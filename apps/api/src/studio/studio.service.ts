import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { and, asc, desc, eq, isNull, max } from 'drizzle-orm';
import { summarizeLedger, usdToMicro, type BudgetPolicy, type PriceCatalog } from '@kampora/cost-engine';
import {
  buildCampaignBrief,
  buildProfessionalBrief,
  generateConcepts,
  generateStoryboard,
} from '@kampora/creative-engine';
import {
  approvals,
  auditLog,
  businesses,
  campaignBriefs,
  creativeConcepts,
  ledgerEntriesFor,
  renderJobs,
  scenes,
  storyboards,
  timelineVersions,
  videoProjects,
  type Database,
} from '@kampora/database';
import {
  buildVideoProject,
  describeTimeline,
  planProduction,
  sceneContentHash,
  timelineQa,
} from '@kampora/production-engine';
import type { ImageSetup } from '@kampora/media-providers';
import {
  assertProjectTransition,
  sceneImagesKey,
  timelineApprovalReason,
  type CampaignRequest,
  type RenderJobPayload,
  type RenderQuality,
} from '@kampora/shared';
import type { StorageDriver } from '@kampora/storage';
import type { AuthContext } from '../common/auth';
import { ApiError, notFound } from '../common/errors';
import { BUDGET_POLICY, DATABASE, IMAGE_SETUP, PRICE_CATALOG, RENDER_QUEUE, STORAGE } from '../infra/tokens';
import { BusinessService, toAvailableAssets, toMediaAssets } from './business.service';
import { NarrationService } from './narration.service';
import { PaidOperationsService } from './paid.service';
import { approvedSceneImages, imagePriceEntry } from './scene-image-assets';

const TARGET_DURATION_SEC = 20;

/**
 * Orchestrates the Creative Studio journey with a fixed, bounded sequence of steps:
 * request → brief → concepts → (select) storyboard + production plan → (approve) timeline → render.
 * Every query is scoped by ctx.orgId.
 */
