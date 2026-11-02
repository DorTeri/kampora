import { HttpException, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, max } from 'drizzle-orm';
import {
  DirectorToolError,
  normalize,
  type AssetSummary,
  type ConceptSummary,
  type DirectionSummary,
  type DirectorApprovalActions,
  type DirectorToolExecutor,
  type RevisionResult,
  type StatusItem,
  type ToolArgs,
} from '@kampora/creative-engine';
import {
  auditLog,
  brandAssets,
  campaignBriefs,
  directorApprovals,
  renderJobs,
  scenes,
  staticAds,
  storyboards,
  videoProjects,
} from '@kampora/database';
import { sceneContentHash } from '@kampora/production-engine';
import {
  canTransitionProject,
  CreativeDirectionSchema,
  type CreativeDirection,
  type DirectorCampaignSummary,
  type Storyboard,
} from '@kampora/shared';
import type { AuthContext } from '../common/auth';
import { ApiError } from '../common/errors';
import type { StaticAdsService } from '../studio/static-ads.service';
import type { StudioService } from '../studio/studio.service';
import type { ConversationRow, DirectorStore } from './director.store';

/** The owner sees Hebrew; API error codes are mapped here, anything unknown becomes a generic message. */
const ERROR_TEXT: Record<string, string> = {
  NOT_FOUND: 'הפריט לא נמצא',
  SCRIPT_NOT_APPROVED: 'התסריט עוד לא אושר',
  PLAN_NOT_READY: 'תוכנית ההפקה עוד לא מוכנה',
  PLAN_MISSING: 'תוכנית ההפקה עוד לא מוכנה',
  RENDER_IN_PROGRESS: 'יש כרגע רינדור שרץ על הסרטון הזה; אפשר לנסות שוב כשהוא יסתיים',
  BUDGET_EXCEEDED: 'התוכנית חורגת מהתקציב של הפרויקט',
  GENERATION_NOT_AVAILABLE: 'התוכנית צריכה יצירת מדיה בתשלום, והיא כבויה. אפשר להעלות תמונות אמיתיות בסטודיו',
  SCENE_IMAGES_REQUIRED: 'יש סצנות שצריכות תמונה מאושרת לפני ההפקה. אפשר להוסיף אותן בסטודיו',
  TIMELINE_QA_FAILED: 'בדיקת התזמון של הסרטון נכשלה',
  NO_STATIC_AD: 'עוד אין מודעות לפרויקט הזה',
  NO_CONCEPT: 'לפרויקט אין רעיון קריאייטיב',
  TOO_MANY_VERSIONS: 'הגעת למספר הגרסאות המרבי של המודעה',
  UNAPPROVED_COPY: 'בעיצוב יש טקסט שלא אושר',
  INVALID_DIRECTION: 'כיוון העיצוב לא תקין',
  PROVIDER_NOT_CONFIGURED: 'שירות הקריאייטיב לא מוגדר בשרת',
  PAID_GENERATION_DISABLED: 'יצירה בתשלום כבויה במערכת',
  PAID_APPROVAL_REQUIRED: 'נדרש אישור עלות לפני יצירה בתשלום',
  NO_BUSINESS: 'עוד אין פרטי עסק לבנות מהם קמפיין',
};

const logger = new Logger('DirectorExecutor');

function toToolError(error: unknown, tool: string): DirectorToolError {
  if (error instanceof DirectorToolError) return error;
  if (error instanceof ApiError) return new DirectorToolError(ERROR_TEXT[error.code] ?? 'הפעולה נדחתה', error.code);
  if (error instanceof HttpException) return new DirectorToolError('הפעולה נדחתה', `HTTP_${error.getStatus()}`);
  logger.error(`${tool} failed: ${error instanceof Error ? error.stack : String(error)}`);
  return new DirectorToolError('תקלה בשירות; לא בוצע שינוי', 'INTERNAL');
}

/** Wraps every method so failures reach the engine as DirectorToolError (it stops the step and explains). */
function guarded<T extends object>(target: T): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if (typeof value !== 'function' || prop === 'constructor') return value;
      return async (...args: unknown[]) => {
        try {
          return await (value as (...a: unknown[]) => Promise<unknown>).apply(obj, args);
        } catch (error) {
          throw toToolError(error, String(prop));
        }
      };
    },
  });
}

/** The Studio titles projects "<business> · <concept>"; the product tells two campaigns of one business apart. */
const campaignTitle = (product: string, projectTitle: string) => `${product} · ${projectTitle.split(' · ').slice(1).join(' · ') || projectTitle}`;

