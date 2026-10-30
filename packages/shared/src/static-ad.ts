import { z } from 'zod';
import { MediaAuthenticitySchema } from './authenticity';
import { BrandColorsSchema, LocaleSchema } from './common';
import { MediaAssetSchema, SafeAreaSchema, type SafeArea } from './video-project';

/** Static image ad formats: square and portrait feed posts, and full-screen Stories/Reels. */
export const StaticAdFormatSchema = z.enum(['1:1', '4:5', '9:16']);
export type StaticAdFormat = z.infer<typeof StaticAdFormatSchema>;

export const STATIC_AD_FORMATS: Record<
  StaticAdFormat,
  { width: number; height: number; safeArea: SafeArea; placement: string }
> = {
  '1:1': { width: 1080, height: 1080, safeArea: { topPx: 64, bottomPx: 64, sidePx: 64 }, placement: 'feed' },
  '4:5': { width: 1080, height: 1350, safeArea: { topPx: 64, bottomPx: 64, sidePx: 64 }, placement: 'feed' },
  // A 9:16 still runs mainly as a Story: Meta's Stories guidance keeps ~14% top and ~20% bottom free of text.
  // (The video ad keeps the stricter Reels area, whose interface covers the bottom third.)
  '9:16': {
    width: 1080,
    height: 1920,
    safeArea: { topPx: 270, bottomPx: 384, sidePx: 65 },
    placement: 'stories',
  },
};

/** Base type sizes (px) per format; `fitStaticAdType` scales them down when the text would not fit. */
export const STATIC_AD_TYPE: Record<
  StaticAdFormat,
  {
    headline: number;
    sub: number;
    price: number;
    label: number;
    cta: number;
    ctaSub: number;
    logo: number;
    gap: number;
    /** Height kept free between the top and bottom text blocks, so the picture shows. */
    photoBand: number;
  }
> = {
  '1:1': {
    headline: 76,
    sub: 38,
    price: 92,
    label: 44,
    cta: 50,
    ctaSub: 34,
    logo: 104,
    gap: 18,
    photoBand: 120,
  },
  '4:5': {
    headline: 86,
    sub: 42,
    price: 110,
    label: 52,
    cta: 56,
    ctaSub: 38,
    logo: 124,
    gap: 24,
    photoBand: 200,
  },
  '9:16': {
    headline: 92,
    sub: 46,
    price: 120,
    label: 56,
    cta: 60,
    ctaSub: 40,
    logo: 140,
    gap: 28,
    photoBand: 320,
  },
};

export const STATIC_AD_LINE_HEIGHT = {
  headline: 1.12,
  sub: 1.3,
  label: 1.1,
  price: 1.05,
  cta: 1.2,
  ctaSub: 1.25,
};

/**
 * Conservative height estimate of the text blocks and the single scale factor that makes them fit the safe area
 * with the photo band free. Deliberately pessimistic about glyph widths (it must hold for the brand font and for
 * fallback fonts alike), so text may end up slightly smaller than strictly necessary, never outside the area.
 */
