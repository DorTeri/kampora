import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ne } from 'drizzle-orm';
import { industryFor } from '@kampora/agent-expertise';
import { directArt, type ArtDirectionInput } from '@kampora/creative-engine';
import {
  campaignBriefs,
  creativeConcepts,
  staticAds,
  storyboards,
  videoProjects,
  type Database,
} from '@kampora/database';
import { sceneComposition, splitPrice } from '@kampora/production-engine';
import {
  StaticAdSchema,
  mediaAuthenticity,
  stripNiqqud,
  type ArtDirectionPlan,
  type CompositionType,
  type LayoutFamily,
  type MediaAuthenticity,
} from '@kampora/shared';
import type { AuthContext } from '../common/auth';
import { notFound } from '../common/errors';
import { DATABASE } from '../infra/tokens';
import { BusinessService } from './business.service';
import { approvedSceneImages } from './scene-image-assets';

export interface ArtDirectionPicture {
  composition?: CompositionType;
  authenticity: MediaAuthenticity;
}

/**
 * The Art Director for one video project: the deterministic plan (creative-engine `directArt`) built from the
 * campaign, the chosen concept's copy, the brand and the best picture, kept on the project so the scene images,
 * the video and the static ads follow the same direction. No model call, no cost.
 */
@Injectable()
export class ArtDirectionService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly businesses: BusinessService,
  ) {}

  private async inputFor(
    ctx: AuthContext,
    projectId: string,
    picture: ArtDirectionPicture | null | undefined,
  ): Promise<ArtDirectionInput> {
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
    const [concept] = storyboard?.conceptId
      ? await this.db.select().from(creativeConcepts).where(eq(creativeConcepts.id, storyboard.conceptId))
      : [];
    const profile = await this.businesses.loadProfile(ctx, project.businessId);
    const scenes = storyboard!.storyboard.scenes;
    const offer = scenes.find((s) => s.role === 'OFFER');
    const hasPrice = Boolean(offer?.onScreenText && splitPrice(stripNiqqud(offer.onScreenText)));
    const industryId =
      brief!.professionalBrief?.industry.id ??
      industryFor({ category: profile.category, description: profile.description }).profile.id;

    // The variety rule: the family this business's last ad (another project) used.
    const [previous] = await this.db
      .select({ ad: staticAds.ad })
      .from(staticAds)
      .innerJoin(videoProjects, eq(videoProjects.id, staticAds.videoProjectId))
      .where(
        and(
          eq(staticAds.orgId, ctx.orgId),
          eq(videoProjects.businessId, project.businessId),
          ne(staticAds.videoProjectId, projectId),
        ),
      )
      .orderBy(desc(staticAds.createdAt))
      .limit(1);
    // The owner's layout choice on this project survives a rebuild.
    const [own] = await this.db
      .select({ ad: staticAds.ad })
      .from(staticAds)
      .where(and(eq(staticAds.orgId, ctx.orgId), eq(staticAds.videoProjectId, projectId)))
      .orderBy(desc(staticAds.createdAt))
      .limit(1);
    const design = (row?: { ad: unknown }) =>
      row ? StaticAdSchema.safeParse(row.ad).data?.design : undefined;
    const owned = design(own);

    return {
      goal: brief!.brief.goal,
      tone: profile.tone,
      industryId,
      hasPrice,
      hasOffer: Boolean(brief!.brief.offer),
      concept: concept
        ? {
            angle: concept.concept.angle,
            hookTechnique: concept.concept.copy?.hookTechnique,
            headline: concept.concept.copy?.headline,
          }
        : undefined,
      brandColors: profile.brandColors,
      picture: picture === undefined ? await this.expectedPicture(ctx, projectId) : (picture ?? undefined),
      previousLayout: design(previous)?.layoutFamily as LayoutFamily | undefined,
      layoutOverride: owned?.chosenBy === 'OWNER' ? owned.layoutFamily : undefined,
    };
  }

  /**
   * Before the static ads exist: the picture the ad will most likely use. An approved scene image, else the
   * business's own photo, else a generated stand-in for the product scene.
   */
  private async expectedPicture(ctx: AuthContext, projectId: string): Promise<ArtDirectionPicture> {
    const approved = await approvedSceneImages(this.db, ctx.orgId, projectId);
    const first = approved.find((i) => i.composition) ?? approved[0];
    if (first) return { composition: first.composition, authenticity: first.authenticity };
    const [project] = await this.db.select().from(videoProjects).where(eq(videoProjects.id, projectId));
    const [storyboard] = await this.db
      .select()
      .from(storyboards)
      .where(eq(storyboards.id, project!.storyboardId));
    const scene =
      storyboard!.storyboard.scenes.find((s) => s.role === 'PRODUCT') ??
      storyboard!.storyboard.scenes.find((s) => s.role === 'HOOK');
    const profile = await this.businesses.loadProfile(ctx, project!.businessId);
    const composition = scene ? sceneComposition(scene, profile.products).type : undefined;
    const photo = (await this.businesses.assets(ctx, project!.businessId)).find(
      (a) => a.kind === 'image' && a.provenance.source === 'CUSTOMER_UPLOAD',
    );
    return {
      composition,
      authenticity: photo
        ? mediaAuthenticity({
            source: photo.provenance.source,
            mimeType: photo.mimeType,
            tags: photo.tags,
            description: photo.description,
          })
        : 'SYNTHETIC_AI',
    };
  }

  /** The stored plan, or a new one from what is known now (kept for the scene images and the video). */
  async current(ctx: AuthContext, projectId: string): Promise<ArtDirectionPlan> {
    const [project] = await this.db
      .select({ artDirection: videoProjects.artDirection })
      .from(videoProjects)
      .where(and(eq(videoProjects.id, projectId), eq(videoProjects.orgId, ctx.orgId)));
    if (!project) throw notFound('Project');
    return project.artDirection ?? this.direct(ctx, projectId);
  }

  /**
   * Re-directs with the picture actually chosen (null: none usable) and stores the result. The motion choices
   * of an existing plan are kept, so a video already approved does not change because a still was rebuilt.
   */
  async direct(
    ctx: AuthContext,
    projectId: string,
    picture?: ArtDirectionPicture | null,
  ): Promise<ArtDirectionPlan> {
    const plan = directArt(await this.inputFor(ctx, projectId, picture));
    const [stored] = await this.db
      .select({ artDirection: videoProjects.artDirection })
      .from(videoProjects)
      .where(eq(videoProjects.id, projectId));
    const merged = stored?.artDirection ? { ...plan, motion: stored.artDirection.motion } : plan;
    await this.db
      .update(videoProjects)
      .set({ artDirection: merged })
      .where(and(eq(videoProjects.id, projectId), eq(videoProjects.orgId, ctx.orgId)));
    return merged;
  }
}
