import {
  CreativeDesignSpecSchema,
  STATIC_AD_FORMATS,
  TYPE_SYSTEMS,
  contrastRatio,
  fillText,
  fitText,
  measureText,
  mixHex,
  nearestWeight,
  readableOn,
  type BrandColors,
  type CompositionMethod,
  type CompositionType,
  type CreativeDesignSpec,
  type DesignLayer,
  type DesignMove,
  type FontFamily,
  type FontSpec,
  type ImageLayer,
  type Rect,
  type ReferenceInfluence,
  type StaticAdFormat,
  type TextRole,
  type TypeSystem,
  type TypeSystemId,
} from '@kampora/shared';

/**
 * The layout engine of Art Director 2.0. It turns decisions (a composition method, design moves, a type system,
 * a palette, the copy and the picture) into a CreativeDesignSpec: measured, layered, inside the safe area.
 * Deterministic: the same decisions always give the same design. Methods are parameterised constructions on a
 * grid, not fixed pictures: copy length, the picture's calm area, the format and every move change the result.
 *
 * When copy does not fit, the engine climbs a ladder instead of shrinking type: (0) measured line breaks at the
 * planned sizes, (1) reflow the regions and spacing, (2) rearrange and allow small size steps while suggesting
 * shorter copy, (3) report the constraint as unresolved. Approved words are never changed or dropped.
 */

export interface SpecPalette {
  background: string;
  ink: string;
  muted: string;
  accent: string;
  accentInk: string;
  surface: string;
}

export interface ComposeCopy {
  eyebrow?: string;
  headline: string;
  subheadline?: string;
  price?: { price: string; label?: string };
  cta: string;
  ctaSub?: string;
  brandName: string;
}

export interface ComposeInput {
  format: StaticAdFormat;
  method: CompositionMethod;
  moves: readonly DesignMove[];
  typeSystem: TypeSystemId;
  palette: SpecPalette;
  copy: ComposeCopy;
  picture?: {
    assetId: string;
    focal: { x: number; y: number };
    composition?: CompositionType;
    /** Where the picture has calm space for text. */
    negativeSpace?: 'TOP' | 'BOTTOM' | 'START' | 'END' | 'NONE';
  };
  logoAssetId?: string;
  /** What the viewer must notice first. */
  emphasis: 'HEADLINE' | 'PRICE' | 'IMAGE' | 'BRAND';
  references?: ReferenceInfluence[];
  decisions?: { topic: string; decision: string; because: string }[];
}

/** Planned (100%) sizes per role, px at 1080 wide. Methods scale these; the fitter measures them. */
const BASE: Record<StaticAdFormat, Record<'headline' | 'sub' | 'eyebrow' | 'price' | 'label' | 'cta' | 'ctaSub' | 'brand', number>> = {
  '1:1': { headline: 92, sub: 38, eyebrow: 25, price: 120, label: 30, cta: 36, ctaSub: 28, brand: 32 },
  '4:5': { headline: 104, sub: 40, eyebrow: 26, price: 140, label: 32, cta: 38, ctaSub: 29, brand: 34 },
  '9:16': { headline: 112, sub: 44, eyebrow: 28, price: 156, label: 34, cta: 42, ctaSub: 31, brand: 36 },
};

interface Block {
  role: TextRole;
  text: string;
  font: FontSpec;
  color: string;
  align: 'START' | 'CENTER' | 'END';
  /** Space before this block. */
  gap: number;
  maxLines?: number;
  minRatio?: number;
  /** Fill the width: the largest size between min and max that fits in maxLines. */
  fill?: { min: number; max: number };
  maxWidth?: number;
  box?: { fill?: string; stroke?: string; radius: number; padX: number; padY: number };
  underline?: boolean;
  arrow?: boolean;
  /** Tight: the layer is as wide as its text (boxes, CTAs); otherwise as wide as the column. */
  tight?: boolean;
}

class Ctx {
  readonly W: number;
  readonly H: number;
  readonly F: Rect;
  readonly B: (typeof BASE)[StaticAdFormat];
  readonly ts: TypeSystem;
  readonly pal: SpecPalette;
  readonly layers: DesignLayer[] = [];
  readonly notes: string[] = [];
  readonly suggestions: CreativeDesignSpec['fit']['suggestions'] = [];
  readonly decisions: { topic: string; decision: string; because: string }[] = [];
  readonly path: string[] = [];
  overflow = 0;
  headlineRatio = 1;
  n = 0;

  constructor(
    readonly input: ComposeInput,
    readonly relax: number,
  ) {
    const f = STATIC_AD_FORMATS[input.format];
    this.W = f.width;
    this.H = f.height;
    const sa = f.safeArea;
    this.F = { x: sa.sidePx, y: sa.topPx, w: f.width - 2 * sa.sidePx, h: f.height - sa.topPx - sa.bottomPx };
    this.B = BASE[input.format];
    this.ts = TYPE_SYSTEMS[input.typeSystem];
    this.pal = input.palette;
  }

  has(m: DesignMove): boolean {
    return this.input.moves.includes(m);
  }
  get tall(): boolean {
    return this.input.format === '9:16';
  }
  get square(): boolean {
    return this.input.format === '1:1';
  }
  id(prefix: string): string {
    this.n += 1;
    return `${prefix}-${this.n}`;
  }
  /** Spacing scale: tighter on each relax step. */
  gap(v: number): number {
    return Math.round(v * (this.relax >= 1 ? 0.72 : 1) * (this.has('GENEROUS_NEGATIVE_SPACE') && this.relax === 0 ? 1.25 : 1));
  }
  decide(topic: string, decision: string, because: string): void {
    this.decisions.push({ topic, decision, because });
  }

  display(size: number, overrides: Partial<FontSpec> = {}): FontSpec {
    const d = this.ts.display;
    return { family: d.family, weight: d.weight, size, lineHeight: d.lineHeight, letterSpacing: d.letterSpacing, ...overrides };
  }
  text(size: number, strong = false, overrides: Partial<FontSpec> = {}): FontSpec {
    const t = this.ts.text;
    return { family: t.family, weight: strong ? t.strongWeight : t.weight, size, lineHeight: 1.32, letterSpacing: 0, ...overrides };
  }
  accent(size: number, overrides: Partial<FontSpec> = {}): FontSpec {
    const a = this.ts.accent;
    return { family: a.family, weight: a.weight, size, lineHeight: 1.2, letterSpacing: a.letterSpacing, ...overrides };
  }

