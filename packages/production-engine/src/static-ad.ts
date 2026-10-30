import {
  STATIC_AD_FORMATS,
  StaticAdSchema,
  designFor,
  stripNiqqud,
  type BackgroundSelection,
  type BusinessProfile,
  type CampaignBrief,
  type MediaAsset,
  type MediaAuthenticity,
  type ProductionPlan,
  type SceneRole,
  type StaticAd,
  type StaticAdDesign,
  type StaticAdEdit,
  type StaticAdFormat,
  type Storyboard,
} from '@kampora/shared';
import { sceneComposition } from './composition';
import { assetAuthenticity, rankBackgrounds, type BackgroundCandidate } from './static-ad-background';
import { ctaCard, splitPrice } from './timeline';

export interface BuildStaticAdInput {
  id: string;
  format: StaticAdFormat;
  business: Pick<BusinessProfile, 'name' | 'address' | 'brandColors' | 'logoAssetId'> & {
    products?: readonly { name: string }[];
  };
  brief: Pick<CampaignBrief, 'cta' | 'keyMessage' | 'offer' | 'goal' | 'productName'>;
  storyboard: Storyboard;
  plan: ProductionPlan;
  /** Every image the ad may use (brand assets + approved AI images), with storage keys and rights. */
  assets: readonly MediaAsset[];
  /** Approved AI image per storyboard scene key. */
  approvedImages?: Record<string, string>;
  /**
   * Pictures to rank for the background, with what each shows and how authentic it is. Defaults to the approved
   * AI images and the photos the video plan uses, described by their scenes.
   */
  candidates?: readonly BackgroundCandidate[];
  /** The owner picked the background (assetId absent: brand color). Kept as long as the picture is usable. */
  ownerBackground?: { assetId?: string };
  /** The Copywriter's written headline (and sub-headline) for ads; the hook's words otherwise. */
  copy?: { headline: string; subheadline?: string };
  /** The Art Director's design for this format. Absent: the original fixed template. */
  design?: StaticAdDesign;
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

/** The approved AI images and the photos the video plan uses, described by the scene each one is for. */
function defaultCandidates(input: BuildStaticAdInput): BackgroundCandidate[] {
  const scenes = input.storyboard.scenes.filter((s) => BACKGROUND_ROLES.includes(s.role));
  const out = new Map<string, BackgroundCandidate>();
  const describe = (scene: (typeof scenes)[number]) => {
    const composition = sceneComposition(scene, input.business.products);
    return {
      content: [scene.visual, ...composition.subjects.map((s) => s.name)].join(' · '),
      composition: composition.type,
    };
  };
  for (const scene of scenes) {
    const asset = usableImage(input.assets, input.approvedImages?.[scene.key]);
    if (asset && !out.has(asset.id))
      out.set(asset.id, { asset, ...describe(scene), authenticity: 'SYNTHETIC_AI', campaignImage: true });
  }
  for (const scene of scenes) {
    for (const id of input.plan.scenes.find((p) => p.sceneKey === scene.key)?.assetIds ?? []) {
      const asset = usableImage(input.assets, id);
      if (asset && !out.has(asset.id))
        out.set(asset.id, { asset, ...describe(scene), authenticity: assetAuthenticity(asset) });
    }
  }
  return [...out.values()];
}

/**
 * Background: the owner's choice when there is one (and the picture is still usable), otherwise the best-ranked
 * candidate, with the reasons it won. Brand color when there is no usable picture.
 */
function chooseBackground(
  input: BuildStaticAdInput,
  pool: readonly MediaAsset[],
  candidates: readonly BackgroundCandidate[],
): { asset?: MediaAsset; selection: BackgroundSelection } {
  const owner = input.ownerBackground;
  if (owner) {
    const asset = usableImage(pool, owner.assetId);
    if (asset || owner.assetId === undefined) return { asset, selection: ownerSelection(asset, candidates) };
  }
  const best = rankBackgrounds({
    format: input.format,
    brief: input.brief,
    business: input.business,
    candidates,
  })[0];
  const asset = usableImage(pool, best?.assetId);
  return {
    asset,
    selection:
      best && asset
        ? { chosenBy: 'AUTO', authenticity: best.authenticity, score: best.score, reasons: best.reasons }
        : { chosenBy: 'AUTO', reasons: [] },
  };
}

function ownerSelection(
  asset: MediaAsset | undefined,
  candidates: readonly { asset: MediaAsset; authenticity: MediaAuthenticity }[],
): BackgroundSelection {
  return {
    chosenBy: 'OWNER',
    authenticity: asset
      ? (candidates.find((c) => c.asset.id === asset.id)?.authenticity ?? assetAuthenticity(asset))
      : undefined,
    reasons: [
      { code: 'OWNER_CHOICE', points: 0, detail: 'Chosen by the owner; kept when the ad is rebuilt' },
    ],
  };
}

const unique = (assets: readonly MediaAsset[]) =>
  assets.filter((a, i) => assets.findIndex((b) => b.id === a.id) === i);

/** Only the assets the ad references travel with it (the renderer downloads exactly these). */
function referencedAssets(assets: readonly MediaAsset[], ...ids: (string | undefined)[]): MediaAsset[] {
  const wanted = new Set(ids.filter(Boolean));
  return assets.filter((a) => wanted.has(a.id));
}

/**
 * The background the ad will get (the owner's choice, or the best-ranked picture) without building the ad: the
 * Art Director decides the layout from it.
 */
export function chooseStaticAdBackground(input: BuildStaticAdInput) {
  const candidates = input.candidates ?? defaultCandidates(input);
  const pool = unique([...input.assets, ...candidates.map((c) => c.asset)]);
  const chosen = chooseBackground(input, pool, candidates);
  return { ...chosen, candidate: candidates.find((c) => c.asset.id === chosen.asset?.id) };
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
    fit(input.copy?.headline, LIMITS.headline) ??
    fit(hook?.onScreenText, LIMITS.headline) ??
    fit(hook?.voiceover && firstSentence(hook.voiceover), LIMITS.headline) ??
    fit(input.brief.keyMessage, LIMITS.headline)!;
  const priced = offer?.onScreenText ? splitPrice(stripNiqqud(offer.onScreenText)) : undefined;
  const price = priced
    ? { price: fit(priced.price, LIMITS.price)!, label: fit(priced.label, LIMITS.priceLabel) }
    : undefined;
  const subCandidate = price ? input.brief.keyMessage : (input.brief.offer ?? input.brief.keyMessage);
  const subheadline = fit(input.copy?.subheadline ?? subCandidate, LIMITS.subheadline);
  const card = ctaCard(cta?.onScreenText, input.business.address, input.brief.cta);
  const candidates = input.candidates ?? defaultCandidates(input);
  const pool = unique([...input.assets, ...candidates.map((c) => c.asset)]);
  const { asset: background, selection } = chooseBackground(input, pool, candidates);
  const logo = usableImage(input.assets, input.business.logoAssetId);
  // A design planned around a picture falls back to the family's no-picture version when this format has none.
  const design =
    input.design && !background && input.design.image.mode !== 'NONE'
      ? {
          ...designFor(input.design.layoutFamily, input.format, input.business.brandColors, false),
          chosenBy: input.design.chosenBy,
        }
      : input.design;

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
    background: { assetId: background?.id, focalPoint: { x: 0.5, y: 0.45 }, selection },
    text: {
      headline,
      subheadline: same(subheadline, headline) ? undefined : subheadline,
      price,
      cta: fit(card.text, LIMITS.cta) ?? fit(input.brief.cta, LIMITS.cta)!,
      ctaSubtext: fit(card.subtext, LIMITS.ctaSubtext),
      showLogo: true,
    },
    ...(design ? { design } : {}),
    assets: referencedAssets(pool, background?.id, logo?.id),
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
  /** What is known about the allowed pictures (authenticity of AI images); provenance is used otherwise. */
  candidates: readonly BackgroundCandidate[] = [],
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
  let selection = ad.background.selection;
  if (edit.backgroundAssetId !== undefined) {
    const picked =
      edit.backgroundAssetId === null ? undefined : usableImage(allowedAssets, edit.backgroundAssetId);
    if (edit.backgroundAssetId !== null && !picked)
      throw new StaticAdEditError('The background must be a commercially usable image of this business');
    backgroundId = picked?.id;
    selection = ownerSelection(picked, candidates);
  }
  const pool = [...ad.assets, ...allowedAssets];
  // A layout switch (or a picture change) re-derives the family's design for this format; the owner's family stays.
  let design = ad.design;
  const family = edit.layoutFamily ?? ad.design?.layoutFamily;
  if (family && (edit.layoutFamily !== undefined || edit.backgroundAssetId !== undefined)) {
    design = {
      ...designFor(family, ad.format, ad.branding.colors, Boolean(backgroundId)),
      chosenBy: edit.layoutFamily !== undefined ? 'OWNER' : ad.design?.chosenBy,
    };
  }
  const result = StaticAdSchema.safeParse({
    ...ad,
    ...(design ? { design } : {}),
    background: {
      assetId: backgroundId,
      focalPoint: edit.focalPoint ?? ad.background.focalPoint,
      ...(selection ? { selection } : {}),
    },
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
    | 'LONG_HEADLINE'
    | 'LONG_SUBHEADLINE'
    | 'CROWDED'
    | 'NO_PHOTO'
    | 'LOW_RESOLUTION_PHOTO'
    | 'REPEATED_TEXT'
    | 'SYNTHETIC_PICTURE'
    | 'REFERENCE_GUIDED_PICTURE'
    | 'ILLUSTRATED_PICTURE';
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
  if (photo) {
    // An AI picture is never presented as the real business: the owner is told, and can swap in a real photo.
    const authenticity = ad.background.selection?.authenticity ?? assetAuthenticity(photo);
    if (authenticity === 'SYNTHETIC_AI')
      issues.push({
        code: 'SYNTHETIC_PICTURE',
        severity: 'warning',
        detail: 'AI-generated picture: a generic stand-in, not your real product or place',
      });
    else if (authenticity === 'REFERENCE_GUIDED_AI')
      issues.push({
        code: 'REFERENCE_GUIDED_PICTURE',
        severity: 'warning',
        detail: 'AI-generated from your product photos: close to the real product, but not a photo of it',
      });
    else if (authenticity === 'ILLUSTRATION')
      issues.push({
        code: 'ILLUSTRATED_PICTURE',
        severity: 'warning',
        detail: 'a drawing, not a photograph',
      });
  }
  if (same(t.subheadline, t.headline) || same(t.ctaSubtext, t.headline))
    issues.push({ code: 'REPEATED_TEXT', severity: 'warning', detail: 'the same text appears twice' });
  return issues;
}
