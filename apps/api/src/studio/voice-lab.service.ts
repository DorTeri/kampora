import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { BudgetPolicy, PriceCatalog } from '@kampora/cost-engine';
import { approvals, generatedAssets, voiceLabSamples, type Database } from '@kampora/database';
import {
  VOICE_LAB_CRITERIA,
  VOICE_LAB_SCRIPT,
  VOICE_STYLES,
  directLabScript,
  labScriptHash,
  voiceLabApprovalRef,
  voiceLabCandidates,
  voiceLabExtraVoices,
  type TtsSetup,
  type VoiceLabCandidate,
} from '@kampora/hebrew-voice';
import type { VoiceLabJobPayload, VoiceStyle } from '@kampora/shared';
import type { StorageDriver } from '@kampora/storage';
import type { AuthContext } from '../common/auth';
import { ApiError, notFound } from '../common/errors';
import { BUDGET_POLICY, DATABASE, NARRATION_QUEUE, PRICE_CATALOG, STORAGE, TTS_SETUP } from '../infra/tokens';

export interface VoiceLabQuote {
  candidateId: string;
  style: VoiceStyle;
  spoken: string;
  characters: number;
  estimatedUsd: number;
  estimatedSec: number;
  paid: boolean;
}

/**
 * Internal voice comparison: the same script read by several voice configurations, recorded only on request
 * (paid readings need an approval at least as high as the estimate) and rated by people after listening.
 */
