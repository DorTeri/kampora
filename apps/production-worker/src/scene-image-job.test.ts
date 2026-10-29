import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BudgetPolicy } from '@kampora/cost-engine';
import {
  DEMO_BUSINESS,
  DEMO_CAMPAIGN_REQUEST,
  MockCreativeLlmProvider,
  buildCampaignBrief,
  generateConcepts,
  generateStoryboard,
} from '@kampora/creative-engine';
import {
  approvals,
  brandAssets,
  businesses,
  campaignBriefs,
  costLedger,
  createDatabase,
  creativeConcepts,
  organizations,
  sceneImages,
  storyboards,
  users,
  videoProjects,
  type DatabaseHandle,
} from '@kampora/database';
import {
  MockImageProvider,
  type ImageGenerationProvider,
  type ImageGenerationRequest,
} from '@kampora/media-providers';
import { planSceneVisual } from '@kampora/production-engine';
import type { StoryboardScene } from '@kampora/shared';
import { LocalDiskStorage } from '@kampora/storage';
import { processSceneImageJob, type SceneImageJobDeps } from './scene-image-job';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://kampora:kampora@127.0.0.1:5433/kampora';

async function reachable(): Promise<boolean> {
  const h = createDatabase(DATABASE_URL, 1);
  try {
    await h.pool.query('select 1 from scene_images limit 1');
    return true;
  } catch {
    return false;
  } finally {
    await h.close();
  }
}
const dbAvailable = await reachable();

/** Stands in for a paid vendor: counts calls, returns mock pixels with an ESTIMATED charge. */
class FakePaidImages implements ImageGenerationProvider {
  readonly id = 'openai';
  readonly model = 'gpt-image-2';
  readonly paid = true;
  readonly capabilities = new MockImageProvider().capabilities;
  calls = 0;
  async generate(request: ImageGenerationRequest) {
    this.calls++;
    const media = await new MockImageProvider().generate(request);
    return {
      ...media,
      usage: {
        ...media.usage,
        provider: this.id,
        model: this.model,
        chargeType: 'ESTIMATED' as const,
        costUsd: 0.041,
      },
    };
  }
}

