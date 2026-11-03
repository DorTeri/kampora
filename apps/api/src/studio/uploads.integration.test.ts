import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { businesses, createDatabase, organizations, type DatabaseHandle } from '@kampora/database';
import { mediaAuthenticity } from '@kampora/shared';
import { LocalDiskStorage } from '@kampora/storage';
import { BusinessService, toAvailableAssets } from './business.service';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://kampora:kampora@127.0.0.1:5433/kampora';
async function reachable(): Promise<boolean> {
  const h = createDatabase(DATABASE_URL, 1);
  try {
    await h.pool.query('select 1 from brand_assets limit 1');
    return true;
  } catch {
    return false;
  } finally {
    await h.close();
  }
}
const dbAvailable = await reachable();

const png = () => {
  const b = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(1080, 16);
  b.writeUInt32BE(1350, 20);
  return b;
};

describe.skipIf(!dbAvailable)('customer media upload (integration: Postgres + local storage)', () => {
  let handle: DatabaseHandle;
  let root: string;
  let service: BusinessService;
  const orgId = randomUUID();
  const otherOrg = randomUUID();
  const businessId = randomUUID();
  const owner = { userId: randomUUID(), orgId, role: 'OWNER' as const };
  const base = { mimeType: 'image/png', subject: 'product', description: 'דאבל סמאש על המגש', rightsConfirmed: true };

  beforeAll(async () => {
    handle = createDatabase(DATABASE_URL, 2);
    root = await mkdtemp(path.join(os.tmpdir(), 'kampora-upload-'));
    service = new BusinessService(
      handle.db,
      new LocalDiskStorage({ root, signingSecret: 'test-secret-123456', publicBaseUrl: 'http://x' }),
    );
    await handle.db.insert(organizations).values([
      { id: orgId, name: 'upload-test' },
      { id: otherOrg, name: 'upload-test-other' },
    ]);
    await handle.db
      .insert(businesses)
      .values({ id: businessId, orgId, name: 'b', category: 'x', description: 'x', products: [], targetAudience: 'x' });
  });

  afterAll(async () => {
    await handle.db.delete(organizations).where(eq(organizations.id, orgId));
    await handle.db.delete(organizations).where(eq(organizations.id, otherOrg));
    await handle.close();
    await rm(root, { recursive: true, force: true });
  });

  it('stores the owner photo as a verified brand asset the Directors can use', async () => {
    const bytes = png();
    const saved = await service.upload(owner, businessId, { ...base, bytes });
    expect(saved).toMatchObject({ kind: 'image', tags: ['product', 'hero'], width: 1080, height: 1350 });
    const rows = await service.assets(owner, businessId);
    const row = rows.find((r) => r.id === saved.id)!;
    expect(row.provenance.source).toBe('CUSTOMER_UPLOAD');
    expect(await readFile(path.join(root, row.storageKey))).toEqual(bytes);
    const [available] = toAvailableAssets([row]);
    expect(mediaAuthenticity(available!)).toBe('VERIFIED_PRODUCT_PHOTO');
  });

  it('refuses another tenant, a renamed file and missing rights', async () => {
    await expect(service.upload({ ...owner, orgId: otherOrg }, businessId, { ...base, bytes: png() })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.upload(owner, businessId, { ...base, mimeType: 'image/jpeg', bytes: png() })).rejects.toMatchObject({ code: 'UPLOAD_CONTENT' });
    await expect(service.upload(owner, businessId, { ...base, rightsConfirmed: false, bytes: png() })).rejects.toMatchObject({ code: 'UPLOAD_RIGHTS' });
    await expect(service.upload(owner, businessId, { ...base, mimeType: 'image/gif', bytes: png() })).rejects.toMatchObject({ code: 'UPLOAD_TYPE' });
  });

  it('measures an MP4 clip with ffprobe', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'kampora-clip-'));
    const file = path.join(dir, 'clip.mp4');
    try {
      execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=180x320:d=1.5', '-pix_fmt', 'yuv420p', file]);
      const saved = await service.upload(owner, businessId, { ...base, subject: 'process', mimeType: 'video/mp4', bytes: await readFile(file) });
      expect(saved.kind).toBe('video');
      expect(saved.durationSec).toBeCloseTo(1.5, 1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
