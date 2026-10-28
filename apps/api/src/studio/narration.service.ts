import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import { evaluateGenerationRequest, type BudgetPolicy, type PriceCatalog } from '@kampora/cost-engine';
import {
  approvals,
  generatedAssets,
  spentUsdFor,
  storyboards,
  videoProjects,
  type Database,
} from '@kampora/database';
import {
  planContinuousNarration,
  planNarration,
  scriptHash,
  VOICE_STYLES,
  type TtsSetup,
} from '@kampora/hebrew-voice';
import type {
  MediaAsset,
  NarrationMode,
  NarrationJobPayload,
  VoiceStyle,
  NarrationState,
  SpeechCue,
  Storyboard,
  VoiceOption,
} from '@kampora/shared';
import type { StorageDriver } from '@kampora/storage';
import type { AuthContext } from '../common/auth';
import { ApiError, notFound } from '../common/errors';
import { BUDGET_POLICY, DATABASE, NARRATION_QUEUE, PRICE_CATALOG, STORAGE, TTS_SETUP } from '../infra/tokens';
import { BusinessService } from './business.service';

type ProjectRow = typeof videoProjects.$inferSelect;

export interface NarrationOptions {
  mode: NarrationMode;
  style: VoiceStyle;
  /** Quote/record only this scene's line (replacing it in an existing narration). */
  sceneKey?: string;
}

export interface NarrationQuote {
  mode: NarrationMode;
  style: VoiceStyle;
  sceneKey?: string;
  provider: TtsSetup['provider'];
  ready: boolean;
  reason?: string;
  paid: boolean;
  paidEnabled: boolean;
  voice: VoiceOption;
  characters: number;
  /** ESTIMATED: ElevenLabs bills in plan credits; this is our USD planning estimate. */
  estimatedUsd: number;
  estimatedSec: number;
  scriptCheck: {
    status: 'OK' | 'LONG' | 'TOO_LONG';
    message?: string;
    estimatedSec: number;
    targetSec: number;
  };
  lines: Array<{ sceneKey: string; original: string; spoken: string; estimatedSec: number }>;
  warnings: string[];
}

