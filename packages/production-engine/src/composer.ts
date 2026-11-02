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

export interface ComposePicture {
  assetId: string;
  focal: { x: number; y: number };
  composition?: CompositionType;
  /** Where the picture has calm space for text. */
  negativeSpace?: 'TOP' | 'BOTTOM' | 'START' | 'END' | 'NONE';
  /** Source width / height. With `subject`, the engine can measure where a crop puts the subject. */
  aspect?: number;
  /** The box (fractions of the source) that holds the people or the product. Verified metadata only, never guessed. */
  subject?: { x: number; y: number; w: number; h: number };
  people?: 'NONE' | 'ONE' | 'FEW' | 'GROUP';
}

export interface ComposeInput {
  format: StaticAdFormat;
  method: CompositionMethod;
  moves: readonly DesignMove[];
  typeSystem: TypeSystemId;
  palette: SpecPalette;
  copy: ComposeCopy;
  picture?: ComposePicture;
  /** Other approved pictures for this ad: a grid (COLLAGE_GRID) may use one beside the main picture. */
  gallery?: readonly ComposePicture[];
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

/** Hebrew has no capitals to space out: wide tracking breaks its words apart, so Hebrew lines keep it slight. */
const HEBREW = /[֐-׿]/;
const HEBREW_MAX_TRACKING = 0.03;
const tracked = (b: Block): Block =>
  HEBREW.test(b.text) && b.font.letterSpacing > HEBREW_MAX_TRACKING ? { ...b, font: { ...b.font, letterSpacing: HEBREW_MAX_TRACKING } } : b;

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
  /** Things a person should check that the engine cannot measure (they do not change the fit status). */
  readonly flags: string[] = [];
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

  image(rect: Rect, extra: Partial<ImageLayer> = {}, p: ComposePicture | undefined = this.input.picture): void {
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
    const saved = this.snapshot();
    const used = this.stack({ x: 0, y: 0, w: width, h: 100000 }, blocks).used;
    this.restore(saved);
    return used;
  }

  /** The drawing state, so an arrangement can be tried and taken back. */
  snapshot() {
    return { overflow: this.overflow, ratio: this.headlineRatio, notes: this.notes.length, layers: this.layers.length, n: this.n };
  }

  restore(saved: ReturnType<Ctx['snapshot']>): void {
    this.overflow = saved.overflow;
    this.headlineRatio = saved.ratio;
    this.notes.length = saved.notes;
    this.layers.length = saved.layers;
    this.n = saved.n;
  }

