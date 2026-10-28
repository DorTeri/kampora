import { and, eq, isNotNull } from 'drizzle-orm';
import type { Logger } from 'pino';
import {
  generationIdempotencyKey,
  usdToMicro,
  type BudgetPolicy,
  type PriceCatalog,
} from '@kampora/cost-engine';
import { approvals, generatedAssets, recordUsage, voiceLabSamples, type Database } from '@kampora/database';
import {
  directLabScript,
  probeBufferDurationSec,
  voiceLabApprovalRef,
  voiceLabCandidates,
  type PreparedSpeech,
  type TtsProvider,
  type TtsSetup,
} from '@kampora/hebrew-voice';
import type { VoiceLabJobPayload, VoiceOption, VoiceStyle } from '@kampora/shared';
import type { StorageDriver } from '@kampora/storage';

export interface VoiceLabJobDeps {
  db: Database;
  storage: StorageDriver;
  catalog: PriceCatalog;
  policy: BudgetPolicy;
  setup: TtsSetup;
  logger: Logger;
  createProvider: (voice: VoiceOption) => TtsProvider;
  /** Group C voices (VOICE_LAB_VOICES). */
  extraVoices: VoiceOption[];
  /** Cumulative cap (USD) for paid lab readings per organization. */
  labMaxUsd: number;
  probeDuration?: (bytes: Buffer, extension: string) => Promise<number>;
}

const OUTPUT_FORMAT = 'mp3_44100_128';

class LabDeniedError extends Error {}

/**
 * One voice-lab reading: the fixed lab script, directed for the candidate + style, recorded in one request.
 * Paid voices need the kill switch on, an approval at least as high as the estimate, and room under the lab cap.
 * Identical readings are reused (never paid twice).
 */
