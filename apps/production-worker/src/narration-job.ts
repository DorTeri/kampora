import { and, eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import {
  evaluateGenerationRequest,
  generationIdempotencyKey,
  usdToMicro,
  type BudgetPolicy,
  type PriceCatalog,
} from '@kampora/cost-engine';
import {
  approvals,
  campaignBriefs,
  generatedAssets,
  generationJobs,
  pronunciationEntries,
  recordUsage,
  spentUsdFor,
  storyboards,
  videoProjects,
  type Database,
} from '@kampora/database';
import {
  buildSpeechCues,
  planNarration,
  probeBufferDurationSec,
  TtsProviderError,
  wordsFromAlignment,
  type TtsProvider,
  type TtsResult,
  type TtsSetup,
  type WordTiming,
} from '@kampora/hebrew-voice';
import type { NarrationJobPayload, NarrationSegment, NarrationState, VoiceOption } from '@kampora/shared';
import type { StorageDriver } from '@kampora/storage';

export interface NarrationJobDeps {
  db: Database;
  storage: StorageDriver;
  catalog: PriceCatalog;
  policy: BudgetPolicy;
  setup: TtsSetup;
  logger: Logger;
  createProvider: (voice: VoiceOption) => TtsProvider;
  /** Injected for tests (default: ffprobe). */
  probeDuration?: (bytes: Buffer, extension: string) => Promise<number>;
  sleep?: (ms: number) => Promise<void>;
}

interface CachedMetadata {
  sceneKey: string;
  durationSec: number;
  words: WordTiming[];
  spoken: string;
}

const OUTPUT_FORMAT = 'mp3_44100_128';

export class NarrationDeniedError extends Error {}

/**
 * Records narration for a project, one storyboard scene per segment (independent segments: a script edit only
 * re-records the changed lines). For each segment: cache lookup by idempotency key → (paid) authorization →
 * synthesize with bounded retries → store → ffprobe duration → speech-timed subtitle cues → ledger.
 */
export async function processNarrationJob(
  deps: NarrationJobDeps,
  payload: NarrationJobPayload,
): Promise<void> {
  const { db, logger } = deps;
  const log = logger.child({ projectId: payload.projectId, orgId: payload.orgId, job: 'narration' });
  const scope = and(eq(videoProjects.id, payload.projectId), eq(videoProjects.orgId, payload.orgId));
  const [project] = await db.select().from(videoProjects).where(scope);
  if (!project?.narration) throw new NarrationDeniedError('Project or narration request not found');
  const state: NarrationState = { ...project.narration, status: 'RUNNING', segments: [], error: undefined };

  const save = (patch: Partial<NarrationState>) => {
    Object.assign(state, patch, { updatedAt: new Date().toISOString() });
    return db
      .update(videoProjects)
      .set({ narration: { ...state } })
      .where(scope);
  };

  try {
    const voice = deps.setup.voices.find((v) => v.id === state.voiceId);
    if (!voice || !deps.setup.ready) throw new NarrationDeniedError('Voice provider not configured');
    const [sb] = await db.select().from(storyboards).where(eq(storyboards.id, project.storyboardId));
    const [brief] = await db.select().from(campaignBriefs).where(eq(campaignBriefs.id, project.briefId));
    const pronunciation = await db
      .select()
      .from(pronunciationEntries)
      .where(
        and(
          eq(pronunciationEntries.businessId, project.businessId),
          eq(pronunciationEntries.orgId, payload.orgId),
        ),
      );
    const storyboard = sb!.storyboard;
    const plan = planNarration(storyboard, {
      provider: voice.provider,
      modelId: voice.modelId,
      pronunciation: pronunciation.map((p) => ({
        term: p.term,
        spoken: p.spoken,
        caseSensitive: p.caseSensitive,
      })),
      targetDurationSec: Math.round(storyboard.scenes.reduce((s, x) => s + x.durationSec, 0)),
      audioTags: deps.setup.audioTags,
      selectiveNiqqud: deps.setup.selectiveNiqqud,
    });
    if (plan.scriptCheck.status === 'TOO_LONG')
      throw new NarrationDeniedError(plan.scriptCheck.message ?? 'Script too long');
    await save({ scriptHash: plan.scriptHash });

    const provider = deps.createProvider(voice);
    const price = deps.catalog.find(voice.provider, voice.modelId, 'TTS');
    if (provider.paid)
      await assertPaidAllowed(
        deps,
        project.id,
        payload.orgId,
        project.briefId,
        voice,
        plan.characters,
        price,
      );

    for (const segment of plan.segments) {
      const key = generationIdempotencyKey(provider.id, provider.model, 'TTS', {
        voiceId: voice.id,
        text: segment.speech.payload,
        settings: segment.speech.settings,
        outputFormat: provider.id === 'elevenlabs' ? OUTPUT_FORMAT : 'wav',
      });

      const [cached] = await db
        .select()
        .from(generatedAssets)
        .where(and(eq(generatedAssets.orgId, payload.orgId), eq(generatedAssets.idempotencyKey, key)));
      let assetId: string;
      let durationSec: number;
      let words: WordTiming[];
      let cachedHit = false;

      if (cached) {
        const meta = cached.metadata as unknown as CachedMetadata;
        assetId = cached.id;
        durationSec = meta.durationSec;
        words = meta.words ?? [];
        cachedHit = true;
        await recordUsage(db, {
          orgId: payload.orgId,
          videoProjectId: project.id,
          operation: 'TTS',
          provider: provider.id,
          model: provider.model,
          quantity: 0,
          unit: 'character',
          step: `narration.${segment.sceneKey}`,
          chargeType: provider.paid ? 'ESTIMATED' : 'SIMULATED',
          amountMicroUsd: 0,
          success: true,
          reused: true,
          accepted: true,
          note: 'cache hit: identical text/voice/model/settings',
        });
      } else {
        const result = await synthesizeWithRetries(
          deps,
          provider,
          voice,
          segment.sceneKey,
          segment.speech,
          project.id,
          payload.orgId,
          price,
          log,
        );
        const ext = result.mimeType === 'audio/wav' ? 'wav' : 'mp3';
        durationSec = await (deps.probeDuration ?? probeBufferDurationSec)(result.audio, ext);
        words = wordsFromAlignment(result.alignment);
        const storageKey = `orgs/${payload.orgId}/narration/${project.id}/${segment.sceneKey}-${key.slice(0, 16)}.${ext}`;
        await deps.storage.put(storageKey, result.audio, result.mimeType);
        const metadata: CachedMetadata & Record<string, unknown> = {
          sceneKey: segment.sceneKey,
          durationSec,
          words,
          spoken: segment.speech.payload,
          characters: result.characters,
          alignment: Boolean(result.alignment),
          requestId: result.requestId,
        };
        const [asset] = await db
          .insert(generatedAssets)
          .values({
            orgId: payload.orgId,
            videoProjectId: project.id,
            kind: 'audio',
            storageKey,
            mimeType: result.mimeType,
            provider: provider.id,
            model: provider.model,
            idempotencyKey: key,
            provenance: {
              source:
                provider.id === 'mock'
                  ? 'PROGRAMMATIC'
                  : provider.id === 'supplied'
                    ? 'CUSTOMER_UPLOAD'
                    : 'AI_GENERATED',
              license:
                provider.id === 'mock'
                  ? 'Kampora mock audio (not speech)'
                  : `${provider.id} generated narration`,
              commercialUse: provider.id !== 'mock',
              provider: provider.id,
            },
            accepted: true,
            metadata,
          })
          .returning({ id: generatedAssets.id });
        assetId = asset!.id;
        const estimatedUsd = price ? deps.catalog.estimate(price, result.characters) : 0;
        await db.insert(generationJobs).values({
          orgId: payload.orgId,
          videoProjectId: project.id,
          operation: 'TTS',
          provider: provider.id,
          model: provider.model,
          status: 'SUCCEEDED',
          idempotencyKey: key,
          input: {
            operation: 'TTS',
            provider: provider.id,
            model: provider.model,
            quantity: result.characters,
            unit: 'character',
            estimatedCostUsd: estimatedUsd,
            paid: provider.paid,
            purpose: `narration:${segment.sceneKey}`,
          },
          attempt: 1,
          maxAttempts: deps.policy.maxAttemptsPerAsset,
          estimatedMicroUsd: usdToMicro(estimatedUsd),
          resultAssetId: assetId,
        });
      }

      const { cues, timing } = buildSpeechCues(segment.original, words, durationSec, {
        pronunciation: pronunciation.map((p) => ({
          term: p.term,
          spoken: p.spoken,
          caseSensitive: p.caseSensitive,
        })),
      });
      const done: NarrationSegment = {
        sceneKey: segment.sceneKey,
        assetId,
        durationSec,
        cues,
        timing,
        cached: cachedHit,
        spokenText: segment.speech.payload,
      };
      await save({ segments: [...state.segments, done] });
      log.info(
        { sceneKey: segment.sceneKey, durationSec, cached: cachedHit, timing },
        'narration segment ready',
      );
    }

    const totalSec = Math.round(state.segments.reduce((s, x) => s + x.durationSec, 0) * 100) / 100;
    const target = brief?.brief.targetDurationSec ?? 20;
    const warnings = [...state.warnings];
    if (totalSec > target * 1.3)
      warnings.push(`NARRATION_LONG: ${totalSec}s of speech for a ${target}s target`);
    await save({ status: 'READY', totalSec, warnings });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ err: message }, 'narration failed');
    await save({ status: 'FAILED', error: message.slice(0, 500) });
  }
}

