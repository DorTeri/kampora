import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import { staticAds, type Database } from '@kampora/database';
import { StaticAdSchema, type StaticAdFileType, type StaticAdJobPayload } from '@kampora/shared';
import type { StorageDriver } from '@kampora/storage';
import { renderStaticAd } from '@kampora/video-renderer';
import { prepareAssets } from './assets';

export interface StaticAdJobDeps {
  db: Database;
  storage: StorageDriver;
  logger: Logger;
  maxAssetBytes: number;
  /** Injected in tests; defaults to the Remotion still renderer. */
  render?: typeof renderStaticAd;
}

export class StaticAdNotFoundError extends Error {}

const MIME: Record<StaticAdFileType, string> = { png: 'image/png', jpeg: 'image/jpeg' };
const EXT: Record<StaticAdFileType, string> = { png: 'png', jpeg: 'jpg' };

/**
 * Renders one static_ads row to PNG and JPEG. Local rendering only: no provider, no paid call. Idempotent: a row
 * that already succeeded is a no-op, and the document is re-validated from the database on every run.
 */
export async function processStaticAdJob(
  deps: StaticAdJobDeps,
  payload: StaticAdJobPayload,
  attempt: { isFinal: boolean },
): Promise<void> {
  const { db, storage } = deps;
  const log = deps.logger.child({ staticAdId: payload.staticAdId, orgId: payload.orgId });
  const scope = and(eq(staticAds.id, payload.staticAdId), eq(staticAds.orgId, payload.orgId));
  const [row] = await db.select().from(staticAds).where(scope);
  if (!row) throw new StaticAdNotFoundError(`Static ad ${payload.staticAdId} not found`);
  if (row.status === 'SUCCEEDED') return;

  await db.update(staticAds).set({ status: 'RUNNING', error: null }).where(scope);
  const tmp = await mkdtemp(path.join(os.tmpdir(), `kampora-static-${row.id.slice(0, 8)}-`));
  let close: (() => Promise<void>) | undefined;
  try {
    const ad = StaticAdSchema.parse(row.ad);
    const prepared = await prepareAssets(
      ad,
      path.join(tmp, 'assets'),
      (asset) => storage.getBuffer(asset.storageKey),
      deps.maxAssetBytes,
    );
    close = prepared.close;
    const render = deps.render ?? renderStaticAd;
    const keys: Partial<Record<StaticAdFileType, { key: string; bytes: number }>> = {};
    for (const fileType of ['png', 'jpeg'] as const) {
      const outputPath = path.join(tmp, `ad.${EXT[fileType]}`);
      await render({ input: { ad, assetUrls: prepared.assetUrls }, outputPath, fileType });
      const bytes = await readFile(outputPath);
      const key = `orgs/${payload.orgId}/projects/${row.videoProjectId}/static-ads/${row.id}.${EXT[fileType]}`;
      await storage.put(key, bytes, MIME[fileType]);
      keys[fileType] = { key, bytes: bytes.length };
    }
    await db
      .update(staticAds)
      .set({
        status: 'SUCCEEDED',
        pngKey: keys.png!.key,
        pngBytes: keys.png!.bytes,
        jpegKey: keys.jpeg!.key,
        jpegBytes: keys.jpeg!.bytes,
        finishedAt: new Date(),
      })
      .where(scope);
    log.info({ format: row.format, version: row.version }, 'static ad rendered');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ err: error }, 'static ad render failed');
    await db
      .update(staticAds)
      .set({
        status: attempt.isFinal ? 'FAILED' : 'QUEUED',
        error: message.slice(0, 2000),
        finishedAt: attempt.isFinal ? new Date() : null,
      })
      .where(scope);
    throw error;
  } finally {
    await close?.();
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  }
}
