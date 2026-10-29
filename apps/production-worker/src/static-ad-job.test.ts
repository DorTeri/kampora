import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEMO_BUSINESS,
  DEMO_CAMPAIGN_REQUEST,
  MockCreativeLlmProvider,
  buildCampaignBrief,
  generateConcepts,
  generateStoryboard,
} from '@kampora/creative-engine';
import {
  businesses,
  campaignBriefs,
  createDatabase,
  creativeConcepts,
  organizations,
  staticAds,
  storyboards,
  users,
  videoProjects,
  type DatabaseHandle,
} from '@kampora/database';
import { MockImageProvider } from '@kampora/media-providers';
import { STATIC_AD_FORMATS, type StaticAd } from '@kampora/shared';
import { LocalDiskStorage } from '@kampora/storage';
import type { renderStaticAd } from '@kampora/video-renderer';
import { processStaticAdJob, type StaticAdJobDeps } from './static-ad-job';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://kampora:kampora@127.0.0.1:5433/kampora';

async function reachable(): Promise<boolean> {
  const h = createDatabase(DATABASE_URL, 1);
  try {
    await h.pool.query('select 1 from static_ads limit 1');
    return true;
  } catch {
    return false;
  } finally {
    await h.close();
  }
}
const dbAvailable = await reachable();