  image(rect: Rect, extra: Partial<ImageLayer> = {}): void {
    const p = this.input.picture;
    if (!p) return;
    const id = this.id('image');
    const treatment: ImageLayer['treatment'] = this.has('HIGH_CONTRAST_DUOTONE')
      ? 'DUOTONE'
      : this.has('MONOCHROME_PALETTE')
        ? 'MONO'
        : this.has('DARK_MOODY')
          ? 'DARKEN'
          : this.has('MUTED_NATURAL_PALETTE')
            ? 'WARM'
            : 'NATURAL';
    this.layers.push({
      kind: 'image',
      id,
      assetId: p.assetId,
      rect: round(rect),
      focal: p.focal,
      zoom: this.has('DETAIL_MACRO_CROP') ? 1.35 : 1,
      mask: 'RECT',
      radius: 0,
      treatment,
      ...(treatment === 'DUOTONE' ? { duotone: [mixHex(this.pal.background, '#000000', 0.55), this.pal.accent] as [string, string] } : {}),
      ...extra,
    });
    if (this.input.emphasis === 'IMAGE') this.path.unshift(id);
    else this.path.push(id);
  }

  shape(layer: Omit<Extract<DesignLayer, { kind: 'shape' }>, 'kind' | 'id' | 'radius' | 'opacity' | 'rotation'> & Partial<Pick<Extract<DesignLayer, { kind: 'shape' }>, 'radius' | 'opacity' | 'rotation'>>): void {
    this.layers.push({ kind: 'shape', id: this.id('shape'), radius: 0, opacity: 1, rotation: 0, ...layer, rect: round(layer.rect) });
  }

  logo(rect: Rect, style: 'WORDMARK' | 'BADGE' | 'MONOGRAM', color: string, fill?: string): string {
    const id = this.id('logo');
    const size = style === 'WORDMARK' ? Math.min(this.B.brand, rect.h * 0.8) : rect.h * 0.3;
    const font = this.display(Math.max(14, Math.round(size)), { lineHeight: 1 });
    // A wordmark is as wide as the business name in its face.
    const w = style === 'WORDMARK' ? Math.min(rect.w, measureText(this.input.copy.brandName, font) + 4) : rect.w;
    const x = style === 'WORDMARK' ? rect.x + rect.w - w : rect.x;
    this.layers.push({
      kind: 'logo',
      id,
      ...(this.input.logoAssetId ? { assetId: this.input.logoAssetId } : {}),
      text: this.input.copy.brandName,
      rect: round(clampTo({ x, y: rect.y, w, h: rect.h }, this.F)),
      style,
      color,
      ...(fill ? { fill } : {}),
      font: { ...font, weight: nearestWeight(font.family, font.weight) },
    });
    return id;
  }

  /** Height the blocks need in a column of this width (measured, nothing placed). */
  measure(width: number, blocks: Block[]): number {
    const saved = { overflow: this.overflow, ratio: this.headlineRatio, notes: this.notes.length, layers: this.layers.length, n: this.n };
    const used = this.stack({ x: 0, y: 0, w: width, h: 100000 }, blocks).used;
    this.overflow = saved.overflow;
    this.headlineRatio = saved.ratio;
    this.notes.length = saved.notes;
    this.layers.length = saved.layers;
    this.n = saved.n;
    return used;
  }

  /**
   * Places blocks top-to-bottom inside `region`, measuring every one. vAlign BOTTOM stacks from the bottom edge.
   * Overflow (text taller than the region) is recorded so compose() can climb the fitting ladder.
   */
  stack(region: Rect, blocks: Block[], vAlign: 'TOP' | 'BOTTOM' | 'CENTER' = 'TOP'): { used: number; ids: string[] } {
    const placed: { block: Block; lines: string[]; size: number; w: number; h: number; ratio: number }[] = [];
    let used = 0;
    for (const b of blocks) {
      const pad = b.box ? { x: b.box.padX, y: b.box.padY } : { x: 0, y: 0 };
      const arrowW = b.arrow ? b.font.size * 1.1 : 0;
      const maxWidth = Math.min(region.w, b.maxWidth ?? region.w) - 2 * pad.x - arrowW;
      const remaining = Math.max(b.font.size * b.font.lineHeight, region.h - used - b.gap - 2 * pad.y);
      const minRatio = Math.min(b.minRatio ?? (b.role === 'HEADLINE' ? 0.92 : 0.9), this.relax >= 3 ? 0.75 : this.relax >= 2 ? 0.82 : 1);
      const fitted = b.fill
        ? fillText({ text: b.text, font: b.font, maxWidth, maxHeight: remaining, maxLines: b.maxLines ?? 3, min: b.fill.min * (this.relax >= 3 ? 0.78 : this.relax >= 2 ? 0.85 : 1), max: b.fill.max * (this.relax >= 1 ? 0.92 : 1) })
        : fitText({ text: b.text, font: b.font, maxWidth, maxHeight: remaining, maxLines: b.maxLines ?? 4, minRatio });
      const ratio = b.fill ? Math.min(1, fitted.size / b.fill.min) : fitted.ratio;
      if (b.role === 'HEADLINE') this.headlineRatio = Math.min(this.headlineRatio, ratio);
      if (ratio < 0.999 && !b.fill) this.notes.push(`${b.role.toLowerCase()} set at ${Math.round(ratio * 100)}% of its planned size`);
      if (!fitted.fits) this.notes.push(`${b.role.toLowerCase()} needs more room than this arrangement has`);
      const w = (b.tight ? fitted.width + arrowW : maxWidth + arrowW) + 2 * pad.x;
      const h = fitted.height + 2 * pad.y;
      used += (placed.length ? b.gap : 0) + h;
      placed.push({ block: b, lines: fitted.lines, size: fitted.size, w, h, ratio });
    }
    this.overflow += Math.max(0, used - region.h);
    let y = vAlign === 'TOP' ? region.y : vAlign === 'BOTTOM' ? region.y + region.h - used : region.y + (region.h - used) / 2;
    if (region.h < 50000) y = Math.max(y, this.F.y);
    const ids: string[] = [];
    placed.forEach((p, i) => {
      if (i) y += p.block.gap;
      const x =
        p.block.align === 'START'
          ? region.x + region.w - p.w
          : p.block.align === 'CENTER'
            ? region.x + (region.w - p.w) / 2
            : region.x;
      const id = this.id(p.block.role.toLowerCase());
      const font = { ...p.block.font, size: p.size, weight: nearestWeight(p.block.font.family, p.block.font.weight) };
      this.layers.push({
        kind: 'text',
        id,
        role: p.block.role,
        text: p.block.text,
        lines: p.lines,
        rect: round(clampTo({ x, y, w: p.w, h: p.h }, this.F)),
        font,
        color: p.block.color,
        align: p.block.align,
        ...(p.block.box ? { box: p.block.box } : {}),
        ...(p.block.underline ? { underline: true } : {}),
        ...(p.block.arrow ? { arrow: true } : {}),
      });
      ids.push(id);
      y += p.h;
    });
    return { used, ids };
  }

