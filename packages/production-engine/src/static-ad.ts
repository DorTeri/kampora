import {
  STATIC_AD_FORMATS,
  StaticAdSchema,
  stripNiqqud,
  type BusinessProfile,
  type CampaignBrief,
  type MediaAsset,
  type ProductionPlan,
  type SceneRole,
  type StaticAd,
  type StaticAdEdit,
  type StaticAdFormat,
  type Storyboard,
} from '@kampora/shared';
import { ctaCard, splitPrice } from './timeline';

export interface BuildStaticAdInput {
  id: string;
  format: StaticAdFormat;
  business: Pick<BusinessProfile, 'name' | 'address' | 'brandColors' | 'logoAssetId'>;
  brief: Pick<CampaignBrief, 'cta' | 'keyMessage' | 'offer'>;
  storyboard: Storyboard;
  plan: ProductionPlan;
  /** Every image the ad may use (brand assets + approved AI images), with storage keys and rights. */
  assets: readonly MediaAsset[];
  /** Approved AI image per storyboard scene key. */
  approvedImages?: Record<string, string>;
}

export class StaticAdEditError extends Error {}

/** Scenes whose picture best carries a single still, best first. */
const BACKGROUND_ROLES: SceneRole[] = ['PRODUCT', 'HOOK', 'DEMO', 'BENEFIT', 'SOLUTION', 'PROOF', 'CTA'];

const LIMITS = { headline: 70, subheadline: 110, cta: 30, ctaSubtext: 60, price: 20, priceLabel: 40 };

/** Cuts at a word boundary so text always fits its layer; QA flags anything long anyway. */
function fit(text: string | undefined, max: number): string | undefined {
  const t = text ? stripNiqqud(text).replace(/\s+/g, ' ').trim() : '';
  if (!t) return undefined;
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.5 ? cut.slice(0, space) : t.slice(0, max)).replace(/[\s,–-]+$/, '');
}

const firstSentence = (text: string) => text.split(/(?<=[.!?])\s/)[0] ?? text;
const same = (a?: string, b?: string) =>
  Boolean(a && b) && a!.replace(/[^\p{L}\p{N}]/gu, '') === b!.replace(/[^\p{L}\p{N}]/gu, '');

function usableImage(assets: readonly MediaAsset[], id: string | undefined): MediaAsset | undefined {
  const asset = id ? assets.find((a) => a.id === id) : undefined;
  return asset && asset.kind === 'image' && asset.provenance.commercialUse ? asset : undefined;
}

/** Background: an approved AI image first, then the photo the video plan uses for that scene. */
function pickBackground(input: BuildStaticAdInput): MediaAsset | undefined {
  const scenes = [...input.storyboard.scenes].sort(
    (a, b) => BACKGROUND_ROLES.indexOf(a.role) - BACKGROUND_ROLES.indexOf(b.role),
  );
  const ranked = scenes.filter((s) => BACKGROUND_ROLES.includes(s.role));
  for (const scene of ranked) {
    const approved = usableImage(input.assets, input.approvedImages?.[scene.key]);
    if (approved) return approved;
  }
  for (const scene of ranked) {
    const plan = input.plan.scenes.find((p) => p.sceneKey === scene.key);
    for (const id of plan?.assetIds ?? []) {
      const asset = usableImage(input.assets, id);
      if (asset) return asset;
    }
  }
  return undefined;
}

/** Only the assets the ad references travel with it (the renderer downloads exactly these). */
function referencedAssets(assets: readonly MediaAsset[], ...ids: (string | undefined)[]): MediaAsset[] {
  const wanted = new Set(ids.filter(Boolean));
  return assets.filter((a) => wanted.has(a.id));
}

/**
 * Deterministic static ad from the approved storyboard, brief and plan: the hook's words as the headline, the
 * offer as a price tag (or a sub-headline), the CTA with the address, the best approved picture behind it.
 * No AI is involved and nothing is generated: it only reuses what the owner already approved.
 */
export function buildStaticAd(input: BuildStaticAdInput): StaticAd {
  const size = STATIC_AD_FORMATS[input.format];
  const byRole = (role: SceneRole) => input.storyboard.scenes.find((s) => s.role === role);
  const hook = byRole('HOOK');
  const offer = byRole('OFFER');
  const cta = byRole('CTA');

  const headline =
    fit(hook?.onScreenText, LIMITS.headline) ??
    fit(hook?.voiceover && firstSentence(hook.voiceover), LIMITS.headline) ??
    fit(input.brief.keyMessage, LIMITS.headline)!;
  const priced = offer?.onScreenText ? splitPrice(stripNiqqud(offer.onScreenText)) : undefined;
  const price = priced
    ? { price: fit(priced.price, LIMITS.price)!, label: fit(priced.label, LIMITS.priceLabel) }
    : undefined;
  const subCandidate = price ? input.brief.keyMessage : (input.brief.offer ?? input.brief.keyMessage);
  const subheadline = fit(subCandidate, LIMITS.subheadline);
  const card = ctaCard(cta?.onScreenText, input.business.address, input.brief.cta);
  const background = pickBackground(input);
  const logo = usableImage(input.assets, input.business.logoAssetId);

  return StaticAdSchema.parse({
    schemaVersion: 1,
    id: input.id,
    format: input.format,
    width: size.width,
    height: size.height,
    locale: 'he-IL',
    direction: 'rtl',
    safeArea: size.safeArea,
    branding: {
      businessName: input.business.name,
      colors: input.business.brandColors,
      fontFamily: 'Heebo',
      logoAssetId: logo?.id,
    },
    background: { assetId: background?.id, focalPoint: { x: 0.5, y: 0.45 } },
    text: {
      headline,
      subheadline: same(subheadline, headline) ? undefined : subheadline,
      price,
      cta: fit(card.text, LIMITS.cta) ?? fit(input.brief.cta, LIMITS.cta)!,
      ctaSubtext: fit(card.subtext, LIMITS.ctaSubtext),
      showLogo: true,
    },
    assets: referencedAssets(input.assets, background?.id, logo?.id),
  });
}

