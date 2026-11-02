import { describe, expect, it } from 'vitest';
import type { BrandColors, CompositionMethod, DesignLayer, DesignMove, StaticAdFormat } from '@kampora/shared';
import { composeDesign, derivePalette, measurePictureUse, pictureBoxOnPage, subjectFocal, type ComposeCopy, type ComposePicture } from './composer';

const BRAND: BrandColors = { primary: '#1F2A2E', secondary: '#B9A58C', accent: '#F2B45C', background: '#F4EFE9', text: '#1A1A1A' };
const COPY: ComposeCopy = {
  eyebrow: 'נשימה · פילאטיס מכשירים',
  headline: 'פילאטיס בקצב שלך',
  subheadline: 'קבוצות של עד 6 מתאמנות, עם מדריכות מוסמכות.',
  price: { price: '49 ₪', label: 'שיעור ניסיון' },
  cta: 'שריינו שיעור ניסיון',
  ctaSub: 'מוריה 40, חיפה',
  brandName: 'נשימה',
};
// A portrait group photo whose people fill the middle of the frame (as recorded by hand for the Q7 showcase).
const GROUP: ComposePicture = { assetId: 'group', focal: { x: 0.5, y: 0.5 }, aspect: 2 / 3, composition: 'LIFESTYLE', negativeSpace: 'TOP', people: 'GROUP', subject: { x: 0.03, y: 0.25, w: 0.97, h: 0.6 } };
const HERO: ComposePicture = { assetId: 'hero', focal: { x: 0.5, y: 0.5 }, aspect: 2 / 3, composition: 'LIFESTYLE', negativeSpace: 'TOP', people: 'ONE', subject: { x: 0.02, y: 0.39, w: 0.98, h: 0.45 } };
const DETAIL: ComposePicture = { assetId: 'detail', focal: { x: 0.5, y: 0.5 }, aspect: 2 / 3, composition: 'DETAIL', negativeSpace: 'TOP', people: 'NONE', subject: { x: 0, y: 0.44, w: 0.96, h: 0.56 } };

const compose = (method: CompositionMethod, format: StaticAdFormat, moves: DesignMove[], picture?: ComposePicture, gallery?: ComposePicture[]) =>
  composeDesign({
    format,
    method,
    moves,
    typeSystem: 'MODERN_SANS',
    palette: derivePalette(BRAND, moves),
    copy: COPY,
    ...(picture ? { picture } : {}),
    ...(gallery ? { gallery } : {}),
    logoAssetId: 'logo',
    emphasis: 'HEADLINE',
  });

type TextLayer = Extract<DesignLayer, { kind: 'text' }>;
const texts = (layers: DesignLayer[]) => layers.filter((l): l is TextLayer => l.kind === 'text');
const role = (layers: DesignLayer[], r: string) => texts(layers).find((l) => l.role === r)!;
const images = (layers: DesignLayer[]) => layers.filter((l): l is Extract<DesignLayer, { kind: 'image' }> => l.kind === 'image');

describe('picture geometry (mirrors the renderer: cover, focal point, zoom)', () => {
  it('maps a subject box from the source picture onto the page', () => {
    // A square picture in a 1000×500 frame: it is drawn 1000×1000 and, centred, shifted up by 250.
    const at = pictureBoxOnPage({ aspect: 1 }, { x: 0, y: 100, w: 1000, h: 500 }, { x: 0.5, y: 0.5 }, 1, { x: 0, y: 0.5, w: 1, h: 0.5 })!;
    expect(at.full).toEqual({ x: 0, y: 350, w: 1000, h: 500 });
    expect(at.visible).toEqual({ x: 0, y: 350, w: 1000, h: 250 });
    // Zoom scales around the focal point.
    const zoomed = pictureBoxOnPage({ aspect: 1 }, { x: 0, y: 0, w: 1000, h: 1000 }, { x: 0.5, y: 0.5 }, 2, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 })!;
    expect(zoomed.full).toEqual({ x: 0, y: 0, w: 1000, h: 1000 });
  });

  it('is not measured without the picture proportions', () => {
    expect(pictureBoxOnPage({}, { x: 0, y: 0, w: 10, h: 10 }, { x: 0.5, y: 0.5 }, 1, { x: 0, y: 0, w: 1, h: 1 })).toBeUndefined();
  });

  it('crops toward the subject, as far as the frame allows', () => {
    const f = subjectFocal({ assetId: 'p', focal: { x: 0.3, y: 0.5 }, aspect: 1, subject: { x: 0, y: 0.6, w: 1, h: 0.3 } }, { x: 0, y: 0, w: 1000, h: 500 });
    expect(f).toEqual({ x: 0.3, y: 1 });
  });
});