@Injectable()
export class VoiceLabService {
  private readonly candidates: VoiceLabCandidate[];
  private readonly labMaxUsd = Number(process.env.VOICE_LAB_MAX_USD ?? 1);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    @Inject(NARRATION_QUEUE) private readonly queue: Queue,
    @Inject(TTS_SETUP) private readonly setup: TtsSetup,
    @Inject(PRICE_CATALOG) private readonly catalog: PriceCatalog,
    @Inject(BUDGET_POLICY) private readonly policy: BudgetPolicy,
  ) {
    this.candidates = voiceLabCandidates(setup, voiceLabExtraVoices(setup));
  }

  private candidate(id: string): VoiceLabCandidate {
    const c = this.candidates.find((x) => x.id === id);
    if (!c) throw new ApiError(HttpStatus.BAD_REQUEST, 'UNKNOWN_VOICE', 'Unknown voice candidate');
    return c;
  }

  quote(candidateId: string, style: VoiceStyle): VoiceLabQuote {
    const candidate = this.candidate(candidateId);
    const script = directLabScript(candidate, style, {
      audioTags: this.setup.audioTags,
      selectiveNiqqud: this.setup.selectiveNiqqud,
    });
    const price = this.catalog.find(candidate.voice.provider, candidate.voice.modelId, 'TTS');
    return {
      candidateId,
      style,
      spoken: script.payload,
      characters: script.characters,
      estimatedUsd: price ? this.catalog.estimate(price, script.characters) : 0,
      estimatedSec: script.estimatedSec,
      paid: candidate.voice.provider === 'elevenlabs',
    };
  }

  async overview(ctx: AuthContext) {
    const rows = await this.db
      .select()
      .from(voiceLabSamples)
      .where(eq(voiceLabSamples.orgId, ctx.orgId))
      .orderBy(desc(voiceLabSamples.createdAt))
      .limit(60);
    const assetIds = rows.map((r) => r.assetId).filter((x): x is string => Boolean(x));
    const assets = assetIds.length
      ? await this.db
          .select({ id: generatedAssets.id, key: generatedAssets.storageKey })
          .from(generatedAssets)
          .where(and(eq(generatedAssets.orgId, ctx.orgId), inArray(generatedAssets.id, assetIds)))
      : [];
    const keyById = new Map(assets.map((a) => [a.id, a.key]));
    const samples = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        candidateId: r.candidateId,
        provider: r.provider,
        model: r.model,
        voiceId: r.voiceId,
        style: r.style,
        status: r.status,
        error: r.error,
        durationSec: r.durationSec,
        characters: r.characters,
        estimatedUsd: r.estimatedMicroUsd / 1e6,
        chargeType: r.chargeType,
        cached: r.cached,
        current: r.scriptHash === labScriptHash(),
        ratings: r.ratings,
        notes: r.notes,
        ratedAt: r.ratedAt,
        createdAt: r.createdAt,
        url:
          r.assetId && keyById.has(r.assetId)
            ? await this.storage.getReadUrl(keyById.get(r.assetId)!, { expiresInSec: 3600 })
            : null,
      })),
    );
    return {
      provider: this.setup.provider,
      ready: this.setup.ready,
      paidEnabled: this.policy.paidGenerationEnabled,
      labMaxUsd: this.labMaxUsd,
      spentUsd: await this.spentUsd(ctx.orgId),
      script: VOICE_LAB_SCRIPT.map((l) => l.text),
      criteria: VOICE_LAB_CRITERIA,
      styles: Object.entries(VOICE_STYLES).map(([id, s]) => ({ id, label: s.label })),
      candidates: this.candidates.map((c) => ({
        id: c.id,
        group: c.group,
        title: c.title,
        provider: c.voice.provider,
        model: c.voice.modelId,
        voiceId: c.voice.id,
        gender: c.voice.gender ?? null,
        quote: this.quote(c.id, 'natural'),
      })),
      samples,
    };
  }

  async request(ctx: AuthContext, candidateId: string, style: VoiceStyle, approvedUsd?: number) {
    const candidate = this.candidate(candidateId);
    const quote = this.quote(candidateId, style);
    if (quote.paid) {
      if (!this.policy.paidGenerationEnabled) {
        throw new ApiError(HttpStatus.FORBIDDEN, 'PAID_DISABLED', 'Paid generation is disabled');
      }
      if (approvedUsd === undefined || approvedUsd + 0.005 < quote.estimatedUsd) {
        throw new ApiError(
          HttpStatus.BAD_REQUEST,
          'APPROVAL_REQUIRED',
          `Approve the estimated cost ($${quote.estimatedUsd.toFixed(3)}) first`,
        );
      }
      const spent = await this.spentUsd(ctx.orgId);
      if (spent + quote.estimatedUsd > this.labMaxUsd + 1e-9) {
        throw new ApiError(HttpStatus.FORBIDDEN, 'BUDGET_EXCEEDED', 'Voice lab budget reached');
      }
      await this.db.insert(approvals).values({
        orgId: ctx.orgId,
        subject: 'VOICE_TEST',
        subjectRef: voiceLabApprovalRef(candidate, style),
        decision: 'APPROVED',
        approvedEstimateMicroUsd: Math.round(approvedUsd * 1_000_000),
        decidedBy: ctx.userId,
      });
    }
    const [sample] = await this.db
      .insert(voiceLabSamples)
      .values({
        orgId: ctx.orgId,
        candidateId,
        provider: candidate.voice.provider,
        model: candidate.voice.modelId,
        voiceId: candidate.voice.id,
        style,
        scriptHash: labScriptHash(),
        spokenText: quote.spoken,
        characters: quote.characters,
        estimatedMicroUsd: Math.round(quote.estimatedUsd * 1_000_000),
        createdBy: ctx.userId,
      })
      .returning();
    const payload: VoiceLabJobPayload = { orgId: ctx.orgId, sampleId: sample!.id };
    await this.queue.add('voice-lab', payload, {
      jobId: `voice-lab-${sample!.id}`,
      attempts: 1,
      removeOnComplete: 200,
      removeOnFail: 500,
    });
    return { id: sample!.id, status: sample!.status, quote };
  }

  async rate(ctx: AuthContext, sampleId: string, ratings: Record<string, number>, notes?: string) {
    const allowed = new Set<string>(VOICE_LAB_CRITERIA.map((c) => c.id));
    const clean = Object.fromEntries(Object.entries(ratings).filter(([k]) => allowed.has(k)));
    const [row] = await this.db
      .update(voiceLabSamples)
      .set({ ratings: clean, notes: notes ?? null, ratedBy: ctx.userId, ratedAt: new Date() })
      .where(and(eq(voiceLabSamples.id, sampleId), eq(voiceLabSamples.orgId, ctx.orgId)))
      .returning({ id: voiceLabSamples.id });
    if (!row) throw notFound('Sample');
    return { id: row.id, ratings: clean, notes: notes ?? null };
  }

  private async spentUsd(orgId: string): Promise<number> {
    const rows = await this.db
      .select({ usd: voiceLabSamples.estimatedMicroUsd, chargeType: voiceLabSamples.chargeType })
      .from(voiceLabSamples)
      .where(
        and(
          eq(voiceLabSamples.orgId, orgId),
          eq(voiceLabSamples.status, 'SUCCEEDED'),
          eq(voiceLabSamples.cached, false),
          isNotNull(voiceLabSamples.chargeType),
        ),
      );
    return rows.filter((r) => r.chargeType !== 'SIMULATED').reduce((s, r) => s + r.usd, 0) / 1e6;
  }
}