export function fitStaticAdType(ad: Pick<StaticAd, 'format' | 'width' | 'height' | 'safeArea' | 'text'>): {
  scale: number;
  sizes: (typeof STATIC_AD_TYPE)[StaticAdFormat];
} {
  const base = STATIC_AD_TYPE[ad.format];
  const lh = STATIC_AD_LINE_HEIGHT;
  const width = ad.width - 2 * ad.safeArea.sidePx;
  const available = ad.height - ad.safeArea.topPx - ad.safeArea.bottomPx;
  const t = ad.text;
  // Average advance of bold Hebrew/Latin glyphs ≈ 0.6em; wrapping wastes up to ~15% of each line.
  const lines = (chars: number, size: number, boxWidth = width) =>
    Math.max(1, Math.ceil((chars * 0.6 * size) / (boxWidth * 0.85)));
  const height = (k: number) => {
    const s = (v: number) => v * k;
    const gap = s(base.gap);
    let top = lines(t.headline.length, s(base.headline)) * s(base.headline) * lh.headline;
    if (t.showLogo) top += s(base.logo) + gap;
    if (t.subheadline) top += gap + lines(t.subheadline.length, s(base.sub)) * s(base.sub) * lh.sub;
    const ctaBox = width - 2 * 2.4 * gap;
    let bottom = lines(t.cta.length, s(base.cta), ctaBox) * s(base.cta) * lh.cta + 2 * 0.8 * gap;
    if (t.ctaSubtext) bottom += gap + lines(t.ctaSubtext.length, s(base.ctaSub)) * s(base.ctaSub) * lh.ctaSub;
    if (t.price) {
      bottom += gap + s(base.price) * lh.price + 12 + gap + 1.2 * gap;
      if (t.price.label)
        bottom += 0.6 * gap + lines(t.price.label.length, s(base.label)) * s(base.label) * lh.label;
    }
    return top + bottom + base.photoBand;
  };
  let scale = 1;
  while (scale > 0.5 && height(scale) > available) scale = Math.round((scale - 0.02) * 100) / 100;
  const k = (v: number) => Math.round(v * scale);
  return {
    scale,
    sizes: {
      headline: k(base.headline),
      sub: k(base.sub),
      price: k(base.price),
      label: k(base.label),
      cta: k(base.cta),
      ctaSub: k(base.ctaSub),
      logo: k(base.logo),
      gap: k(base.gap),
      photoBand: base.photoBand,
    },
  };
}

/**
 * Layout families: tested design tools the Art Director chooses between (never one universal template). Each is
 * a set of decisions about where the picture goes, where the text sits, and what carries the price and the action.
 */
export const LayoutFamilySchema = z.enum([
  /** Large product picture, restrained editorial type aligned to the reading edge. */
  'EDITORIAL_PRODUCT',
  /** Calm brand field, the picture as a framed inset, light hierarchy, a text-link action. */
  'PREMIUM_MINIMAL',
  /** The price is the hero: a stamp, a bold headline and a full-width action bar. */
  'OFFER_RETAIL',
  /** Full-bleed photograph of a moment; the text sits low on a soft scrim. */
  'LIFESTYLE_PHOTO',
  /** Type is the image: a very large headline on a brand-color field; the picture (if any) supports it. */
  'BOLD_TYPOGRAPHIC',
  /** The product on a clean field, framed, with a price badge. */
  'PRODUCT_SHOWCASE',
  /** Picture on one side, message on the other; picture on top in tall formats. */
  'SPLIT',
  /** Neighbourhood promotion: business name and address are prominent, the picture shows the place or product. */
  'LOCAL_PROMO',
]);
export type LayoutFamily = z.infer<typeof LayoutFamilySchema>;

const Hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Renderer-facing design of one static ad (one format). Deterministic components draw it; no generated code. */
export const StaticAdDesignSchema = z.object({
  layoutFamily: LayoutFamilySchema,
  image: z.object({
    mode: z.enum(['FULL_BLEED', 'PANEL', 'INSET', 'NONE']),
    /** PANEL: the frame edge the picture sits on. START is the reading edge (right, in Hebrew). */
    edge: z.enum(['TOP', 'BOTTOM', 'START', 'END']).optional(),
    /** PANEL: share of the frame the picture takes. */
    share: z.number().min(0.3).max(0.75).optional(),
  }),
  /** Where the text sits. SPLIT keeps the message at the top and the action at the bottom. */
  textZone: z.enum(['TOP', 'BOTTOM', 'CENTER', 'SPLIT']),
  align: z.enum(['START', 'CENTER']),
  /** How text stays readable: a scrim on the picture, a solid panel behind the text, or a solid color field. */
  surface: z.enum(['SCRIM', 'PANEL', 'FIELD']),
  headlineScale: z.number().min(0.7).max(1.5),
  headlineWeight: z.union([z.literal(700), z.literal(800), z.literal(900)]),
  price: z.enum(['CARD', 'BADGE', 'STAMP', 'INLINE', 'HERO']),
  cta: z.enum(['PILL', 'BAR', 'TEXT']),
  logo: z.enum(['BADGE', 'WORDMARK', 'NONE']),
  palette: z.object({ field: Hex, text: Hex, muted: Hex, accent: Hex, accentText: Hex }),
});
export type StaticAdDesign = z.infer<typeof StaticAdDesignSchema>;

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StaticAdLayout {
  /** Where the picture is drawn (absent: no picture, or an inset sized inside the text column). */
  image?: LayoutRect;
  /** The text column; always inside the safe area. */
  text: LayoutRect;
  /** Height inside the text column kept for the picture (full-bleed bands, insets). */
  reserve: number;
  scale: number;
  sizes: {
    headline: number;
    sub: number;
    price: number;
    label: number;
    cta: number;
    ctaSub: number;
    logo: number;
    gap: number;
    /** Diameter of a price stamp. */
    stamp: number;
  };
}