export async function processVoiceLabJob(deps: VoiceLabJobDeps, payload: VoiceLabJobPayload): Promise<void> {
  const log = deps.logger.child({ sampleId: payload.sampleId });
  const [sample] = await deps.db
    .select()
    .from(voiceLabSamples)
    .where(and(eq(voiceLabSamples.id, payload.sampleId), eq(voiceLabSamples.orgId, payload.orgId)));
  if (!sample || sample.status !== 'QUEUED') return;
  const update = (patch: Partial<typeof voiceLabSamples.$inferInsert>) =>
    deps.db.update(voiceLabSamples).set(patch).where(eq(voiceLabSamples.id, sample.id));

  try {
    await update({ status: 'RUNNING' });
    const candidate = voiceLabCandidates(deps.setup, deps.extraVoices).find(
      (c) => c.id === sample.candidateId,
    );
    if (!candidate) throw new LabDeniedError(`Unknown voice candidate ${sample.candidateId}`);
    const style = sample.style as VoiceStyle;
    const script = directLabScript(candidate, style, {
      audioTags: deps.setup.audioTags,
      selectiveNiqqud: deps.setup.selectiveNiqqud,
    });
    if (script.payload !== sample.spokenText)
      throw new LabDeniedError('The lab script changed since the quote');

    const provider = deps.createProvider(candidate.voice);
    const price = deps.catalog.find(candidate.voice.provider, candidate.voice.modelId, 'TTS');
    const estimateUsd = price ? deps.catalog.estimate(price, script.characters) : 0;
    const key = generationIdempotencyKey(provider.id, provider.model, 'TTS', {
      voiceId: candidate.voice.id,
      text: script.payload,
      settings: script.settings,
      outputFormat: provider.id === 'elevenlabs' ? OUTPUT_FORMAT : 'wav',
      mode: 'continuous',
    });

    const [cached] = await deps.db
      .select()
      .from(generatedAssets)
      .where(and(eq(generatedAssets.orgId, payload.orgId), eq(generatedAssets.idempotencyKey, key)));
    if (cached) {
      const meta = cached.metadata as { durationSec?: number };
      await update({
        status: 'SUCCEEDED',
        assetId: cached.id,
        durationSec: meta.durationSec ?? null,
        cached: true,
        chargeType: provider.paid ? 'ESTIMATED' : 'SIMULATED',
      });
      log.info({ candidate: candidate.id }, 'voice lab reading reused');
      return;
    }

    if (provider.paid)
      await assertLabSpendAllowed(deps, payload.orgId, candidate.id, style, estimateUsd, price);

    const speech: PreparedSpeech = {
      provider: provider.id,
      format: 'text',
      payload: script.payload,
      characters: script.characters,
      settings: script.settings,
      ambiguities: [],
    };
    const step = `voice-lab.${candidate.group}`;
    let result;
    try {
      result = await provider.synthesize({ segmentKey: 'voice-lab', speech, voiceId: candidate.voice.id });
    } catch (error) {
      await recordUsage(deps.db, {
        orgId: payload.orgId,
        operation: 'TTS',
        provider: provider.id,
        model: provider.model,
        quantity: 0,
        unit: 'character',
        step,
        chargeType: provider.paid ? 'ESTIMATED' : 'SIMULATED',
        amountMicroUsd: 0,
        success: false,
        note: (error instanceof Error ? error.message : String(error)).slice(0, 300),
      });
      throw error;
    }
    const chargeType = result.chargeType === 'NONE' ? 'SIMULATED' : result.chargeType;
    await recordUsage(deps.db, {
      orgId: payload.orgId,
      operation: 'TTS',
      provider: provider.id,
      model: provider.model,
      quantity: result.characters,
      unit: 'character',
      step,
      chargeType,
      amountMicroUsd: usdToMicro(price ? deps.catalog.estimate(price, result.characters) : 0),
      success: true,
      accepted: true,
      metadata: { requestId: result.requestId, sampleId: sample.id },
    });

    const ext = result.mimeType === 'audio/wav' ? 'wav' : 'mp3';
    const durationSec = await (deps.probeDuration ?? probeBufferDurationSec)(result.audio, ext);
    const storageKey = `orgs/${payload.orgId}/voice-lab/${sample.id}.${ext}`;
    await deps.storage.put(storageKey, result.audio, result.mimeType);
    const [asset] = await deps.db
      .insert(generatedAssets)
      .values({
        orgId: payload.orgId,
        kind: 'audio',
        storageKey,
        mimeType: result.mimeType,
        provider: provider.id,
        model: provider.model,
        idempotencyKey: key,
        provenance: {
          source: provider.id === 'mock' ? 'PROGRAMMATIC' : 'AI_GENERATED',
          license:
            provider.id === 'mock' ? 'Kampora mock audio (not speech)' : `${provider.id} voice-lab reading`,
          commercialUse: false,
          provider: provider.id,
          notes: 'Internal voice comparison sample',
        },
        accepted: true,
        metadata: { durationSec, spoken: script.payload, characters: result.characters, voiceLab: true },
      })
      .returning({ id: generatedAssets.id });
    await update({ status: 'SUCCEEDED', assetId: asset!.id, durationSec, cached: false, chargeType });
    log.info({ candidate: candidate.id, durationSec }, 'voice lab reading ready');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn({ err: message }, 'voice lab reading failed');
    await update({ status: 'FAILED', error: message.slice(0, 500) });
  }
}

async function assertLabSpendAllowed(
  deps: VoiceLabJobDeps,
  orgId: string,
  candidateId: string,
  style: VoiceStyle,
  estimateUsd: number,
  price: unknown,
) {
  if (!deps.policy.paidGenerationEnabled) throw new LabDeniedError('Paid generation is disabled');
  if (!price) throw new LabDeniedError('No price entry for this voice model');
  const candidate = voiceLabCandidates(deps.setup, deps.extraVoices).find((c) => c.id === candidateId)!;
  const ref = voiceLabApprovalRef(candidate, style);
  const rows = await deps.db
    .select({ amount: approvals.approvedEstimateMicroUsd })
    .from(approvals)
    .where(
      and(eq(approvals.orgId, orgId), eq(approvals.subject, 'VOICE_TEST'), eq(approvals.subjectRef, ref)),
    );
  const approved = rows.reduce((m, r) => Math.max(m, r.amount), 0) / 1e6;
  if (approved + 0.005 < estimateUsd) throw new LabDeniedError('Voice test cost not approved');
  const spent = await labSpentUsd(deps.db, orgId);
  if (spent + estimateUsd > deps.labMaxUsd + 1e-9) {
    throw new LabDeniedError(`Voice lab cap reached ($${spent.toFixed(2)} of $${deps.labMaxUsd.toFixed(2)})`);
  }
}

/** Paid lab spend so far: successful, non-reused paid readings. */
export async function labSpentUsd(db: Database, orgId: string): Promise<number> {
  const rows = await db
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
