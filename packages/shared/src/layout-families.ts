import { contrastRatio, mixHex, readableOn } from './color';
import type { BrandColors } from './common';
import type { LayoutFamily, StaticAdDesign, StaticAdFormat } from './static-ad';

/**
 * The tested parameters of each layout family per format, and a contrast-checked palette from the brand colors.
 * The Art Director chooses the family; these recipes turn the choice into a renderer-facing StaticAdDesign.
 */
/** Readable palette from the brand colors for a surface (contrast-checked; never invented colors). */
function palette(c: BrandColors, surface: StaticAdDesign['surface'], field: 'background' | 'primary') {
  const base = surface === 'SCRIM' ? '#111111' : field === 'primary' ? c.primary : c.background;
  const text = surface === 'SCRIM' ? '#ffffff' : readableOn(base, [c.text, c.background, c.primary]);
  const accent =
    contrastRatio(c.accent, base) >= 1.8 ? c.accent : readableOn(base, [c.secondary, c.accent, c.primary], 3);
  return {
    field: base,
    text,
    muted: mixHex(text, base, 0.3),
    accent,
    accentText: readableOn(accent, [c.primary, c.text, '#ffffff', '#111111']),
  };
}

type Recipe = Omit<StaticAdDesign, 'palette' | 'layoutFamily'> & { field: 'background' | 'primary' };

/** The tested parameters of each family per format (side by side in a square, stacked in tall formats). */
function recipe(family: LayoutFamily, format: StaticAdFormat, hasPicture: boolean): Recipe {
  const tall = format !== '1:1';
  switch (family) {
    case 'EDITORIAL_PRODUCT':
      return {
        image: tall
          ? { mode: 'PANEL', edge: 'TOP', share: 0.5 }
          : { mode: 'PANEL', edge: 'START', share: 0.5 },
        textZone: 'CENTER',
        align: 'START',
        surface: 'FIELD',
        field: 'background',
        headlineScale: 1.15,
        headlineWeight: 800,
        price: 'INLINE',
        cta: 'TEXT',
        logo: 'WORDMARK',
      };
    case 'PREMIUM_MINIMAL':
      return {
        image: { mode: hasPicture ? 'INSET' : 'NONE' },
        textZone: 'CENTER',
        align: 'CENTER',
        surface: 'FIELD',
        field: 'background',
        headlineScale: 0.85,
        headlineWeight: 700,
        price: 'INLINE',
        cta: 'TEXT',
        logo: 'WORDMARK',
      };
    case 'OFFER_RETAIL':
      // The offer block sits on the brand field, the product below (or beside) it: the stamp never covers it.
      return {
        image: tall
          ? { mode: 'PANEL', edge: 'BOTTOM', share: format === '9:16' ? 0.36 : 0.4 }
          : { mode: 'PANEL', edge: 'END', share: 0.42 },
        textZone: 'CENTER',
        align: 'CENTER',
        surface: 'FIELD',
        field: 'primary',
        headlineScale: 1.05,
        headlineWeight: 900,
        price: 'STAMP',
        cta: 'BAR',
        logo: 'BADGE',
      };
    case 'LIFESTYLE_PHOTO':
      return {
        image: { mode: 'FULL_BLEED' },
        textZone: 'BOTTOM',
        align: 'START',
        surface: 'SCRIM',
        field: 'primary',
        headlineScale: 1,
        headlineWeight: 800,
        price: 'BADGE',
        cta: 'PILL',
        logo: 'WORDMARK',
      };
    case 'BOLD_TYPOGRAPHIC':
      return {
        image: { mode: hasPicture && tall ? 'PANEL' : 'NONE', edge: 'BOTTOM', share: 0.32 },
        textZone: 'CENTER',
        align: 'START',
        surface: 'FIELD',
        field: 'primary',
        headlineScale: 1.4,
        headlineWeight: 900,
        price: 'HERO',
        cta: 'BAR',
        logo: 'WORDMARK',
      };
    case 'PRODUCT_SHOWCASE':
      return {
        image: tall
          ? { mode: 'PANEL', edge: 'TOP', share: format === '9:16' ? 0.5 : 0.55 }
          : { mode: 'PANEL', edge: 'END', share: 0.5 },
        textZone: tall ? 'BOTTOM' : 'CENTER',
        align: 'CENTER',
        surface: 'FIELD',
        field: 'background',
        headlineScale: 0.95,
        headlineWeight: 800,
        price: 'BADGE',
        cta: 'PILL',
        logo: 'WORDMARK',
      };
    case 'SPLIT':
      return {
        image: tall
          ? { mode: 'PANEL', edge: 'TOP', share: format === '9:16' ? 0.45 : 0.5 }
          : { mode: 'PANEL', edge: 'START', share: 0.5 },
        textZone: 'SPLIT',
        align: 'START',
        surface: 'FIELD',
        field: 'primary',
        headlineScale: 1.1,
        headlineWeight: 900,
        price: 'BADGE',
        cta: 'BAR',
        logo: 'WORDMARK',
      };
    case 'LOCAL_PROMO':
      return {
        image: { mode: hasPicture ? 'FULL_BLEED' : 'NONE' },
        textZone: 'SPLIT',
        align: 'CENTER',
        surface: hasPicture ? 'PANEL' : 'FIELD',
        field: 'background',
        headlineScale: 1,
        headlineWeight: 900,
        price: 'BADGE',
        cta: 'PILL',
        logo: 'BADGE',
      };
  }
}

export function designFor(
  family: LayoutFamily,
  format: StaticAdFormat,
  colors: BrandColors,
  hasPicture: boolean,
): StaticAdDesign {
  const { field, ...r } = recipe(family, format, hasPicture);
  const image = { ...r.image };
  if (!hasPicture) {
    image.mode = 'NONE';
    delete image.edge;
    delete image.share;
  }
  // Without a picture a scrim has nothing to sit on: the brand field carries the text.
  const surface = !hasPicture && r.surface !== 'FIELD' ? 'FIELD' : r.surface;
  return { ...r, image, surface, layoutFamily: family, palette: palette(colors, surface, field) };
}
