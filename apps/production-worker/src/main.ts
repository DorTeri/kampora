import { UnrecoverableError, Worker } from 'bullmq';
import pino from 'pino';
import { PriceCatalog, budgetPolicyFromEnv } from '@kampora/cost-engine';
import { createDatabase } from '@kampora/database';
import { createTtsProvider, ttsSetupFromEnv, voiceLabExtraVoices } from '@kampora/hebrew-voice';
import {
  NARRATION_QUEUE_NAME,
  NarrationJobPayloadSchema,
  VoiceLabJobPayloadSchema,
  RENDER_QUEUE_NAME,
  RenderJobPayloadSchema,
} from '@kampora/shared';
import { storageFromEnv } from '@kampora/storage';
import { getServeUrl } from '@kampora/video-renderer';
import { processNarrationJob } from './narration-job';
import { processVoiceLabJob } from './voice-lab-job';
import { RenderJobNotFoundError, processRenderJob } from './render-job';
import { redisConnection } from './redis';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', base: { service: 'production-worker' } });

async function main() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL is not set');
  const { db, close } = createDatabase(undefined, 4);
  const deps = {
    db,
    storage: storageFromEnv(),
    catalog: PriceCatalog.fromEnv(),
    logger,
    maxAssetBytes: Number(process.env.MAX_ASSET_BYTES ?? 100 * 1024 * 1024),
    remotionConcurrency: process.env.REMOTION_CONCURRENCY
      ? Number(process.env.REMOTION_CONCURRENCY)
      : undefined,
  };

  // Warm the Remotion bundle so the first render does not pay the webpack cost.
  getServeUrl()
    .then(() => logger.info('remotion bundle ready'))
    .catch((err: unknown) => logger.error({ err }, 'remotion bundle failed'));

  const worker = new Worker(
    RENDER_QUEUE_NAME,
    async (job) => {
      const parsed = RenderJobPayloadSchema.safeParse(job.data);
      if (!parsed.success) throw new UnrecoverableError('Invalid render job payload');
      const maxAttempts = job.opts.attempts ?? 1;
      try {
        await processRenderJob(deps, parsed.data, {
          number: job.attemptsMade + 1,
          isFinal: job.attemptsMade + 1 >= maxAttempts,
        });
      } catch (error) {
        if (error instanceof RenderJobNotFoundError) throw new UnrecoverableError(error.message);
        throw error;
      }
    },
    {
      connection: redisConnection(redisUrl),
      concurrency: Number(process.env.RENDER_CONCURRENCY ?? 1),
      lockDuration: 120_000,
    },
  );

  worker.on('ready', () => logger.info({ queue: RENDER_QUEUE_NAME }, 'worker listening'));
  worker.on('failed', (job, err) => logger.warn({ jobId: job?.id, err: err.message }, 'job attempt failed'));

  // Narration: one job at a time keeps paid TTS calls serialized (no unbounded parallel spend).
  const narrationDeps = {
    db,
    storage: deps.storage,
    catalog: deps.catalog,
    policy: budgetPolicyFromEnv(),
    setup: ttsSetupFromEnv(),
    logger,
    createProvider: (voice: Parameters<typeof createTtsProvider>[0]) => createTtsProvider(voice),
  };
  const voiceLabDeps = {
    ...narrationDeps,
    extraVoices: voiceLabExtraVoices(narrationDeps.setup),
    labMaxUsd: Number(process.env.VOICE_LAB_MAX_USD ?? 1),
  };
  const narrationWorker = new Worker(
    NARRATION_QUEUE_NAME,
    async (job) => {
      if (job.name === 'voice-lab') {
        const lab = VoiceLabJobPayloadSchema.safeParse(job.data);
        if (!lab.success) throw new UnrecoverableError('Invalid voice lab job payload');
        await processVoiceLabJob(voiceLabDeps, lab.data);
        return;
      }
      const parsed = NarrationJobPayloadSchema.safeParse(job.data);
      if (!parsed.success) throw new UnrecoverableError('Invalid narration job payload');
      await processNarrationJob(narrationDeps, parsed.data);
    },
    { connection: redisConnection(redisUrl), concurrency: 1, lockDuration: 120_000 },
  );
  narrationWorker.on('ready', () =>
    logger.info(
      { queue: NARRATION_QUEUE_NAME, tts: narrationDeps.setup.provider },
      'narration worker listening',
    ),
  );

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    await narrationWorker.close();
    await worker.close();
    await close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'worker crashed');
  process.exit(1);
});