/** Defense in depth: the API already checked, but the worker never calls a paid provider without re-checking. */
async function assertPaidAllowed(
  deps: NarrationJobDeps,
  projectId: string,
  orgId: string,
  briefId: string,
  voice: VoiceOption,
  characters: number,
  price: ReturnType<PriceCatalog['find']>,
) {
  if (!deps.policy.paidGenerationEnabled) throw new NarrationDeniedError('Paid generation is disabled');
  if (!price) throw new NarrationDeniedError(`No price entry for ${voice.provider}/${voice.modelId}`);
  const estimate = deps.catalog.estimate(price, characters);
  const rows = await deps.db
    .select({ amount: approvals.approvedEstimateMicroUsd, ref: approvals.subjectRef })
    .from(approvals)
    .where(
      and(
        eq(approvals.orgId, orgId),
        eq(approvals.videoProjectId, projectId),
        eq(approvals.subject, 'NARRATION'),
      ),
    );
  const approved =
    rows.filter((r) => r.ref === `${voice.id}:${voice.modelId}`).reduce((m, r) => Math.max(m, r.amount), 0) /
    1e6;
  if (approved + 0.005 < estimate) throw new NarrationDeniedError('Narration cost not approved');
  const spent = await spentUsdFor(deps.db, orgId, { projectIds: [projectId], briefIds: [briefId] });
  const decision = evaluateGenerationRequest(
    {
      ...deps.policy,
      perGenerationMaxUsd: Number.POSITIVE_INFINITY,
      maxConcurrentPaidGenerations: Number.POSITIVE_INFINITY,
    },
    { confirmedSpendUsd: spent, reservedUsd: 0, activePaidGenerations: 0 },
    { estimatedUsd: estimate, attempt: 1, paid: true, approved: true },
  );
  if (!decision.allowed) throw new NarrationDeniedError(`Budget denied: ${decision.reasons.join(', ')}`);
}