/** Space between a picture panel and the text column. */
const PANEL_GUTTER = 48;

/**
 * Geometry and type sizes of a designed static ad: where the picture and the text column go, and the single
 * scale factor at which every text block fits the column (estimated pessimistically, like fitStaticAdType).
 */
export function staticAdLayout(
  ad: Pick<StaticAd, 'format' | 'width' | 'height' | 'safeArea' | 'text'> & { design: StaticAdDesign },
): StaticAdLayout {
  const { width: W, height: H, safeArea: sa, design: d } = ad;
  const safe: LayoutRect = {
    x: sa.sidePx,
    y: sa.topPx,
    width: W - 2 * sa.sidePx,
    height: H - sa.topPx - sa.bottomPx,
  };
  let image: LayoutRect | undefined;
  let text = safe;
  let reserve = 0;
  const share = d.image.share ?? 0.5;
  if (d.image.mode === 'FULL_BLEED') {
    image = { x: 0, y: 0, width: W, height: H };
    reserve =
      d.textZone === 'SPLIT'
        ? STATIC_AD_TYPE[ad.format].photoBand
        : d.textZone === 'CENTER'
          ? 0
          : Math.round(safe.height * 0.34);
  } else if (d.image.mode === 'INSET') {
    reserve = Math.round(safe.height * 0.3);
  } else if (d.image.mode === 'PANEL') {
    const edge = d.image.edge ?? 'TOP';
    if (edge === 'TOP' || edge === 'BOTTOM') {
      const ph = Math.round(H * share);
      image = { x: 0, y: edge === 'TOP' ? 0 : H - ph, width: W, height: ph };
      const top = edge === 'TOP' ? Math.max(sa.topPx, ph + PANEL_GUTTER) : sa.topPx;
      const bottom = edge === 'TOP' ? H - sa.bottomPx : Math.min(H - sa.bottomPx, H - ph - PANEL_GUTTER);
      text = { x: safe.x, y: top, width: safe.width, height: bottom - top };
    } else {
      // START is the reading edge: the right side of a Hebrew ad.
      const pw = Math.round(W * share);
      image = { x: edge === 'START' ? W - pw : 0, y: 0, width: pw, height: H };
      const left = edge === 'START' ? sa.sidePx : pw + PANEL_GUTTER;
      const right = edge === 'START' ? W - pw - PANEL_GUTTER : W - sa.sidePx;
      text = { x: left, y: safe.y, width: right - left, height: safe.height };
    }
  }

  const base = STATIC_AD_TYPE[ad.format];
  const lh = STATIC_AD_LINE_HEIGHT;
  const t = ad.text;
  const lines = (chars: number, size: number, boxWidth: number) =>
    Math.max(1, Math.ceil((chars * 0.6 * size) / (boxWidth * 0.85)));
  const sizesAt = (k: number) => {
    const s = (v: number) => Math.round(v * k);
    return {
      headline: s(base.headline * d.headlineScale),
      sub: s(base.sub),
      price: s(base.price * (d.price === 'HERO' ? 1.45 : d.price === 'INLINE' ? 0.5 : 1)),
      label: s(base.label * (d.price === 'INLINE' ? 0.8 : 1)),
      cta: s(base.cta),
      ctaSub: s(base.ctaSub),
      logo: s(base.logo),
      gap: s(base.gap),
      stamp: s(base.price * 2.5),
    };
  };
  const height = (k: number) => {
    const z = sizesAt(k);
    const w = text.width;
    const blocks: number[] = [];
    if (d.logo === 'BADGE') blocks.push(z.logo);
    if (d.logo === 'WORDMARK') blocks.push(z.logo * 0.4 * 1.15);
    blocks.push(lines(t.headline.length, z.headline, w) * z.headline * lh.headline);
    if (t.subheadline) blocks.push(lines(t.subheadline.length, z.sub, w) * z.sub * lh.sub);
    if (t.price) {
      const label = t.price.label ?? '';
      if (d.price === 'STAMP') blocks.push(z.stamp);
      else if (d.price === 'INLINE')
        blocks.push(lines(label.length + t.price.price.length + 3, z.label, w) * z.label * lh.label);
      else {
        let h = z.price * lh.price + 12;
        if (label) h += 0.6 * z.gap + lines(label.length, z.label, w) * z.label * lh.label;
        if (d.price === 'CARD') h += 2.2 * z.gap;
        blocks.push(h);
      }
    }
    const ctaBox = d.cta === 'PILL' ? w - 2 * 2.4 * z.gap : d.cta === 'BAR' ? w - 2 * 1.2 * z.gap : w;
    const ctaPad = d.cta === 'TEXT' ? 12 : d.cta === 'BAR' ? 2 * z.gap : 1.6 * z.gap;
    blocks.push(lines(t.cta.length, z.cta, ctaBox) * z.cta * lh.cta + ctaPad);
    if (t.ctaSubtext) blocks.push(lines(t.ctaSubtext.length, z.ctaSub, w) * z.ctaSub * lh.ctaSub);
    // SPLIT layouts separate the top and bottom groups by at least one more gap.
    const gaps = (blocks.length - 1 + (reserve ? 1 : 0) + (d.textZone === 'SPLIT' ? 1 : 0)) * z.gap;
    const panelPad = d.surface === 'PANEL' ? 2 * 1.4 * z.gap : 0;
    return blocks.reduce((a, b) => a + b, 0) + gaps + reserve + panelPad;
  };
  let scale = 1;
  while (scale > 0.45 && height(scale) > text.height) scale = Math.round((scale - 0.02) * 100) / 100;
  return { image, text, reserve, scale, sizes: sizesAt(scale) };
}