describe('subject-safe text', () => {
  it('text over a picture with a recorded subject never covers the people', () => {
    for (const method of ['IMAGE_FIRST', 'LIFESTYLE'] as const)
      for (const format of ['4:5', '9:16'] as const)
        for (const pic of [GROUP, HERO]) {
          const spec = compose(method, format, ['FULL_BLEED_IMAGE', 'PEOPLE_AS_HERO'], pic);
          const use = measurePictureUse(spec, [pic]);
          expect(use.length, `${method} ${format} ${pic.assetId}`).toBeGreaterThan(0);
          for (const u of use) expect(u.covered, `${method} ${format} ${pic.assetId}`).toBeLessThan(0.03);
          expect(spec.fit.notes.some((n) => n.startsWith('Text covers')), `${method} ${format}`).toBe(false);
        }
  });

  it('without recorded subject coordinates nothing is invented: the design is flagged for review', () => {
    const plain: ComposePicture = { assetId: 'plain', focal: { x: 0.5, y: 0.5 }, composition: 'LIFESTYLE' };
    const spec = compose('IMAGE_FIRST', '4:5', ['FULL_BLEED_IMAGE'], plain);
    expect(spec.fit.notes.some((n) => n.includes('not recorded'))).toBe(true);
    expect(measurePictureUse(spec, [plain])).toEqual([]);
  });

  it('a collage keeps both pictures and their subjects visible', () => {
    const spec = compose('IMAGE_FIRST', '4:5', ['SPLIT_PANEL', 'COLLAGE_GRID', 'PEOPLE_AS_HERO'], GROUP, [HERO, DETAIL]);
    const shown = images(spec.layers).map((l) => l.assetId);
    expect(shown).toContain('group');
    expect(shown).toContain('detail');
    for (const u of measurePictureUse(spec, [GROUP, DETAIL])) {
      expect(u.covered).toBeLessThan(0.03);
      expect(u.kept).toBeGreaterThan(0.5);
    }
  });
});

describe('composition rules', () => {
  it('editorial 9:16: the price sits with the action and no large empty band is left', () => {
    const spec = compose('EDITORIAL', '9:16', ['GENEROUS_NEGATIVE_SPACE'], HERO);
    const price = role(spec.layers, 'PRICE');
    const cta = role(spec.layers, 'CTA');
    expect(cta.rect.y - (price.rect.y + price.rect.h)).toBeLessThan(spec.height * 0.06);
    // Vertical gaps between content inside the safe frame (text and pictures, sorted top to bottom).
    const top = spec.height * 0.14;
    const bottom = spec.height * 0.8;
    const boxes = [...texts(spec.layers).map((l) => l.rect), ...images(spec.layers).map((l) => l.rect)]
      .map((r) => ({ y0: Math.max(top, r.y), y1: Math.min(bottom, r.y + r.h) }))
      .filter((r) => r.y1 > r.y0)
      .sort((a, b) => a.y0 - b.y0);
    let reach = top;
    let gap = 0;
    for (const b of boxes) {
      gap = Math.max(gap, b.y0 - reach);
      reach = Math.max(reach, b.y1);
    }
    gap = Math.max(gap, bottom - reach);
    expect(gap).toBeLessThan(spec.height * 0.08);
  });

  it('bold type with a picture: the picture reads, and the action sits beside it or under it', () => {
    for (const format of ['4:5', '9:16'] as const) {
      const spec = compose('BOLD_TYPE', format, ['BRAND_COLOR_FLOOD', 'MINIMAL_COPY'], HERO);
      const pic = images(spec.layers)[0]!;
      expect(pic.rect.h, format).toBeGreaterThanOrEqual(spec.height * 0.24 * 0.8);
      const cta = role(spec.layers, 'CTA');
      const beside = cta.rect.x >= pic.rect.x + pic.rect.w - 1;
      const under = cta.rect.y >= pic.rect.y + pic.rect.h - 1;
      expect(beside || under, format).toBe(true);
      if (beside) {
        // The column beside the picture is held at both ends: the supporting line opens it, level with the picture.
        const sub = role(spec.layers, 'SUBHEADLINE');
        expect(Math.abs(sub.rect.y - pic.rect.y), format).toBeLessThan(4);
      }
    }
  });

  it('type as image sets the headline as a block of two lines', () => {
    // Without a picture the plain headline breaks wherever the fill puts it; type as image sets two balanced lines,
    // closed up into one block.
    const plain = role(compose('BOLD_TYPE', '4:5', ['BRAND_COLOR_FLOOD']).layers, 'HEADLINE');
    const block = compose('BOLD_TYPE', '4:5', ['BRAND_COLOR_FLOOD', 'TYPE_AS_IMAGE']);
    const head = role(block.layers, 'HEADLINE');
    expect(plain.lines).toHaveLength(3);
    expect(head.lines).toEqual(['פילאטיס', 'בקצב שלך']);
    expect(head.font.lineHeight).toBeLessThanOrEqual(0.9);
    expect(head.font.lineHeight).toBeLessThan(plain.font.lineHeight);
    expect(block.fit.headlineRatio).toBeGreaterThanOrEqual(0.88);
  });

  it('a small-corner logo moves to a free corner and stays readable', () => {
    const base = compose('EDITORIAL', '4:5', [], HERO);
    const corner = compose('EDITORIAL', '4:5', ['LOGO_SMALL_CORNER'], HERO);
    const logo = (l: DesignLayer[]) => l.find((x): x is Extract<DesignLayer, { kind: 'logo' }> => x.kind === 'logo')!;
    expect(logo(corner.layers).rect).not.toEqual(logo(base.layers).rect);
    expect(logo(corner.layers).font.size).toBeGreaterThanOrEqual(26);
  });
});
