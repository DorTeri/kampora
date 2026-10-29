import {
  STATIC_AD_FORMATS,
  mediaAuthenticity,
  representsRealBusiness,
  type BackgroundReason,
  type CampaignBrief,
  type CompositionType,
  type MediaAsset,
  type MediaAuthenticity,
  type StaticAdFormat,
} from '@kampora/shared';
import { inferCompositionType, mentions, subjectsIn } from './composition';

/** A picture that may go behind a static ad: the business's own photos and the AI images the owner approved. */
export interface BackgroundCandidate {
  asset: MediaAsset;
  /**
   * What the picture shows: an upload's description and tags, or what an AI image was planned to show (its scene
   * and required subjects). Kampora does not look at the pixels, so this is metadata, not image recognition.
   */
  content: string;
  authenticity: MediaAuthenticity;
  composition?: CompositionType;
  /** AI images of one ad share its look; they were also planned with calm zones for overlays. */
  campaignImage?: boolean;
}

export interface RankedBackground {
  assetId: string;
  score: number;
  authenticity: MediaAuthenticity;
  reasons: BackgroundReason[];
}

export interface RankBackgroundsInput {
  format: StaticAdFormat;
  brief: Pick<CampaignBrief, 'goal' | 'offer' | 'productName'>;
  business: { products?: readonly { name: string }[] };
  candidates: readonly BackgroundCandidate[];
}

const PRODUCT_LED: readonly CompositionType[] = ['SINGLE_HERO', 'ASSORTMENT', 'DETAIL', 'DEMONSTRATION'];
const AUTHENTICITY_ORDER: readonly MediaAuthenticity[] = [
  'VERIFIED_PRODUCT_PHOTO',
  'VERIFIED_BUSINESS_PHOTO',
  'REFERENCE_GUIDED_AI',
  'SYNTHETIC_AI',
  'GENERIC_STOCK',
  'ILLUSTRATION',
];

/**
 * The products the ad sells: those of the business's products the offer or product name mention; otherwise the
 * product name split at "+", ",", "&", "and", or failing those "ו" ("קפה ומאפה" → קפה, מאפה).
 */
export function offerSubjects(
  brief: Pick<CampaignBrief, 'offer' | 'productName'>,
  products: readonly { name: string }[] = [],
): string[] {
  const text = [brief.offer, brief.productName].filter(Boolean).join(' ');
  const named = subjectsIn(text, products);
  if (named.length) return named;
  // Explicit separators first: "ו" also starts many words ("ורדים"), so it only splits when nothing else does.
  const name = brief.productName;
  const explicit = /\s*(?:[+,&/]|\band\b)\s*/i;
  const parts = explicit.test(name) ? name.split(explicit) : name.split(/\s+ו(?=\S{2,})/);
  return parts.map((s) => s.trim()).filter(Boolean);
}

function compositionOf(c: BackgroundCandidate): CompositionType {
  if (c.composition) return c.composition;
  if (c.authenticity === 'VERIFIED_PRODUCT_PHOTO') return 'SINGLE_HERO';
  if (c.authenticity === 'VERIFIED_BUSINESS_PHOTO') return 'ENVIRONMENT';
  return inferCompositionType(c.content);
}

/** Share of the picture left after cover-cropping it to the format (1 = nothing lost). */
function cropRetention(asset: MediaAsset, format: StaticAdFormat): number | undefined {
  if (!asset.width || !asset.height) return undefined;
  const size = STATIC_AD_FORMATS[format];
  const a = asset.width / asset.height;
  const f = size.width / size.height;
  return Math.min(a, f) / Math.max(a, f);
}

/**
 * Explainable ranking of background pictures for one format. Every point awarded or taken is a reason the owner
 * can read; nothing is hidden in a model. Factors, in order of weight: does it show what the ad sells, is it the
 * business's real product or place, does its kind fit the campaign goal, will it survive the crop and carry text.
 */