export const StaticAdFileTypeSchema = z.enum(['png', 'jpeg']);
export type StaticAdFileType = z.infer<typeof StaticAdFileTypeSchema>;

/** The text layers of a static ad. All text is live, RTL-rendered text; none is ever baked into an image. */
export const StaticAdTextSchema = z.object({
  headline: z.string().trim().min(1).max(70),
  subheadline: z.string().trim().min(1).max(110).optional(),
  price: z
    .object({
      price: z.string().trim().min(1).max(20),
      label: z.string().trim().min(1).max(40).optional(),
    })
    .optional(),
  cta: z.string().trim().min(1).max(30),
  ctaSubtext: z.string().trim().min(1).max(60).optional(),
  showLogo: z.boolean(),
});
export type StaticAdText = z.infer<typeof StaticAdTextSchema>;

/** One explainable factor in choosing an ad's background picture. Points are summed; the highest total wins. */
export const BackgroundReasonSchema = z.object({
  code: z.enum([
    /** Shows the products the ad offers (all or some of them). */
    'OFFER_SUBJECTS',
    /** Shows none of the products the ad offers. */
    'OFFER_SUBJECTS_MISSING',
    /** Its kind of picture (product, place, people) fits the campaign goal. */
    'OBJECTIVE_FIT',
    /** Planned with calm areas where the text goes. */
    'TEXT_ROOM',
    /** Many items: busy behind text. */
    'BUSY_PICTURE',
    /** How much of the picture survives the crop to this format. */
    'CROP_FIT',
    'LOW_RESOLUTION',
    /** Made with this campaign's shared look. */
    'CAMPAIGN_LOOK',
    /** The business's own photo. */
    'OWN_PHOTO',
    /** The business's own photo of the real product. */
    'REAL_PRODUCT',
    /** AI image guided by the business's own product photos. */
    'REFERENCE_GUIDED',
    /** A generated picture of a place: not the business's real venue. */
    'SYNTHETIC_PLACE',
    /** A drawing, not a photograph. */
    'ILLUSTRATION',
    /** Chosen by the owner; kept when the ad is rebuilt. */
    'OWNER_CHOICE',
  ]),
  points: z.number(),
  detail: z.string(),
  /** OFFER_SUBJECTS / OFFER_SUBJECTS_MISSING: which offered products are (not) shown. */
  subjects: z.array(z.string()).optional(),
});
export type BackgroundReason = z.infer<typeof BackgroundReasonSchema>;

