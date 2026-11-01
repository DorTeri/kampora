import { z } from 'zod';
import { HexColorSchema } from './common';
import { FONTS, FontFamilySchema, TypeSystemIdSchema } from './typography';
import { SafeAreaSchema } from './video-project';

/**
 * Design moves: the professional vocabulary the reference library is analysed in and the Art Director composes
 * with. A move is a deliberate decision ("oversized headline", "generous negative space"), not a template.
 */
export const DesignMoveSchema = z.enum([
  'FULL_BLEED_IMAGE',
  'SPLIT_PANEL',
  'ASYMMETRIC_GRID',
  'CENTERED_HERO',
  'IMAGE_INSET_FRAME',
  'TYPE_ONLY',
  'COLLAGE_GRID',
  'LAYERED_TYPE_OVER_IMAGE',
  'CUTOUT_PRODUCT_ON_COLOR',
  'OVERLAPPING_ELEMENTS',
  'OVERSIZED_HEADLINE',
  'SERIF_EDITORIAL',
  'CONDENSED_DISPLAY',
  'BOLD_GEOMETRIC_SANS',
  'HANDWRITTEN_ACCENT',
  'MINIMAL_COPY',
  'TYPE_AS_IMAGE',
  'STACKED_HEADLINE',
  'BRAND_COLOR_FLOOD',
  'MONOCHROME_PALETTE',
  'HIGH_CONTRAST_DUOTONE',
  'MUTED_NATURAL_PALETTE',
  'VIBRANT_COMPLEMENTARY',
  'DARK_MOODY',
  'GENEROUS_NEGATIVE_SPACE',
  'SINGLE_FOCAL_POINT',
  'Z_READING_PATH',
  'PRODUCT_AS_HERO',
  'PEOPLE_AS_HERO',
  'DETAIL_MACRO_CROP',
  'PRICE_AS_GRAPHIC',
  'PRICE_UNDERSTATED',
  'BADGE_STAMP',
  'CTA_AS_TEXT_LINE',
  'CTA_BUTTON',
  'LOGO_SMALL_CORNER',
  'LOGO_AS_SIGNOFF',
  'GEOMETRIC_SHAPES',
  'ILLUSTRATIVE_ELEMENTS',
  'TEXTURE_GRAIN',
  'FRAME_BORDER',
  'RULE_LINES',
]);
export type DesignMove = z.infer<typeof DesignMoveSchema>;

/**
 * Composition methods: ways of building a page from a grid, regions and the moves. Each is parameterised by the
 * copy length, the picture, the format and the chosen moves, so two ads with the same method still differ.
 */
export const CompositionMethodSchema = z.enum([
  /** The picture carries the ad; text sits in its calm area. */
  'IMAGE_FIRST',
  /** A large picture panel and restrained, serif-led type aligned to the reading edge. */
  'EDITORIAL',
  /** Type is the image: an oversized headline on a colour field; a picture, if any, supports it. */
  'BOLD_TYPE',
  /** Off-centre grid: the picture bleeds off one side, the text column overlaps its edge. */
  'ASYMMETRIC',
  /** The product, masked or framed, on a calm field with the price close to it. */
  'PRODUCT_LED',
  /** Two clear panels: picture and message. */
  'SPLIT',
  /** Large type layered over the photograph with controlled contrast. */
  'LAYERED',
  /** The price is set as a typographic graphic, not a sticker. */
  'PROMO_PRICE',
  /** A real moment, full bleed, with a quiet message low on the frame. */
  'LIFESTYLE',
  /** Neighbourhood business: name and place lead, framed picture, direct action. */
  'LOCAL_MODERN',
]);
export type CompositionMethod = z.infer<typeof CompositionMethodSchema>;

export const TextRoleSchema = z.enum([
  'EYEBROW',
  'HEADLINE',
  'SUBHEADLINE',
  'PRICE',
  'PRICE_LABEL',
  'CTA',
  'CTA_SUB',
  'BRAND',
  'ADDRESS',
]);
export type TextRole = z.infer<typeof TextRoleSchema>;

export const RectSchema = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() });
export type Rect = z.infer<typeof RectSchema>;

