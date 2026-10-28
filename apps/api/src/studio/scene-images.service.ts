import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { BudgetPolicy, PriceCatalog } from '@kampora/cost-engine';
import {
  approvals,
  creativeConcepts,
  generatedAssets,
  sceneImages,
  spentUsdFor,
  storyboards,
  videoProjects,
  type Database,
} from '@kampora/database';
import {
  QuoteOnlyImageToVideoProvider,
  imageCallEstimateUsd,
  videoSetupFromEnv,
  type ImageSetup,
  type ImageToVideoProvider,
  type ImageToVideoQuote,
} from '@kampora/media-providers';
import { pickReferenceImages, planSceneVisual } from '@kampora/production-engine';
import type { SceneImageJobPayload, StoryboardScene, VisualScenePlan } from '@kampora/shared';
import type { StorageDriver } from '@kampora/storage';
import type { AuthContext } from '../common/auth';
import { ApiError, notFound } from '../common/errors';
import {
  BUDGET_POLICY,
  DATABASE,
  IMAGE_SETUP,
  NARRATION_QUEUE,
  PRICE_CATALOG,
  STORAGE,
} from '../infra/tokens';
import { BusinessService, toAvailableAssets } from './business.service';
import { imagePriceEntry } from './scene-image-assets';
import { StudioService } from './studio.service';

/** Versions per scene: bounds regeneration loops (and their cost). */
export const MAX_IMAGE_VERSIONS_PER_SCENE = 6;

export interface SceneImageQuote {
  sceneKey: string;
  eligible: boolean;
  estimatedUsd: number;
  paid: boolean;
  referenceCount: number;
  nextVersion: number;
  /** Scenes that need real subject motion: what image-to-video would cost (quote only). */
  motion: ImageToVideoQuote | null;
}

/**
 * AI images per storyboard scene: quote → (paid: explicit approval) → generate a version → owner approves or
 * rejects it. Approving re-plans the project so the image replaces the planned generation. Everything is
 * deterministic up to the provider call (VisualScenePlan + fingerprint), and identical requests are reused.
 */