const OPENING_VERB = /^(?:תפתח|שיפתח|תתחיל|שיתחיל|פתיחה)\s+(?:ב|עם)\s*/;

/**
 * The Director's tools over the real application services, for one request of one organization. The Studio
 * services keep enforcing their own rules (script approval, budget, paid-generation kill switch); this class
 * only translates. Nothing here publishes, messages customers or spends advertising money.
 */
export class ApiDirectorExecutor implements DirectorToolExecutor, DirectorApprovalActions {
  readonly kind = 'API';

  static create(deps: {
    ctx: AuthContext;
    conversation: ConversationRow;
    store: DirectorStore;
    studio: StudioService;
    staticAds: StaticAdsService;
  }) {
    return guarded(new ApiDirectorExecutor(deps.ctx, deps.conversation, deps.store, deps.studio, deps.staticAds));
  }

  private constructor(
    private readonly ctx: AuthContext,
    private readonly conversation: ConversationRow,
    private readonly store: DirectorStore,
    private readonly studio: StudioService,
    private readonly ads: StaticAdsService,
  ) {}

  private get db() {
    return this.store.db;
  }

  private businessId(): string {
    if (!this.conversation.businessId) throw new DirectorToolError(ERROR_TEXT.NO_BUSINESS!, 'NO_BUSINESS');
    return this.conversation.businessId;
  }

  /** Projects of this conversation's business only (ids from the conversation are checked, not trusted). */
  private async project(projectId: string) {
    const [row] = await this.db
      .select()
      .from(videoProjects)
      .where(and(eq(videoProjects.id, projectId), eq(videoProjects.orgId, this.ctx.orgId), eq(videoProjects.businessId, this.businessId())));
    if (!row) throw new DirectorToolError(ERROR_TEXT.NOT_FOUND!, 'NOT_FOUND');
    return row;
  }

  private async campaign(campaignId: string) {
    const [row] = await this.db
      .select({ id: campaignBriefs.id })
      .from(campaignBriefs)
      .where(and(eq(campaignBriefs.id, campaignId), eq(campaignBriefs.orgId, this.ctx.orgId), eq(campaignBriefs.businessId, this.businessId())));
    if (!row) throw new DirectorToolError(ERROR_TEXT.NOT_FOUND!, 'NOT_FOUND');
  }

  // ── Memory ───────────────────────────────────────────────────────────

  async ReadBusinessProfile() {
    return { facts: await this.store.facts(this.ctx, this.conversation.businessId) };
  }

  async ProposeBusinessProfileUpdate(args: ToolArgs<'ProposeBusinessProfileUpdate'>) {
    await this.store.saveFacts(this.ctx, this.conversation, args.facts);
    return { saved: args.facts.length };
  }

  async GetCampaignHistory(args: ToolArgs<'GetCampaignHistory'>): Promise<DirectorCampaignSummary[]> {
    if (!this.conversation.businessId) return [];
    const rows = await this.db
      .select({
        id: campaignBriefs.id,
        brief: campaignBriefs.brief,
        plan: campaignBriefs.directorPlan,
        createdAt: campaignBriefs.createdAt,
        projectId: videoProjects.id,
        title: videoProjects.title,
        scriptApprovedAt: videoProjects.scriptApprovedAt,
      })
      .from(campaignBriefs)
      .leftJoin(videoProjects, eq(videoProjects.briefId, campaignBriefs.id))
      .where(and(eq(campaignBriefs.orgId, this.ctx.orgId), eq(campaignBriefs.businessId, this.conversation.businessId)))
      .orderBy(desc(campaignBriefs.createdAt))
      .limit(args.limit ?? 20);
    const projectIds = rows.flatMap((r) => (r.projectId ? [r.projectId] : []));
    const ads = projectIds.length
      ? await this.db
          .select({ projectId: staticAds.videoProjectId, format: staticAds.format })
          .from(staticAds)
          .where(and(eq(staticAds.orgId, this.ctx.orgId), inArray(staticAds.videoProjectId, projectIds)))
      : [];
    const approvedDirections = projectIds.length
      ? await this.db
          .select({ subjectId: auditLog.subjectId })
          .from(auditLog)
          .where(and(eq(auditLog.orgId, this.ctx.orgId), eq(auditLog.action, 'creative_direction.approved'), inArray(auditLog.subjectId, projectIds)))
      : [];
    const renders = projectIds.length
      ? await this.db
          .select({ projectId: renderJobs.videoProjectId, status: renderJobs.status, createdAt: renderJobs.createdAt })
          .from(renderJobs)
          .where(and(eq(renderJobs.orgId, this.ctx.orgId), inArray(renderJobs.videoProjectId, projectIds)))
          .orderBy(desc(renderJobs.createdAt))
      : [];
    return rows.map((r) => ({
      campaignId: r.id,
      projectId: r.projectId,
      title: r.title ? campaignTitle(r.brief.productName, r.title) : r.brief.productName,
      product: r.brief.productName,
      goal: r.brief.goal,
      ...(r.plan ? { objective: r.plan.objective } : {}),
      createdAt: r.createdAt.toISOString(),
      hasVideo: Boolean(r.projectId),
      scriptApproved: Boolean(r.scriptApprovedAt),
      staticAds: new Set(ads.filter((a) => a.projectId === r.projectId).map((a) => a.format)).size,
      directionApproved: approvedDirections.some((a) => a.subjectId === r.projectId),
      renderStatus: renders.find((x) => x.projectId === r.projectId)?.status ?? null,
    }));
  }

