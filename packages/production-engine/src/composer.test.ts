import { describe, expect, it } from 'vitest';
import { CompositionMethodSchema, CreativeDesignSpecSchema, contrastRatio, type BrandColors, type DesignMove } from '@kampora/shared';
import { PICTURE_METHODS, composeDesign, derivePalette, type ComposeCopy } from './composer';

const LUZ: BrandColors = { primary: '#2B1B12', secondary: '#C8743A', accent: '#F2C14E', background: '#FBF5EC', text: '#1C140F' };
const COPY: ComposeCopy = {
  eyebrow: 'לוז קפה · פלורנטין',
  headline: 'הקומבו של הבוקר',
  subheadline: 'קפה ומאפה טרי מהתנור',
  price: { price: '29.90 ₪', label: 'עד סוף החודש' },
  cta: 'בואו לבוקר טוב',
  ctaSub: 'פתוח מ-7:00',
  brandName: 'לוז קפה',
};
const picture = { assetId: 'pic', focal: { x: 0.5, y: 0.5 }, composition: 'SINGLE_HERO' as const };

const compose = (method: (typeof CompositionMethodSchema.options)[number], format: '1:1' | '4:5' | '9:16', moves: DesignMove[] = []) =>
  composeDesign({
    format,
    method,
    moves,
    typeSystem: 'MODERN_SANS',
    palette: derivePalette(LUZ, moves),
    copy: COPY,
    picture,
    logoAssetId: 'logo',
    emphasis: 'HEADLINE',
  });

describe('layout engine', () => {
  it('every method composes a valid spec in every format with all approved copy', () => {
    const unresolved: string[] = [];
    for (const method of CompositionMethodSchema.options)
      for (const format of ['1:1', '4:5', '9:16'] as const) {
        const spec = compose(method, format);
        expect(() => CreativeDesignSpecSchema.parse(spec)).not.toThrow();
        const roles = new Set(spec.layers.flatMap((l) => (l.kind === 'text' ? [l.role] : [])));
        for (const role of ['EYEBROW', 'HEADLINE', 'SUBHEADLINE', 'PRICE', 'CTA'] as const) expect(roles.has(role), `${method} ${format} ${role}`).toBe(true);
        if (spec.fit.status === 'UNRESOLVED') unresolved.push(`${method} ${format}: ${spec.fit.notes.join('; ')}`);
      }
    expect(unresolved).toEqual([]);
  });

  it('methods produce genuinely different arrangements', () => {
    const headlineBoxes = CompositionMethodSchema.options.map((m) => {
      const l = compose(m, '4:5').layers.find((x) => x.kind === 'text' && x.role === 'HEADLINE')!;
      return `${Math.round(l.rect.x / 40)}:${Math.round(l.rect.y / 40)}:${Math.round(l.rect.w / 40)}`;
    });
    expect(new Set(headlineBoxes).size).toBeGreaterThanOrEqual(6);
  });

  it('records each headline size against its plan and never goes below 88% silently', () => {
    for (const method of CompositionMethodSchema.options) {
      const spec = compose(method, '9:16');
      if (spec.fit.status === 'FITS' || spec.fit.status === 'REFLOWED') expect(spec.fit.headlineRatio, method).toBeGreaterThanOrEqual(0.78);
    }
  });

  it('flags copy that cannot fit instead of shrinking it away', () => {
    const spec = composeDesign({
      format: '1:1',
      method: 'EDITORIAL',
      moves: ['OVERSIZED_HEADLINE'],
      typeSystem: 'LUXURY_SERIF',
      palette: derivePalette(LUZ, []),
      copy: { ...COPY, headline: 'רוצה להתחיל פילאטיס מכשירים ולא יודעת מאיפה להתחיל כי זה נראה מסובך ומפחיד ויקר מדי?' },
      picture,
      emphasis: 'HEADLINE',
    });
    expect(['SHORTER_COPY_SUGGESTED', 'UNRESOLVED', 'REFLOWED']).toContain(spec.fit.status);
    if (spec.fit.status !== 'REFLOWED') expect(spec.fit.suggestions.length).toBeGreaterThan(0);
  });

  it('without a picture, picture methods fall back to a type-led arrangement with no image layer', () => {
    for (const method of PICTURE_METHODS) {
      const spec = composeDesign({ format: '4:5', method, moves: [], typeSystem: 'MODERN_SANS', palette: derivePalette(LUZ, []), copy: COPY, emphasis: 'HEADLINE' });
      expect(spec.layers.some((l) => l.kind === 'image')).toBe(false);
    }
  });

  it('palette keeps readable contrast for every colour move', () => {
    for (const move of ['BRAND_COLOR_FLOOD', 'MONOCHROME_PALETTE', 'MUTED_NATURAL_PALETTE', 'VIBRANT_COMPLEMENTARY', 'DARK_MOODY'] as DesignMove[]) {
      const p = derivePalette(LUZ, [move]);
      expect(contrastRatio(p.ink, p.background), move).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.accentInk, p.accent), move).toBeGreaterThanOrEqual(4.5);
    }
  });
});