@Injectable()
export class SceneImagesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    @Inject(NARRATION_QUEUE) private readonly queue: Queue,
    @Inject(PRICE_CATALOG) private readonly catalog: PriceCatalog,
    @Inject(BUDGET_POLICY) private readonly policy: BudgetPolicy,
    @Inject(IMAGE_SETUP) private readonly setup: ImageSetup,
    private readonly businesses: BusinessService,
    private readonly studio: StudioService,
  ) {
    const videoSetup = videoSetupFromEnv();
    const price = this.catalog.find('planning', videoSetup.model, 'IMAGE_TO_VIDEO');
    this.video =
      videoSetup.provider === 'quote-only' && price
        ? new QuoteOnlyImageToVideoProvider(videoSetup.model, price.unitPriceUsd)
        : null;
  }

  private readonly video: ImageToVideoProvider | null;

  private async context(ctx: AuthContext, projectId: string) {
    const [project] = await this.db
      .select()
      .from(videoProjects)
      .where(and(eq(videoProjects.id, projectId), eq(videoProjects.orgId, ctx.orgId)));
    if (!project) throw notFound('Project');
    const [storyboard] = await this.db
      .select()
      .from(storyboards)
      .where(eq(storyboards.id, project.storyboardId));
    const [concept] = await this.db
      .select({ concept: creativeConcepts.concept })
      .from(creativeConcepts)
      .where(eq(creativeConcepts.id, storyboard!.conceptId));
    const profile = await this.businesses.loadProfile(ctx, project.businessId);
    const assets = toAvailableAssets(await this.businesses.assets(ctx, project.businessId));
    const versions = await this.db
      .select()
      .from(sceneImages)
      .where(and(eq(sceneImages.orgId, ctx.orgId), eq(sceneImages.videoProjectId, projectId)))
      .orderBy(asc(sceneImages.sceneKey), asc(sceneImages.version));
    return {
      project,
      storyboard: storyboard!.storyboard,
      concept: concept!.concept,
      profile,
      assets,
      versions,
    };
  }

  private unitPrice() {
    const entry = imagePriceEntry(this.catalog, this.setup);
    return entry ? { usd: entry.unitPriceUsd, known: true } : { usd: 0, known: false };
  }

  /** Scenes built from text/graphics or existing footage do not need a generated still. */
  private eligible(scene: StoryboardScene, strategy: string | undefined): boolean {
    return scene.visualKind !== 'GRAPHIC' && strategy !== 'EXISTING_VIDEO';
  }

  private visualPlan(
    c: Awaited<ReturnType<SceneImagesService['context']>>,
    scene: StoryboardScene,
    variant: number,
  ) {
    return planSceneVisual({
      scene,
      business: c.profile,
      strategy: c.concept.strategy,
      references: pickReferenceImages(scene, c.assets),
      lookSeed: c.project.id,
      aspect: '9:16',
      variant,
      provider: { id: this.setup.provider, model: this.setup.model, quality: this.setup.quality },
    });
  }

  private quoteFor(
    c: Awaited<ReturnType<SceneImagesService['context']>>,
    scene: StoryboardScene,
  ): SceneImageQuote & { plan: VisualScenePlan } {
    const existing = c.versions.filter((v) => v.sceneKey === scene.key);
    const plan = this.visualPlan(c, scene, existing.length);
    const strategy = c.project.plan?.scenes.find((s) => s.sceneKey === scene.key)?.strategy;
    return {
      sceneKey: scene.key,
      eligible: this.eligible(scene, strategy),
      estimatedUsd: imageCallEstimateUsd(this.unitPrice().usd, plan.referenceAssetIds.length),
      paid: this.setup.paid,
      referenceCount: plan.referenceAssetIds.length,
      nextVersion: existing.length + 1,
      motion:
        this.video && (scene.quality.requiresHumanMotion || scene.quality.requiresComplexAction)
          ? this.video.quote({ durationSec: scene.durationSec, aspectRatio: '9:16' })
          : null,
      plan,
    };
  }

  async list(ctx: AuthContext, projectId: string) {
    const c = await this.context(ctx, projectId);
    const assetIds = c.versions.map((v) => v.assetId).filter((x): x is string => Boolean(x));
    const assets = assetIds.length
      ? await this.db
          .select({ id: generatedAssets.id, key: generatedAssets.storageKey })
          .from(generatedAssets)
          .where(and(eq(generatedAssets.orgId, ctx.orgId), inArray(generatedAssets.id, assetIds)))
      : [];
    const keyById = new Map(assets.map((a) => [a.id, a.key]));
    return {
      provider: this.setup.provider,
      ready: this.setup.ready && (!this.setup.paid || this.unitPrice().known),
      paid: this.setup.paid,
      paidEnabled: this.policy.paidGenerationEnabled,
      maxVersions: MAX_IMAGE_VERSIONS_PER_SCENE,
      scenes: c.storyboard.scenes.map((scene) => {
        const { plan: _plan, ...quote } = this.quoteFor(c, scene);
        return quote;
      }),
      images: await Promise.all(
        c.versions.map(async (v) => ({
          id: v.id,
          sceneKey: v.sceneKey,
          version: v.version,
          status: v.status,
          error: v.error,
          decision: v.decision,
          style: v.plan.style,
          estimatedUsd: v.estimatedMicroUsd / 1e6,
          chargeType: v.chargeType,
          cached: v.cached,
          createdAt: v.createdAt,
          url:
            v.assetId && keyById.has(v.assetId)
              ? await this.storage.getReadUrl(keyById.get(v.assetId)!, { expiresInSec: 3600 })
              : null,
        })),
      ),
    };
  }

  async request(ctx: AuthContext, projectId: string, sceneKey: string, approvedUsd?: number) {
    if (!this.setup.ready)
      throw new ApiError(HttpStatus.CONFLICT, 'IMAGES_UNAVAILABLE', 'Image generation is not available');
    const c = await this.context(ctx, projectId);
    if (c.project.status === 'RENDERING')
      throw new ApiError(HttpStatus.CONFLICT, 'RENDER_IN_PROGRESS', 'Wait for the render to finish');
    const scene = c.storyboard.scenes.find((s) => s.key === sceneKey);
    if (!scene) throw notFound('Scene');
    const quote = this.quoteFor(c, scene);
    if (!quote.eligible)
      throw new ApiError(
        HttpStatus.CONFLICT,
        'SCENE_NOT_ELIGIBLE',
        'This scene does not use a generated image',
      );
    if (c.versions.some((v) => v.sceneKey === sceneKey && (v.status === 'QUEUED' || v.status === 'RUNNING')))
      throw new ApiError(
        HttpStatus.CONFLICT,
        'IMAGE_IN_PROGRESS',
        'An image for this scene is already being made',
      );
    if (quote.nextVersion > MAX_IMAGE_VERSIONS_PER_SCENE)
      throw new ApiError(HttpStatus.CONFLICT, 'TOO_MANY_VERSIONS', 'Version limit for this scene reached');

    if (this.setup.paid) {
      if (!this.unitPrice().known)
        throw new ApiError(HttpStatus.CONFLICT, 'NO_PRICE', 'No price entry for the image model');
      if (!this.policy.paidGenerationEnabled)
        throw new ApiError(HttpStatus.FORBIDDEN, 'PAID_DISABLED', 'Paid generation is disabled');
      if (approvedUsd === undefined || approvedUsd + 0.0005 < quote.estimatedUsd)
        throw new ApiError(
          HttpStatus.BAD_REQUEST,
          'APPROVAL_REQUIRED',
          `Approve the estimated cost ($${quote.estimatedUsd.toFixed(3)}) first`,
        );
      const spent = await spentUsdFor(this.db, ctx.orgId, {
        projectIds: [projectId],
        briefIds: [c.project.briefId],
      });
      const cap = Math.min(this.policy.projectMaxUsd, c.project.budgetMicroUsd / 1e6);
      if (quote.estimatedUsd > this.policy.perGenerationMaxUsd || spent + quote.estimatedUsd > cap + 1e-9)
        throw new ApiError(HttpStatus.FORBIDDEN, 'BUDGET_EXCEEDED', 'Not enough budget left for this image');
    }

    const row = await this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(sceneImages)
        .values({
          orgId: ctx.orgId,
          videoProjectId: projectId,
          sceneKey,
          version: quote.nextVersion,
          plan: quote.plan,
          fingerprint: quote.plan.fingerprint,
          provider: this.setup.provider,
          model: this.setup.model,
          estimatedMicroUsd: Math.round(quote.estimatedUsd * 1e6),
          createdBy: ctx.userId,
        })
        .returning();
      if (this.setup.paid)
        await tx.insert(approvals).values({
          orgId: ctx.orgId,
          videoProjectId: projectId,
          subject: 'SCENE_IMAGE',
          subjectRef: inserted!.id,
          decision: 'APPROVED',
          approvedEstimateMicroUsd: Math.round(approvedUsd! * 1e6),
          decidedBy: ctx.userId,
        });
      return inserted!;
    });
    const payload: SceneImageJobPayload = { orgId: ctx.orgId, sceneImageId: row.id };
    await this.queue.add('scene-image', payload, {
      jobId: `scene-image-${row.id}`,
      attempts: 1,
      removeOnComplete: 200,
      removeOnFail: 500,
    });
    const { plan: _plan, ...publicQuote } = quote;
    return { id: row.id, status: row.status, version: row.version, quote: publicQuote };
  }

  /** Approve (one approved version per scene; others go back to pending) or reject; then re-plan. */
  async decide(ctx: AuthContext, projectId: string, imageId: string, decision: 'APPROVED' | 'REJECTED') {
    const [row] = await this.db
      .select()
      .from(sceneImages)
      .where(
        and(
          eq(sceneImages.id, imageId),
          eq(sceneImages.orgId, ctx.orgId),
          eq(sceneImages.videoProjectId, projectId),
        ),
      );
    if (!row) throw notFound('Image');
    if (row.status !== 'SUCCEEDED' || !row.assetId)
      throw new ApiError(HttpStatus.CONFLICT, 'IMAGE_NOT_READY', 'The image is not ready');
    await this.db.transaction(async (tx) => {
      if (decision === 'APPROVED')
        await tx
          .update(sceneImages)
          .set({ decision: 'PENDING' })
          .where(
            and(
              eq(sceneImages.videoProjectId, projectId),
              eq(sceneImages.sceneKey, row.sceneKey),
              eq(sceneImages.decision, 'APPROVED'),
            ),
          );
      await tx
        .update(sceneImages)
        .set({ decision, decidedBy: ctx.userId, decidedAt: new Date() })
        .where(eq(sceneImages.id, row.id));
    });
    const plan = await this.studio.refreshPlan(ctx, projectId);
    return { id: row.id, decision, plan };
  }
}