/** Why the background is what it is. Absent on ads built before backgrounds were ranked. */
export const BackgroundSelectionSchema = z.object({
  /** OWNER: picked in the editor; a rebuild keeps it. AUTO: ranked by Kampora. */
  chosenBy: z.enum(['AUTO', 'OWNER']),
  authenticity: MediaAuthenticitySchema.optional(),
  score: z.number().optional(),
  reasons: z.array(BackgroundReasonSchema).max(16).default([]),
});
export type BackgroundSelection = z.infer<typeof BackgroundSelectionSchema>;

/**
 * Editable representation of one static ad. Layout comes from fixed per-format templates and the safe area, so an
 * edit can change words, the background photo and its focal point, but never push text out of the safe area.
 */
export const StaticAdSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    format: StaticAdFormatSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    locale: LocaleSchema,
    direction: z.literal('rtl'),
    safeArea: SafeAreaSchema,
    branding: z.object({
      businessName: z.string().min(1),
      colors: BrandColorsSchema,
      fontFamily: z.string().min(1),
      logoAssetId: z.string().optional(),
    }),
    background: z.object({
      /** No image: a brand-colored background. */
      assetId: z.string().optional(),
      focalPoint: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
      selection: BackgroundSelectionSchema.optional(),
    }),
    text: StaticAdTextSchema,
    /** The Art Director's layout. Absent: the original fixed template (ads built before art direction). */
    design: StaticAdDesignSchema.optional(),
    assets: z.array(MediaAssetSchema),
  })
  .superRefine((ad, ctx) => {
    const size = STATIC_AD_FORMATS[ad.format];
    if (ad.width !== size.width || ad.height !== size.height)
      ctx.addIssue({
        code: 'custom',
        path: ['width'],
        message: `${ad.format} must be ${size.width}x${size.height}`,
      });
    const byId = new Map(ad.assets.map((a) => [a.id, a]));
    for (const [path, id] of [
      [['background', 'assetId'], ad.background.assetId],
      [['branding', 'logoAssetId'], ad.branding.logoAssetId],
    ] as const) {
      if (!id) continue;
      const asset = byId.get(id);
      if (!asset || asset.kind !== 'image')
        ctx.addIssue({ code: 'custom', path: [...path], message: `Image asset "${id}" is not in assets` });
      else if (!asset.provenance.commercialUse)
        ctx.addIssue({
          code: 'custom',
          path: [...path],
          message: `Asset "${id}" has no commercial-use rights`,
        });
    }
  });
export type StaticAd = z.infer<typeof StaticAdSchema>;
export type StaticAdInput = z.input<typeof StaticAdSchema>;

/** An owner's edit. Empty strings remove an optional layer; `backgroundAssetId: null` switches to brand color. */
export const StaticAdEditSchema = z
  .object({
    headline: z.string().trim().min(1).max(70),
    subheadline: z.string().trim().max(110),
    price: z.string().trim().max(20),
    priceLabel: z.string().trim().max(40),
    cta: z.string().trim().min(1).max(30),
    ctaSubtext: z.string().trim().max(60),
    showLogo: z.boolean(),
    backgroundAssetId: z.string().min(1).max(64).nullable(),
    focalPoint: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  })
  .partial()
  .strict();
export type StaticAdEdit = z.infer<typeof StaticAdEditSchema>;

/** Props of the KamporaStaticAd still composition. */
export const StaticAdRenderInputSchema = z.object({
  ad: StaticAdSchema,
  assetUrls: z.record(z.string(), z.string()),
});
export type StaticAdRenderInput = z.infer<typeof StaticAdRenderInputSchema>;

/** Static ads render on the render queue under this job name. */
export const STATIC_AD_JOB_NAME = 'static-ad';
export const StaticAdJobPayloadSchema = z.object({
  orgId: z.string().uuid(),
  staticAdId: z.string().uuid(),
});
export type StaticAdJobPayload = z.infer<typeof StaticAdJobPayloadSchema>;
