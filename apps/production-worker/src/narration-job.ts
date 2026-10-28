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
  decodeToPcm,
  detectSilences,
  NARRATION_SAMPLE_RATE,
  planContinuousNarration,
  planNarration,
  probeBufferDurationSec,
  sceneCutsFromAlignment,
  sceneCutsFromSilences,
  shiftWords,
  slicePcm,
  TtsProviderError,
  wordsFromAlignment,
  type CharacterAlignment,
  type DirectedScript,
  type PreparedSpeech,
  type TtsProvider,
  type TtsResult,
  type TtsSetup,
  type WordTiming,
} from '@kampora/hebrew-voice';
import type {
  AssetProvenance,
  NarrationJobPayload,
  NarrationSegment,
  NarrationState,
  PronunciationEntry,
  VoiceOption,
} from '@kampora/shared';
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

interface MasterMetadata {
  durationSec: number;
  alignment: CharacterAlignment | null;
  spoken: string;
}

const OUTPUT_FORMAT = 'mp3_44100_128';
/** Timeline frame rate the continuous narration is cut for (VideoProject default). */
export const NARRATION_FPS = 30;

export class NarrationDeniedError extends Error {}

type Price = ReturnType<PriceCatalog['find']>;

interface SegmentContext {
  deps: NarrationJobDeps;
  provider: TtsProvider;
  voice: VoiceOption;
  price: Price;
  projectId: string;
  orgId: string;
  log: Logger;
}

