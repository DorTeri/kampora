import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import type { Logger } from 'pino';
import { PriceCatalog, usdToMicro } from '@kampora/cost-engine';
import { recordUsage, renderJobs, timelineVersions, videoProjects, type Database } from '@kampora/database';
import { VideoProjectSchema, type RenderJobPayload, type RenderStage } from '@kampora/shared';
import type { StorageDriver } from '@kampora/storage';
import { renderVideoProject } from '@kampora/video-renderer';
import { prepareAssets } from './assets';

export interface RenderJobDeps {
  db: Database;
  storage: StorageDriver;
  catalog: PriceCatalog;
  logger: Logger;
  maxAssetBytes: number;
  remotionConcurrency?: number;
}

export class RenderJobNotFoundError extends Error {}

/**
 * Renders one render_jobs row. Idempotent: a job that already succeeded is a no-op, and every run reloads
 * authoritative state from the database (the queue payload carries only IDs).
 */
export async function processRenderJob(
  deps: RenderJobDeps,
  payload: RenderJobPayload,
  attempt: { number: number; isFinal: boolean },
): Promise<void> {
  const { db, storage, logger } = deps;
  const log = logger.child({
    renderJobId: payload.renderJobId,
    orgId: payload.orgId,
    attempt: attempt.number,
  });
  const scope = and(eq(renderJobs.id, payload.renderJobId), eq(renderJobs.orgId, payload.orgId));

  const [job] = await db.select().from(renderJobs).where(scope);
  if (!job) throw new RenderJobNotFoundError(`Render job ${payload.renderJobId} not found`);
  if (job.status === 'SUCCEEDED') {
    log.info('render job already succeeded; skipping');
    return;
  }

  const setStage = (stage: RenderStage, extra: Partial<typeof renderJobs.$inferInsert> = {}) =>
    db
      .update(renderJobs)
      .set({ stage, ...extra })
      .where(scope);

  await setStage('PREPARING_ASSETS', {
    status: 'RUNNING',
    attempts: attempt.number,
    startedAt: new Date(),
    error: null,
    progress: 0,
  });
  await db
    .update(videoProjects)
    .set({ status: 'RENDERING' })
    .where(
      and(
        eq(videoProjects.id, job.videoProjectId),
        eq(videoProjects.orgId, payload.orgId),
        inArray(videoProjects.status, ['APPROVED', 'RENDERED', 'FAILED', 'RENDERING']),
      ),
    );

  const tmp = await mkdtemp(path.join(os.tmpdir(), `kampora-render-${job.id.slice(0, 8)}-`));
  const startedAt = Date.now();
  let close: (() => Promise<void>) | undefined;
  try {
    const [version] = await db
      .select()
      .from(timelineVersions)
      .where(and(eq(timelineVersions.id, job.timelineVersionId), eq(timelineVersions.orgId, payload.orgId)));
    if (!version) throw new Error(`Timeline version ${job.timelineVersionId} not found`);
    const project = VideoProjectSchema.parse(version.project);

    const prepared = await prepareAssets(
      project,
      path.join(tmp, 'assets'),
      (asset) => storage.getBuffer(asset.storageKey),
      deps.maxAssetBytes,
    );
    close = prepared.close;

    await setStage('BUNDLING');
    let lastReported = 0;
    const outputPath = path.join(tmp, 'output.mp4');
    const result = await renderVideoProject({
      input: { project, assetUrls: prepared.assetUrls, scale: 1 },
      outputPath,
      quality: job.quality,
      concurrency: deps.remotionConcurrency,
      onBundleProgress: () => undefined,
      onProgress: (progress) => {
        if (progress - lastReported >= 0.05 || progress === 1) {
          lastReported = progress;
          void setStage('RENDERING', { progress: Math.round(progress * 100) / 100 }).catch(() => undefined);
        }
      },
    });

    await setStage('UPLOADING', { progress: 1 });
    const bytes = await readFile(outputPath);
    const outputKey = `orgs/${payload.orgId}/renders/${job.videoProjectId}/${job.id}-${job.quality}.mp4`;
    await storage.put(outputKey, bytes, 'video/mp4');

    await setStage('DONE', {
      status: 'SUCCEEDED',
      progress: 1,
      outputKey,
      outputBytes: bytes.length,
      width: result.width,
      height: result.height,
      durationSec: result.durationSec,
      finishedAt: new Date(),
    });
    await db
      .update(videoProjects)
      .set({ status: 'RENDERED' })
      .where(and(eq(videoProjects.id, job.videoProjectId), eq(videoProjects.orgId, payload.orgId)));

    const price = deps.catalog.defaultFor('RENDER');
    await recordUsage(db, {
      orgId: payload.orgId,
      videoProjectId: job.videoProjectId,
      operation: 'RENDER',
      provider: price.provider,
      model: price.model,
      quantity: result.durationSec,
      unit: price.unit,
      step: `render.${job.quality}`,
      chargeType: 'SIMULATED',
      amountMicroUsd: usdToMicro(deps.catalog.estimate(price, result.durationSec)),
      attempt: attempt.number,
      success: true,
      accepted: job.quality === 'final',
      metadata: { renderJobId: job.id, wallClockMs: Date.now() - startedAt, bytes: bytes.length },
    });
    log.info({ outputKey, bytes: bytes.length, ms: Date.now() - startedAt }, 'render succeeded');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ err: error }, 'render failed');
    await setStage(attempt.isFinal ? 'FAILED' : 'QUEUED', {
      status: attempt.isFinal ? 'FAILED' : 'QUEUED',
      error: message.slice(0, 2000),
      finishedAt: attempt.isFinal ? new Date() : null,
    });
    if (attempt.isFinal) {
      await db
        .update(videoProjects)
        .set({ status: 'FAILED' })
        .where(and(eq(videoProjects.id, job.videoProjectId), eq(videoProjects.orgId, payload.orgId)));
    }
    throw error;
  } finally {
    await close?.();
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}