  async GetAvailableAssets(): Promise<AssetSummary> {
    if (!this.conversation.businessId) return { photos: 0, verified: 0, demonstration: 0 };
    const rows = await this.db
      .select({ kind: brandAssets.kind, provenance: brandAssets.provenance })
      .from(brandAssets)
      .where(and(eq(brandAssets.orgId, this.ctx.orgId), eq(brandAssets.businessId, this.conversation.businessId)));
    const photos = rows.filter((r) => r.kind === 'image');
    const verified = photos.filter((r) => r.provenance.source === 'CUSTOMER_UPLOAD').length;
    return { photos: photos.length, verified, demonstration: photos.length - verified };
  }

  // ── Creative ─────────────────────────────────────────────────────────

  async CreateCreativeBrief(args: ToolArgs<'CreateCreativeBrief'>) {
    const businessId = this.businessId();
    const campaign = await this.studio.createCampaign(
      this.ctx,
      businessId,
      { goal: args.goal, productName: args.productName, ...(args.offer ? { offer: args.offer } : {}), ...(args.notes ? { notes: args.notes } : {}) },
      args.approvedUsd,
    );
    // The Director's plan (objective, conversion destination, unpublished Meta draft) is kept with the brief.
    await this.db
      .update(campaignBriefs)
      .set({ directorPlan: args.plan })
      .where(and(eq(campaignBriefs.id, campaign.id), eq(campaignBriefs.orgId, this.ctx.orgId)));
    return { campaignId: campaign.id, concepts: this.concepts(campaign.concepts) };
  }

  private concepts(list: { id: string; concept: { title: string; hook: string }; isRecommended: boolean }[]): ConceptSummary[] {
    return list.map((c) => ({ id: c.id, title: c.concept.title, hook: c.concept.hook, recommended: c.isRecommended }));
  }

  async GenerateCreativeConcepts(args: ToolArgs<'GenerateCreativeConcepts'>) {
    await this.campaign(args.campaignId);
    const campaign = await this.studio.getCampaign(this.ctx, args.campaignId);
    return { concepts: this.concepts(campaign.concepts) };
  }

  async RequestStoryboard(args: ToolArgs<'RequestStoryboard'>) {
    await this.campaign(args.campaignId);
    const { projectId } = await this.studio.selectConcept(this.ctx, args.campaignId, args.conceptId);
    const project = await this.studio.getProject(this.ctx, projectId);
    return { projectId, title: campaignTitle(project.brief.productName, project.title), script: project.storyboard.scenes.map((s) => s.voiceover).filter((v) => v.trim()) };
  }

  async RequestArtDirection(args: ToolArgs<'RequestArtDirection'>) {
    await this.project(args.projectId);
    const existing = await this.ads.list(this.ctx, args.projectId);
    if (!existing.ads.length) await this.ads.create(this.ctx, args.projectId);
    const d = await this.ads.directions(this.ctx, args.projectId);
    const recommended = d.set.recommended;
    const ordered = [...d.set.directions].sort((a, b) => Number(b.key === recommended) - Number(a.key === recommended));
    return { directions: ordered.map((x) => this.direction(x, d.copy)) };
  }

  private direction(d: CreativeDirection, copy: Record<string, unknown>): DirectionSummary {
    const own = copy[d.key] as { headline?: unknown } | undefined;
    const headline = typeof own?.headline === 'string' ? own.headline : d.idea;
    return { key: d.key, name: d.name, method: d.method, headline: headline.slice(0, 200), direction: d };
  }