describe.skipIf(!dbAvailable)('scene image job (integration)', () => {
  let handle: DatabaseHandle;
  let storageRoot: string;
  let scene: StoryboardScene;
  const orgId = randomUUID();
  const userId = randomUUID();
  const businessId = randomUUID();
  const projectId = randomUUID();
  const logger = pino({ level: 'silent' });
  const policy: BudgetPolicy = {
    projectMaxUsd: 5,
    perGenerationMaxUsd: 1,
    maxAttemptsPerAsset: 2,
    maxConcurrentPaidGenerations: 1,
    requireApprovalForPaid: true,
    paidGenerationEnabled: true,
  };
  let version = 0;

  const deps = (
    provider: ImageGenerationProvider | null,
    overrides: Partial<BudgetPolicy> = {},
  ): SceneImageJobDeps => ({
    db: handle.db,
    storage: new LocalDiskStorage({
      root: storageRoot,
      signingSecret: 'test-secret-123456',
      publicBaseUrl: 'http://x',
    }),
    policy: { ...policy, ...overrides },
    logger,
    provider,
  });

  async function queueImage(
    provider: ImageGenerationProvider,
    variant: number,
    approvedUsd?: number,
    references: Array<{ id: string; description: string }> = [],
  ) {
    const plan = planSceneVisual({
      scene,
      business: DEMO_BUSINESS,
      references,
      lookSeed: projectId,
      aspect: '9:16',
      variant,
      provider: { id: provider.id, model: provider.model, quality: 'medium' },
    });
    const [row] = await handle.db
      .insert(sceneImages)
      .values({
        orgId,
        videoProjectId: projectId,
        sceneKey: scene.key,
        version: ++version,
        plan,
        fingerprint: plan.fingerprint,
        provider: provider.id,
        model: provider.model,
        estimatedMicroUsd: provider.paid ? 41_000 : 0,
        createdBy: userId,
      })
      .returning();
    if (approvedUsd !== undefined)
      await handle.db.insert(approvals).values({
        orgId,
        videoProjectId: projectId,
        subject: 'SCENE_IMAGE',
        subjectRef: row!.id,
        decision: 'APPROVED',
        approvedEstimateMicroUsd: Math.round(approvedUsd * 1e6),
        decidedBy: userId,
      });
    return row!;
  }

  const reload = async (id: string) =>
    (await handle.db.select().from(sceneImages).where(eq(sceneImages.id, id)))[0]!;

  beforeAll(async () => {
    handle = createDatabase(DATABASE_URL, 2);
    storageRoot = await mkdtemp(path.join(os.tmpdir(), 'kampora-images-'));
    const db = handle.db;
    await db.insert(organizations).values({ id: orgId, name: 'image-test' });
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
    scene = storyboard.scenes[0]!;
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
  });

  afterAll(async () => {
    await handle.db.delete(organizations).where(eq(organizations.id, orgId));
    await handle.close();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it('mock: stores a free image, and an identical request reuses it', async () => {
    const mock = new MockImageProvider();
    const first = await queueImage(mock, 0);
    await processSceneImageJob(deps(mock), { orgId, sceneImageId: first.id });
    const done = await reload(first.id);
    expect(done.error).toBeNull();
    expect(done).toMatchObject({ status: 'SUCCEEDED', cached: false, chargeType: 'SIMULATED' });
    expect(done.assetId).toBeTruthy();

    const again = await queueImage(mock, 0); // same fingerprint
    await processSceneImageJob(deps(mock), { orgId, sceneImageId: again.id });
    const reused = await reload(again.id);
    expect(reused).toMatchObject({ status: 'SUCCEEDED', cached: true, assetId: done.assetId });
  });

  it('paid: refuses with the kill switch off, without approval, or below the estimate', async () => {
    const paid = new FakePaidImages();
    const off = await queueImage(paid, 1, 0.05);
    await processSceneImageJob(deps(paid, { paidGenerationEnabled: false }), { orgId, sceneImageId: off.id });
    expect((await reload(off.id)).error).toMatch(/disabled/);

    const none = await queueImage(paid, 2);
    await processSceneImageJob(deps(paid), { orgId, sceneImageId: none.id });
    expect((await reload(none.id)).error).toMatch(/not approved/);

    const low = await queueImage(paid, 3, 0.01);
    await processSceneImageJob(deps(paid), { orgId, sceneImageId: low.id });
    expect((await reload(low.id)).error).toMatch(/not approved/);
    expect(paid.calls).toBe(0);
  });

  it('paid: one approved call, recorded in the ledger; the project budget then blocks the next', async () => {
    const paid = new FakePaidImages();
    const ok = await queueImage(paid, 4, 0.05);
    await processSceneImageJob(deps(paid), { orgId, sceneImageId: ok.id });
    expect(await reload(ok.id)).toMatchObject({ status: 'SUCCEEDED', chargeType: 'ESTIMATED' });
    expect(paid.calls).toBe(1);
    const ledger = await handle.db.select().from(costLedger).where(eq(costLedger.videoProjectId, projectId));
    expect(
      ledger.filter((l) => l.operation === 'IMAGE_GENERATION' && l.chargeType === 'ESTIMATED'),
    ).toHaveLength(1);

    // Budget is $0.10: 0.041 spent, the next 0.041 fits, the one after does not.
    const second = await queueImage(paid, 5, 0.05);
    await processSceneImageJob(deps(paid), { orgId, sceneImageId: second.id });
    const third = await queueImage(paid, 6, 0.05);
    await processSceneImageJob(deps(paid), { orgId, sceneImageId: third.id });
    expect((await reload(third.id)).error).toMatch(/PROJECT_BUDGET_EXCEEDED/);
    expect(paid.calls).toBe(2);
  });

  it('never sends a reference the provider cannot read (an SVG from an older plan)', async () => {
    const [svg] = await handle.db
      .insert(brandAssets)
      .values({
        orgId,
        businessId,
        kind: 'image',
        storageKey: `test/${randomUUID()}.svg`,
        mimeType: 'image/svg+xml',
        bytes: 10,
        sha256: 'x',
        provenance: { source: 'DEMO', license: 'test', commercialUse: true },
      })
      .returning();
    const paid = new FakePaidImages();
    const row = await queueImage(paid, 9, 0.05, [{ id: svg!.id, description: 'illustration' }]);
    await processSceneImageJob(deps(paid), { orgId, sceneImageId: row.id });
    expect(await reload(row.id)).toMatchObject({ status: 'FAILED' });
    expect((await reload(row.id)).error).toMatch(/JPEG, PNG or WebP/);
    expect(paid.calls).toBe(0);
  });

  it('fails cleanly when no provider is configured or the provider changed', async () => {
    const row = await queueImage(new MockImageProvider(), 7);
    await processSceneImageJob(deps(null), { orgId, sceneImageId: row.id });
    expect((await reload(row.id)).error).toMatch(/not configured/);
    const other = await queueImage(new MockImageProvider(), 8);
    await processSceneImageJob(deps(new FakePaidImages()), { orgId, sceneImageId: other.id });
    expect((await reload(other.id)).error).toMatch(/changed/);
  });
});