  /* ---- standard blocks ---- */

  eyebrow(color: string, align: Block['align'] = 'START'): Block[] {
    const t = this.input.copy.eyebrow;
    if (!t) return [];
    const font = this.has('HANDWRITTEN_ACCENT')
      ? { family: 'Amatic SC' as FontFamily, weight: 700, size: Math.round(this.B.eyebrow * 1.7), lineHeight: 1, letterSpacing: 0 }
      : this.accent(this.B.eyebrow);
    return [{ role: 'EYEBROW', text: t, font, color, align, gap: 0, maxLines: 2 }];
  }

  headline(color: string, align: Block['align'], opts: { scale?: number; fill?: { min: number; max: number }; maxLines?: number; gap?: number; maxWidth?: number; box?: Block['box'] } = {}): Block {
    let text = this.input.copy.headline;
    const words = text.split(' ');
    // Stacked: one word per line for up to three words, pairs for four.
    if (this.has('STACKED_HEADLINE') && words.length <= 3) text = words.join('\n');
    else if (this.has('STACKED_HEADLINE') && words.length === 4) text = `${words[0]} ${words[1]}\n${words[2]} ${words[3]}`;
    const size = Math.round(this.B.headline * (opts.scale ?? 1) * (this.has('OVERSIZED_HEADLINE') ? 1.18 : 1));
    return {
      role: 'HEADLINE',
      text,
      font: this.display(size),
      color,
      align,
      gap: opts.gap ?? this.gap(24),
      maxLines: opts.maxLines ?? 4,
      ...(opts.fill ? { fill: opts.fill } : {}),
      ...(opts.maxWidth ? { maxWidth: opts.maxWidth } : {}),
      ...(opts.box ? { box: opts.box, tight: true } : {}),
    };
  }

  sub(color: string, align: Block['align'], scale = 1): Block[] {
    const t = this.input.copy.subheadline;
    if (!t || (this.has('MINIMAL_COPY') && this.input.copy.price && t.includes(this.input.copy.price.price))) return [];
    return [{ role: 'SUBHEADLINE', text: t, font: this.text(Math.round(this.B.sub * scale)), color, align, gap: this.gap(18), maxLines: 3 }];
  }

  /** The price as type: a graphic numeral, an understated line, or (with BADGE_STAMP) nothing here: see stamp(). */
  price(color: string, align: Block['align'], labelColor: string): Block[] {
    const p = this.input.copy.price;
    if (!p || this.has('BADGE_STAMP')) return [];
    const graphic = this.has('PRICE_AS_GRAPHIC') || this.input.emphasis === 'PRICE';
    const blocks: Block[] = [];
    if (p.label)
      blocks.push({ role: 'PRICE_LABEL', text: p.label, font: this.accent(this.B.label * (graphic ? 0.9 : 0.8)), color: labelColor, align, gap: this.gap(graphic ? 30 : 20), maxLines: 2 });
    blocks.push({
      role: 'PRICE',
      text: p.price,
      font: graphic ? this.display(Math.round(this.B.price * 1.1), { lineHeight: 0.96 }) : this.text(Math.round(this.B.sub * 1.25), true),
      color,
      align,
      gap: p.label ? this.gap(6) : this.gap(graphic ? 30 : 18),
      maxLines: 1,
      ...(graphic ? { fill: { min: this.B.price * 0.8, max: this.B.price * 1.25 } } : {}),
    });
    return blocks;
  }

  cta(style: 'BUTTON' | 'TEXT_LINE' | 'AUTO', align: Block['align'], onColor: string): Block[] {
    const c = this.input.copy;
    const asText = style === 'TEXT_LINE' || (style === 'AUTO' && this.has('CTA_AS_TEXT_LINE') && !this.has('CTA_BUTTON'));
    const blocks: Block[] = asText
      ? [{ role: 'CTA', text: c.cta, font: this.text(this.B.cta, true), color: onColor, align, gap: this.gap(34), maxLines: 1, underline: true, arrow: true, tight: true }]
      : [
          {
            role: 'CTA',
            text: c.cta,
            font: this.text(this.B.cta, true),
            color: this.pal.accentInk,
            align,
            gap: this.gap(34),
            maxLines: 1,
            tight: true,
            box: { fill: this.pal.accent, radius: this.has('GEOMETRIC_SHAPES') ? 0 : 14, padX: Math.round(this.B.cta * 0.95), padY: Math.round(this.B.cta * 0.5) },
          },
        ];
    if (c.ctaSub) blocks.push({ role: 'CTA_SUB', text: c.ctaSub, font: this.text(this.B.ctaSub), color: onColor === this.pal.ink ? this.pal.muted : onColor, align, gap: this.gap(14), maxLines: 2 });
    return blocks;
  }

  /** A price stamp: a circle with the label and price, placed by the method. */
  stamp(cx: number, cy: number, maxD: number): string | undefined {
    const p = this.input.copy.price;
    if (!p || !this.has('BADGE_STAMP')) return undefined;
    const font = this.display(Math.round(this.B.price * 0.62), { lineHeight: 1 });
    const d = Math.min(maxD, Math.max(measureText(p.price, font) * 1.45, font.size * 2.6));
    const r = clampTo({ x: cx - d / 2, y: cy - d / 2, w: d, h: d }, this.F);
    this.shape({ shape: 'CIRCLE', rect: r, fill: this.pal.accent, radius: d / 2, rotation: -8 });
    const inner = { x: r.x + d * 0.14, y: r.y + d * 0.2, w: d * 0.72, h: d * 0.62 };
    const blocks: Block[] = [];
    if (p.label) blocks.push({ role: 'PRICE_LABEL', text: p.label, font: this.text(Math.round(font.size * 0.36), true), color: this.pal.accentInk, align: 'CENTER', gap: 0, maxLines: 2 });
    blocks.push({ role: 'PRICE', text: p.price, font, color: this.pal.accentInk, align: 'CENTER', gap: 4, maxLines: 1, fill: { min: font.size * 0.7, max: font.size } });
    return this.stack(inner, blocks, 'CENTER').ids.at(-1);
  }

  decorations(): void {
    if (this.has('FRAME_BORDER')) {
      const m = 28;
      this.shape({ shape: 'RECT', rect: { x: m, y: m, w: this.W - 2 * m, h: this.H - 2 * m }, stroke: { color: this.pal.accent, width: 3 }, opacity: 0.9 });
    }
  }
}