/**
 * Records narration for a project in one of three ways:
 *  - continuous: the whole directed script as ONE recording (natural flow between lines), cut at the pauses
 *    into one frame-exact clip per scene;
 *  - per-scene: one recording per scene line (Phase 2 behavior; a script edit only re-records changed lines);
 *  - replace: re-record a single scene line, keeping every other segment.
 * Every paid call: cache lookup by idempotency key → (paid) authorization → bounded retries → store → ledger.
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
  const previous = project.narration;
  const state: NarrationState = { ...previous, status: 'RUNNING', segments: [], error: undefined };

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
    const lexicon: PronunciationEntry[] = pronunciation.map((p) => ({
      term: p.term,
      spoken: p.spoken,
      caseSensitive: p.caseSensitive,
    }));
    const planOptions = {
      provider: voice.provider,
      modelId: voice.modelId,
      pronunciation: lexicon,
      targetDurationSec: Math.round(storyboard.scenes.reduce((s, x) => s + x.durationSec, 0)),
      audioTags: deps.setup.audioTags,
      selectiveNiqqud: deps.setup.selectiveNiqqud,
    };
    const provider = deps.createProvider(voice);
    const price = deps.catalog.find(voice.provider, voice.modelId, 'TTS');
    const ctx: SegmentContext = {
      deps,
      provider,
      voice,
      price,
      projectId: project.id,
      orgId: payload.orgId,
      log,
    };
    const authorize = async (characters: number) => {
      if (provider.paid)
        await assertPaidAllowed(deps, project.id, payload.orgId, project.briefId, voice, characters, price);
    };

    if (payload.replaceSceneKey) {
      if (!previous.segments.length) throw new NarrationDeniedError('There is no narration to update yet');
      const plan = planNarration(storyboard, { ...planOptions, style: state.style ?? 'natural' });
      const line = plan.segments.find((x) => x.sceneKey === payload.replaceSceneKey);
      if (!line) throw new NarrationDeniedError(`Scene "${payload.replaceSceneKey}" has no line to record`);
      await authorize(line.speech.characters);
      const done = await recordSeparateSegment(ctx, line.sceneKey, line.original, line.speech, lexicon);
      const kept = previous.segments.filter((x) => plan.segments.some((p) => p.sceneKey === x.sceneKey));
      const segments = kept.some((x) => x.sceneKey === done.sceneKey)
        ? kept.map((x) => (x.sceneKey === done.sceneKey ? done : x))
        : [...kept, done];
      await save({ segments, scriptHash: plan.scriptHash });
    } else if (state.mode === 'continuous') {
      const plan = planContinuousNarration(storyboard, { ...planOptions, style: state.style ?? 'natural' });
      if (plan.scriptCheck.status === 'TOO_LONG')
        throw new NarrationDeniedError(plan.scriptCheck.message ?? 'Script too long');
      await save({ scriptHash: plan.scriptHash });
      await authorize(plan.script.characters);
      await recordContinuous(ctx, plan.script, lexicon, save);
    } else {
      // Stored Phase 2 requests have no style: they keep their original (undirected) preparation.
      const plan = planNarration(storyboard, { ...planOptions, style: state.style });
      if (plan.scriptCheck.status === 'TOO_LONG')
        throw new NarrationDeniedError(plan.scriptCheck.message ?? 'Script too long');
      await save({ scriptHash: plan.scriptHash });
      await authorize(plan.characters);
      for (const segment of plan.segments) {
        const done = await recordSeparateSegment(
          ctx,
          segment.sceneKey,
          segment.original,
          segment.speech,
          lexicon,
        );
        await save({ segments: [...state.segments, done] });
      }
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
    // A failed single-line replacement keeps the narration that was already there.
    if (payload.replaceSceneKey && previous.segments.length) {
      await save({
        ...previous,
        status: 'READY',
        error: `Replacing a line failed: ${message.slice(0, 400)}`,
      });
    } else {
      await save({ status: 'FAILED', error: message.slice(0, 500) });
    }
  }
}

function provenanceFor(provider: TtsProvider): AssetProvenance {
  return {
    source:
      provider.id === 'mock'
        ? 'PROGRAMMATIC'
        : provider.id === 'supplied'
          ? 'CUSTOMER_UPLOAD'
          : 'AI_GENERATED',
    license:
      provider.id === 'mock' ? 'Kampora mock audio (not speech)' : `${provider.id} generated narration`,
    commercialUse: provider.id !== 'mock',
    provider: provider.id,
  };
}

async function findCached(ctx: SegmentContext, key: string) {
  const [row] = await ctx.deps.db
    .select()
    .from(generatedAssets)
    .where(and(eq(generatedAssets.orgId, ctx.orgId), eq(generatedAssets.idempotencyKey, key)));
  return row;
}

async function recordCacheHit(ctx: SegmentContext, step: string) {
  await recordUsage(ctx.deps.db, {
    orgId: ctx.orgId,
    videoProjectId: ctx.projectId,
    operation: 'TTS',
    provider: ctx.provider.id,
    model: ctx.provider.model,
    quantity: 0,
    unit: 'character',
    step,
    chargeType: ctx.provider.paid ? 'ESTIMATED' : 'SIMULATED',
    amountMicroUsd: 0,
    success: true,
    reused: true,
    accepted: true,
    note: 'cache hit: identical text/voice/model/settings',
  });
}

/** Stores a freshly synthesized recording and its generation job; returns the asset id. */
async function storeGenerated(
  ctx: SegmentContext,
  key: string,
  label: string,
  result: TtsResult,
  metadata: Record<string, unknown>,
): Promise<string> {
  const { deps, provider } = ctx;
  const ext = result.mimeType === 'audio/wav' ? 'wav' : 'mp3';
  const storageKey = `orgs/${ctx.orgId}/narration/${ctx.projectId}/${label}-${key.slice(0, 16)}.${ext}`;
  await deps.storage.put(storageKey, result.audio, result.mimeType);
  const [asset] = await deps.db
    .insert(generatedAssets)
    .values({
      orgId: ctx.orgId,
      videoProjectId: ctx.projectId,
      kind: 'audio',
      storageKey,
      mimeType: result.mimeType,
      provider: provider.id,
      model: provider.model,
      idempotencyKey: key,
      provenance: provenanceFor(provider),
      accepted: true,
      metadata: {
        alignment: Boolean(result.alignment),
        ...metadata,
        characters: result.characters,
        requestId: result.requestId,
      },
    })
    .returning({ id: generatedAssets.id });
  const estimatedUsd = ctx.price ? deps.catalog.estimate(ctx.price, result.characters) : 0;
  await deps.db.insert(generationJobs).values({
    orgId: ctx.orgId,
    videoProjectId: ctx.projectId,
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
      purpose: `narration:${label}`,
    },
    attempt: 1,
    maxAttempts: deps.policy.maxAttemptsPerAsset,
    estimatedMicroUsd: usdToMicro(estimatedUsd),
    resultAssetId: asset!.id,
  });
  return asset!.id;
}