  async RequestProduction(args: ToolArgs<'RequestProduction'>) {
    await this.project(args.projectId);
    await this.studio.approvePlan(this.ctx, args.projectId);
    const render = await this.studio.requestRender(this.ctx, args.projectId, 'preview');
    return {
      status: render.status,
      detail: 'הסרטון נשלח להפקת תצוגה מקדימה (ללא עלות). אפשר לעקוב אחרי ההתקדמות בפאנל הסטטוס.',
    };
  }

  async GetProductionStatus(args: ToolArgs<'GetProductionStatus'>): Promise<StatusItem[]> {
    if (!this.conversation.businessId) return [];
    const projects = await this.db
      .select({
        id: videoProjects.id,
        title: videoProjects.title,
        brief: campaignBriefs.brief,
        status: videoProjects.status,
        scriptApprovedAt: videoProjects.scriptApprovedAt,
      })
      .from(videoProjects)
      .innerJoin(campaignBriefs, eq(campaignBriefs.id, videoProjects.briefId))
      .where(
        and(
          eq(videoProjects.orgId, this.ctx.orgId),
          eq(videoProjects.businessId, this.conversation.businessId),
          ...(args.projectId ? [eq(videoProjects.id, args.projectId)] : []),
        ),
      )
      .orderBy(desc(videoProjects.updatedAt))
      .limit(10);
    const ids = projects.map((p) => p.id);
    const renders = ids.length
      ? await this.db
          .select({ projectId: renderJobs.videoProjectId, status: renderJobs.status, stage: renderJobs.stage, progress: renderJobs.progress })
          .from(renderJobs)
          .where(and(eq(renderJobs.orgId, this.ctx.orgId), inArray(renderJobs.videoProjectId, ids)))
          .orderBy(desc(renderJobs.createdAt))
      : [];
    return projects.map((p) => {
      const r = renders.find((x) => x.projectId === p.id);
      const state = r
        ? r.status === 'SUCCEEDED'
          ? 'תצוגה מקדימה מוכנה'
          : r.status === 'FAILED'
            ? 'הרינדור נכשל'
            : `ברינדור (${Math.round(r.progress)}%)`
        : p.status === 'APPROVED'
          ? 'הפקה אושרה'
          : p.scriptApprovedAt
            ? 'תסריט מאושר'
            : 'תסריט ממתין לאישור';
      return { label: campaignTitle(p.brief.productName, p.title), state, href: `/studio/projects/${p.id}` };
    });
  }

  async PresentCreativeForApproval(args: ToolArgs<'PresentCreativeForApproval'>) {
    const a = await this.store.insertApproval(this.ctx, this.conversation, args);
    return { approvalId: a.id };
  }

  // ── Targeted revisions ───────────────────────────────────────────────

  async RequestTargetedRevision(args: ToolArgs<'RequestTargetedRevision'>): Promise<RevisionResult> {
    return args.target === 'VIDEO_OPENING' ? this.reviseOpening(args) : this.reviseDirection(args);
  }

  /**
   * Changes only the first scene: a quoted line replaces its narration and on-screen text; otherwise the owner's
   * words describe what it shows. A new storyboard version is stored (the old one stays), the script approval is
   * reset (the owner approves the new opening) and the production plan is recomputed. Nothing is rendered.
   */
  private async reviseOpening(args: ToolArgs<'RequestTargetedRevision'>): Promise<RevisionResult> {
    const project = await this.project(args.projectId);
    if (project.status === 'RENDERING') throw new DirectorToolError(ERROR_TEXT.RENDER_IN_PROGRESS!, 'RENDER_IN_PROGRESS');
    const [current] = await this.db.select().from(storyboards).where(eq(storyboards.id, project.storyboardId));
    if (!current) throw new DirectorToolError(ERROR_TEXT.NOT_FOUND!, 'NOT_FOUND');
    const sorted = [...current.storyboard.scenes].sort((a, b) => a.order - b.order);
    const first = sorted[0]!;
    const text = normalize(args.instruction);
    const quoted = text.match(/"([^"]{2,120})"/)?.[1]?.trim();
    const visual = text.replace(OPENING_VERB, '').trim();
    const revised = quoted ? { ...first, voiceover: quoted, onScreenText: quoted } : { ...first, visual: visual.slice(0, 300) };
    const before = quoted ? first.voiceover : first.visual;
    const after = quoted ? quoted : revised.visual;
    const storyboard: Storyboard = { ...current.storyboard, scenes: current.storyboard.scenes.map((s) => (s.key === first.key ? revised : s)) };