const ImageLayerSchema = z.object({
  kind: z.literal('image'),
  id: z.string().min(1),
  assetId: z.string().min(1),
  rect: RectSchema,
  focal: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  zoom: z.number().min(1).max(2.5),
  mask: z.enum(['RECT', 'ROUNDED', 'ARCH', 'CIRCLE', 'SLANT_START', 'SLANT_END']),
  radius: z.number().min(0).max(600),
  treatment: z.enum(['NATURAL', 'WARM', 'COOL', 'MONO', 'DUOTONE', 'DARKEN']),
  duotone: z.tuple([HexColorSchema, HexColorSchema]).optional(),
  overlay: z
    .object({
      color: HexColorSchema,
      /** Opacity where the overlay is strongest / weakest. */
      from: z.number().min(0).max(0.9),
      to: z.number().min(0).max(0.9),
      /** The edge where it is strongest. */
      direction: z.enum(['TOP', 'BOTTOM', 'START', 'END', 'EVEN']),
    })
    .optional(),
});

const ShapeLayerSchema = z.object({
  kind: z.literal('shape'),
  id: z.string().min(1),
  shape: z.enum(['RECT', 'CIRCLE', 'LINE', 'ARCH', 'RING']),
  rect: RectSchema,
  fill: HexColorSchema.optional(),
  stroke: z.object({ color: HexColorSchema, width: z.number().min(1).max(24) }).optional(),
  radius: z.number().min(0).max(600),
  opacity: z.number().min(0.05).max(1),
  rotation: z.number().min(-30).max(30),
});

const FontSpecSchema = z.object({
  family: FontFamilySchema,
  weight: z.number().int().min(100).max(900),
  size: z.number().min(14).max(420),
  lineHeight: z.number().min(0.85).max(1.8),
  letterSpacing: z.number().min(-0.06).max(0.35),
});

const TextLayerSchema = z.object({
  kind: z.literal('text'),
  id: z.string().min(1),
  role: TextRoleSchema,
  /** The approved words; `lines` is how the layout engine broke them (measured with the font's real metrics). */
  text: z.string().min(1).max(160),
  lines: z.array(z.string().min(1)).min(1).max(8),
  rect: RectSchema,
  font: FontSpecSchema,
  color: HexColorSchema,
  align: z.enum(['START', 'CENTER', 'END']),
  box: z
    .object({
      fill: HexColorSchema.optional(),
      stroke: HexColorSchema.optional(),
      radius: z.number().min(0).max(200),
      padX: z.number().min(0).max(120),
      padY: z.number().min(0).max(80),
    })
    .optional(),
  underline: z.boolean().optional(),
  /** CTA as a text line: an arrow drawn after the words. */
  arrow: z.boolean().optional(),
  rotation: z.number().min(-12).max(12).optional(),
});

const LogoLayerSchema = z.object({
  kind: z.literal('logo'),
  id: z.string().min(1),
  assetId: z.string().optional(),
  /** Without an asset the business name is set as a wordmark in this font. */
  text: z.string().min(1).max(60),
  rect: RectSchema,
  style: z.enum(['WORDMARK', 'BADGE', 'MONOGRAM']),
  color: HexColorSchema,
  fill: HexColorSchema.optional(),
  font: FontSpecSchema,
});

export const DesignLayerSchema = z.discriminatedUnion('kind', [
  ImageLayerSchema,
  ShapeLayerSchema,
  TextLayerSchema,
  LogoLayerSchema,
]);
export type DesignLayer = z.infer<typeof DesignLayerSchema>;
export type ImageLayer = z.infer<typeof ImageLayerSchema>;
export type TextLayer = z.infer<typeof TextLayerSchema>;
export type ShapeLayer = z.infer<typeof ShapeLayerSchema>;
export type LogoLayer = z.infer<typeof LogoLayerSchema>;

export const FitStatusSchema = z.enum([
  /** Everything fits at the planned sizes. */
  'FITS',
  /** Fitted by re-breaking lines, small size steps or moving regions (recorded in notes). */
  'REFLOWED',
  /** Fits, but the copy is longer than this composition wants; a shorter version is suggested (not applied). */
  'SHORTER_COPY_SUGGESTED',
  /** A constraint could not be met; the owner must see it. */
  'UNRESOLVED',
]);
export type FitStatus = z.infer<typeof FitStatusSchema>;