/** One line recorded on its own (per-scene mode, or a replaced line of a continuous narration). */
async function recordSeparateSegment(
  ctx: SegmentContext,
  sceneKey: string,
  original: string,
  speech: PreparedSpeech,
  lexicon: PronunciationEntry[],
): Promise<NarrationSegment> {
  const { deps, provider, voice } = ctx;
  const key = generationIdempotencyKey(provider.id, provider.model, 'TTS', {
    voiceId: voice.id,
    text: speech.payload,
    settings: speech.settings,
    outputFormat: provider.id === 'elevenlabs' ? OUTPUT_FORMAT : 'wav',
  });
  const cached = await findCached(ctx, key);
  let assetId: string;
  let durationSec: number;
  let words: WordTiming[];
  if (cached) {
    const meta = cached.metadata as unknown as CachedMetadata;
    assetId = cached.id;
    durationSec = meta.durationSec;
    words = meta.words ?? [];
    await recordCacheHit(ctx, `narration.${sceneKey}`);
  } else {
    const result = await synthesizeWithRetries(ctx, sceneKey, speech);
    const ext = result.mimeType === 'audio/wav' ? 'wav' : 'mp3';
    durationSec = await (deps.probeDuration ?? probeBufferDurationSec)(result.audio, ext);
    words = wordsFromAlignment(result.alignment);
    assetId = await storeGenerated(ctx, key, sceneKey, result, {
      sceneKey,
      durationSec,
      words,
      spoken: speech.payload,
    });
  }
  const { cues, timing } = buildSpeechCues(original, words, durationSec, { pronunciation: lexicon });
  ctx.log.info({ sceneKey, durationSec, cached: Boolean(cached), timing }, 'narration segment ready');
  return {
    sceneKey,
    assetId,
    durationSec,
    cues,
    timing,
    cached: Boolean(cached),
    spokenText: speech.payload,
    source: 'separate',
  };
}

/**
 * Continuous mode: ONE recording of the whole directed script, then cut in the pauses between lines into
 * frame-exact WAV clips (one per scene). Cuts come from the TTS alignment, or from detected pauses when the
 * provider returned none. Slices are free derivatives, cached by their exact cut frames.
 */
