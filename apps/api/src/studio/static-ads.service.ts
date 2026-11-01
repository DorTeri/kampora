import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { and, asc, eq, max } from 'drizzle-orm';
import { industryFor } from '@kampora/agent-expertise';
import {
  applyCreativeChange,
  directCreative,
  directionInputFor,
  reviewDirectionSet,
  reviewStaticAd,
  withComposition,
  type DirectionInput,
  type StaticDirectionContext,
} from '@kampora/creative-engine';
import {
  auditLog,
  campaignBriefs,
  creativeConcepts,
  staticAds,
  storyboards,
  videoProjects,
  type Database,
} from '@kampora/database';
import {
  StaticAdEditError,
  applyStaticAdEdit,
  buildStaticAd,
  chooseStaticAdBackground,
  staticAdQa,
  type BackgroundCandidate,
} from '@kampora/production-engine';
import {
  STATIC_AD_FORMATS,
  STATIC_AD_JOB_NAME,
  StaticAdSchema,
  mediaAuthenticity,
  type CreativeDirection,
  type DirectionApprovalRequest,
  type DirectionChangeRequest,
  type MediaAsset,
  type StaticAd,
  type StaticAdEdit,
  type StaticAdFormat,
  type StaticAdJobPayload,
} from '@kampora/shared';
import type { StorageDriver } from '@kampora/storage';
import type { AuthContext } from '../common/auth';
import { ApiError, notFound } from '../common/errors';
import { DATABASE, RENDER_QUEUE, STORAGE } from '../infra/tokens';
import { ArtDirectionService } from './art-direction.service';
import { BusinessService, toMediaAssets } from './business.service';
import { CriticService } from './critic.service';
import { approvedSceneImages } from './scene-image-assets';

export const MAX_STATIC_AD_VERSIONS = 20;
const FORMATS = Object.keys(STATIC_AD_FORMATS) as StaticAdFormat[];

type StaticAdRow = typeof staticAds.$inferSelect;