  /**
   * Places blocks top-to-bottom inside `region`, measuring every one. vAlign BOTTOM stacks from the bottom edge.
   * Overflow (text taller than the region) is recorded so compose() can climb the fitting ladder.
   */
  stack(region: Rect, blocks: Block[], vAlign: 'TOP' | 'BOTTOM' | 'CENTER' = 'TOP'): { used: number; ids: string[] } {
    const placed: { block: Block; lines: string[]; size: number; w: number; h: number; ratio: number }[] = [];
    let used = 0;
    for (const [i, raw] of blocks.entries()) {
      const b = tracked(raw);
      const pad = b.box ? { x: b.box.padX, y: b.box.padY } : { x: 0, y: 0 };
      const arrowW = b.arrow ? b.font.size * 1.1 : 0;
      const maxWidth = Math.min(region.w, b.maxWidth ?? region.w) - 2 * pad.x - arrowW;
      // A block that grows to fill its space leaves room for the blocks after it (not measured inside measure()).
      const next = blocks[i + 1];
      const after = b.fill && next && region.h < 50000 ? this.measure(region.w, blocks.slice(i + 1)) + next.gap : 0;
      const remaining = Math.max(b.font.size * b.font.lineHeight, region.h - used - b.gap - 2 * pad.y - after);
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
      // A separator dot belongs between two phrases on one line; where the line breaks, the break replaces it.
      const lines = fitted.lines.length > 1 ? fitted.lines.map((l) => l.replace(/\s*·\s*$/, '').replace(/^\s*·\s*/, '')) : fitted.lines;
      placed.push({ block: b, lines, size: fitted.size, w, h, ratio });
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

  headline(color: string, align: Block['align'], opts: { scale?: number; fill?: { min: number; max: number }; maxLines?: number; gap?: number; maxWidth?: number; box?: Block['box']; twoLines?: boolean } = {}): Block {
    let text = this.input.copy.headline;
    const words = text.split(' ');
    // Stacked: one word per line for up to three words, pairs for four. Stacking is a style, not a size: it is the
    // first thing given up when the copy needs room, before any type gets smaller.
    const stacked = this.has('STACKED_HEADLINE') && this.relax === 0;
    if (stacked && words.length <= 3) text = words.join('\n');
    else if (stacked && words.length === 4) text = `${words[0]} ${words[1]}\n${words[2]} ${words[3]}`;
    // Type as image: the headline is set as a block of two balanced lines, so the fill can grow it across the width
    // twice instead of running it as one thin line.
    const two = !stacked && opts.twoLines && words.length >= 2;
    if (two) {
      const diff = (k: number) => Math.abs(words.slice(0, k).join(' ').length - words.slice(k).join(' ').length);
      let cut = 1;
      for (let k = 2; k < words.length; k++) if (diff(k) < diff(cut)) cut = k;
      text = `${words.slice(0, cut).join(' ')}\n${words.slice(cut).join(' ')}`;
    }
    // When the price leads, the headline is planned to stop short of the price numeral: two heroes is no hero.
    const cap = this.input.emphasis === 'PRICE' && this.input.copy.price && !this.has('BADGE_STAMP') ? this.B.price * 1.25 * 0.82 : Infinity;
    const size = Math.round(Math.min(cap, this.B.headline * (opts.scale ?? 1) * (this.has('OVERSIZED_HEADLINE') ? 1.18 : 1)));
    const fill = opts.fill && { min: Math.min(cap, opts.fill.min), max: Math.min(cap, opts.fill.max) };
    return {
      role: 'HEADLINE',
      text,
      font: this.display(size),
      color,
      align,
      gap: opts.gap ?? this.gap(24),
      maxLines: two ? 2 : opts.maxLines ?? 4,
      ...(fill ? { fill } : {}),
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
    // Three weights of price: a graphic numeral, a clear figure in the display face (the default), or, when the
    // references ask for restraint, a quiet line in the text face.
    const quiet = !graphic && this.has('PRICE_UNDERSTATED');
    const blocks: Block[] = [];
    if (p.label)
      blocks.push({ role: 'PRICE_LABEL', text: p.label, font: this.accent(this.B.label * (graphic ? 0.9 : quiet ? 0.72 : 0.8)), color: labelColor, align, gap: this.gap(graphic ? 30 : 20), maxLines: 2 });
    blocks.push({
      role: 'PRICE',
      text: p.price,
      font: graphic
        ? this.display(Math.round(this.B.price * 1.1), { lineHeight: 0.96 })
        : quiet
          ? this.text(Math.round(this.B.sub * 1.05), true)
          : this.display(Math.round(this.B.sub * 1.5), { lineHeight: 1 }),
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

/** Blocks stacked as a new group: the first one needs no space before it. */
const first0 = (blocks: Block[]): Block[] => blocks.map((b, i) => (i === 0 ? { ...b, gap: 0 } : b));

/** The part of a text layer that carries ink: as wide as its longest line, on its alignment side (START is right in RTL). */
function inkRect(l: Extract<DesignLayer, { kind: 'text' }>): Rect {
  const extra = (l.box ? 2 * l.box.padX : 0) + (l.arrow ? l.font.size * 1.1 : 0);
  const w = Math.min(l.rect.w, Math.max(...l.lines.map((t) => measureText(t, l.font))) + extra);
  const x = l.align === 'START' ? l.rect.x + l.rect.w - w : l.align === 'CENTER' ? l.rect.x + (l.rect.w - w) / 2 : l.rect.x;
  return { x, y: l.rect.y, w, h: l.rect.h };
}

const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/* ------------------------------------------------------------------------------------------------------------ */
/* Picture geometry                                                                                            */
/* ------------------------------------------------------------------------------------------------------------ */

/**
 * Where a box of the source picture lands on the page, drawn as the renderer draws it (object-fit cover at the
 * focal point, then scaled by `zoom` around it). `full` is the box unclipped; `visible` is what the frame shows.
 * Undefined without the picture's proportions: the engine does not guess.
 */
export function pictureBoxOnPage(
  pic: Pick<ComposePicture, 'aspect'>,
  rect: Rect,
  focal: { x: number; y: number },
  zoom: number,
  box: { x: number; y: number; w: number; h: number },
): { full: Rect; visible: Rect | null } | undefined {
  if (!pic.aspect) return undefined;
  const s = Math.max(rect.w / pic.aspect, rect.h);
  const rw = pic.aspect * s;
  const rh = s;
  const ox = (rect.w - rw) * focal.x;
  const oy = (rect.h - rh) * focal.y;
  const cx = focal.x * rect.w;
  const cy = focal.y * rect.h;
  const map = (u: number, v: number) => ({ x: rect.x + cx + (ox + u * rw - cx) * zoom, y: rect.y + cy + (oy + v * rh - cy) * zoom });
  const a = map(box.x, box.y);
  const b = map(box.x + box.w, box.y + box.h);
  const full = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  const x0 = Math.max(rect.x, a.x);
  const y0 = Math.max(rect.y, a.y);
  const x1 = Math.min(rect.x + rect.w, b.x);
  const y1 = Math.min(rect.y + rect.h, b.y);
  return { full, visible: x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null };
}

/** The crop that centres the subject in a frame as far as the picture allows (responsive cropping). */
export function subjectFocal(pic: ComposePicture, rect: Rect): { x: number; y: number } {
  if (!pic.aspect || !pic.subject) return pic.focal;
  const s = Math.max(rect.w / pic.aspect, rect.h);
  const axis = (frame: number, rendered: number, centre: number, fallback: number) =>
    Math.abs(frame - rendered) < 1 ? fallback : Math.min(1, Math.max(0, (frame / 2 - centre * rendered) / (frame - rendered)));
  return {
    x: Math.round(axis(rect.w, pic.aspect * s, pic.subject.x + pic.subject.w / 2, pic.focal.x) * 100) / 100,
    y: Math.round(axis(rect.h, s, pic.subject.y + pic.subject.h / 2, pic.focal.y) * 100) / 100,
  };
}

export interface PictureUse {
  assetId: string;
  /** Share of the subject's visible area that text covers (0–1). */
  covered: number;
  /** Visible subject area as a share of the page: how large the people or product read. */
  subjectShare: number;
  /** Share of the subject the crop keeps in frame. */
  kept: number;
}

/** Measures how a composed spec treats each picture's subject. Pictures without subject metadata are not measured. */
export function measurePictureUse(spec: Pick<CreativeDesignSpec, 'layers' | 'width' | 'height'>, pictures: readonly ComposePicture[]): PictureUse[] {
  const out: PictureUse[] = [];
  const texts = spec.layers.flatMap((l) => (l.kind === 'text' ? [inkRect(l)] : []));
  for (const l of spec.layers) {
    if (l.kind !== 'image') continue;
    const pic = pictures.find((p) => p.assetId === l.assetId);
    if (!pic?.subject) continue;
    const at = pictureBoxOnPage(pic, l.rect, l.focal, l.zoom, pic.subject);
    if (!at) continue;
    const vis = at.visible;
    const area = vis ? vis.w * vis.h : 0;
    const covered = vis && area ? Math.min(1, texts.reduce((n, t) => n + overlapArea(t, vis), 0) / area) : 0;
    out.push({ assetId: l.assetId, covered: Math.round(covered * 100) / 100, subjectShare: Math.round((area / (spec.width * spec.height)) * 100) / 100, kept: Math.round((area / Math.max(1, at.full.w * at.full.h)) * 100) / 100 });
  }
  return out;
}

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

/**
 * A picture area as one picture or, with COLLAGE_GRID and a second approved picture, a grid: the main picture on the
 * reading side and a tile beside it. Every picture is cropped to keep its subject in frame.
 */
function pictureArea(c: Ctx, rect: Rect, extra: Partial<ImageLayer> = {}): void {
  const main = c.input.picture;
  if (!main) return;
  const second = c.has('COLLAGE_GRID') ? pickTile(main, c.input.gallery ?? []) : undefined;
  if (c.has('COLLAGE_GRID') && !second) c.decide('collage', 'One picture, no grid', 'A grid needs a second approved picture of this business; there is only one.');
  if (!second || rect.w < 400) {
    c.image(rect, { focal: subjectFocal(main, rect), ...extra });
    return;
  }
  const gutter = 12;
  const mainW = Math.round(rect.w * 0.62);
  const a = { x: rect.x + rect.w - mainW, y: rect.y, w: mainW, h: rect.h };
  const b = { x: rect.x, y: rect.y, w: rect.w - mainW - gutter, h: rect.h };
  c.image(a, { focal: subjectFocal(main, a), ...extra });
  c.image(b, { focal: subjectFocal(second, b), ...extra }, second);
  c.decide('collage', `Two pictures in a grid: ${main.assetId} and ${second.assetId}`, 'Two views of the same place (the whole and a detail) tell more than one, without inventing anything.');
}

/** The grid's second picture: the one that shows something the main picture does not (a detail beside a scene). */
function pickTile(main: ComposePicture, gallery: readonly ComposePicture[]): ComposePicture | undefined {
  const others = gallery.filter((p) => p.assetId !== main.assetId);
  return others.find((p) => p.composition === 'DETAIL' && main.composition !== 'DETAIL') ?? others.find((p) => p.composition !== main.composition) ?? others[0];
}

interface OverPlan {
  focal: { x: number; y: number };
  zoom: number;
  /** ONE: all the copy in the calm band. SPLIT: the message in the calm band, the action on a band under the subject. */
  mode: 'ONE' | 'SPLIT';
  side: 'TOP' | 'BOTTOM';
  /** Top of the subject and its bottom on the page. */
  subjectTop: number;
  subjectBottom: number;
}

/**
 * Text over a full-bleed picture without covering its subject. Tries crops (focal points, and with PEOPLE_AS_HERO a
 * closer crop on the people) and measures, for each, the calm bands above and below the subject. The copy goes
 * where it fits: all in one band, or the message above and the action below. Returns null when no crop leaves
 * room, and 'UNKNOWN' when the picture has no verified subject box.
 */
function planOverPicture(c: Ctx, colW: number, all: Block[], message: Block[], action: Block[], prefer: 'TOP' | 'BOTTOM'): OverPlan | null | 'UNKNOWN' {
  const pic = c.input.picture!;
  if (!pic.subject || !pic.aspect) return 'UNKNOWN';
  const { F, W, H } = c;
  const page = { x: 0, y: 0, w: W, h: H };
  const m = c.gap(32);
  const hAll = c.measure(colW, first0(all));
  const hMessage = c.measure(colW, first0(message));
  const hAction = c.measure(F.w, first0(action));
  const centred = subjectFocal(pic, page);
  const ys = [...new Set([pic.focal.y, centred.y, 0, 0.25, 0.5, 0.75, 1])];
  const zooms = c.has('PEOPLE_AS_HERO') ? [1, 1.12] : [1];
  let best: (OverPlan & { score: number }) | null = null;
  for (const zoom of zooms)
    for (const y of ys) {
      const focal = { x: centred.x, y };
      const at = pictureBoxOnPage(pic, page, focal, zoom, pic.subject)!;
      // Heads stay in: the crop may cut feet, not the top of the subject.
      if (!at.visible || at.full.y < -2 || (at.visible.w * at.visible.h) / (at.full.w * at.full.h) < 0.72) continue;
      const S = at.visible;
      const top = S.y - m - F.y;
      const bottom = F.y + F.h - (S.y + S.h) - m;
      const options: { mode: OverPlan['mode']; side: OverPlan['side']; spare: number }[] = [];
      if (top >= hAll) options.push({ mode: 'ONE', side: 'TOP', spare: top - hAll });
      if (bottom >= hAll) options.push({ mode: 'ONE', side: 'BOTTOM', spare: bottom - hAll });
      if (top >= hMessage && bottom >= hAction) options.push({ mode: 'SPLIT', side: 'TOP', spare: Math.min(top - hMessage, bottom - hAction) });
      for (const o of options) {
        const score = (o.mode === 'ONE' ? 3 : 1.5) + (o.side === prefer ? 0.5 : 0) + o.spare / H + (c.has('PEOPLE_AS_HERO') ? (2 * S.w * S.h) / (W * H) : 0);
        if (!best || score > best.score) best = { ...o, focal, zoom, score, subjectTop: S.y, subjectBottom: S.y + S.h };
      }
    }
  return best;
}

/**
 * The picture and the message in two panels: the picture takes what the copy leaves (never an empty field), and
 * bleeds through the larger of the safe bands, where platform buttons sit and type must not.
 */
function picturePanel(c: Ctx, scale: number, because: string): void {
  const { F, W, H, pal } = c;
  const ink = pal.ink;
  const blocks = [...c.eyebrow(pal.accent), c.headline(ink, 'START', { scale, gap: c.input.copy.eyebrow ? c.gap(18) : 0 }), ...c.sub(pal.muted, 'START'), ...c.price(ink, 'START', pal.muted), ...c.cta('AUTO', 'START', ink)];
  const textH = c.measure(F.w, first0(blocks));
  const pad = c.gap(48);
  const minPic = H * (c.tall ? 0.34 : 0.4);
  const sa = STATIC_AD_FORMATS[c.input.format].safeArea;
  const pictureLow = sa.bottomPx > sa.topPx;
  if (pictureLow) {
    let picTop = F.y + textH + pad;
    if (H - picTop < minPic) {
      c.overflow += minPic - (H - picTop);
      picTop = H - minPic;
    }
    pictureArea(c, { x: 0, y: picTop, w: W, h: H - picTop });
    c.shape({ shape: 'RECT', rect: { x: F.x + F.w - 160, y: picTop - 6, w: 160, h: 12 }, fill: pal.accent });
    c.path.push(...c.stack({ x: F.x, y: F.y, w: F.w, h: picTop - pad - F.y }, first0(blocks), 'TOP').ids);
  } else {
    let panelTop = F.y + F.h - textH - pad;
    if (panelTop < minPic) {
      c.overflow += minPic - panelTop;
      panelTop = minPic;
    }
    pictureArea(c, { x: 0, y: 0, w: W, h: panelTop });
    c.shape({ shape: 'RECT', rect: { x: F.x + F.w - 160, y: panelTop - 6, w: 160, h: 12 }, fill: pal.accent });
    c.path.push(...c.stack({ x: F.x, y: panelTop + pad, w: F.w, h: F.y + F.h - panelTop - pad }, first0(blocks), 'TOP').ids);
  }
  c.logo({ x: F.x, y: pictureLow ? F.y : F.y + F.h - c.B.brand * 1.2, w: F.w * 0.4, h: c.B.brand * 1.2 }, 'WORDMARK', pal.muted);
  c.decide('composition', 'The picture and the message in two panels', because);
}

/**
 * Full-bleed picture with the copy beside its subject. With verified subject metadata the engine measures the crop
 * and keeps the text off the people or product; without it the old calm-side rule applies and a review flag says so.
 */
function textOverPicture(c: Ctx, opts: { scale: number; prefer: 'TOP' | 'BOTTOM'; ctaStyle: 'AUTO' | 'BUTTON' | 'TEXT_LINE'; colW: number; scrimMix: number; what: string }): void {
  const { F, W, H, pal } = c;
  const ink = '#ffffff';
  const eb = Boolean(c.input.copy.eyebrow);
  const message = [...c.eyebrow(ink), c.headline(ink, 'START', { scale: opts.scale, gap: eb ? c.gap(18) : 0 }), ...c.sub(ink, 'START')];
  const action = [...c.price(ink, 'START', ink), ...c.cta(opts.ctaStyle, 'START', ink)];
  const scrim = mixHex(pal.background, '#000000', opts.scrimMix);
  const colX = F.x + F.w - opts.colW;
  const plan = planOverPicture(c, opts.colW, [...message, ...action], message, action, opts.prefer);
  if (plan === null) {
    picturePanel(c, 0.86, 'No crop of this picture leaves room for the copy beside the subject: the text moves onto a panel instead of covering it.');
    return;
  }
  if (plan === 'UNKNOWN') {
    const side = opts.prefer === 'BOTTOM' ? 'BOTTOM' : calmSide(c);
    c.image({ x: 0, y: 0, w: W, h: H }, { overlay: { color: scrim, from: 0.82, to: 0, direction: side } });
    const share = c.relax >= 1 ? 0.6 : 0.5;
    const region = { x: colX, y: side === 'TOP' ? F.y : F.y + F.h * (1 - share), w: opts.colW, h: F.h * share };
    c.logo({ x: F.x, y: side === 'BOTTOM' ? F.y : F.y + F.h - c.B.brand * 1.4, w: F.w * 0.5, h: c.B.brand * 1.4 }, 'WORDMARK', ink);
    c.path.push(...c.stack(region, [...message, ...action], side === 'TOP' ? 'TOP' : 'BOTTOM').ids);
    c.flags.push('Where the subject is in this picture is not recorded: check that the text does not cover the people or the product.');
    c.decide('composition', opts.what, 'The subject position is not recorded, so the copy uses the calm side; flagged for review.');
    return;
  }
  const m = c.gap(32);
  if (plan.mode === 'ONE') {
    c.image({ x: 0, y: 0, w: W, h: H }, { focal: plan.focal, zoom: plan.zoom, overlay: { color: scrim, from: 0.82, to: 0, direction: plan.side } });
    const region = plan.side === 'TOP' ? { x: colX, y: F.y, w: opts.colW, h: plan.subjectTop - m - F.y } : { x: colX, y: plan.subjectBottom + m, w: opts.colW, h: F.y + F.h - plan.subjectBottom - m };
    c.path.push(...c.stack(region, first0([...message, ...action]), plan.side === 'TOP' ? 'TOP' : 'BOTTOM').ids);
    c.logo({ x: F.x, y: plan.side === 'TOP' ? F.y + F.h - c.B.brand * 1.4 : F.y, w: F.w * 0.5, h: c.B.brand * 1.4 }, 'WORDMARK', ink);
  } else {
    // The message on the calm band over the picture; the action on a band of brand colour under the subject.
    c.image({ x: 0, y: 0, w: W, h: H }, { focal: plan.focal, zoom: plan.zoom, overlay: { color: scrim, from: 0.82, to: 0, direction: 'TOP' } });
    const bandTop = plan.subjectBottom + Math.round(m / 2);
    c.shape({ shape: 'RECT', rect: { x: 0, y: bandTop, w: W, h: H - bandTop }, fill: pal.background, opacity: 0.96 });
    const top = c.stack({ x: colX, y: F.y, w: opts.colW, h: plan.subjectTop - m - F.y }, first0(message), 'TOP');
    const actionInk = readableOn(pal.background, [pal.ink, '#ffffff', '#111111']);
    const recoloured = action.map((b) => (b.role === 'CTA' && b.box ? b : { ...b, color: b.role === 'PRICE_LABEL' ? pal.muted : actionInk }));
    const bottom = c.stack({ x: F.x, y: bandTop + m / 2, w: F.w, h: F.y + F.h - bandTop - m / 2 }, first0(recoloured), 'BOTTOM');
    c.path.push(...top.ids, ...bottom.ids);
    c.logo({ x: F.x, y: F.y + F.h - c.B.brand * 1.2, w: F.w * 0.4, h: c.B.brand * 1.2 }, 'WORDMARK', pal.muted);
  }
  c.decide('composition', opts.what, `The crop was measured: the copy sits ${plan.mode === 'ONE' ? `in the calm band ${plan.side === 'TOP' ? 'above' : 'below'} the subject` : 'above the subject, the action on a band below it'}, so no text covers it.`);
}

const IMAGE_FIRST: Method = (c) => {
  const { F } = c;
  if (c.has('SPLIT_PANEL') || c.has('COLLAGE_GRID')) {
    picturePanel(c, 0.9, c.has('COLLAGE_GRID') ? 'A grid of the business\'s own pictures above a clean message panel.' : 'A hard split keeps the picture whole and the message clear: nothing is printed over the subject.');
    return;
  }
  textOverPicture(c, { scale: 1, prefer: calmSide(c), ctaStyle: 'AUTO', colW: c.has('GENEROUS_NEGATIVE_SPACE') ? F.w * 0.74 : F.w, scrimMix: 0.55, what: 'The photograph fills the frame; the copy sits in its calm area' });
};

const LIFESTYLE: Method = (c) => {
  if (c.has('SPLIT_PANEL') || c.has('COLLAGE_GRID')) {
    picturePanel(c, 0.86, 'The moment stays whole above the message.');
    return;
  }
  textOverPicture(c, { scale: 0.86, prefer: 'BOTTOM', ctaStyle: c.has('CTA_BUTTON') ? 'BUTTON' : 'TEXT_LINE', colW: c.F.w * 0.88, scrimMix: 0.6, what: 'A real moment full bleed, message to the reading edge' });
};

const EDITORIAL: Method = (c) => (c.input.picture ? EDITORIAL_WITH_PICTURE(c) : EDITORIAL_TYPE_ONLY(c));

/**
 * Editorial with a picture. The picture panel takes the height the copy leaves (no empty field under the action),
 * and bleeds through the larger safe band. The price belongs to the action: label, price and button read as one
 * group on the reading edge; only when that does not fit does the price move beside the button, on its row.
 */
const EDITORIAL_WITH_PICTURE: Method = (c) => {
  const { F, W, H, pal } = c;
  const ink = pal.ink;
  const eb = Boolean(c.input.copy.eyebrow);
  const sa = STATIC_AD_FORMATS[c.input.format].safeArea;
  const pictureLow = sa.bottomPx > sa.topPx;
  const inset = c.has('IMAGE_INSET_FRAME') || c.has('FRAME_BORDER');
  const message = [...c.eyebrow(pal.accent), c.headline(ink, 'START', { scale: 0.84, gap: eb ? c.gap(30) : 0 }), ...c.sub(pal.muted, 'START')];
  const priceBlocks = c.price(ink, 'START', pal.muted);
  const ctaBlocks = c.cta('AUTO', 'START', ink);
  const gapPic = c.gap(44);
  const minPic = H * (c.tall ? 0.34 : 0.36);
  const maxPic = H * (c.tall ? 0.6 : 0.56);
  const groupedH = c.measure(F.w, first0([...message, ...priceBlocks, ...ctaBlocks]));
  const rowH = c.measure(F.w, first0(message)) + c.gap(34) + Math.max(c.measure(F.w * 0.6, first0(ctaBlocks)), priceBlocks.length ? c.measure(F.w * 0.38, first0(priceBlocks)) : 0);
  // Height the picture leaves for text, measured from the picture's edge to the far edge of the frame.
  const textRoom = (pic: number) => (pictureLow ? H - pic - gapPic - F.y : F.y + F.h - pic - gapPic);
  const grouped = !priceBlocks.length || textRoom(minPic) >= groupedH;
  const need = grouped ? groupedH : rowH;
  const pic = Math.max(minPic, Math.min(maxPic, pictureLow ? H - F.y - need - gapPic : F.y + F.h - need - gapPic));
  if (textRoom(pic) < need) c.overflow += need - textRoom(pic);
  const picRect = pictureLow
    ? inset ? { x: F.x, y: H - pic, w: F.w, h: pic - F.x } : { x: 0, y: H - pic, w: W, h: pic }
    : inset ? { x: F.x, y: F.y, w: F.w, h: pic - F.y } : { x: 0, y: 0, w: W, h: pic };
  pictureArea(c, picRect, inset ? { mask: 'ROUNDED', radius: 6 } : {});
  const region = pictureLow ? { x: F.x, y: F.y, w: F.w, h: H - pic - gapPic - F.y } : { x: F.x, y: pic + gapPic, w: F.w, h: F.y + F.h - pic - gapPic };
  const ids: string[] = [];
  if (grouped) {
    // Message on top; the action group follows it or, when the picture is at its largest, sits at the far edge.
    const top = c.stack(region, first0(message), 'TOP');
    const actionBlocks = first0([...priceBlocks, ...ctaBlocks]);
    const actionH = c.measure(F.w, actionBlocks);
    const slack = region.h - top.used - actionH;
    const actionY = slack > c.gap(34) * 2.5 ? region.y + region.h - actionH : region.y + top.used + c.gap(34);
    const act = c.stack({ x: F.x, y: actionY, w: F.w, h: actionH }, actionBlocks, 'TOP');
    ids.push(...top.ids, ...act.ids);
    if (c.has('RULE_LINES')) c.shape({ shape: 'LINE', rect: { x: F.x + F.w - 120, y: actionY - c.gap(20), w: 120, h: 2 }, fill: mixHex(ink, pal.background, 0.6) });
  } else {
    const top = c.stack(region, first0(message), 'TOP');
    const bottomH = Math.max(c.measure(F.w * 0.6, first0(ctaBlocks)), c.measure(F.w * 0.38, first0(priceBlocks)));
    const bottom = { x: F.x, y: region.y + region.h - bottomH, w: F.w, h: bottomH };
    if (c.has('RULE_LINES')) c.shape({ shape: 'LINE', rect: { x: F.x, y: bottom.y - c.gap(22), w: F.w, h: 2 }, fill: mixHex(ink, pal.background, 0.7) });
    // On one row the price and the button share a baseline: one action, not two islands.
    const cta = c.stack({ ...bottom, w: F.w * 0.6, x: F.x + F.w * 0.4 }, first0(ctaBlocks), 'BOTTOM');
    const price = c.stack({ ...bottom, w: F.w * 0.38 }, first0(priceBlocks), 'BOTTOM');
    ids.push(...top.ids, ...price.ids, ...cta.ids);
  }
  if (c.has('RULE_LINES') && eb) {
    const ebLayer = c.layers.find((l) => l.kind === 'text' && l.role === 'EYEBROW');
    if (ebLayer) c.shape({ shape: 'LINE', rect: { x: F.x + F.w - 120, y: ebLayer.rect.y + ebLayer.rect.h + c.gap(12), w: 120, h: 3 }, fill: pal.accent });
  }
  c.logo({ x: F.x, y: region.y - 4, w: F.w * 0.36, h: c.B.brand * 1.1 }, 'WORDMARK', pal.muted);
  c.path.push(...ids);
  c.decide('composition', `Picture panel ${pictureLow ? 'below' : 'above'} an editorial text column`, `The picture takes the height the copy leaves${pictureLow ? ' and fills the bottom band, where Stories buttons sit' : ''}; ${grouped ? 'price and action read as one group' : 'price and action share one row'}.`);
};

const EDITORIAL_TYPE_ONLY: Method = (c) => {
  const { F, W, H, pal } = c;
  const hasPic = Boolean(c.input.picture);
  const share = hasPic ? (c.tall ? 0.5 : c.square ? 0.46 : 0.54) - (c.relax >= 1 ? 0.08 : 0) : 0;
  // Without a picture the type is the page: the column starts a fifth of the way down and the headline fills it.
  let textTop = hasPic ? F.y : F.y + F.h * (c.tall ? 0.16 : 0.12);
  if (hasPic) {
    const inset = c.has('IMAGE_INSET_FRAME') || c.has('FRAME_BORDER');
    const rect = inset ? { x: F.x, y: F.y, w: F.w, h: (H * share) - F.y } : { x: 0, y: 0, w: W, h: H * share };
    c.image(rect, inset ? { mask: 'ROUNDED', radius: 6 } : {});
    textTop = rect.y + rect.h + c.gap(44);
  }
  const ink = pal.ink;
  const region = { x: F.x, y: textTop, w: F.w, h: F.y + F.h - textTop };
  // Eyebrow and a short rule, then the headline: an editorial reading start.
  const top = c.stack({ ...region, h: region.h * 0.68 }, [...c.eyebrow(pal.accent), c.headline(ink, 'START', hasPic ? { scale: 0.84, gap: c.input.copy.eyebrow ? c.gap(30) : 0 } : { fill: { min: c.B.headline, max: c.B.headline * (c.tall ? 1.9 : 1.6) }, maxLines: 4, gap: c.input.copy.eyebrow ? c.gap(30) : 0 }), ...c.sub(pal.muted, 'START')], 'TOP');
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

/**
 * Bold type with a picture. The headline is set first; the picture takes the height the type leaves (at least a
 * third of the page, so it reads), and the action group goes beside it when it measurably fits there, else under it.
 * The picture is never a small stamp floating in an empty field.
 */
function boldTypePicture(c: Ctx, topY: number, headBlocks: Block[], bottomBlocks: Block[]): void {
  const { F, H } = c;
  const g = c.gap(32);
  const action = first0(bottomBlocks);
  const minPic = H * (c.tall ? 0.24 : 0.3);
  // Beside: the widest line of the action group must fit next to a picture at least half the frame wide.
  const actionW = Math.max(
    ...action.map((b) => measureText(b.text, b.font) + (b.box ? 2 * b.box.padX : 0) + (b.arrow ? b.font.size * 1.1 : 0)),
  );
  const besideW = F.w - actionW - g;
  const beside = besideW >= F.w * 0.5;
  // Beside a tall picture the action alone leaves the column mostly empty: the supporting line moves into the column
  // and opens it, level with the picture's top, so the column is held at both ends (only when it fits there).
  const sub = headBlocks.filter((b) => b.role === 'SUBHEADLINE');
  const headRegion = { x: F.x, y: topY, w: F.w, h: F.y + F.h - topY - minPic - g - c.measure(F.w, action) - g };
  let moveSub = beside && sub.length > 0;
  const saved = c.snapshot();
  let head = c.stack(headRegion, moveSub ? headBlocks.filter((b) => !sub.includes(b)) : headBlocks, 'TOP');
  if (moveSub) {
    // Tried with the supporting line beside the picture; taken back when the column cannot hold it with the action.
    const h = F.y + F.h - (topY + head.used + g);
    const colW = F.w - Math.min(besideW, h * 0.86) - g;
    if (c.measure(colW, [...sub, ...action]) + g > h) {
      c.restore(saved);
      moveSub = false;
      head = c.stack(headRegion, headBlocks, 'TOP');
    }
  }
  const picTop = topY + head.used + g;
  const overlap = c.has('OVERLAPPING_ELEMENTS');
  const mask: ImageLayer['mask'] = c.has('CUTOUT_PRODUCT_ON_COLOR') ? 'CIRCLE' : 'ARCH';
  let rect: Rect;
  let actionRegion: Rect;
  let subIds: string[] = [];
  if (beside) {
    const h = F.y + F.h - picTop;
    const w = mask === 'CIRCLE' ? Math.min(besideW, h) : Math.min(besideW, h * 0.86);
    rect = { x: F.x, y: F.y + F.h - (mask === 'CIRCLE' ? w : h), w, h: mask === 'CIRCLE' ? w : h };
    actionRegion = { x: F.x + w + g, y: picTop, w: F.w - w - g, h: F.y + F.h - picTop };
    if (moveSub) {
      const top = c.stack({ ...actionRegion, y: rect.y }, first0(sub), 'TOP');
      subIds = top.ids;
      actionRegion = { ...actionRegion, y: rect.y + top.used + g, h: F.y + F.h - rect.y - top.used - g };
    }
  } else {
    const actionH = c.measure(F.w, action);
    const h = Math.max(minPic * 0.8, F.y + F.h - actionH - g - picTop);
    const w = mask === 'CIRCLE' ? Math.min(F.w, h) : F.w;
    rect = { x: F.x + (F.w - w) / 2, y: picTop, w, h: mask === 'CIRCLE' ? w : h };
    actionRegion = { x: F.x, y: picTop + rect.h + g, w: F.w, h: F.y + F.h - picTop - rect.h - g };
  }
  if (overlap) rect = { ...rect, x: rect.x - 40, y: Math.max(topY, rect.y - Math.round(rect.h * 0.12)) };
  const pic = c.input.picture!;
  c.image(rect, { mask, radius: Math.min(rect.w / 2, rect.h), focal: subjectFocal(pic, rect) });
  if (rect.h < minPic * 0.8) c.overflow += minPic * 0.8 - rect.h;
  const b = c.stack(actionRegion, action, 'BOTTOM');
  c.path.push(...head.ids, ...subIds, ...b.ids);
  c.decide('composition', 'The headline is set as large as the frame allows; the picture takes the rest', `The picture fills the height the type leaves (${Math.round((rect.h / H) * 100)}% of the page), with the action ${besideW >= F.w * 0.5 ? 'beside it' : 'under it'}.`);
}

const BOLD_TYPE: Method = (c) => {
  const { F, W, pal } = c;
  const ink = readableOn(pal.background, [pal.ink, '#ffffff', '#111111']);
  if (c.has('GEOMETRIC_SHAPES')) {
    const d = W * 0.8;
    c.shape({ shape: 'RING', rect: { x: -d * 0.3, y: c.H - d * 0.7, w: d, h: d }, stroke: { color: pal.accent, width: 18 }, radius: d / 2, opacity: 0.9 });
  }
  const hasPic = Boolean(c.input.picture);
  c.logo({ x: F.x, y: F.y, w: F.w, h: c.B.brand * 1.3 }, 'WORDMARK', ink);
  const topY = F.y + c.B.brand * 1.3 + c.gap(36);
  const bottomBlocks = [...c.price(ink, 'START', pal.accent), ...c.cta(c.has('CTA_AS_TEXT_LINE') ? 'TEXT_LINE' : 'BUTTON', 'START', ink)];
  // Type as image: the headline is set as one tight block, larger and with closed-up lines.
  const asImage = c.has('TYPE_AS_IMAGE');
  const headline = c.headline(ink, 'START', { fill: { min: c.B.headline, max: c.B.headline * (c.tall ? 2.6 : 2.3) * (asImage ? 1.12 : 1) }, maxLines: c.has('STACKED_HEADLINE') ? 5 : 4, twoLines: asImage && c.relax === 0 });
  const headBlocks = [...c.eyebrow(pal.accent), { ...headline, font: asImage ? { ...headline.font, lineHeight: Math.min(headline.font.lineHeight, 0.9) } : headline.font, gap: c.input.copy.eyebrow ? c.gap(20) : 0 }, ...c.sub(ink, 'START')];
  if (hasPic) {
    boldTypePicture(c, topY, headBlocks, bottomBlocks);
    return;
  }
  const bottomReserve = c.measure(F.w, bottomBlocks) + c.gap(36) + (c.input.copy.price && c.has('BADGE_STAMP') ? Math.min(270, F.w * 0.3) + c.gap(20) : 0);
  const headRegion = { x: F.x, y: topY, w: F.w, h: F.h - (topY - F.y) - bottomReserve };
  const head = c.stack(headRegion, headBlocks, 'TOP');
  const b = c.stack({ x: F.x, y: F.y, w: F.w, h: F.h }, bottomBlocks, 'BOTTOM');
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
    // A pale tonal field read as a missing photo; a deep block in the brand's ink reads as a decision.
    const field = mixHex(pal.ink, pal.background, 0.12);
    // The address sits on the picture's top band: darken that band so white type reads on any photo.
    if (hasPic) c.image({ x: 0, y: H - picH, w: W, h: picH }, { mask: 'SLANT_START', overlay: { direction: 'TOP', color: '#000000', from: 0.62, to: 0 } });
    else {
      // No picture: a deep colour block takes its place, cut by an accent rule; the grid stays asymmetric.
      c.shape({ shape: 'RECT', rect: { x: W * 0.18, y: H - picH, w: W * 0.82, h: picH }, fill: field });
      c.shape({ shape: 'RECT', rect: { x: W * 0.18, y: H - picH, w: W * 0.3, h: 16 }, fill: pal.accent });
    }
    c.logo({ x: F.x, y: F.y, w: F.w, h: c.B.brand * 1.3 }, 'WORDMARK', ink);
    // The action sits on the picture's slanted edge; the address goes under it, on the picture's calm band.
    const ctaBlocks = c.cta('BUTTON', 'START', hasPic ? '#ffffff' : readableOn(field, [pal.ink, '#ffffff', '#111111'])).map((b, i) => (i === 0 ? { ...b, gap: 0 } : b));
    const ctaH = c.measure(F.w, ctaBlocks);
    const ctaY = Math.min(H - picH - c.B.cta, F.y + F.h - ctaH);
    // The copy ends above the action, so a large price numeral can never run into the button.
    const regionY = F.y + c.B.brand * 1.3 + c.gap(40);
    const region = { x: F.x, y: regionY, w: F.w * 0.92, h: Math.min(H - picH - F.y - c.B.brand * 1.3 - c.gap(60), ctaY - c.gap(24) - regionY) };
    const s = c.stack(region, [...c.eyebrow(pal.accent), c.headline(ink, 'START', { scale: 1.05, gap: c.input.copy.eyebrow ? c.gap(18) : 0 }), ...c.sub(pal.muted, 'START'), ...c.price(ink, 'START', pal.muted)], 'TOP');
    const cta = c.stack({ x: F.x, y: ctaY, w: F.w, h: ctaH }, ctaBlocks, 'TOP');
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
  // A near-black overlay tinted by the brand: a pale brand background would only grey the photo, not protect the type.
  c.image({ x: 0, y: 0, w: W, h: H }, { treatment: 'DARKEN', overlay: { color: mixHex(pal.background, '#000000', 0.85), from: 0.62, to: 0.25, direction: 'START' } });
  const ink = '#ffffff';
  c.logo({ x: F.x, y: F.y, w: F.w * 0.5, h: c.B.brand * 1.3 }, 'WORDMARK', ink);
  const sub = c.input.copy.subheadline;
  const subBlocks: Block[] = sub ? [{ role: 'SUBHEADLINE', text: sub, font: c.text(c.B.sub, true), color: pal.ink, align: 'START', gap: 0, maxLines: 3, tight: true, maxWidth: F.w * 0.86, box: { fill: pal.surface, radius: 0, padX: 26, padY: 16 } }] : [];
  const bottomBlocks = [...subBlocks, ...c.price(ink, 'START', ink), ...c.cta(c.has('CTA_AS_TEXT_LINE') ? 'TEXT_LINE' : 'BUTTON', 'START', ink)];
  // The headline gets what the bottom group leaves: a big price grows the group upwards, never into the headline.
  const bottomH = Math.max(F.h * 0.42, c.measure(F.w, bottomBlocks));
  const headTop = F.y + F.h * (c.tall ? 0.2 : 0.14);
  const headH = Math.min(F.h * 0.5, F.y + F.h - bottomH - c.gap(30) - headTop);
  const head = c.stack({ x: F.x, y: headTop, w: F.w, h: headH }, [...c.eyebrow(pal.accent), { ...c.headline(ink, 'START', { fill: { min: c.B.headline * 0.95, max: c.B.headline * 1.9 }, maxLines: 3 }), gap: c.input.copy.eyebrow ? c.gap(16) : 0 }], 'TOP');
  if (head.used > headH) c.overflow += head.used - headH;
  const bottom = c.stack({ x: F.x, y: F.y + F.h - bottomH, w: F.w, h: bottomH }, bottomBlocks, 'BOTTOM');
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
    brandMark(ctx);
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
  const flood = input.moves.includes('BRAND_COLOR_FLOOD') || !input.picture;
  ensureReadable(c.layers, flood ? [pal.background, mixHex(pal.background, '#000000', 0.12)] : [pal.background], pal);
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
    background: flood
      ? { kind: 'GRADIENT', color: pal.background, to: mixHex(pal.background, '#000000', 0.12), angle: 160, grain: input.moves.includes('TEXTURE_GRAIN') ? 0.08 : 0 }
      : { kind: 'SOLID', color: pal.background, grain: input.moves.includes('TEXTURE_GRAIN') ? 0.08 : 0 },
    layers: c.layers,
    focal: input.emphasis,
    readingPath: [...new Set(c.path)].filter((id) => c.layers.some((l) => l.id === id)),
    safeArea: fmt.safeArea,
    fit: { status, headlineRatio: Math.round(c.headlineRatio * 100) / 100, notes: [...notes, ...c.notes, ...coverageFlags(c, input), ...c.flags], suggestions: c.suggestions },
    rationale: { decisions: [...(input.decisions ?? []), ...c.decisions], references: input.references ?? [] },
  };
  if (spec.readingPath.length < 2) spec.readingPath = spec.layers.filter((l) => l.kind === 'text').map((l) => l.id).slice(0, 3);
  return CreativeDesignSpecSchema.parse(spec);
}

/** A review flag when, despite the planning, text covers part of a picture's recorded subject. */
function coverageFlags(c: Ctx, input: ComposeInput): string[] {
  const pictures = [input.picture, ...(input.gallery ?? [])].filter((p): p is ComposePicture => Boolean(p));
  return measurePictureUse({ layers: c.layers, width: c.W, height: c.H }, pictures)
    .filter((u) => u.covered >= 0.03)
    .map((u) => `Text covers ${Math.round(u.covered * 100)}% of the subject of ${u.assetId}: check that no face or product is hidden.`);
}

/**
 * Where the brand mark goes is a design move. LOGO_SMALL_CORNER: a smaller wordmark in the top far corner;
 * LOGO_AS_SIGNOFF: the wordmark signs off at the bottom far corner, after the action. The mark only moves to a spot
 * that no text uses and where it can be read (on the page or a solid shape, not on an unprotected photo).
 */
function brandMark(c: Ctx): void {
  const corner = c.has('LOGO_SMALL_CORNER');
  const signoff = c.has('LOGO_AS_SIGNOFF');
  if (!corner && !signoff) return;
  const i = c.layers.findIndex((l) => l.kind === 'logo');
  const logo = c.layers[i];
  if (!logo || logo.kind !== 'logo') return;
  const { F } = c;
  const font = { ...logo.font, size: Math.max(corner ? 26 : 14, Math.round(logo.font.size * (corner ? 0.8 : 1.1))) };
  const w = Math.min(F.w * 0.4, measureText(logo.text, font) + 4);
  const h = Math.round(font.size * 1.25);
  const spots = corner ? [{ x: F.x, y: F.y }, { x: F.x, y: F.y + F.h - h }] : [{ x: F.x, y: F.y + F.h - h }];
  const page = c.input.palette.background;
  for (const s of spots) {
    const r = { x: s.x, y: s.y, w, h };
    const padded = { x: r.x - 16, y: r.y - 16, w: r.w + 32, h: r.h + 32 };
    if (c.layers.some((l, j) => j !== i && ((l.kind === 'text' && overlapArea(inkRect(l), padded) > 0) || (l.kind === 'logo' && overlapArea(l.rect, padded) > 0)))) continue;
    // What is behind the spot: the topmost picture or solid shape under most of it, else the page.
    let behind: string | null = page;
    for (let j = c.layers.length - 1; j >= 0; j--) {
      const u = c.layers[j]!;
      if (j === i || overlapArea(u.rect, r) < r.w * r.h * 0.5) continue;
      if (u.kind === 'shape' && u.fill && u.opacity >= 0.85 && u.shape !== 'LINE' && u.shape !== 'RING') {
        behind = u.fill;
        break;
      }
      if (u.kind === 'image') {
        const o = u.overlay;
        const strong = o && ((o.direction === 'TOP' && r.y < c.H * 0.3) || (o.direction === 'BOTTOM' && r.y > c.H * 0.7) || o.direction === 'EVEN') && o.from >= 0.5;
        behind = strong ? mixHex('#808080', o.color, o.from) : null;
        break;
      }
    }
    if (!behind) continue;
    c.layers[i] = { ...logo, rect: round(r), font: { ...font, weight: nearestWeight(font.family, font.weight) }, color: readableOn(behind, [c.input.palette.muted, c.input.palette.ink, '#ffffff', '#111111']) };
    c.decide('brand mark', corner ? 'A small wordmark in the top far corner' : 'The wordmark signs off at the bottom far corner', corner ? 'The references keep the brand quiet so the message leads.' : 'The brand closes the reading path, after the action.');
    return;
  }
  c.decide('brand mark', 'The wordmark stays where the composition put it', 'The corner the references suggest is taken by copy or sits on an unprotected photo.');
}

/**
 * Every text layer must meet contrast against what is behind it: 3:1 for large type, 4.5:1 otherwise. Behind means
 * the topmost layer covering at least half of it (the Critic's rule): a solid shape, a protected photo (modelled as
 * mid-grey under its overlay, as the Critic models it) or the page. A colour that misses (an accent eyebrow on a pale
 * page) takes the most readable ink instead. Unprotected photos are left to the Critic, which flags them.
 */
function ensureReadable(layers: DesignLayer[], page: readonly string[], pal: SpecPalette): void {
  const shared = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  layers.forEach((l, i) => {
    if (l.kind !== 'text' || l.box?.fill) return;
    let behind: readonly string[] = page;
    for (let j = i - 1; j >= 0; j--) {
      const u = layers[j]!;
      if (shared(u.rect, l.rect) < l.rect.w * l.rect.h * 0.5) continue;
      if (u.kind === 'shape' && u.fill && u.opacity >= 0.85 && u.shape !== 'LINE' && u.shape !== 'RING') {
        behind = [u.fill];
        break;
      }
      if (u.kind === 'image') {
        const o = u.overlay;
        const strength = Math.max(o?.from ?? 0, o?.to ?? 0);
        if (u.treatment !== 'DARKEN' && strength < 0.35) return;
        behind = [o ? mixHex('#808080', o.color, strength) : '#808080'];
        break;
      }
    }
    const min = l.font.size >= 40 ? 3 : 4.5;
    if (behind.every((b) => contrastRatio(l.color, b) >= min)) return;
    const worst = [...behind].sort((a, b) => contrastRatio(l.color, a) - contrastRatio(l.color, b))[0]!;
    l.color = readableOn(worst, [pal.ink, '#ffffff', '#111111']);
  });
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