@Injectable()
export class StudioService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    @Inject(RENDER_QUEUE) private readonly queue: Queue,
    @Inject(PRICE_CATALOG) private readonly catalog: PriceCatalog,
    @Inject(BUDGET_POLICY) private readonly policy: BudgetPolicy,
    @Inject(IMAGE_SETUP) private readonly imageSetup: ImageSetup,
    private readonly businesses: BusinessService,
    private readonly paid: PaidOperationsService,
    private readonly narration: NarrationService,
  ) {}

  private audit(
    ctx: AuthContext,
    action: string,
    subjectType: string,
    subjectId: string,
    metadata: Record<string, unknown> = {},
  ) {
    return this.db
      .insert(auditLog)
      .values({ orgId: ctx.orgId, actorUserId: ctx.userId, action, subjectType, subjectId, metadata });
  }

  // ── Campaigns ────────────────────────────────────────────────────────

  /**
   * Creates the campaign: deterministic brief (no AI call), then AI concepts. With a paid creative provider
   * the customer must first approve the quoted ceiling (`aiApprovalUsd`); it covers concepts + storyboard.
   */
  async createCampaign(
    ctx: AuthContext,
    businessId: string,
    request: CampaignRequest,
    aiApprovalUsd?: number,
  ) {
    const quote = this.paid.assertCreativeApproval(aiApprovalUsd);
    const profile = await this.businesses.loadProfile(ctx, businessId);
    const brief = buildCampaignBrief({
      business: profile,
      request,
      defaults: {
        budgetUsd: this.policy.projectMaxUsd,
        qualityTier: 'standard',
        targetDurationSec: TARGET_DURATION_SEC,
      },
    });
    // The professional brief is kept with the campaign: the concepts can always be traced to what was known.
    const professionalBrief = buildProfessionalBrief({
      business: profile,
      brief,
      assets: toAvailableAssets(await this.businesses.assets(ctx, businessId)),
      notes: request.notes,
    });
    const [row] = await this.db
      .insert(campaignBriefs)
      .values({ orgId: ctx.orgId, businessId, brief, professionalBrief, createdBy: ctx.userId })
      .returning();
    if (quote.paid && aiApprovalUsd !== undefined) {
      await this.paid.recordCreativeApproval(ctx, row!.id, aiApprovalUsd);
    }
    await this.audit(ctx, 'campaign.created', 'campaign_brief', row!.id, {
      goal: request.goal,
      creativeProvider: quote.provider,
      approvedAiUsd: aiApprovalUsd,
    });
    await this.generateConceptBatch(ctx, row!.id);
    return this.getCampaign(ctx, row!.id);
  }

  private async briefRow(ctx: AuthContext, briefId: string) {
    const [row] = await this.db
      .select()
      .from(campaignBriefs)
      .where(and(eq(campaignBriefs.id, briefId), eq(campaignBriefs.orgId, ctx.orgId)));
    if (!row) throw notFound('Campaign');
    return row;
  }

  /** Generates three concepts as a new batch ("request alternatives" keeps history). */
  async generateConceptBatch(ctx: AuthContext, briefId: string) {
    const brief = await this.briefRow(ctx, briefId);
    if (brief.status === 'CONCEPT_SELECTED') {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'CONCEPT_ALREADY_SELECTED',
        'A concept was already selected for this campaign',
      );
    }
    const profile = await this.businesses.loadProfile(ctx, brief.businessId);
    const assets = toAvailableAssets(await this.businesses.assets(ctx, brief.businessId));
    const { provider, recorder } = this.paid.creativeProviderFor(ctx, briefId);
    let result: Awaited<ReturnType<typeof generateConcepts>>;
    try {
      result = await generateConcepts({ business: profile, brief: brief.brief, assets }, { provider, recorder });
    } finally {
      // Spend is recorded even when the step fails.
      await recorder.flush(this.db, { orgId: ctx.orgId, campaignBriefId: briefId });
    }
    const { conceptSet, claimFlags } = result;
    const [{ value: lastBatch } = { value: 0 }] = await this.db
      .select({ value: max(creativeConcepts.batch) })
      .from(creativeConcepts)
      .where(and(eq(creativeConcepts.briefId, briefId), eq(creativeConcepts.orgId, ctx.orgId)));
    const batch = (lastBatch ?? 0) + 1;
    await this.db.insert(creativeConcepts).values(
      conceptSet.concepts.map((concept) => ({
        orgId: ctx.orgId,
        briefId,
        batch,
        key: concept.key,
        concept,
        isRecommended: concept.key === conceptSet.recommendedKey,
        recommendationReason:
          concept.key === conceptSet.recommendedKey ? conceptSet.recommendationReason : null,
        claimFlags: claimFlags.filter((f) =>
          [concept.hook, concept.mainMessage, concept.voiceover, concept.cta].includes(f.source),
        ),
      })),
    );
    await this.db
      .update(campaignBriefs)
      .set({ status: 'CONCEPTS_READY' })
      .where(eq(campaignBriefs.id, briefId));
    return this.getCampaign(ctx, briefId);
  }

  async listCampaigns(ctx: AuthContext) {
    return this.db
      .select({
        id: campaignBriefs.id,
        status: campaignBriefs.status,
        brief: campaignBriefs.brief,
        createdAt: campaignBriefs.createdAt,
        businessName: businesses.name,
        projectId: videoProjects.id,
        projectStatus: videoProjects.status,
      })
      .from(campaignBriefs)
      .innerJoin(businesses, eq(businesses.id, campaignBriefs.businessId))
      .leftJoin(videoProjects, eq(videoProjects.briefId, campaignBriefs.id))
      .where(eq(campaignBriefs.orgId, ctx.orgId))
      .orderBy(desc(campaignBriefs.createdAt));
  }

  async getCampaign(ctx: AuthContext, briefId: string) {
    const brief = await this.briefRow(ctx, briefId);
    const all = await this.db
      .select()
      .from(creativeConcepts)
      .where(and(eq(creativeConcepts.briefId, briefId), eq(creativeConcepts.orgId, ctx.orgId)))
      .orderBy(desc(creativeConcepts.batch), asc(creativeConcepts.createdAt));
    const latestBatch = all[0]?.batch;
    const [project] = await this.db
      .select({ id: videoProjects.id, status: videoProjects.status })
      .from(videoProjects)
      .where(and(eq(videoProjects.briefId, briefId), eq(videoProjects.orgId, ctx.orgId)));
    // Campaigns created before the professional brief get one built now (deterministic, no model call).
    const professionalBrief =
      brief.professionalBrief ??
      buildProfessionalBrief({
        business: await this.businesses.loadProfile(ctx, brief.businessId),
        brief: brief.brief,
        assets: toAvailableAssets(await this.businesses.assets(ctx, brief.businessId)),
      });
    return {
      id: brief.id,
      businessId: brief.businessId,
      status: brief.status,
      brief: brief.brief,
      professionalBrief,
      createdAt: brief.createdAt,
      concepts: all
        .filter((c) => c.batch === latestBatch || c.selectedAt)
        .map((c) => ({
          id: c.id,
          batch: c.batch,
          concept: c.concept,
          isRecommended: c.isRecommended,
          recommendationReason: c.recommendationReason,
          claimFlags: c.claimFlags,
          selected: Boolean(c.selectedAt),
        })),
      project: project ?? null,
    };
  }

  /** Selecting a concept produces the storyboard, the production plan and the project (idempotent). */
  async selectConcept(ctx: AuthContext, briefId: string, conceptId: string) {
    const brief = await this.briefRow(ctx, briefId);
    const [concept] = await this.db
      .select()
      .from(creativeConcepts)
      .where(
        and(
          eq(creativeConcepts.id, conceptId),
          eq(creativeConcepts.briefId, briefId),
          eq(creativeConcepts.orgId, ctx.orgId),
        ),
      );
    if (!concept) throw notFound('Concept');

    const [existing] = await this.db
      .select({ id: videoProjects.id })
      .from(videoProjects)
      .where(and(eq(videoProjects.briefId, briefId), eq(videoProjects.orgId, ctx.orgId)));
    if (existing) return { projectId: existing.id };

    const profile = await this.businesses.loadProfile(ctx, brief.businessId);
    const assetRows = await this.businesses.assets(ctx, brief.businessId);
    const available = toAvailableAssets(assetRows);
    const { provider, recorder } = this.paid.creativeProviderFor(ctx, briefId);
    let generated: Awaited<ReturnType<typeof generateStoryboard>>;
    try {
      generated = await generateStoryboard(
        { business: profile, brief: brief.brief, concept: concept.concept, assets: available },
        { provider, recorder },
      );
    } catch (error) {
      await recorder.flush(this.db, { orgId: ctx.orgId, campaignBriefId: briefId });
      throw error;
    }
    const { storyboard, claimFlags } = generated;
    const plan = planProduction({
      storyboard,
      assets: available,
      budgetUsd: brief.brief.productionBudgetUsd,
      perGenerationMaxUsd: this.policy.perGenerationMaxUsd,
      qualityTier: brief.brief.qualityTier,
      catalog: this.catalog,
      imagePrice: this.imagePrice(),
    });

    const projectId = await this.db.transaction(async (tx) => {
      await tx
        .update(creativeConcepts)
        .set({ selectedAt: null })
        .where(and(eq(creativeConcepts.briefId, briefId), eq(creativeConcepts.orgId, ctx.orgId)));
      await tx
        .update(creativeConcepts)
        .set({ selectedAt: new Date() })
        .where(eq(creativeConcepts.id, conceptId));
      await tx
        .update(campaignBriefs)
        .set({ status: 'CONCEPT_SELECTED' })
        .where(eq(campaignBriefs.id, briefId));
      const [sb] = await tx
        .insert(storyboards)
        .values({ orgId: ctx.orgId, briefId, conceptId, version: 1, storyboard, claimFlags })
        .returning();
      const [project] = await tx
        .insert(videoProjects)
        .values({
          orgId: ctx.orgId,
          businessId: brief.businessId,
          briefId,
          storyboardId: sb!.id,
          title: `${profile.name} · ${concept.concept.title}`,
          status: 'PLAN_READY',
          plan,
          budgetMicroUsd: usdToMicro(brief.brief.productionBudgetUsd),
        })
        .returning();
      await tx.insert(scenes).values(
        storyboard.scenes.map((s) => ({
          orgId: ctx.orgId,
          videoProjectId: project!.id,
          sceneKey: s.key,
          order: s.order,
          spec: s,
          plan: plan.scenes.find((p) => p.sceneKey === s.key),
          contentHash: sceneContentHash(s),
        })),
      );
      return project!.id;
    });
    await recorder.flush(this.db, { orgId: ctx.orgId, campaignBriefId: briefId, videoProjectId: projectId });
    await this.audit(ctx, 'concept.selected', 'video_project', projectId, { conceptKey: concept.key });
    return { projectId };
  }

  // ── Projects ─────────────────────────────────────────────────────────

  /** Price of the configured image provider, when it can be used (planning falls back to the default otherwise). */
  private imagePrice() {
    return this.imageSetup.ready ? imagePriceEntry(this.catalog, this.imageSetup) : undefined;
  }

  /**
   * Re-routes every scene with the owner's approved scene images (they replace planned image generations) and
   * stores the new plan. Called whenever an image is approved or rejected.
   */
  async refreshPlan(ctx: AuthContext, projectId: string) {
    const project = await this.projectRow(ctx, projectId);
    const [storyboard] = await this.db
      .select()
      .from(storyboards)
      .where(eq(storyboards.id, project.storyboardId));
    const brief = await this.briefRow(ctx, project.briefId);
    const assetRows = await this.businesses.assets(ctx, project.businessId);
    const approved = await approvedSceneImages(this.db, ctx.orgId, projectId);
    const plan = planProduction({
      storyboard: storyboard!.storyboard,
      assets: [...toAvailableAssets(assetRows), ...approved.map((a) => a.available)],
      approvedImages: Object.fromEntries(approved.map((a) => [a.sceneKey, a.assetId])),
      budgetUsd: brief.brief.productionBudgetUsd,
      perGenerationMaxUsd: this.policy.perGenerationMaxUsd,
      qualityTier: brief.brief.qualityTier,
      catalog: this.catalog,
      imagePrice: this.imagePrice(),
    });
    await this.db.transaction(async (tx) => {
      await tx
        .update(videoProjects)
        .set({ plan })
        .where(and(eq(videoProjects.id, projectId), eq(videoProjects.orgId, ctx.orgId)));
      for (const scenePlan of plan.scenes) {
        await tx
          .update(scenes)
          .set({ plan: scenePlan })
          .where(and(eq(scenes.videoProjectId, projectId), eq(scenes.sceneKey, scenePlan.sceneKey)));
      }
    });
    return plan;
  }

  private async projectRow(ctx: AuthContext, projectId: string) {
    const [row] = await this.db
      .select()
      .from(videoProjects)
      .where(and(eq(videoProjects.id, projectId), eq(videoProjects.orgId, ctx.orgId)));
    if (!row) throw notFound('Project');
    return row;
  }

  async getProject(ctx: AuthContext, projectId: string) {
    const project = await this.projectRow(ctx, projectId);
    const [storyboard] = await this.db
      .select()
      .from(storyboards)
      .where(eq(storyboards.id, project.storyboardId));
    const brief = await this.briefRow(ctx, project.briefId);
    const [concept] = await this.db
      .select()
      .from(creativeConcepts)
      .where(eq(creativeConcepts.id, storyboard!.conceptId));
    const versions = await this.db
      .select({
        id: timelineVersions.id,
        version: timelineVersions.version,
        reason: timelineVersions.reason,
        createdAt: timelineVersions.createdAt,
      })
      .from(timelineVersions)
      .where(and(eq(timelineVersions.videoProjectId, projectId), eq(timelineVersions.orgId, ctx.orgId)))
      .orderBy(desc(timelineVersions.version));
    const renders = await this.listRenders(ctx, projectId);
    const approvedImages = await approvedSceneImages(this.db, ctx.orgId, projectId);
    const [current] = project.currentTimelineVersionId
      ? await this.db
          .select({ project: timelineVersions.project })
          .from(timelineVersions)
          .where(eq(timelineVersions.id, project.currentTimelineVersionId))
      : [];
    return {
      id: project.id,
      title: project.title,
      status: project.status,
      budgetUsd: project.budgetMicroUsd / 1_000_000,
      plan: project.plan,
      brief: brief.brief,
      briefId: brief.id,
      concept: concept!.concept,
      storyboard: storyboard!.storyboard,
      claimFlags: storyboard!.claimFlags,
      scriptApprovedAt: project.scriptApprovedAt,
      narration: await this.narration.describe(ctx, project, storyboard!.storyboard),
      currentTimelineVersionId: project.currentTimelineVersionId,
      /** Part of the timeline approval key (see timelineApprovalReason). */
      imagesKey: sceneImagesKey(approvedImages),
      /** Technical QA of the current timeline (internal review aid; not a quality verdict). */
      timelineQa: current ? timelineQa(current.project) : [],
      /** What each scene of the current timeline shows and how it moves (review aid). */
      timeline: current ? describeTimeline(current.project) : null,
      versions,
      renders,
      costs: await this.projectCosts(ctx, projectId),
    };
  }

  async projectCosts(ctx: AuthContext, projectId: string) {
    const project = await this.projectRow(ctx, projectId);
    return summarizeLedger(
      await ledgerEntriesFor(this.db, ctx.orgId, { projectIds: [projectId], briefIds: [project.briefId] }),
    );
  }

  /** The customer approved the script (voiceover lines). Required before narration and production. */
  async approveScript(ctx: AuthContext, projectId: string) {
    const project = await this.projectRow(ctx, projectId);
    if (!project.scriptApprovedAt) {
      await this.db
        .update(videoProjects)
        .set({ scriptApprovedAt: new Date() })
        .where(and(eq(videoProjects.id, projectId), eq(videoProjects.orgId, ctx.orgId)));
      await this.db.insert(approvals).values({
        orgId: ctx.orgId,
        videoProjectId: projectId,
        subject: 'STORYBOARD',
        subjectRef: project.storyboardId,
        decision: 'APPROVED',
        approvedEstimateMicroUsd: 0,
        decidedBy: ctx.userId,
      });
      await this.audit(ctx, 'script.approved', 'video_project', projectId);
    }
    return this.getProject(ctx, projectId);
  }

  /**
   * The customer approves production. Builds a timeline version from the storyboard, the production plan and —
   * when recorded — the narration (scenes retimed to the measured speech). Re-approving with unchanged inputs
   * is a no-op; new narration produces a new version. Paid media generation is not available yet, so plans
   * that need it are refused rather than silently downgraded.
   */
  async approvePlan(ctx: AuthContext, projectId: string) {
    const project = await this.projectRow(ctx, projectId);
    if (!project.scriptApprovedAt) {
      throw new ApiError(HttpStatus.CONFLICT, 'SCRIPT_NOT_APPROVED', 'Approve the script first');
    }
    if (project.status === 'RENDERING') {
      throw new ApiError(HttpStatus.CONFLICT, 'RENDER_IN_PROGRESS', 'Wait for the render to finish');
    }
    if (project.status !== 'APPROVED') assertProjectTransition(project.status, 'APPROVED');
    const plan = project.plan;
    if (!plan) throw new ApiError(HttpStatus.CONFLICT, 'PLAN_MISSING', 'Project has no production plan');
    if (!plan.withinBudget)
      throw new ApiError(HttpStatus.CONFLICT, 'BUDGET_EXCEEDED', 'Plan exceeds the project budget');
    const imagesUsable =
      this.imageSetup.ready && (!this.imageSetup.paid || this.policy.paidGenerationEnabled);
    const needImages = plan.scenes
      .filter((s) => s.strategy === 'AI_IMAGE_MOTION' && s.assetIds.length === 0)
      .map((s) => s.sceneKey);
    if (needImages.length && imagesUsable) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'SCENE_IMAGES_REQUIRED',
        'Create and approve an image for every scene that needs one',
        { sceneKeys: needImages },
      );
    }
    if (plan.requiresPaidApproval && !this.policy.paidGenerationEnabled) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'GENERATION_NOT_AVAILABLE',
        'This plan needs paid AI generation, which is not enabled. Add matching media or enable providers.',
        { estimatedPaidCostUsd: plan.estimatedPaidCostUsd },
      );
    }

    const [storyboard] = await this.db
      .select()
      .from(storyboards)
      .where(eq(storyboards.id, project.storyboardId));
    const brief = await this.briefRow(ctx, project.briefId);
    const profile = await this.businesses.loadProfile(ctx, project.businessId);
    const assetRows = await this.businesses.assets(ctx, project.businessId);
    const music = assetRows.find((a) => a.kind === 'audio' && a.tags.includes('music'));
    const narration = await this.narration.timelineVoiceovers(ctx, project, storyboard!.storyboard);
    const images = await approvedSceneImages(this.db, ctx.orgId, projectId);
    const reason = timelineApprovalReason(narration?.key, sceneImagesKey(images));
    const [latest] = await this.db
      .select({ reason: timelineVersions.reason })
      .from(timelineVersions)
      .where(and(eq(timelineVersions.videoProjectId, projectId), eq(timelineVersions.orgId, ctx.orgId)))
      .orderBy(desc(timelineVersions.version))
      .limit(1);
    if (latest?.reason === reason && project.currentTimelineVersionId) {
      if (project.status !== 'APPROVED' && project.status !== 'RENDERED') {
        await this.db
          .update(videoProjects)
          .set({ status: 'APPROVED' })
          .where(eq(videoProjects.id, projectId));
      }
      return this.getProject(ctx, projectId);
    }
    const timeline = buildVideoProject({
      projectId,
      title: project.title,
      business: profile,
      brief: brief.brief,
      storyboard: storyboard!.storyboard,
      plan,
      assets: [...toMediaAssets(assetRows), ...images.map((i) => i.media), ...(narration?.assets ?? [])],
      voiceovers: narration?.voiceovers,
      musicAssetId: music?.id,
      logoAssetId: profile.logoAssetId,
    });
    const qaErrors = timelineQa(timeline).filter((i) => i.severity === 'error');
    if (qaErrors.length) {
      throw new ApiError(HttpStatus.CONFLICT, 'TIMELINE_QA_FAILED', 'The timeline failed technical checks', {
        issues: qaErrors,
      });
    }

    await this.db.transaction(async (tx) => {
      const [{ value: last } = { value: 0 }] = await tx
        .select({ value: max(timelineVersions.version) })
        .from(timelineVersions)
        .where(eq(timelineVersions.videoProjectId, projectId));
      const [version] = await tx
        .insert(timelineVersions)
        .values({
          orgId: ctx.orgId,
          videoProjectId: projectId,
          version: (last ?? 0) + 1,
          project: timeline,
          reason,
          createdBy: ctx.userId,
        })
        .returning();
      await tx.insert(approvals).values({
        orgId: ctx.orgId,
        videoProjectId: projectId,
        subject: 'PRODUCTION_PLAN',
        subjectRef: version!.id,
        decision: 'APPROVED',
        approvedEstimateMicroUsd: usdToMicro(plan.totalEstimatedCostUsd),
        decidedBy: ctx.userId,
      });
      await tx
        .update(videoProjects)
        .set({ status: 'APPROVED', currentTimelineVersionId: version!.id })
        .where(and(eq(videoProjects.id, projectId), eq(videoProjects.orgId, ctx.orgId)));
    });
    await this.audit(ctx, 'plan.approved', 'video_project', projectId, {
      estimateUsd: plan.totalEstimatedCostUsd,
    });
    return this.getProject(ctx, projectId);
  }

  // ── Renders ──────────────────────────────────────────────────────────

  /** Idempotent per timeline version + quality. A failed render is re-queued; anything else is returned as-is. */
  async requestRender(ctx: AuthContext, projectId: string, quality: RenderQuality) {
    const project = await this.projectRow(ctx, projectId);
    if (
      !project.currentTimelineVersionId ||
      !['APPROVED', 'RENDERING', 'RENDERED', 'FAILED'].includes(project.status)
    ) {
      throw new ApiError(HttpStatus.CONFLICT, 'NOT_APPROVED', 'Approve the production plan before rendering');
    }
    const idempotencyKey = `${project.currentTimelineVersionId}:${quality}`;
    const [existing] = await this.db
      .select()
      .from(renderJobs)
      .where(and(eq(renderJobs.idempotencyKey, idempotencyKey), eq(renderJobs.orgId, ctx.orgId)));
    if (existing && existing.status !== 'FAILED') return this.toRenderDto(existing);

    let job = existing;
    if (job) {
      [job] = await this.db
        .update(renderJobs)
        .set({ status: 'QUEUED', stage: 'QUEUED', progress: 0, error: null, finishedAt: null })
        .where(eq(renderJobs.id, job.id))
        .returning();
    } else {
      [job] = await this.db
        .insert(renderJobs)
        .values({
          orgId: ctx.orgId,
          videoProjectId: projectId,
          timelineVersionId: project.currentTimelineVersionId,
          quality,
          idempotencyKey,
          requestedBy: ctx.userId,
        })
        .returning();
    }
    const payload: RenderJobPayload = { renderJobId: job!.id, orgId: ctx.orgId };
    await this.queue.add('render', payload, {
      jobId: existing ? `${job!.id}-retry-${Date.now()}` : job!.id,
      attempts: 2,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 200,
      removeOnFail: 500,
    });
    await this.db.update(videoProjects).set({ status: 'RENDERING' }).where(eq(videoProjects.id, projectId));
    await this.audit(ctx, 'render.requested', 'render_job', job!.id, { quality });
    return this.toRenderDto(job!);
  }

  async listRenders(ctx: AuthContext, projectId?: string) {
    const rows = await this.db
      .select()
      .from(renderJobs)
      .where(
        and(
          eq(renderJobs.orgId, ctx.orgId),
          projectId ? eq(renderJobs.videoProjectId, projectId) : undefined,
        ),
      )
      .orderBy(desc(renderJobs.createdAt));
    return Promise.all(rows.map((r) => this.toRenderDto(r)));
  }

  async getRender(ctx: AuthContext, renderId: string) {
    const [row] = await this.db
      .select()
      .from(renderJobs)
      .where(and(eq(renderJobs.id, renderId), eq(renderJobs.orgId, ctx.orgId)));
    if (!row) throw notFound('Render');
    return this.toRenderDto(row);
  }

  /** Finished videos for "הסרטונים שלי". */
  async listVideos(ctx: AuthContext) {
    const rows = await this.db
      .select({ render: renderJobs, title: videoProjects.title })
      .from(renderJobs)
      .innerJoin(videoProjects, eq(videoProjects.id, renderJobs.videoProjectId))
      .where(
        and(eq(renderJobs.orgId, ctx.orgId), eq(renderJobs.status, 'SUCCEEDED'), isNull(renderJobs.error)),
      )
      .orderBy(desc(renderJobs.finishedAt));
    return Promise.all(
      rows.map(async (r) => ({ ...(await this.toRenderDto(r.render, r.title)), title: r.title })),
    );
  }

  private async toRenderDto(row: typeof renderJobs.$inferSelect, title?: string) {
    const ready = row.status === 'SUCCEEDED' && row.outputKey;
    return {
      id: row.id,
      projectId: row.videoProjectId,
      timelineVersionId: row.timelineVersionId,
      quality: row.quality,
      status: row.status,
      stage: row.stage,
      progress: row.progress,
      error: row.error,
      width: row.width,
      height: row.height,
      durationSec: row.durationSec,
      outputBytes: row.outputBytes,
      createdAt: row.createdAt,
      finishedAt: row.finishedAt,
      streamUrl: ready ? await this.storage.getReadUrl(row.outputKey!, { expiresInSec: 3600 }) : null,
      downloadUrl: ready
        ? await this.storage.getReadUrl(row.outputKey!, {
            expiresInSec: 3600,
            downloadName: `kampora-${(title ?? 'video').replace(/[^\p{L}\p{N}]+/gu, '-')}-${row.quality}.mp4`,
          })
        : null,
    };
  }
}