/** The document minus its id: two versions with the same content render the same pixels. */
function fingerprint(ad: StaticAd): string {
  const { id: _id, ...content } = ad;
  return createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

/**
 * Static image ads (1:1, 4:5, 9:16): built deterministically from the approved script, edited through validated
 * changes, rendered locally to PNG and JPEG. Nothing here calls a paid provider or generates new images.
 */
@Injectable()
export class StaticAdsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    @Inject(RENDER_QUEUE) private readonly queue: Queue,
    private readonly businesses: BusinessService,
    private readonly artDirection: ArtDirectionService,
    private readonly critic: CriticService,
  ) {}

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
    const [brief] = await this.db
      .select()
      .from(campaignBriefs)
      .where(and(eq(campaignBriefs.id, project.briefId), eq(campaignBriefs.orgId, ctx.orgId)));
    const [concept] = await this.db
      .select({ concept: creativeConcepts.concept })
      .from(creativeConcepts)
      .where(eq(creativeConcepts.id, storyboard!.conceptId));
    const profile = await this.businesses.loadProfile(ctx, project.businessId);
    const brandRows = await this.businesses.assets(ctx, project.businessId);
    const approved = await approvedSceneImages(this.db, ctx.orgId, projectId);
    const brand = toMediaAssets(brandRows);
    // Pictures the owner may put behind the text: their own photos and the AI images they approved.
    const pictures: MediaAsset[] = [
      ...brand.filter((a) => brandRows.find((r) => r.id === a.id)?.kind === 'image'),
      ...approved.map((i) => i.media),
    ].filter((a) => a.kind === 'image' && a.provenance.commercialUse);
    // What each picture shows and how authentic it is: the ranking's input. Uploads are described by their owner
    // (description and tags); AI images by what they were planned to show. No image recognition is involved.
    const candidates: BackgroundCandidate[] = pictures.map((asset) => {
      const ai = approved.find((i) => i.assetId === asset.id);
      if (ai)
        return {
          asset,
          content: ai.plannedContent,
          authenticity: ai.authenticity,
          composition: ai.composition,
          campaignImage: true,
        };
      const row = brandRows.find((r) => r.id === asset.id)!;
      return {
        asset,
        content: [row.description, ...row.tags].join(' '),
        authenticity: mediaAuthenticity({
          source: row.provenance.source,
          mimeType: row.mimeType,
          tags: row.tags,
          description: row.description,
        }),
      };
    });
    return {
      project,
      storyboard: storyboard!.storyboard,
      brief: brief!.brief,
      concept: concept?.concept,
      profile,
      brand,
      approved,
      pictures,
      candidates,
    };
  }

  private async rows(ctx: AuthContext, projectId: string): Promise<StaticAdRow[]> {
    return this.db
      .select()
      .from(staticAds)
      .where(and(eq(staticAds.orgId, ctx.orgId), eq(staticAds.videoProjectId, projectId)))
      .orderBy(asc(staticAds.format), asc(staticAds.version));
  }

  private url(key: string | null, downloadName?: string) {
    return key ? this.storage.getReadUrl(key, { expiresInSec: 3600, downloadName }) : null;
  }

  private async toDto(row: StaticAdRow, versions: number) {
    const ad = StaticAdSchema.parse(row.ad);
    const name = `ad-${row.format.replace(':', 'x')}-v${row.version}`;
    return {
      id: row.id,
      format: row.format,
      version: row.version,
      versions,
      status: row.status,
      error: row.error,
      width: ad.width,
      height: ad.height,
      text: ad.text,
      backgroundAssetId: ad.background.assetId ?? null,
      backgroundSelection: ad.background.selection ?? null,
      design: ad.design ?? null,
      qa: staticAdQa(ad),
      pngUrl: await this.url(row.pngKey),
      jpegUrl: await this.url(row.jpegKey),
      pngDownloadUrl: await this.url(row.pngKey, `${name}.png`),
      jpegDownloadUrl: await this.url(row.jpegKey, `${name}.jpg`),
      pngBytes: row.pngBytes,
      jpegBytes: row.jpegBytes,
      createdAt: row.createdAt,
    };
  }

  /** Latest version per format, plus the pictures that can be chosen as background. */
  async list(ctx: AuthContext, projectId: string) {
    const c = await this.context(ctx, projectId);
    const rows = await this.rows(ctx, projectId);
    const ads = await Promise.all(
      FORMATS.map((format) => {
        const mine = rows.filter((r) => r.format === format);
        const latest = mine.at(-1);
        return latest ? this.toDto(latest, mine.length) : null;
      }),
    );
    const art = c.project.artDirection;
    return {
      scriptApproved: Boolean(c.project.scriptApprovedAt),
      // What the Art Director decided and why (the per-format designs travel with each ad).
      artDirection: art
        ? {
            layoutFamily: art.layoutFamily,
            visualConcept: art.visualConcept,
            hierarchy: art.hierarchy,
            decisions: art.decisions,
            alternatives: art.alternatives.slice(0, 4),
            referenceIds: art.referenceIds,
            playbookVersion: art.playbookVersion,
          }
        : null,
      maxVersions: MAX_STATIC_AD_VERSIONS,
      ads: ads.filter((a) => a !== null),
      // The Creative Critic's latest review of each format (measured checks; people judge the rest).
      reviews: (await this.critic.latest(ctx, { videoProjectId: projectId })).filter(
        (r) => r.subjectType === 'STATIC_AD',
      ),
      // The owner's latest verdict on each shown version.
      feedback: await this.critic.feedbackFor(
        ctx,
        ads.flatMap((a) => (a ? [a.id] : [])),
      ),
      pictures: await Promise.all(
        c.pictures.map(async (p) => ({
          assetId: p.id,
          source: c.approved.some((i) => i.assetId === p.id) ? ('AI' as const) : ('BUSINESS' as const),
          authenticity: c.candidates.find((x) => x.asset.id === p.id)!.authenticity,
          url: await this.storage.getReadUrl(p.storageKey, { expiresInSec: 3600 }),
        })),
      ),
    };
  }

  /** Builds (or rebuilds from the current script) the ads for the given formats and queues their render. */
  async create(ctx: AuthContext, projectId: string, formats: StaticAdFormat[] = FORMATS) {
    const c = await this.context(ctx, projectId);
    if (!c.project.scriptApprovedAt)
      throw new ApiError(HttpStatus.CONFLICT, 'SCRIPT_NOT_APPROVED', 'Approve the script first');
    if (!c.project.plan) throw new ApiError(HttpStatus.CONFLICT, 'PLAN_NOT_READY', 'The plan is not ready');
    const approvedImages = Object.fromEntries(c.approved.map((i) => [i.sceneKey, i.assetId]));
    const rows = await this.rows(ctx, projectId);
    const ownerBackground = (format: StaticAdFormat) => {
      const latest = rows.filter((r) => r.format === format).at(-1);
      const previous = latest ? StaticAdSchema.parse(latest.ad).background : undefined;
      return previous?.selection?.chosenBy === 'OWNER' ? { assetId: previous.assetId } : undefined;
    };
    const base = {
      business: c.profile,
      brief: c.brief,
      storyboard: c.storyboard,
      plan: c.project.plan,
      assets: [...c.brand, ...c.approved.map((i) => i.media)],
      approvedImages,
      candidates: c.candidates,
    };
    // The Art Director decides the layout from the picture the feed ad will actually show.
    const lead = chooseStaticAdBackground({
      ...base,
      id: projectId,
      format: '4:5',
      ownerBackground: ownerBackground('4:5'),
    });
    const art = await this.artDirection.direct(
      ctx,
      projectId,
      lead.asset
        ? {
            composition: lead.candidate?.composition,
            authenticity: lead.selection.authenticity ?? 'SYNTHETIC_AI',
          }
        : null,
    );
    const copy = c.concept?.copy;
    const industry = industryFor({
      category: c.profile.category,
      description: c.profile.description,
    }).profile;
    const previousLayout = await this.artDirection.previousLayout(ctx, projectId, c.project.businessId);
    const alternatives = [...art.alternatives].sort((a, b) => b.score - a.score).map((a) => a.layoutFamily);
    for (const format of [...new Set(formats)]) {
      // A background the owner picked survives the rebuild (the builder drops it if the picture is gone).
      const built = buildStaticAd({
        ...base,
        id: `${projectId}:${format}`,
        format,
        ownerBackground: ownerBackground(format),
        copy: copy ? { headline: copy.headline, subheadline: copy.subheadline } : undefined,
        design: art.formats[format],
      });
      // The Critic checks the ad; free layout fixes are applied (at most two rounds), the rest waits for people.
      const shown = c.candidates.find((x) => x.asset.id === built.background.assetId);
      const { ad, history } = reviewStaticAd(built, {
        plan: art,
        previousLayout,
        pictureComposition: shown?.composition,
        offer: c.brief.offer,
        business: c.profile,
        industry,
        alternatives,
      });
      await this.saveVersion(ctx, projectId, ad);
      await this.critic.record(ctx, {
        businessId: c.project.businessId,
        videoProjectId: projectId,
        subject: { type: 'STATIC_AD', ref: format },
        history,
        industry,
      });
    }
    return this.list(ctx, projectId);
  }

  /** Applies an owner's edit to one version; the result is a new version of that format. */
  async edit(ctx: AuthContext, projectId: string, staticAdId: string, edit: StaticAdEdit) {
    const [row] = await this.db
      .select()
      .from(staticAds)
      .where(
        and(
          eq(staticAds.id, staticAdId),
          eq(staticAds.orgId, ctx.orgId),
          eq(staticAds.videoProjectId, projectId),
        ),
      );
    if (!row) throw notFound('Static ad');
    const c = await this.context(ctx, projectId);
    let next: StaticAd;
    try {
      next = applyStaticAdEdit(StaticAdSchema.parse(row.ad), edit, c.pictures, c.candidates);
    } catch (error) {
      if (error instanceof StaticAdEditError)
        throw new ApiError(HttpStatus.BAD_REQUEST, 'INVALID_EDIT', error.message);
      throw error;
    }
    await this.saveVersion(ctx, projectId, next);
    return this.list(ctx, projectId);
  }

  /**
   * Design directions (Art Director 2.0) for the latest ad: three composed alternatives, each reviewed by the
   * Critic. Deterministic and free, so it is recomputed on every request rather than stored.
   */
  private async directionState(ctx: AuthContext, projectId: string) {
    const c = await this.context(ctx, projectId);
    const rows = await this.rows(ctx, projectId);
    const base = rows.filter((r) => r.format === '4:5').at(-1) ?? rows.at(-1);
    if (!base) throw new ApiError(HttpStatus.CONFLICT, 'NO_STATIC_AD', 'Build the static ads first');
    if (!c.concept) throw new ApiError(HttpStatus.CONFLICT, 'NO_CONCEPT', 'The project has no concept');
    const ad = StaticAdSchema.parse(base.ad);
    const dctx: StaticDirectionContext = {
      business: c.profile,
      brief: c.brief,
      concept: c.concept,
      assets: c.candidates.map((x) => ({
        id: x.asset.id,
        kind: 'image' as const,
        description: x.content,
        tags: [],
        ...(x.asset.width ? { width: x.asset.width } : {}),
        ...(x.asset.height ? { height: x.asset.height } : {}),
        mimeType: x.asset.mimeType,
        source: x.asset.provenance.source,
        commercialUse: x.asset.provenance.commercialUse,
      })),
    };
    const input = directionInputFor(ad, dctx);
    // The brief's key message is approved copy: it may replace a subheadline that only repeats the price.
    const reviewed = reviewDirectionSet(input, directCreative(input), {
      approvedClaims: c.profile.approvedClaims,
      approvedSubheadline: c.brief.keyMessage,
    });
    const approvedWords = new Set(
      [
        ...Object.values(input.copy).flatMap((v) => (typeof v === 'string' ? [v] : v ? [v.price, v.label ?? ''] : [])),
        c.brief.keyMessage,
        c.profile.name,
      ].filter(Boolean),
    );
    return { c, rows, base, ad, input, reviewed, approvedWords };
  }

  async directions(ctx: AuthContext, projectId: string) {
    const { c, base, reviewed } = await this.directionState(ctx, projectId);
    return {
      baseStaticAdId: base.id,
      set: reviewed.set,
      copy: reviewed.copy,
      reviews: reviewed.reviews,
      assetUrls: Object.fromEntries(
        await Promise.all(
          c.pictures.map(async (p) => [p.id, await this.storage.getReadUrl(p.storageKey, { expiresInSec: 3600 })] as const),
        ),
      ),
    };
  }

  /** An owner's change request in Hebrew, applied to one direction (its current state comes from the client). */
  async changeDirection(
    ctx: AuthContext,
    projectId: string,
    key: CreativeDirection['key'],
    body: DirectionChangeRequest,
  ) {
    const { input, reviewed } = await this.directionState(ctx, projectId);
    if (body.direction && body.direction.key !== key)
      throw new ApiError(HttpStatus.BAD_REQUEST, 'INVALID_DIRECTION', 'Direction key mismatch');
    const copy = reviewed.copy[key];
    if (!copy) throw notFound('Direction');
    const set = {
      ...reviewed.set,
      directions: reviewed.set.directions.map((d) => (d.key === key && body.direction ? body.direction : d)),
    };
    const withCopy: DirectionInput = { ...input, copy };
    return applyCreativeChange(withCopy, set, key, body.text);
  }

  /**
   * The owner approves a direction: each of its specs becomes the composition of a new version of that format's
   * ad, rendered by the worker. Every word in the specs must be approved copy; the owner's decision is audited.
   */
  async approveDirection(
    ctx: AuthContext,
    projectId: string,
    key: CreativeDirection['key'],
    body: DirectionApprovalRequest,
  ) {
    const { rows, ad, approvedWords } = await this.directionState(ctx, projectId);
    const d = body.direction;
    if (d.key !== key) throw new ApiError(HttpStatus.BAD_REQUEST, 'INVALID_DIRECTION', 'Direction key mismatch');
    for (const spec of Object.values(d.specs))
      for (const l of spec.layers)
        if (l.kind === 'text' && !approvedWords.has(l.text))
          throw new ApiError(HttpStatus.BAD_REQUEST, 'UNAPPROVED_COPY', `"${l.text}" is not approved copy`);
    const saved: { format: StaticAdFormat; staticAdId: string; version: number }[] = [];
    for (const [format, spec] of Object.entries(d.specs) as [StaticAdFormat, (typeof d.specs)[string]][]) {
      const latest = rows.filter((r) => r.format === format).at(-1);
      const size = STATIC_AD_FORMATS[format];
      const current = latest
        ? StaticAdSchema.parse(latest.ad)
        : { ...ad, format, width: size.width, height: size.height, safeArea: size.safeArea };
      const sub = spec.layers.find((l) => l.kind === 'text' && l.role === 'SUBHEADLINE');
      const text = { ...current.text, ...(sub && sub.kind === 'text' ? { subheadline: sub.text } : {}) };
      const row = await this.saveVersion(
        ctx,
        projectId,
        withComposition({ ...current, id: `${projectId}:${format}`, text }, spec),
      );
      saved.push({ format, staticAdId: row.id, version: row.version });
    }
    await this.db.insert(auditLog).values({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      action: 'creative_direction.approved',
      subjectType: 'video_project',
      subjectId: projectId,
      metadata: { key, method: d.method, typeSystem: d.typeSystem, moves: d.moves, note: body.note ?? null, saved },
    });
    return {
      approved: { key, decidedAt: new Date().toISOString(), note: body.note ?? null },
      saved,
      ...(await this.list(ctx, projectId)),
    };
  }

  /** Same content as the latest good version ⇒ reuse it; otherwise a new version, queued for rendering. */
  private async saveVersion(ctx: AuthContext, projectId: string, ad: StaticAd) {
    const fp = fingerprint(ad);
    const mine = (await this.rows(ctx, projectId)).filter((r) => r.format === ad.format);
    const latest = mine.at(-1);
    if (latest && latest.fingerprint === fp && latest.status !== 'FAILED') return latest;
    if (mine.length >= MAX_STATIC_AD_VERSIONS)
      throw new ApiError(HttpStatus.CONFLICT, 'TOO_MANY_VERSIONS', 'Too many versions of this format');
    const row = await this.db.transaction(async (tx) => {
      const [{ value: last } = { value: 0 }] = await tx
        .select({ value: max(staticAds.version) })
        .from(staticAds)
        .where(and(eq(staticAds.videoProjectId, projectId), eq(staticAds.format, ad.format)));
      const [inserted] = await tx
        .insert(staticAds)
        .values({
          orgId: ctx.orgId,
          videoProjectId: projectId,
          format: ad.format,
          version: (last ?? 0) + 1,
          ad,
          fingerprint: fp,
          createdBy: ctx.userId,
        })
        .returning();
      await tx.insert(auditLog).values({
        orgId: ctx.orgId,
        actorUserId: ctx.userId,
        action: 'static_ad.version',
        subjectType: 'static_ad',
        subjectId: inserted!.id,
        metadata: { format: ad.format, version: inserted!.version },
      });
      return inserted!;
    });
    const payload: StaticAdJobPayload = { orgId: ctx.orgId, staticAdId: row.id };
    await this.queue.add(STATIC_AD_JOB_NAME, payload, {
      jobId: `static-${row.id}`,
      attempts: 2,
      backoff: { type: 'exponential', delay: 3_000 },
      removeOnComplete: 200,
      removeOnFail: 500,
    });
    return row;
  }
}