/** Narration: voice choice, quote, approval-gated generation (worker job), and timeline inputs. */
@Injectable()
export class NarrationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    @Inject(NARRATION_QUEUE) private readonly queue: Queue,
    @Inject(TTS_SETUP) private readonly setup: TtsSetup,
    @Inject(PRICE_CATALOG) private readonly catalog: PriceCatalog,
    @Inject(BUDGET_POLICY) private readonly policy: BudgetPolicy,
    private readonly businesses: BusinessService,
  ) {}

  voices() {
    return {
      provider: this.setup.provider,
      ready: this.setup.ready,
      reason: this.setup.reason,
      paid: this.setup.paid,
      paidEnabled: this.policy.paidGenerationEnabled,
      voices: this.setup.voices,
      styles: Object.entries(VOICE_STYLES).map(([id, s]) => ({
        id,
        label: s.label,
        description: s.description,
      })),
    };
  }

  private voice(voiceId: string): VoiceOption {
    const voice = this.setup.voices.find((v) => v.id === voiceId);
    if (!voice) throw new ApiError(HttpStatus.BAD_REQUEST, 'UNKNOWN_VOICE', 'Unknown voice');
    return voice;
  }

  private async projectContext(ctx: AuthContext, projectId: string) {
    const [project] = await this.db
      .select()
      .from(videoProjects)
      .where(and(eq(videoProjects.id, projectId), eq(videoProjects.orgId, ctx.orgId)));
    if (!project) throw notFound('Project');
    const [sb] = await this.db.select().from(storyboards).where(eq(storyboards.id, project.storyboardId));
    const profile = await this.businesses.loadProfile(ctx, project.businessId);
    return { project, storyboard: sb!.storyboard, profile };
  }

  async quote(
    ctx: AuthContext,
    projectId: string,
    voiceId: string,
    options: NarrationOptions = { mode: 'continuous', style: 'natural' },
  ): Promise<NarrationQuote> {
    const voice = this.voice(voiceId);
    const { storyboard, profile } = await this.projectContext(ctx, projectId);
    const base = {
      provider: voice.provider,
      modelId: voice.modelId,
      pronunciation: profile.pronunciation,
      targetDurationSec: Math.round(storyboard.scenes.reduce((s, x) => s + x.durationSec, 0)),
      audioTags: this.setup.audioTags,
      selectiveNiqqud: this.setup.selectiveNiqqud,
      style: options.style,
    };
    const perScene = planNarration(storyboard, base);
    let plan: Pick<typeof perScene, 'characters' | 'estimatedSec' | 'scriptCheck' | 'warnings'> = perScene;
    let lines = perScene.segments.map((s) => ({
      sceneKey: s.sceneKey,
      original: s.original,
      spoken: s.speech.payload,
      estimatedSec: s.estimatedSec,
    }));
    if (options.sceneKey) {
      const line = perScene.segments.find((s) => s.sceneKey === options.sceneKey);
      if (!line) throw new ApiError(HttpStatus.BAD_REQUEST, 'UNKNOWN_SCENE', 'Scene has no narration line');
      lines = lines.filter((l) => l.sceneKey === options.sceneKey);
      plan = {
        ...perScene,
        characters: line.speech.characters,
        estimatedSec: line.estimatedSec,
        warnings: line.warnings,
      };
    } else if (options.mode === 'continuous') {
      const continuous = planContinuousNarration(storyboard, base);
      plan = { ...continuous, characters: continuous.script.characters };
      lines = continuous.script.lines.map((l) => ({
        sceneKey: l.sceneKey,
        original: l.original,
        spoken: l.spoken,
        estimatedSec: l.estimatedSec,
      }));
    }
    const price = this.catalog.find(voice.provider, voice.modelId, 'TTS');
    const estimatedUsd = price ? this.catalog.estimate(price, plan.characters) : 0;
    return {
      mode: options.mode,
      style: options.style,
      sceneKey: options.sceneKey,
      provider: this.setup.provider,
      ready: this.setup.ready,
      reason: this.setup.reason,
      paid: this.setup.paid,
      paidEnabled: this.policy.paidGenerationEnabled,
      voice,
      characters: plan.characters,
      estimatedUsd: Math.ceil(estimatedUsd * 100) / 100,
      estimatedSec: plan.estimatedSec,
      scriptCheck: plan.scriptCheck,
      lines,
      warnings: plan.warnings,
    };
  }

  /**
   * Starts narration. Paid voices require: provider ready, global paid switch, script approved, script length
   * OK, an explicit approval ≥ the current estimate, and budget headroom. The worker re-checks before calling.
   */
  async request(
    ctx: AuthContext,
    projectId: string,
    voiceId: string,
    approvedUsd?: number,
    options: NarrationOptions = { mode: 'continuous', style: 'natural' },
  ) {
    const { project } = await this.projectContext(ctx, projectId);
    if (options.sceneKey) {
      const n = project.narration;
      if (!n || n.status !== 'READY' || n.voiceId !== voiceId) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'NARRATION_NOT_READY',
          'Record the narration with this voice before replacing a line',
        );
      }
      options = { ...options, mode: n.mode ?? 'per-scene', style: n.style ?? options.style };
    }
    if (!project.scriptApprovedAt) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'SCRIPT_NOT_APPROVED',
        'Approve the script before recording narration',
      );
    }
    if (project.status === 'RENDERING') {
      throw new ApiError(HttpStatus.CONFLICT, 'RENDER_IN_PROGRESS', 'Wait for the render to finish');
    }
    if (project.narration && ['QUEUED', 'RUNNING'].includes(project.narration.status))
      return project.narration;

    const quote = await this.quote(ctx, projectId, voiceId, options);
    if (!quote.ready) {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'PROVIDER_NOT_CONFIGURED',
        'Voice provider is not configured',
        {
          reason: quote.reason,
        },
      );
    }
    if (quote.scriptCheck.status === 'TOO_LONG') {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'SCRIPT_TOO_LONG',
        quote.scriptCheck.message ?? 'Script too long',
        quote.scriptCheck,
      );
    }
    if (quote.paid) {
      if (!this.policy.paidGenerationEnabled) {
        throw new ApiError(HttpStatus.CONFLICT, 'PAID_GENERATION_DISABLED', 'Paid generation is disabled');
      }
      if (approvedUsd === undefined || approvedUsd + 1e-9 < quote.estimatedUsd) {
        throw new ApiError(
          HttpStatus.CONFLICT,
          'PAID_APPROVAL_REQUIRED',
          'Approve the narration cost first',
          { quote },
        );
      }
      const spent = await spentUsdFor(this.db, ctx.orgId, {
        projectIds: [projectId],
        briefIds: [project.briefId],
      });
      const decision = evaluateGenerationRequest(
        {
          ...this.policy,
          perGenerationMaxUsd: Number.POSITIVE_INFINITY,
          maxConcurrentPaidGenerations: Number.POSITIVE_INFINITY,
        },
        { confirmedSpendUsd: spent, reservedUsd: 0, activePaidGenerations: 0 },
        { estimatedUsd: quote.estimatedUsd, attempt: 1, paid: true, approved: true },
      );
      if (!decision.allowed) {
        throw new ApiError(HttpStatus.CONFLICT, 'BUDGET_DENIED', 'Narration exceeds the project budget', {
          reasons: decision.reasons,
        });
      }
      await this.db.insert(approvals).values({
        orgId: ctx.orgId,
        videoProjectId: projectId,
        subject: 'NARRATION',
        subjectRef: `${quote.voice.id}:${quote.voice.modelId}`,
        decision: 'APPROVED',
        approvedEstimateMicroUsd: Math.round(approvedUsd * 1_000_000),
        decidedBy: ctx.userId,
      });
    }

    const payload: NarrationJobPayload = { projectId, orgId: ctx.orgId, replaceSceneKey: options.sceneKey };
    const queueOptions = {
      jobId: `narration-${projectId}-${Date.now()}`,
      attempts: 1, // retries happen per request inside the job, bounded by MAX_GENERATION_ATTEMPTS
      removeOnComplete: 200,
      removeOnFail: 500,
    };
    if (options.sceneKey) {
      // Keep the recorded narration visible while one line is re-recorded.
      const state: NarrationState = {
        ...project.narration!,
        status: 'QUEUED',
        updatedAt: new Date().toISOString(),
      };
      await this.db.update(videoProjects).set({ narration: state }).where(eq(videoProjects.id, projectId));
      await this.queue.add('narrate', payload, queueOptions);
      return state;
    }

    const state: NarrationState = {
      status: 'QUEUED',
      mode: options.mode,
      style: options.style,
      provider: quote.voice.provider,
      voiceId: quote.voice.id,
      voiceLabel: quote.voice.label,
      modelId: quote.voice.modelId,
      scriptHash: '',
      segments: [],
      totalSec: 0,
      estimate: { characters: quote.characters, usd: quote.estimatedUsd },
      warnings: quote.warnings,
      updatedAt: new Date().toISOString(),
    };
    await this.db.update(videoProjects).set({ narration: state }).where(eq(videoProjects.id, projectId));
    await this.queue.add('narrate', payload, queueOptions);
    return state;
  }

  /** Narration state for the UI, with short-lived signed URLs for each recorded line. */
  async describe(ctx: AuthContext, project: ProjectRow, storyboard: Storyboard) {
    const n = project.narration;
    if (!n) return null;
    const ids = [...n.segments.map((s) => s.assetId), ...(n.master ? [n.master.assetId] : [])];
    const rows = ids.length
      ? await this.db
          .select({ id: generatedAssets.id, storageKey: generatedAssets.storageKey })
          .from(generatedAssets)
          .where(and(eq(generatedAssets.orgId, ctx.orgId), inArray(generatedAssets.id, ids)))
      : [];
    const keyById = new Map(rows.map((r) => [r.id, r.storageKey]));
    return {
      ...n,
      stale: n.status === 'READY' && n.scriptHash !== scriptHash(storyboard),
      masterUrl:
        n.master && keyById.has(n.master.assetId)
          ? await this.storage.getReadUrl(keyById.get(n.master.assetId)!, { expiresInSec: 3600 })
          : null,
      segments: await Promise.all(
        n.segments.map(async (s) => ({
          ...s,
          url: keyById.has(s.assetId)
            ? await this.storage.getReadUrl(keyById.get(s.assetId)!, { expiresInSec: 3600 })
            : null,
        })),
      ),
    };
  }

  /**
   * Timeline inputs from a READY narration. A narration for an older script is refused (it would put the
   * wrong words over the scenes).
   */
  async timelineVoiceovers(
    ctx: AuthContext,
    project: ProjectRow,
    storyboard: Storyboard,
  ): Promise<{
    voiceovers: Record<string, { assetId: string; durationSec: number; cues: SpeechCue[]; slice?: boolean }>;
    assets: MediaAsset[];
    key: string;
  } | null> {
    const n = project.narration;
    if (!n) return null;
    if (n.status !== 'READY') {
      throw new ApiError(HttpStatus.CONFLICT, 'NARRATION_NOT_READY', 'Narration is not ready yet');
    }
    if (n.scriptHash !== scriptHash(storyboard)) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'NARRATION_STALE',
        'The script changed after narration was recorded',
      );
    }
    const rows = await this.db
      .select()
      .from(generatedAssets)
      .where(
        and(
          eq(generatedAssets.orgId, ctx.orgId),
          inArray(
            generatedAssets.id,
            n.segments.map((s) => s.assetId),
          ),
        ),
      );
    const assets: MediaAsset[] = rows.map((r) => ({
      id: r.id,
      kind: 'audio',
      storageKey: r.storageKey,
      mimeType: r.mimeType,
      durationSec: Number((r.metadata as { durationSec?: number }).durationSec) || undefined,
      provenance: r.provenance,
    }));
    const voiceovers = Object.fromEntries(
      n.segments.map((s) => [
        s.sceneKey,
        { assetId: s.assetId, durationSec: s.durationSec, cues: s.cues, slice: s.source === 'slice' },
      ]),
    );
    return { voiceovers, assets, key: `${n.voiceId}:${n.segments.map((s) => s.assetId).join(',')}` };
  }
}