async function recordContinuous(
  ctx: SegmentContext,
  script: DirectedScript,
  lexicon: PronunciationEntry[],
  save: (patch: Partial<NarrationState>) => Promise<unknown>,
): Promise<void> {
  const { deps, provider, voice } = ctx;
  const speech: PreparedSpeech = {
    provider: provider.id,
    format: 'text',
    payload: script.payload,
    characters: script.characters,
    settings: script.settings,
    ambiguities: [],
  };
  const masterKey = generationIdempotencyKey(provider.id, provider.model, 'TTS', {
    voiceId: voice.id,
    text: script.payload,
    settings: script.settings,
    outputFormat: provider.id === 'elevenlabs' ? OUTPUT_FORMAT : 'wav',
    mode: 'continuous',
  });
  const cached = await findCached(ctx, masterKey);
  let masterId: string;
  let audio: Buffer;
  let ext: string;
  let alignment: CharacterAlignment | null;
  if (cached) {
    masterId = cached.id;
    audio = await deps.storage.getBuffer(cached.storageKey);
    ext = cached.mimeType === 'audio/wav' ? 'wav' : 'mp3';
    alignment = (cached.metadata as unknown as MasterMetadata).alignment ?? null;
    await recordCacheHit(ctx, 'narration.continuous');
  } else {
    const result = await synthesizeWithRetries(ctx, 'continuous', speech);
    ext = result.mimeType === 'audio/wav' ? 'wav' : 'mp3';
    audio = result.audio;
    alignment = result.alignment;
    const durationSec = await (deps.probeDuration ?? probeBufferDurationSec)(audio, ext);
    masterId = await storeGenerated(ctx, masterKey, 'continuous', result, {
      sceneKey: 'continuous',
      durationSec,
      spoken: script.payload,
      alignment,
    });
  }

  const pcm = await decodeToPcm(audio, ext);
  const durationSec = pcm.length / 2 / NARRATION_SAMPLE_RATE;
  const cuts =
    sceneCutsFromAlignment(script.payload, alignment, script.lines, durationSec, NARRATION_FPS) ??
    sceneCutsFromSilences(
      await detectSilences(audio, ext),
      script.lines,
      script.payload.length,
      durationSec,
      NARRATION_FPS,
    );
  const clips = slicePcm(pcm, NARRATION_SAMPLE_RATE, cuts.cuts);

  const segments: NarrationSegment[] = [];
  for (const [i, line] of script.lines.entries()) {
    const from = cuts.cutFrames[i]!;
    const to = cuts.cutFrames[i + 1]!;
    const clipSec = (to - from) / NARRATION_FPS;
    const words = shiftWords(cuts.words[i] ?? [], cuts.cuts[i]!);
    const sliceKey = `${masterKey}:slice:${NARRATION_FPS}:${from}-${to}`;
    let assetId = (await findCached(ctx, sliceKey))?.id;
    if (!assetId) {
      const storageKey = `orgs/${ctx.orgId}/narration/${ctx.projectId}/${line.sceneKey}-slice-${masterKey.slice(0, 12)}-${from}.wav`;
      await deps.storage.put(storageKey, clips[i]!, 'audio/wav');
      const [row] = await deps.db
        .insert(generatedAssets)
        .values({
          orgId: ctx.orgId,
          videoProjectId: ctx.projectId,
          kind: 'audio',
          storageKey,
          mimeType: 'audio/wav',
          provider: 'kampora',
          model: 'narration-slice-v1',
          idempotencyKey: sliceKey,
          provenance: { ...provenanceFor(provider), notes: `slice of narration ${masterId}` },
          accepted: true,
          metadata: {
            sceneKey: line.sceneKey,
            durationSec: clipSec,
            words,
            masterAssetId: masterId,
            fromFrame: from,
            toFrame: to,
          },
        })
        .returning({ id: generatedAssets.id });
      assetId = row!.id;
    }
    const built = buildSpeechCues(line.original, words, clipSec, { pronunciation: lexicon, tailSec: 0 });
    segments.push({
      sceneKey: line.sceneKey,
      assetId,
      durationSec: clipSec,
      cues: built.cues.map((c) => ({ ...c, endSec: Math.min(c.endSec, clipSec) })),
      timing: cuts.boundaries === 'provider' ? built.timing : 'estimated',
      cached: Boolean(cached),
      spokenText: line.spoken,
      source: 'slice',
    });
  }
  ctx.log.info(
    { cutFrames: cuts.cutFrames, boundaries: cuts.boundaries, cached: Boolean(cached) },
    'continuous narration sliced',
  );
  await save({
    segments,
    master: {
      assetId: masterId,
      durationSec: Math.round(durationSec * 1000) / 1000,
      boundaries: cuts.boundaries,
    },
  });
}

/** Defense in depth: the API already checked, but the worker never calls a paid provider without re-checking. */
async function assertPaidAllowed(
  deps: NarrationJobDeps,
  projectId: string,
  orgId: string,
  briefId: string,
  voice: VoiceOption,
  characters: number,
  price: Price,
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
  ctx: SegmentContext,
  sceneKey: string,
  speech: PreparedSpeech,
): Promise<TtsResult> {
  const { deps, provider, voice, price, log } = ctx;
  const max = Math.max(1, deps.policy.maxAttemptsPerAsset);
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await provider.synthesize({ segmentKey: sceneKey, speech, voiceId: voice.id });
      await recordUsage(deps.db, {
        orgId: ctx.orgId,
        videoProjectId: ctx.projectId,
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
        orgId: ctx.orgId,
        videoProjectId: ctx.projectId,
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