    await this.db.transaction(async (tx) => {
      const [{ value: last } = { value: 1 }] = await tx
        .select({ value: max(storyboards.version) })
        .from(storyboards)
        .where(and(eq(storyboards.conceptId, current.conceptId), eq(storyboards.orgId, this.ctx.orgId)));
      const [sb] = await tx
        .insert(storyboards)
        .values({ orgId: this.ctx.orgId, briefId: current.briefId, conceptId: current.conceptId, version: (last ?? 1) + 1, storyboard, claimFlags: current.claimFlags })
        .returning({ id: storyboards.id });
      const status = project.status === 'PLAN_READY' || !canTransitionProject(project.status, 'PLAN_READY') ? project.status : 'PLAN_READY';
      await tx
        .update(videoProjects)
        .set({ storyboardId: sb!.id, scriptApprovedAt: null, status })
        .where(and(eq(videoProjects.id, project.id), eq(videoProjects.orgId, this.ctx.orgId)));
      await tx
        .update(scenes)
        .set({ spec: revised, contentHash: sceneContentHash(revised) })
        .where(and(eq(scenes.videoProjectId, project.id), eq(scenes.sceneKey, first.key), eq(scenes.orgId, this.ctx.orgId)));
    });
    await this.studio.refreshPlan(this.ctx, project.id);
    await this.store.audit(this.ctx, 'director.opening_revised', 'video_project', project.id, { quoted: Boolean(quoted), instruction: text.slice(0, 300) });
    return {
      applied: true,
      summary: quoted ? 'החלפתי את משפט הפתיחה (קריינות וטקסט על המסך).' : 'עדכנתי את מה שרואים בסצנת הפתיחה. שאר הסרטון לא השתנה.',
      before,
      after,
    };
  }

  /** The Studio's Hebrew change-request engine, applied to the direction the owner was last shown. */
  private async reviseDirection(args: ToolArgs<'RequestTargetedRevision'>): Promise<RevisionResult> {
    await this.project(args.projectId);
    const d = await this.ads.directions(this.ctx, args.projectId);
    const key = args.directionKey ?? d.set.recommended;
    const shown = await this.lastShownDirection(args.projectId, key);
    const outcome = await this.ads.changeDirection(this.ctx, args.projectId, key, { text: args.instruction, ...(shown ? { direction: shown } : {}) });
    const base = shown ?? d.set.directions.find((x) => x.key === key);
    const applied = JSON.stringify(outcome.direction) !== JSON.stringify(base);
    return {
      applied,
      summary: outcome.summary,
      ...(outcome.suggestions?.length ? { suggestions: outcome.suggestions } : {}),
      ...(applied ? { direction: this.direction(outcome.direction, d.copy) } : {}),
    };
  }

  /** The latest direction proposed for approval for this project and key, so revisions build on each other. */
  private async lastShownDirection(projectId: string, key: string): Promise<CreativeDirection | undefined> {
    const rows = await this.db
      .select({ payload: directorApprovals.payload })
      .from(directorApprovals)
      .where(and(eq(directorApprovals.orgId, this.ctx.orgId), eq(directorApprovals.kind, 'CREATIVE_DIRECTION')))
      .orderBy(desc(directorApprovals.createdAt))
      .limit(20);
    const hit = rows.find((r) => r.payload.projectId === projectId && r.payload.key === key);
    const parsed = CreativeDirectionSchema.safeParse(hit?.payload.direction);
    return parsed.success ? parsed.data : undefined;
  }

  // ── Approved actions (run only from an explicit owner decision) ──────

  async approveScript(projectId: string) {
    await this.project(projectId);
    await this.studio.approveScript(this.ctx, projectId);
  }

  async approveDirection(projectId: string, key: 'A' | 'B' | 'C', direction: unknown) {
    await this.project(projectId);
    const parsed = CreativeDirectionSchema.safeParse(direction);
    if (!parsed.success) throw new DirectorToolError(ERROR_TEXT.INVALID_DIRECTION!, 'INVALID_DIRECTION');
    const r = await this.ads.approveDirection(this.ctx, projectId, key, { direction: parsed.data, note: 'אושר דרך מנהל הקמפיין' });
    return { formats: r.saved.map((s) => s.format) };
  }
}