export const ReferenceInfluenceSchema = z.object({
  referenceId: z.string(),
  /** The moves this reference contributed to the design. */
  moves: z.array(DesignMoveSchema),
  /** How it changed the design, in words. */
  influence: z.string(),
});
export type ReferenceInfluence = z.infer<typeof ReferenceInfluenceSchema>;

/**
 * CreativeDesignSpec: a complete, provider-independent description of one static ad as layers in pixel space.
 * It is produced by the deterministic layout engine from the Art Director's decisions and interpreted by fixed
 * rendering components. No generated code, CSS or markup ever reaches the renderer; every value is validated.
 */
export const CreativeDesignSpecSchema = z
  .object({
    version: z.literal(1),
    format: z.enum(['1:1', '4:5', '9:16']),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    direction: z.literal('rtl'),
    method: CompositionMethodSchema,
    moves: z.array(DesignMoveSchema),
    typeSystem: TypeSystemIdSchema,
    palette: z.object({
      background: HexColorSchema,
      ink: HexColorSchema,
      muted: HexColorSchema,
      accent: HexColorSchema,
      accentInk: HexColorSchema,
      surface: HexColorSchema,
    }),
    background: z.object({
      kind: z.enum(['SOLID', 'GRADIENT']),
      color: HexColorSchema,
      to: HexColorSchema.optional(),
      angle: z.number().min(0).max(360).optional(),
      grain: z.number().min(0).max(0.25),
    }),
    /** Bottom to top. */
    layers: z.array(DesignLayerSchema).min(2).max(24),
    /** What the viewer should notice first. */
    focal: z.string(),
    /** Layer ids in the intended reading order. */
    readingPath: z.array(z.string()).min(2),
    safeArea: SafeAreaSchema,
    fit: z.object({
      status: FitStatusSchema,
      /** The smallest headline size as a share of its planned size. */
      headlineRatio: z.number().min(0).max(1.5),
      notes: z.array(z.string()),
      /** Shorter copy the composition would prefer, per role (a suggestion; never applied silently). */
      suggestions: z.array(z.object({ role: TextRoleSchema, maxChars: z.number().int().positive(), reason: z.string() })),
    }),
    rationale: z.object({
      decisions: z.array(z.object({ topic: z.string(), decision: z.string(), because: z.string() })),
      references: z.array(ReferenceInfluenceSchema),
    }),
  })
  .superRefine((spec, ctx) => {
    const ids = new Set<string>();
    const W = spec.width;
    const H = spec.height;
    const sa = spec.safeArea;
    spec.layers.forEach((layer, i) => {
      if (ids.has(layer.id)) ctx.addIssue({ code: 'custom', path: ['layers', i, 'id'], message: `Duplicate layer id ${layer.id}` });
      ids.add(layer.id);
      const r = layer.rect;
      // Pictures and shapes may bleed off the canvas a little; nothing may sit entirely outside it.
      const bleed = layer.kind === 'image' || layer.kind === 'shape' ? 0.25 : 0;
      if (r.x < -W * bleed - 0.5 || r.y < -H * bleed - 0.5 || r.x + r.w > W * (1 + bleed) + 0.5 || r.y + r.h > H * (1 + bleed) + 0.5)
        ctx.addIssue({ code: 'custom', path: ['layers', i, 'rect'], message: `${layer.id} is outside the canvas` });
      if (layer.kind === 'text' || layer.kind === 'logo') {
        const inSafe =
          r.x >= sa.sidePx - 0.5 && r.y >= sa.topPx - 0.5 && r.x + r.w <= W - sa.sidePx + 0.5 && r.y + r.h <= H - sa.bottomPx + 0.5;
        if (!inSafe) ctx.addIssue({ code: 'custom', path: ['layers', i, 'rect'], message: `${layer.id} leaves the safe area` });
        if (!FONTS[layer.font.family].weights.includes(layer.font.weight))
          ctx.addIssue({ code: 'custom', path: ['layers', i, 'font'], message: `${layer.font.family} has no weight ${layer.font.weight}` });
      }
    });
    for (const id of spec.readingPath)
      if (!ids.has(id)) ctx.addIssue({ code: 'custom', path: ['readingPath'], message: `Unknown layer ${id}` });
  });
export type CreativeDesignSpec = z.infer<typeof CreativeDesignSpecSchema>;