async function synthesizeWithRetries(
  deps: NarrationJobDeps,
  provider: TtsProvider,
  voice: VoiceOption,
  sceneKey: string,
  speech: Parameters<TtsProvider['synthesize']>[0]['speech'],
  projectId: string,
  orgId: string,
  price: ReturnType<PriceCatalog['find']>,
  log: Logger,
): Promise<TtsResult> {
  const max = Math.max(1, deps.policy.maxAttemptsPerAsset);
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await provider.synthesize({ segmentKey: sceneKey, speech, voiceId: voice.id });
      await recordUsage(deps.db, {
        orgId,
        videoProjectId: projectId,
        operation: 'TTS',
        provider: provider.id,
        model: provider.model,
        quantity: result.characters,
        unit: 'character',
        step: `narration.${sceneKey}`,
        chargeType: result.chargeType === 'NONE' ? 'SIMULATED' : result.chargeType,
        amountMicroUsd: usdToMicro(price ? deps.catalog.estimate(price, result.characters) : 0),
        attempt,
        success: true,
        accepted: true,
        metadata: { requestId: result.requestId, alignment: Boolean(result.alignment) },
      });
      return result;
    } catch (error) {
      const retryable = error instanceof TtsProviderError && error.retryable;
      await recordUsage(deps.db, {
        orgId,
        videoProjectId: projectId,
        operation: 'TTS',
        provider: provider.id,
        model: provider.model,
        quantity: 0,
        unit: 'character',
        step: `narration.${sceneKey}`,
        chargeType: provider.paid ? 'ESTIMATED' : 'SIMULATED',
        amountMicroUsd: 0,
        attempt,
        success: false,
        note: (error instanceof Error ? error.message : String(error)).slice(0, 300),
      });
      if (!retryable || attempt >= max) throw error;
      log.warn({ sceneKey, attempt }, 'tts attempt failed; retrying');
      await sleep(1500 * attempt);
    }
  }
}