describe.skipIf(!dbAvailable)('static ad job (integration)', () => {
  let handle: DatabaseHandle;
  let storageRoot: string;
  let storage: LocalDiskStorage;
  const orgId = randomUUID();
  const userId = randomUUID();
  const businessId = randomUUID();
  const projectId = randomUUID();
  const logger = pino({ level: 'silent' });
  let version = 0;

  /** Stands in for Remotion: records what it was asked to render and writes a tagged file. */
  const renders: Parameters<typeof renderStaticAd>[0][] = [];
  const fakeRender: typeof renderStaticAd = async (options) => {
    renders.push(options);
    await writeFile(options.outputPath, `${options.fileType}:${options.input.ad.text.headline}`);
    return { outputPath: options.outputPath, width: options.input.ad.width, height: options.input.ad.height };
  };
  const deps = (): StaticAdJobDeps => ({
    db: handle.db,
    storage,
    logger,
    maxAssetBytes: 5_000_000,
    render: fakeRender,
  });

  const ad = (backgroundKey: string, mimeType = 'image/png'): StaticAd => {
    const size = STATIC_AD_FORMATS['4:5'];
    return {
      schemaVersion: 1,
      id: 'ad',
      format: '4:5',
      width: size.width,
      height: size.height,
      locale: 'he-IL',
      direction: 'rtl',
      safeArea: size.safeArea,
      branding: { businessName: 'Luz', colors: DEMO_BUSINESS.brandColors, fontFamily: 'Heebo' },
      background: { assetId: 'bg', focalPoint: { x: 0.5, y: 0.45 } },
      text: { headline: 'מאפים טריים כל בוקר', cta: 'בואו היום', showLogo: true },
      assets: [
        {
          id: 'bg',
          kind: 'image',
          storageKey: backgroundKey,
          mimeType,
          provenance: { source: 'DEMO', license: 'test', commercialUse: true },
        },
      ],
    };
  };

  async function queue(doc: StaticAd) {
    const [row] = await handle.db
      .insert(staticAds)
      .values({
        orgId,
        videoProjectId: projectId,
        format: doc.format,
        version: ++version,
        ad: doc,
        fingerprint: 'fp',
      })
      .returning();
    return row!;
  }
  const reload = async (id: string) =>
    (await handle.db.select().from(staticAds).where(eq(staticAds.id, id)))[0]!;

  beforeAll(async () => {
    handle = createDatabase(DATABASE_URL, 2);
    storageRoot = await mkdtemp(path.join(os.tmpdir(), 'kampora-static-'));
    storage = new LocalDiskStorage({
      root: storageRoot,
      signingSecret: 'test-secret-123456',
      publicBaseUrl: 'http://x',
    });
    const db = handle.db;
    await db.insert(organizations).values({ id: orgId, name: 'static-test' });
    await db.insert(users).values({ id: userId, email: `t-${userId}@test.local`, displayName: 't' });
    await db.insert(businesses).values({
      id: businessId,
      orgId,
      name: 'Luz',
      category: 'x',
      description: 'x',
      products: [],
      targetAudience: 'x',
    });
    const provider = new MockCreativeLlmProvider();
    const brief = buildCampaignBrief({
      business: DEMO_BUSINESS,
      request: DEMO_CAMPAIGN_REQUEST,
      defaults: { budgetUsd: 5, qualityTier: 'standard', targetDurationSec: 20 },
    });
    const { conceptSet } = await generateConcepts({ business: DEMO_BUSINESS, brief }, { provider });
    const concept = conceptSet.concepts[0]!;
    const { storyboard } = await generateStoryboard(
      { business: DEMO_BUSINESS, brief, concept, assets: [] },
      { provider },
    );
    const [b] = await db.insert(campaignBriefs).values({ orgId, businessId, brief }).returning();
    const [c] = await db
      .insert(creativeConcepts)
      .values({ orgId, briefId: b!.id, key: concept.key, concept })
      .returning();
    const [sb] = await db
      .insert(storyboards)
      .values({ orgId, briefId: b!.id, conceptId: c!.id, storyboard })
      .returning();
    await db.insert(videoProjects).values({
      id: projectId,
      orgId,
      businessId,
      briefId: b!.id,
      storyboardId: sb!.id,
      title: 't',
      status: 'PLAN_READY',
      budgetMicroUsd: 100_000,
    });
    const png = await new MockImageProvider().generate({ prompt: '#c8743a #f2c14e', aspectRatio: '4:5' });
    await storage.put('test/bg.png', png.data, 'image/png');
    await storage.put('test/not-a-png.png', Buffer.from('<html>nope</html>'), 'image/png');
  });

  afterAll(async () => {
    await handle?.db.delete(organizations).where(eq(organizations.id, orgId));
    await handle?.db.delete(users).where(eq(users.id, userId));
    await handle?.close();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it('renders PNG and JPEG from the stored document, with its background served locally', async () => {
    const row = await queue(ad('test/bg.png'));
    await processStaticAdJob(deps(), { orgId, staticAdId: row.id }, { isFinal: true });
    const done = await reload(row.id);
    expect(done.status).toBe('SUCCEEDED');
    expect(done.pngKey).toBe(`orgs/${orgId}/projects/${projectId}/static-ads/${row.id}.png`);
    expect(done.jpegKey).toMatch(/\.jpg$/);
    expect((await storage.getBuffer(done.pngKey!)).toString()).toBe('png:מאפים טריים כל בוקר');
    expect((await storage.getBuffer(done.jpegKey!)).toString()).toMatch(/^jpeg:/);
    expect(renders.map((r) => r.fileType)).toEqual(['png', 'jpeg']);
    expect(Object.keys(renders[0]!.input.assetUrls)).toEqual(['bg']);

    // A finished ad is never rendered twice.
    await processStaticAdJob(deps(), { orgId, staticAdId: row.id }, { isFinal: true });
    expect(renders).toHaveLength(2);
  });

  it('refuses a background whose bytes do not match its type, and records the failure', async () => {
    const row = await queue(ad('test/not-a-png.png'));
    await expect(
      processStaticAdJob(deps(), { orgId, staticAdId: row.id }, { isFinal: false }),
    ).rejects.toThrow(/does not match/);
    expect((await reload(row.id)).status).toBe('QUEUED');
    await expect(
      processStaticAdJob(deps(), { orgId, staticAdId: row.id }, { isFinal: true }),
    ).rejects.toThrow();
    const failed = await reload(row.id);
    expect(failed.status).toBe('FAILED');
    expect(failed.error).toMatch(/does not match/);
  });
});
