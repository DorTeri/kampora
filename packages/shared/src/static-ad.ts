import { z } from 'zod';
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
    }),
    text: StaticAdTextSchema,
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