/**
 * Applies an owner's edit and validates the result. Empty strings remove optional layers; a new background must
 * be one of `allowedAssets` (commercially usable images of this business or its approved AI images).
 */
export function applyStaticAdEdit(
  ad: StaticAd,
  edit: StaticAdEdit,
  allowedAssets: readonly MediaAsset[],
): StaticAd {
  const opt = (value: string | undefined, current: string | undefined) =>
    value === undefined ? current : value.trim() || undefined;
  const text = { ...ad.text };
  if (edit.headline !== undefined) text.headline = edit.headline;
  if (edit.cta !== undefined) text.cta = edit.cta;
  if (edit.showLogo !== undefined) text.showLogo = edit.showLogo;
  text.subheadline = opt(edit.subheadline, text.subheadline);
  text.ctaSubtext = opt(edit.ctaSubtext, text.ctaSubtext);
  const price = opt(edit.price, text.price?.price);
  const priceLabel = opt(edit.priceLabel, text.price?.label);
  text.price = price ? { price, label: priceLabel } : undefined;

  let backgroundId = ad.background.assetId;
  if (edit.backgroundAssetId !== undefined) {
    if (edit.backgroundAssetId !== null && !usableImage(allowedAssets, edit.backgroundAssetId))
      throw new StaticAdEditError('The background must be a commercially usable image of this business');
    backgroundId = edit.backgroundAssetId ?? undefined;
  }
  const pool = [...ad.assets, ...allowedAssets];
  const result = StaticAdSchema.safeParse({
    ...ad,
    background: { assetId: backgroundId, focalPoint: edit.focalPoint ?? ad.background.focalPoint },
    text,
    assets: referencedAssets(
      pool.filter((a, i) => pool.findIndex((b) => b.id === a.id) === i),
      backgroundId,
      ad.branding.logoAssetId,
    ),
  });
  if (!result.success) throw new StaticAdEditError(result.error.issues[0]?.message ?? 'Invalid edit');
  return result.data;
}

export interface StaticAdIssue {
  code:
    'LONG_HEADLINE' | 'LONG_SUBHEADLINE' | 'CROWDED' | 'NO_PHOTO' | 'LOW_RESOLUTION_PHOTO' | 'REPEATED_TEXT';
  severity: 'error' | 'warning';
  detail: string;
}

/**
 * Technical checks a machine can make on a static ad: length and density of the text for the format, picture
 * resolution, repetition. Whether the ad persuades is for people to judge.
 */
export function staticAdQa(ad: StaticAd): StaticAdIssue[] {
  const issues: StaticAdIssue[] = [];
  const t = ad.text;
  const square = ad.format === '1:1';
  const headlineWords = t.headline.split(/\s+/).length;
  if (headlineWords > (square ? 7 : 9))
    issues.push({
      code: 'LONG_HEADLINE',
      severity: 'warning',
      detail: `${headlineWords} words; short headlines read better in the feed`,
    });
  if (t.subheadline && t.subheadline.split(/\s+/).length > (square ? 10 : 14))
    issues.push({
      code: 'LONG_SUBHEADLINE',
      severity: 'warning',
      detail: 'sub-headline is long for the format',
    });
  const layers = [t.headline, t.subheadline, t.price, t.cta, t.ctaSubtext].filter(Boolean).length;
  if (layers > (square ? 4 : 5))
    issues.push({ code: 'CROWDED', severity: 'warning', detail: `${layers} text blocks on a square image` });
  const photo = ad.background.assetId ? ad.assets.find((a) => a.id === ad.background.assetId) : undefined;
  if (!photo)
    issues.push({ code: 'NO_PHOTO', severity: 'warning', detail: 'brand-color background, no picture' });
  else if (photo.width && photo.height) {
    // Cover-fit: the picture is scaled until it fills the frame; below ~75% of the needed size it looks soft.
    const scale = Math.max(ad.width / photo.width, ad.height / photo.height);
    if (scale > 1.34)
      issues.push({
        code: 'LOW_RESOLUTION_PHOTO',
        severity: 'warning',
        detail: `${photo.width}x${photo.height} is enlarged ${scale.toFixed(1)}x for ${ad.width}x${ad.height}`,
      });
  }
  if (same(t.subheadline, t.headline) || same(t.ctaSubtext, t.headline))
    issues.push({ code: 'REPEATED_TEXT', severity: 'warning', detail: 'the same text appears twice' });
  return issues;
}
