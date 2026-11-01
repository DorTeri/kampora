import { industryFor, retrieveProfessionalReferences, type RetrievedReference } from '@kampora/agent-expertise';
import type { ComposeCopy } from '@kampora/production-engine';
import {
  STATIC_AD_FORMATS,
  StaticAdSchema,
  mediaAuthenticity,
  type AvailableAsset,
  type BusinessProfile,
  type CampaignBrief,
  type CreativeConcept,
  type CreativeDirectionSet,
  type MediaAuthenticity,
  type StaticAd,
  type StaticAdFormat,
} from '@kampora/shared';
import { directCreative, type DirectionInput } from './art-director-v2';

/**
 * The bridge between the copy pipeline and Art Director 2.0. The words of a static ad are decided first (by the
 * Copywriter and buildStaticAd, then approved or edited by the owner); this turns them into three composed design
 * directions without changing a word. The chosen direction's spec becomes `StaticAd.composition`.
 */

export interface StaticDirectionContext {
  business: BusinessProfile;
  brief: Pick<CampaignBrief, 'goal' | 'productName' | 'audience'>;
  concept: Pick<CreativeConcept, 'key' | 'title' | 'angle' | 'copy' | 'design'>;
  assets: readonly AvailableAsset[];
  /** Injected in tests and by the Studio when the owner pins references; retrieved otherwise. */
  references?: readonly RetrievedReference[];
  formats?: readonly StaticAdFormat[];
}

/** The approved words of an ad in the shape the layout engine composes. Nothing is rewritten. */
export function copyFromStaticAd(ad: StaticAd, ctx: Pick<StaticDirectionContext, 'business' | 'concept'>): ComposeCopy {
  const eyebrow = ctx.concept.design?.eyebrow ?? (ctx.business.city ? `${ctx.business.name} · ${ctx.business.city}` : undefined);
  return {
    ...(eyebrow ? { eyebrow } : {}),
    headline: ad.text.headline,
    ...(ad.text.subheadline ? { subheadline: ad.text.subheadline } : {}),
    ...(ad.text.price ? { price: { price: ad.text.price.price, ...(ad.text.price.label ? { label: ad.text.price.label } : {}) } } : {}),
    cta: ad.text.cta,
    ...(ad.text.ctaSubtext ? { ctaSub: ad.text.ctaSubtext } : {}),
    brandName: ad.branding.businessName,
  };
}

function pictureAuthenticity(ad: StaticAd, assets: readonly AvailableAsset[]): MediaAuthenticity {
  if (ad.background.selection?.authenticity) return ad.background.selection.authenticity;
  const asset = assets.find((a) => a.id === ad.background.assetId);
  // Unknown provenance is treated as a stand-in: it is never framed as "this is the product".
  return asset ? mediaAuthenticity(asset) : 'SYNTHETIC_AI';
}

export function referencesFor(ctx: Pick<StaticDirectionContext, 'business' | 'brief' | 'concept'>): RetrievedReference[] {
  const { profile } = industryFor(ctx.business);
  return retrieveProfessionalReferences({
    industryId: profile.id,
    goal: ctx.brief.goal,
    tone: ctx.business.tone,
    productType: `${ctx.brief.productName} ${ctx.business.category}`,
    audience: ctx.brief.audience,
    ...(ctx.concept.design ? { moves: ctx.concept.design.designMoves } : {}),
    format: 'STATIC',
  });
}

export function directionInputFor(ad: StaticAd, ctx: StaticDirectionContext): DirectionInput {
  const { profile } = industryFor(ctx.business);
  const picture = ad.background.assetId
    ? {
        assetId: ad.background.assetId,
        focal: ad.background.focalPoint,
        authenticity: pictureAuthenticity(ad, ctx.assets),
      }
    : undefined;
  return {
    conceptKey: ctx.concept.key,
    goal: ctx.brief.goal,
    tone: ctx.business.tone,
    industryId: profile.id,
    brand: { name: ctx.business.name, colors: ctx.business.brandColors },
    concept: {
      title: ctx.concept.title,
      angle: ctx.concept.angle,
      ...(ctx.concept.copy ? { hookTechnique: ctx.concept.copy.hookTechnique } : {}),
      ...(ctx.concept.design ? { visualIdea: ctx.concept.design.visualIdea, visualMoves: ctx.concept.design.designMoves } : {}),
    },
    copy: copyFromStaticAd(ad, ctx),
    ...(picture ? { picture } : {}),
    ...(ad.branding.logoAssetId ? { logoAssetId: ad.branding.logoAssetId } : {}),
    references: ctx.references ?? referencesFor(ctx),
    formats: ctx.formats ?? ['4:5', '9:16'],
  };
}

/** One static ad per direction and format, each carrying its composed spec. */
export function directStaticAd(ad: StaticAd, ctx: StaticDirectionContext): { set: CreativeDirectionSet; ads: Record<string, Partial<Record<StaticAdFormat, StaticAd>>> } {
  const set = directCreative(directionInputFor(ad, ctx));
  const ads: Record<string, Partial<Record<StaticAdFormat, StaticAd>>> = {};
  for (const d of set.directions) {
    ads[d.key] = {};
    for (const [format, spec] of Object.entries(d.specs) as [StaticAdFormat, (typeof d.specs)[string]][]) {
      const size = STATIC_AD_FORMATS[format];
      ads[d.key]![format] = withComposition({ ...ad, id: `${ad.id}-${d.key}-${format.replace(':', 'x')}`, format, width: size.width, height: size.height, safeArea: size.safeArea }, spec);
    }
  }
  return { set, ads };
}

export function withComposition(ad: StaticAd, spec: NonNullable<StaticAd['composition']>): StaticAd {
  return StaticAdSchema.parse({ ...ad, composition: spec });
}