const round = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) });

function clampTo(r: Rect, f: Rect): Rect {
  const w = Math.min(r.w, f.w);
  const h = Math.min(r.h, f.h);
  return { x: Math.min(Math.max(r.x, f.x), f.x + f.w - w), y: Math.min(Math.max(r.y, f.y), f.y + f.h - h), w, h };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Composition methods                                                                                         */
/* ------------------------------------------------------------------------------------------------------------ */

type Method = (c: Ctx) => void;

/** Text side for a full-bleed picture: where the picture is calm, else the bottom. */
function calmSide(c: Ctx): 'TOP' | 'BOTTOM' {
  const ns = c.input.picture?.negativeSpace;
  return ns === 'TOP' ? 'TOP' : 'BOTTOM';
}

const IMAGE_FIRST: Method = (c) => {
  const { F, W, H, pal } = c;
  const side = calmSide(c);
  const scrim = mixHex(pal.background, '#000000', 0.55);
  c.image({ x: 0, y: 0, w: W, h: H }, { overlay: { color: scrim, from: 0.82, to: 0, direction: side } });
  const ink = '#ffffff';
  const colW = c.has('GENEROUS_NEGATIVE_SPACE') ? F.w * 0.74 : F.w;
  const share = c.relax >= 1 ? 0.6 : 0.5;
  const region = { x: F.x + F.w - colW, y: side === 'TOP' ? F.y : F.y + F.h * (1 - share), w: colW, h: F.h * share };
  const logoTop = side === 'BOTTOM';
  const logoH = c.B.brand * 1.4;
  c.logo({ x: F.x + F.w * 0.5, y: logoTop ? F.y : F.y + F.h - logoH, w: F.w * 0.5, h: logoH }, 'WORDMARK', ink);
  if (side === 'TOP') region.y += 0;
  const s = c.stack(region, [...c.eyebrow(ink), c.headline(ink, 'START', { gap: c.input.copy.eyebrow ? c.gap(18) : 0 }), ...c.sub(ink, 'START'), ...c.price(ink, 'START', ink), ...c.cta('AUTO', 'START', ink)], side === 'TOP' ? 'TOP' : 'BOTTOM');
  c.path.push(...s.ids);
  c.decide('composition', 'The photograph fills the frame; the copy sits in its calm area', 'The picture carries the idea, so nothing covers the subject.');
};

const LIFESTYLE: Method = (c) => {
  const { F, W, H, pal } = c;
  c.image({ x: 0, y: 0, w: W, h: H }, { overlay: { color: mixHex(pal.background, '#000000', 0.6), from: 0.78, to: 0, direction: 'BOTTOM' } });
  const ink = '#ffffff';
  c.logo({ x: F.x, y: F.y, w: F.w, h: c.B.brand * 1.3 }, 'WORDMARK', ink);
  const region = { x: F.x + F.w * 0.12, y: F.y + F.h * (c.relax >= 1 ? 0.4 : 0.52), w: F.w * 0.88, h: F.h * (c.relax >= 1 ? 0.6 : 0.48) };
  const s = c.stack(region, [...c.eyebrow(ink), c.headline(ink, 'START', { scale: 0.86, gap: c.input.copy.eyebrow ? c.gap(14) : 0 }), ...c.sub(ink, 'START', 0.95), ...c.price(ink, 'START', ink), ...c.cta(c.has('CTA_BUTTON') ? 'BUTTON' : 'TEXT_LINE', 'START', ink)], 'BOTTOM');
  c.path.push(...s.ids);
  c.decide('composition', 'A real moment full bleed, message low and to the reading edge', 'People connect with the moment first; a quiet message keeps it believable.');
};

const EDITORIAL: Method = (c) => {
  const { F, W, H, pal } = c;
  const hasPic = Boolean(c.input.picture);
  const share = hasPic ? (c.tall ? 0.5 : c.square ? 0.46 : 0.54) - (c.relax >= 1 ? 0.08 : 0) : 0;
  let textTop = F.y;
  if (hasPic) {
    const inset = c.has('IMAGE_INSET_FRAME') || c.has('FRAME_BORDER');
    const rect = inset ? { x: F.x, y: F.y, w: F.w, h: (H * share) - F.y } : { x: 0, y: 0, w: W, h: H * share };
    c.image(rect, inset ? { mask: 'ROUNDED', radius: 6 } : {});
    textTop = rect.y + rect.h + c.gap(44);
  }
  const ink = pal.ink;
  const region = { x: F.x, y: textTop, w: F.w, h: F.y + F.h - textTop };
  // Eyebrow and a short rule, then the headline: an editorial reading start.
  const top = c.stack({ ...region, h: region.h * 0.68 }, [...c.eyebrow(pal.accent), c.headline(ink, 'START', { scale: hasPic ? 0.84 : 1.05, gap: c.input.copy.eyebrow ? c.gap(30) : 0 }), ...c.sub(pal.muted, 'START')], 'TOP');
  if (c.has('RULE_LINES') && c.input.copy.eyebrow) {
    const eb = c.layers.find((l) => l.id === top.ids[0]);
    if (eb) c.shape({ shape: 'LINE', rect: { x: F.x + F.w - 120, y: eb.rect.y + eb.rect.h + c.gap(12), w: 120, h: 3 }, fill: pal.accent });
  }
  const priceProbe = c.price(ink, 'END', pal.muted);
  const ctaW = priceProbe.length ? F.w * 0.6 : F.w;
  const bottomH = Math.max(c.measure(ctaW, c.cta('AUTO', 'START', ink).map((b, i) => (i === 0 ? { ...b, gap: 0 } : b))), priceProbe.length ? c.measure(F.w * 0.38, priceProbe.map((b, i) => (i === 0 ? { ...b, gap: 0 } : b))) : 0);
  const bottom = { x: F.x, y: F.y + F.h - bottomH, w: F.w, h: bottomH };
  if (top.used > region.h - bottomH - c.gap(24)) c.overflow += top.used - (region.h - bottomH - c.gap(24));
  if (c.has('RULE_LINES')) c.shape({ shape: 'LINE', rect: { x: F.x, y: bottom.y - c.gap(22), w: F.w, h: 2 }, fill: mixHex(ink, pal.background, 0.7) });
  const priceBlocks = c.price(ink, 'END', pal.muted);
  const cta = c.stack({ ...bottom, w: priceBlocks.length ? F.w * 0.6 : F.w, x: priceBlocks.length ? F.x + F.w * 0.4 : F.x }, c.cta('AUTO', 'START', ink).map((b, i) => (i === 0 ? { ...b, gap: 0 } : b)), 'BOTTOM');
  const price = priceBlocks.length ? c.stack({ ...bottom, w: F.w * 0.38 }, priceBlocks.map((b, i) => (i === 0 ? { ...b, gap: 0 } : b)), 'BOTTOM') : { ids: [] };
  // The wordmark sits on the reading row of the eyebrow, at the far (left) edge: a signature, not a header.
  c.logo({ x: F.x, y: textTop - 4, w: F.w * 0.36, h: c.B.brand * 1.1 }, 'WORDMARK', pal.muted);
  c.path.push(...top.ids, ...price.ids, ...cta.ids);
  c.decide('composition', 'Large picture panel above an editorial text column', 'A calm reading order (picture, headline, detail, action) suits a considered purchase.');
};

const BOLD_TYPE: Method = (c) => {
  const { F, W, pal } = c;
  const ink = readableOn(pal.background, [pal.ink, '#ffffff', '#111111']);
  if (c.has('GEOMETRIC_SHAPES')) {
    const d = W * 0.8;
    c.shape({ shape: 'RING', rect: { x: -d * 0.3, y: c.H - d * 0.7, w: d, h: d }, stroke: { color: pal.accent, width: 18 }, radius: d / 2, opacity: 0.9 });
  }
  const hasPic = Boolean(c.input.picture);
  const picD = hasPic ? Math.round(W * (c.tall ? 0.5 : 0.4) * (c.relax >= 3 ? 0.6 : c.relax >= 2 ? 0.72 : c.relax >= 1 ? 0.85 : 1)) : 0;
  c.logo({ x: F.x, y: F.y, w: F.w, h: c.B.brand * 1.3 }, 'WORDMARK', ink);
  const topY = F.y + c.B.brand * 1.3 + c.gap(36);
  const bottomBlocks = [...c.price(ink, 'START', pal.accent), ...c.cta(c.has('CTA_AS_TEXT_LINE') ? 'TEXT_LINE' : 'BUTTON', 'START', ink)];
  const bottomReserve = c.measure(F.w - (hasPic ? picD * 0.55 : 0), bottomBlocks) + c.gap(36) + (c.input.copy.price && c.has('BADGE_STAMP') && !hasPic ? Math.min(270, F.w * 0.3) + c.gap(20) : 0);
  const headRegion = { x: F.x, y: topY, w: F.w, h: F.h - (topY - F.y) - (hasPic && !c.has('OVERLAPPING_ELEMENTS') ? picD + c.gap(28) : 0) - bottomReserve };
  const head = c.stack(headRegion, [...c.eyebrow(pal.accent), { ...c.headline(ink, 'START', { fill: { min: c.B.headline, max: c.B.headline * (c.tall ? 2.6 : 2.3) }, maxLines: c.has('STACKED_HEADLINE') ? 5 : 4 }), gap: c.input.copy.eyebrow ? c.gap(20) : 0 }, ...c.sub(ink, 'START')], 'TOP');
  if (hasPic) {
    const y = c.has('OVERLAPPING_ELEMENTS') ? Math.min(F.y + F.h - picD, topY + head.used - picD * 0.25) : topY + head.used + c.gap(28);
    c.image({ x: F.x - (c.has('OVERLAPPING_ELEMENTS') ? 40 : 0), y, w: picD, h: picD }, { mask: c.has('CUTOUT_PRODUCT_ON_COLOR') ? 'CIRCLE' : 'ARCH', radius: picD / 2 });
  }
  const b = c.stack({ x: F.x + (hasPic ? picD * 0.55 : 0), y: F.y, w: F.w - (hasPic ? picD * 0.55 : 0), h: F.h }, bottomBlocks, 'BOTTOM');
  // A stamp sits on the far (left) side above the action, clear of the right-aligned type.
  const stampD = Math.min(270, F.w * 0.3);
  const stamp = hasPic ? undefined : c.stamp(F.x + stampD / 2 + 10, F.y + F.h - b.used - stampD / 2 - c.gap(30), stampD);
  c.path.push(...head.ids, ...(stamp ? [stamp] : []), ...b.ids);
  c.decide('composition', 'The headline is set as large as the frame allows', 'Type is the image here: one idea read at a glance in a fast feed.');
};

const ASYMMETRIC: Method = (c) => {
  const { F, W, H, pal } = c;
  const ink = pal.ink;
  const hasPic = Boolean(c.input.picture);
  if (c.tall) {
    const picH = H * (c.relax >= 1 ? 0.4 : 0.46);
    if (hasPic) c.image({ x: 0, y: H - picH, w: W, h: picH }, { mask: 'SLANT_START' });
    c.logo({ x: F.x, y: F.y, w: F.w, h: c.B.brand * 1.3 }, 'WORDMARK', ink);
    const region = { x: F.x, y: F.y + c.B.brand * 1.3 + c.gap(40), w: F.w * 0.92, h: H - picH - F.y - c.B.brand * 1.3 - c.gap(60) };
    const s = c.stack(region, [...c.eyebrow(pal.accent), c.headline(ink, 'START', { scale: 1.05, gap: c.input.copy.eyebrow ? c.gap(18) : 0 }), ...c.sub(pal.muted, 'START'), ...c.price(ink, 'START', pal.muted)], 'TOP');
    // The action sits on the picture's slanted edge; the address goes under it, on the picture's calm band.
    const ctaBlocks = c.cta('BUTTON', 'START', '#ffffff').map((b, i) => (i === 0 ? { ...b, gap: 0 } : b));
    const ctaH = c.measure(F.w, ctaBlocks);
    const cta = c.stack({ x: F.x, y: Math.min(H - picH - c.B.cta, F.y + F.h - ctaH), w: F.w, h: ctaH }, ctaBlocks, 'TOP');
    c.path.push(...s.ids, ...cta.ids);
  } else {
    const picW = W * (c.relax >= 1 ? 0.38 : 0.44);
    if (hasPic) c.image({ x: 0, y: 0, w: picW, h: H }, { mask: 'SLANT_END' });
    else c.shape({ shape: 'RECT', rect: { x: 0, y: 0, w: picW * 0.7, h: H }, fill: pal.accent, opacity: 0.95 });
    const colX = (hasPic ? picW : picW * 0.7) + c.gap(40);
    const col = { x: colX, y: F.y, w: F.x + F.w - colX, h: F.h };
    c.logo({ x: col.x, y: F.y, w: col.w, h: c.B.brand * 1.3 }, 'WORDMARK', ink);
    const overlap = c.has('OVERLAPPING_ELEMENTS') && hasPic;
    const headRegion = { x: overlap ? colX - 90 : col.x, y: F.y + c.B.brand * 1.3 + c.gap(54), w: overlap ? col.w + 90 : col.w, h: F.h * 0.62 };
    const s = c.stack(
      headRegion,
      [
        ...c.eyebrow(pal.accent),
        c.headline(ink, 'START', { scale: 0.92, gap: c.input.copy.eyebrow ? c.gap(18) : 0, ...(overlap ? { box: { fill: pal.background, radius: 0, padX: 22, padY: 14 } } : {}) }),
        ...c.sub(pal.muted, 'START', 0.92),
      ],
      'TOP',
    );
    const bottom = c.stack({ ...col, y: F.y + F.h * 0.6, h: F.h * 0.4 }, [...c.price(ink, 'START', pal.muted), ...c.cta('AUTO', 'START', ink)], 'BOTTOM');
    if (s.used + bottom.used + c.gap(30) > F.h - c.B.brand * 1.3) c.overflow += s.used + bottom.used + c.gap(30) - (F.h - c.B.brand * 1.3);
    c.path.push(...s.ids, ...bottom.ids);
  }
  if (c.has('GEOMETRIC_SHAPES')) c.shape({ shape: 'RECT', rect: { x: F.x + F.w - 14, y: F.y + c.B.brand * 1.3 + c.gap(20), w: 14, h: 120 }, fill: pal.accent });
  c.decide('composition', 'Off-centre grid with the picture bleeding off the far edge', 'Asymmetry creates tension and a clear reading start at the right-hand edge.');
};

const PRODUCT_LED: Method = (c) => {
  const { F, W, H, pal } = c;
  const ink = pal.ink;
  c.logo({ x: F.x, y: F.y, w: F.w, h: c.B.brand * 1.2 }, 'WORDMARK', pal.muted);
  const center = c.has('CENTERED_HERO');
  const align = center ? 'CENTER' : 'START';
  const head = c.stack({ x: F.x, y: F.y + c.B.brand * 1.2 + c.gap(30), w: F.w, h: F.h * 0.32 }, [...c.eyebrow(pal.accent, align), c.headline(ink, align, { scale: 0.9, gap: c.input.copy.eyebrow ? c.gap(14) : 0 }), ...c.sub(pal.muted, align, 0.92)], 'TOP');
  const bottomBlocks = [...c.price(ink, align, pal.muted), ...c.cta(c.has('CTA_AS_TEXT_LINE') ? 'TEXT_LINE' : 'BUTTON', align, ink)];
  const bottomH = c.measure(F.w, bottomBlocks.map((bl, i) => (i === 0 ? { ...bl, gap: 0 } : bl)));
  const picTop = F.y + c.B.brand * 1.2 + c.gap(30) + head.used + c.gap(36);
  const picH = Math.max(H * 0.18, F.y + F.h - bottomH - picTop - c.gap(30));
  const d = Math.min(picH, W * (c.relax >= 1 ? 0.62 : 0.72));
  if (c.input.picture) {
    const circle = c.has('CUTOUT_PRODUCT_ON_COLOR');
    c.shape({ shape: circle ? 'CIRCLE' : 'ARCH', rect: { x: (W - d) / 2 - 18, y: picTop + 18, w: d + 36, h: d }, fill: mixHex(pal.background, pal.accent, 0.22), radius: (d + 36) / 2 });
    c.image({ x: (W - d) / 2, y: picTop, w: d, h: d }, { mask: circle ? 'CIRCLE' : 'ARCH', radius: d / 2 });
  }
  c.stamp(W / 2 + d * 0.42, picTop + d * 0.18, Math.min(260, d * 0.42));
  const b = c.stack({ x: F.x, y: F.y + F.h - bottomH, w: F.w, h: bottomH }, bottomBlocks.map((bl, i) => (i === 0 ? { ...bl, gap: 0 } : bl)), 'BOTTOM');
  c.path.push(...head.ids, ...b.ids);
  c.decide('composition', 'The product framed on a calm field, the price close to it', 'When the product sells itself, it should be the largest, cleanest thing on the page.');
};

const SPLIT: Method = (c) => {
  const { F, W, H, pal } = c;
  const hasPic = Boolean(c.input.picture);
  const share = c.relax >= 1 ? 0.42 : 0.5;
  const panel = pal.accent === pal.background ? mixHex(pal.background, '#000000', 0.2) : pal.background;
  const ink = readableOn(panel, [pal.ink, '#ffffff', '#111111']);
  let col: Rect;
  if (c.square) {
    if (hasPic) c.image({ x: 0, y: 0, w: W * share, h: H });
    col = { x: W * share + c.gap(48), y: F.y, w: F.x + F.w - (W * share + c.gap(48)), h: F.h };
  } else {
    const picH = H * (c.tall ? share * 0.92 : share);
    if (hasPic) c.image({ x: 0, y: 0, w: W, h: picH });
    col = { x: F.x, y: Math.max(F.y, picH + c.gap(48)), w: F.w, h: F.y + F.h - Math.max(F.y, picH + c.gap(48)) };
    if (hasPic) c.shape({ shape: 'RECT', rect: { x: F.x + F.w - 160, y: picH - 6, w: 160, h: 12 }, fill: pal.accent });
  }
  c.logo({ x: col.x, y: col.y, w: col.w, h: c.B.brand * 1.2 }, 'WORDMARK', pal.muted);
  const top = c.stack({ ...col, y: col.y + c.B.brand * 1.2 + c.gap(24), h: col.h * 0.62 }, [...c.eyebrow(pal.accent), c.headline(ink, 'START', { scale: 0.86, gap: c.input.copy.eyebrow ? c.gap(14) : 0 }), ...c.sub(pal.muted, 'START', 0.92)], 'TOP');
  const bottom = c.stack({ ...col, y: col.y + col.h * 0.5, h: col.h * 0.5 }, [...c.price(ink, 'START', pal.muted), ...c.cta('AUTO', 'START', ink)], 'BOTTOM');
  if (top.used + bottom.used + c.B.brand * 1.2 + c.gap(40) > col.h) c.overflow += top.used + bottom.used + c.B.brand * 1.2 + c.gap(40) - col.h;
  c.path.push(...top.ids, ...bottom.ids);
  c.decide('composition', 'Two panels: picture and message', 'A clean division gives the picture and the offer equal, uncluttered space.');
};

const LAYERED: Method = (c) => {
  const { F, W, H, pal } = c;
  c.image({ x: 0, y: 0, w: W, h: H }, { treatment: 'DARKEN', overlay: { color: mixHex(pal.background, '#000000', 0.5), from: 0.55, to: 0.2, direction: 'START' } });
  const ink = '#ffffff';
  c.logo({ x: F.x, y: F.y, w: F.w * 0.5, h: c.B.brand * 1.3 }, 'WORDMARK', ink);
  const head = c.stack({ x: F.x, y: F.y + F.h * (c.tall ? 0.2 : 0.14), w: F.w, h: F.h * 0.5 }, [...c.eyebrow(pal.accent), { ...c.headline(ink, 'START', { fill: { min: c.B.headline * 0.95, max: c.B.headline * 1.9 }, maxLines: 3 }), gap: c.input.copy.eyebrow ? c.gap(16) : 0 }], 'TOP');
  const sub = c.input.copy.subheadline;
  const subBlocks: Block[] = sub ? [{ role: 'SUBHEADLINE', text: sub, font: c.text(c.B.sub, true), color: pal.ink, align: 'START', gap: 0, maxLines: 3, tight: true, maxWidth: F.w * 0.86, box: { fill: pal.surface, radius: 0, padX: 26, padY: 16 } }] : [];
  const bottom = c.stack({ x: F.x, y: F.y + F.h * 0.58, w: F.w, h: F.h * 0.42 }, [...subBlocks, ...c.price(ink, 'START', ink), ...c.cta(c.has('CTA_AS_TEXT_LINE') ? 'TEXT_LINE' : 'BUTTON', 'START', ink)], 'BOTTOM');
  c.path.push(...head.ids, ...bottom.ids);
  c.decide('composition', 'Large type layered over the photograph', 'Type and picture read as one image; controlled darkening keeps it legible.');
};

const PROMO_PRICE: Method = (c) => {
  const { F, W, H, pal } = c;
  const ink = readableOn(pal.background, [pal.ink, '#ffffff', '#111111']);
  const hasPic = Boolean(c.input.picture);
  const picH = hasPic ? H * (c.tall ? 0.34 : 0.4) * (c.relax >= 3 ? 0.62 : c.relax >= 2 ? 0.72 : c.relax >= 1 ? 0.82 : 1) : 0;
  if (hasPic) c.image({ x: 0, y: H - picH, w: W, h: picH }, c.has('ASYMMETRIC_GRID') ? { mask: 'SLANT_START' } : {});
  c.logo({ x: F.x, y: F.y, w: F.w, h: c.B.brand * 1.2 }, 'WORDMARK', ink);
  const region = { x: F.x, y: F.y + c.B.brand * 1.2 + c.gap(36), w: F.w, h: H - picH - (F.y + c.B.brand * 1.2 + c.gap(36)) - c.gap(40) };
  const p = c.input.copy.price;
  const blocks: Block[] = [...c.eyebrow(pal.accent), c.headline(ink, 'START', { scale: 0.78, gap: c.input.copy.eyebrow ? c.gap(14) : 0, maxLines: 3 }), ...c.sub(mixHex(ink, pal.background, 0.3), 'START', 0.9)];
  if (p) {
    if (p.label) blocks.push({ role: 'PRICE_LABEL', text: p.label, font: c.accent(c.B.label), color: pal.accent, align: 'START', gap: c.gap(40), maxLines: 1 });
    blocks.push({ role: 'PRICE', text: p.price, font: c.display(c.B.price * 1.4, { lineHeight: 0.95 }), color: ink, align: 'START', gap: c.gap(p.label ? 4 : 40), maxLines: 1, fill: { min: c.B.price, max: c.B.price * (c.tall ? 2.1 : 1.8) } });
  }
  blocks.push(...c.cta('BUTTON', 'START', ink));
  const s = c.stack(region, blocks, 'TOP');
  // Rules frame the price: a typographic price, not a sticker.
  const priceLayer = c.layers.find((l) => l.kind === 'text' && l.role === 'PRICE');
  if (priceLayer && (c.has('RULE_LINES') || !c.has('BADGE_STAMP'))) {
    c.shape({ shape: 'LINE', rect: { x: F.x, y: priceLayer.rect.y + priceLayer.rect.h + 10, w: F.w, h: 3 }, fill: pal.accent });
  }
  c.path.push(...(p ? s.ids.filter((id) => id.startsWith('price')) : []), ...s.ids.filter((id) => !id.startsWith('price')));
  c.decide('composition', 'The price is set as a typographic graphic between rules', 'For an offer the number is the news; setting it as type keeps it bold without a cheap sticker look.');
};

const LOCAL_MODERN: Method = (c) => {
  const { F, W, H, pal } = c;
  const band = c.B.brand * 3.2;
  c.shape({ shape: 'RECT', rect: { x: 0, y: 0, w: W, h: F.y + band }, fill: pal.accent });
  const bandInk = pal.accentInk;
  const brand = c.stack({ x: F.x, y: F.y + 8, w: F.w, h: band - 16 }, [{ role: 'BRAND', text: c.input.copy.brandName, font: c.display(Math.round(c.B.brand * 1.6), { lineHeight: 1 }), color: bandInk, align: 'START', gap: 0, maxLines: 1, fill: { min: c.B.brand, max: c.B.brand * 1.9 } }], 'CENTER');
  const hasPic = Boolean(c.input.picture);
  const picTop = F.y + band + c.gap(40);
  const picH = hasPic ? H * (c.tall ? 0.3 : 0.34) * (c.relax >= 1 ? 0.8 : 1) : 0;
  if (hasPic) c.image({ x: F.x, y: picTop, w: F.w, h: picH }, { mask: 'ROUNDED', radius: 18 });
  const region = { x: F.x, y: picTop + picH + c.gap(36), w: F.w, h: F.y + F.h - (picTop + picH + c.gap(36)) };
  // The place line (eyebrow) sits on the band under the name: name and neighbourhood read together.
  const s = c.stack(region, [...c.eyebrow(pal.muted), c.headline(pal.ink, 'START', { scale: 0.82, gap: c.input.copy.eyebrow ? c.gap(12) : 0 }), ...c.sub(pal.muted, 'START', 0.92), ...c.price(pal.ink, 'START', pal.muted), ...c.cta('BUTTON', 'START', pal.ink)], 'TOP');
  c.path.push(...brand.ids, ...s.ids);
  c.decide('composition', 'The business name leads on a brand band; the place is framed', 'Locals choose who they know: the name and the place must be recognisable first.');
};

const METHODS: Record<CompositionMethod, Method> = {
  IMAGE_FIRST,
  EDITORIAL,
  BOLD_TYPE,
  ASYMMETRIC,
  PRODUCT_LED,
  SPLIT,
  LAYERED,
  PROMO_PRICE,
  LIFESTYLE,
  LOCAL_MODERN,
};

/** Methods that need a picture to work; without one compose() falls back to a type-led method. */
export const PICTURE_METHODS: readonly CompositionMethod[] = ['IMAGE_FIRST', 'LIFESTYLE', 'LAYERED', 'PRODUCT_LED'];

/**
 * Builds the CreativeDesignSpec for one format. Climbs the fitting ladder (see the module comment) and records
 * every step in `fit`, so the owner and the Critic see what the layout engine had to do.
 */
export function composeDesign(input: ComposeInput): CreativeDesignSpec {
  let method = input.method;
  const notes: string[] = [];
  if (!input.picture && PICTURE_METHODS.includes(method)) {
    notes.push(`${method} needs a picture; composed as BOLD_TYPE instead`);
    method = 'BOLD_TYPE';
  }
  let effective = { ...input, method };
  const build = () => {
    let ctx = new Ctx(effective, 0);
    for (let relax = 0; relax <= 3; relax++) {
      ctx = new Ctx(effective, relax);
      ctx.decorations();
      METHODS[method](ctx);
      if (ctx.overflow <= 1) break;
    }
    return ctx;
  };
  let c = build();
  // Every approved element must be on the page. A stamp the method could not place falls back to typeset price.
  if (input.copy.price && !c.layers.some((l) => l.kind === 'text' && l.role === 'PRICE') && effective.moves.includes('BADGE_STAMP')) {
    notes.push('No room for a price stamp in this composition; the price is set as type');
    effective = { ...effective, moves: effective.moves.filter((m) => m !== 'BADGE_STAMP') };
    c = build();
  }
  const roles = new Set(c.layers.flatMap((l) => (l.kind === 'text' ? [l.role] : [])));
  const required: TextRole[] = ['HEADLINE', 'CTA'];
  if (input.copy.price) required.push('PRICE');
  if (input.copy.ctaSub) required.push('CTA_SUB');
  if (input.copy.eyebrow) required.push('EYEBROW');
  const subCarriesPrice = input.copy.price && input.copy.subheadline?.includes(input.copy.price.price);
  if (input.copy.subheadline && !(effective.moves.includes('MINIMAL_COPY') && subCarriesPrice)) required.push('SUBHEADLINE');
  const missing = required.filter((r) => !roles.has(r));
  if (missing.length) throw new Error(`Composition ${method} lost approved copy: ${missing.join(', ')}`);
  const status: CreativeDesignSpec['fit']['status'] =
    c.overflow > 1 ? 'UNRESOLVED' : c.relax >= 2 ? 'SHORTER_COPY_SUGGESTED' : c.relax === 1 || c.notes.length ? 'REFLOWED' : 'FITS';
  if (c.relax >= 1) notes.push(c.relax === 1 ? 'Regions and spacing were reflowed to fit the copy' : 'The copy is long for this composition');
  if (c.relax >= 2) {
    const h = input.copy.headline;
    c.suggestions.push({ role: 'HEADLINE', maxChars: Math.max(12, Math.floor(h.length * 0.72)), reason: `This composition wants a headline of about ${Math.floor(h.length * 0.72)} characters` });
    if (input.copy.subheadline)
      c.suggestions.push({ role: 'SUBHEADLINE', maxChars: Math.max(20, Math.floor(input.copy.subheadline.length * 0.7)), reason: 'A shorter supporting line would give the headline room' });
  }
  if (c.overflow > 1) notes.push(`Text is ${Math.round(c.overflow)}px taller than the space; shorten the copy or choose another direction`);
  const fmt = STATIC_AD_FORMATS[input.format];
  const pal = input.palette;
  const spec: CreativeDesignSpec = {
    version: 1,
    format: input.format,
    width: fmt.width,
    height: fmt.height,
    direction: 'rtl',
    method,
    moves: [...effective.moves],
    typeSystem: input.typeSystem,
    palette: pal,
    background: input.moves.includes('BRAND_COLOR_FLOOD') || !input.picture
      ? { kind: 'GRADIENT', color: pal.background, to: mixHex(pal.background, '#000000', 0.12), angle: 160, grain: input.moves.includes('TEXTURE_GRAIN') ? 0.08 : 0 }
      : { kind: 'SOLID', color: pal.background, grain: input.moves.includes('TEXTURE_GRAIN') ? 0.08 : 0 },
    layers: c.layers,
    focal: input.emphasis,
    readingPath: [...new Set(c.path)].filter((id) => c.layers.some((l) => l.id === id)),
    safeArea: fmt.safeArea,
    fit: { status, headlineRatio: Math.round(c.headlineRatio * 100) / 100, notes: [...notes, ...c.notes], suggestions: c.suggestions },
    rationale: { decisions: [...(input.decisions ?? []), ...c.decisions], references: input.references ?? [] },
  };
  if (spec.readingPath.length < 2) spec.readingPath = spec.layers.filter((l) => l.kind === 'text').map((l) => l.id).slice(0, 3);
  return CreativeDesignSpecSchema.parse(spec);
}

/* ------------------------------------------------------------------------------------------------------------ */
/* Palettes                                                                                                    */
/* ------------------------------------------------------------------------------------------------------------ */

/**
 * A palette from the brand colours, shaped by the colour moves. Contrast is enforced: ink on background ≥ 4.5,
 * accent text on accent ≥ 4.5 (WCAG), so the moves can change mood but never legibility.
 */
export function derivePalette(brand: BrandColors, moves: readonly DesignMove[]): SpecPalette {
  const has = (m: DesignMove) => moves.includes(m);
  let background = brand.background;
  let accent = brand.accent;
  if (has('BRAND_COLOR_FLOOD')) background = brand.primary;
  if (has('DARK_MOODY')) background = mixHex(brand.primary, '#000000', 0.62);
  if (has('MUTED_NATURAL_PALETTE')) background = mixHex(brand.background, '#efe7da', 0.6);
  if (has('VIBRANT_COMPLEMENTARY')) {
    background = brand.secondary;
    accent = brand.accent;
  }
  const ink = readableOn(background, [brand.text, '#141414', '#ffffff']);
  if (has('MONOCHROME_PALETTE')) accent = ink;
  if (contrastRatio(accent, background) < 1.6) accent = has('DARK_MOODY') ? mixHex(brand.accent, '#ffffff', 0.3) : brand.primary;
  const accentInk = readableOn(accent, ['#ffffff', '#141414', brand.text]);
  const muted = mixHex(ink, background, 0.32);
  const surface = mixHex(background, contrastRatio('#ffffff', background) > 4 ? '#ffffff' : '#000000', 0.12);
  return { background, ink, muted, accent, accentInk, surface };
}