export function rankBackgrounds(input: RankBackgroundsInput): RankedBackground[] {
  const offered = offerSubjects(input.brief, input.business.products);
  const productGoal = input.brief.goal !== 'AWARENESS' && input.brief.goal !== 'LEADS';
  const size = STATIC_AD_FORMATS[input.format];

  const ranked = input.candidates
    .filter((c) => c.asset.kind === 'image' && c.asset.provenance.commercialUse)
    .map((c): RankedBackground => {
      const reasons: BackgroundReason[] = [];
      const add = (reason: BackgroundReason) => reasons.push(reason);
      const composition = compositionOf(c);

      // 1. What the ad sells.
      if (offered.length) {
        const shown = offered.filter((s) => mentions(c.content, s));
        const missing = offered.filter((s) => !shown.includes(s));
        if (shown.length)
          add({
            code: 'OFFER_SUBJECTS',
            points: Math.round((40 * shown.length) / offered.length),
            detail: `Shows ${shown.length} of ${offered.length} offered products: ${shown.join(', ')}`,
            subjects: shown,
          });
        if (missing.length)
          add({
            code: 'OFFER_SUBJECTS_MISSING',
            points: 0,
            detail: `Does not show: ${missing.join(', ')}`,
            subjects: missing,
          });
      }

      // 2. Authenticity: only the business's own photos show the real thing.
      if (c.authenticity === 'VERIFIED_PRODUCT_PHOTO')
        add({
          code: 'REAL_PRODUCT',
          points: productGoal ? 20 : 10,
          detail: "The business's own product photo",
        });
      else if (c.authenticity === 'VERIFIED_BUSINESS_PHOTO')
        add({ code: 'OWN_PHOTO', points: 10, detail: "The business's own photo" });
      else if (c.authenticity === 'REFERENCE_GUIDED_AI')
        add({
          code: 'REFERENCE_GUIDED',
          points: 6,
          detail: "AI image guided by the business's product photos",
        });
      else if (c.authenticity === 'ILLUSTRATION')
        add({ code: 'ILLUSTRATION', points: -15, detail: 'A drawing, not a photograph' });
      if (composition === 'ENVIRONMENT' && !representsRealBusiness(c.authenticity))
        add({
          code: 'SYNTHETIC_PLACE',
          points: -10,
          detail: "A generated place, not the business's real venue",
        });

      // 3. Campaign goal.
      const fits = productGoal
        ? PRODUCT_LED.includes(composition)
        : composition === 'ENVIRONMENT' || composition === 'LIFESTYLE';
      if (fits)
        add({
          code: 'OBJECTIVE_FIT',
          points: 10,
          detail: `A ${composition.toLowerCase()} picture suits the campaign goal (${input.brief.goal})`,
        });

      // 4. Crop, resolution and room for text.
      const retention = cropRetention(c.asset, input.format);
      if (retention !== undefined)
        add({
          code: 'CROP_FIT',
          points: Math.round(10 * retention),
          detail: `${Math.round(retention * 100)}% of the picture is kept at ${input.format}`,
        });
      if (c.asset.width && c.asset.height) {
        const scale = Math.max(size.width / c.asset.width, size.height / c.asset.height);
        if (scale > 1.34)
          add({ code: 'LOW_RESOLUTION', points: -8, detail: `Enlarged ${scale.toFixed(1)}x; may look soft` });
      }
      if (c.campaignImage) {
        add({ code: 'TEXT_ROOM', points: 6, detail: 'Planned with calm areas for the text' });
        add({ code: 'CAMPAIGN_LOOK', points: 4, detail: "Shares the campaign's look" });
      } else if (representsRealBusiness(c.authenticity)) {
        add({ code: 'CAMPAIGN_LOOK', points: 4, detail: "The business's own visual identity" });
      }
      if (composition === 'ASSORTMENT')
        add({ code: 'BUSY_PICTURE', points: -4, detail: 'Many items: busy behind text' });

      return {
        assetId: c.asset.id,
        score: reasons.reduce((s, r) => s + r.points, 0),
        authenticity: c.authenticity,
        reasons,
      };
    });

  return ranked.sort(
    (a, b) =>
      b.score - a.score ||
      AUTHENTICITY_ORDER.indexOf(a.authenticity) - AUTHENTICITY_ORDER.indexOf(b.authenticity) ||
      a.assetId.localeCompare(b.assetId),
  );
}

/** Authenticity from provenance alone (when nothing better is known an AI image counts as fully synthetic). */
export function assetAuthenticity(asset: MediaAsset, tags: readonly string[] = []): MediaAuthenticity {
  return mediaAuthenticity({ source: asset.provenance.source, mimeType: asset.mimeType, tags });
}
