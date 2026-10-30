import { afterAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Thumbnail } from '@remotion/player';
import {
  LayoutFamilySchema,
  STATIC_AD_FORMATS,
  designFor,
  staticAdLayout,
  type StaticAdDesign,
  type StaticAdFormat,
  type StaticAdRenderInput,
  type StaticAdText,
} from '@kampora/shared';
import { KamporaStaticAd } from './StaticAd';
import { ChromeLayout, leftToRight, visualOrderRtl, type CharBox } from '../../test/chrome-layout';

/**
 * Static ads rendered in headless Chrome: every text block must stay inside the format's safe area, the top and
 * bottom blocks must never collide, and Hebrew must read right-to-left exactly like the video overlays.
 */

const TYPICAL: StaticAdText = {
  headline: 'רגע, ראיתם את המבצע ב-Luz?',
  subheadline: 'קולים את הפולים בעצמנו, ומאפים טריים כל בוקר',
  price: { price: '29.90 ₪', label: 'קפה + מאפה' },
  cta: 'בואו לנצל את המבצע',
  ctaSubtext: 'פלורנטין 12, תל אביב',
  showLogo: true,
};

/** Every layer at its schema maximum or close to it. */
const WORST: StaticAdText = {
  headline: 'הבוקר הכי טעים בפלורנטין מחכה לכם עם קפה טרי ומאפים חמים מהתנור',
  subheadline:
    'קולים את הפולים בעצמנו כל בוקר, אופים במקום ומגישים עם חיוך, כי לבוקר טוב באמת מגיע קפה טוב באמת',
  price: { price: '129.90 ₪', label: 'ארוחת בוקר זוגית' },
  cta: 'הזמינו שולחן עוד היום',
  ctaSubtext: 'רחוב פלורנטין 12, תל אביב-יפו',
  showLogo: true,
};

const BRAND = {
  primary: '#2B1B12',
  secondary: '#C8743A',
  accent: '#F2C14E',
  background: '#FBF5EC',
  text: '#1C140F',
};

/** A plain 4:3 picture: layout must not depend on what the picture shows. */
const PICTURE_URL =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200"><rect width="1600" height="1200" fill="#8a6a4a"/></svg>',
  ).toString('base64');

function input(
  format: StaticAdFormat,
  text: StaticAdText,
  design?: StaticAdDesign,
  picture = false,
): StaticAdRenderInput {
  const size = STATIC_AD_FORMATS[format];
  return {
    assetUrls: picture ? { pic: PICTURE_URL } : {},
    ad: {
      schemaVersion: 1,
      id: `layout-${format}`,
      format,
      width: size.width,
      height: size.height,
      locale: 'he-IL',
      direction: 'rtl',
      safeArea: size.safeArea,
      branding: {
        businessName: 'Luz',
        colors: BRAND,
        fontFamily: 'Heebo',
      },
      background: { focalPoint: { x: 0.5, y: 0.45 }, ...(picture ? { assetId: 'pic' } : {}) },
      text,
      ...(design ? { design } : {}),
      assets: picture
        ? [
            {
              id: 'pic',
              kind: 'image',
              storageKey: 'test/pic.svg',
              mimeType: 'image/svg+xml',
              width: 1600,
              height: 1200,
              provenance: { source: 'UPLOAD', license: 'owner', commercialUse: true },
            },
          ]
        : [],
    },
  };
}

const chrome = await ChromeLayout.launch();
afterAll(() => chrome?.close());

const LAYERS = ['logo', 'headline', 'subheadline', 'price-label', 'price', 'cta', 'cta-subtext'] as const;

async function layout(format: StaticAdFormat, text: StaticAdText, design?: StaticAdDesign, picture = false) {
  const { width, height } = STATIC_AD_FORMATS[format];
  await chrome!.setBody(
    renderToStaticMarkup(
      <Thumbnail
        component={KamporaStaticAd}
        inputProps={input(format, text, design, picture)}
        compositionWidth={width}
        compositionHeight={height}
        durationInFrames={1}
        fps={30}
        frameToDisplay={0}
      />,
    ),
  );
  const boxes: Partial<Record<(typeof LAYERS)[number], CharBox[]>> = {};
  for (const layer of LAYERS) {
    const found = await chrome!.charBoxes(`[data-kampora-text="${layer}"]`).catch(() => undefined);
    // The invisible word joiner that keeps "ב-Luz" together is not part of the reading order.
    if (found) boxes[layer] = found.filter((b) => b.ch !== String.fromCharCode(0x2060));
  }
  return boxes;
}

const FORMATS = ['1:1', '4:5', '9:16'] as const;

describe.skipIf(!chrome)('static ad layout (headless Chrome)', () => {
  it.each(FORMATS.flatMap((f) => [[f, 'typical', TYPICAL] as const, [f, 'worst-case', WORST] as const]))(
    '%s %s text stays inside the safe area without collisions',
    async (format, _name, text) => {
      const { width, height, safeArea } = STATIC_AD_FORMATS[format];
      const boxes = await layout(format, text);
      for (const [layer, chars] of Object.entries(boxes)) {
        for (const b of chars!) {
          // Spaces at a line wrap hang past the edge without painting anything.
          if (/\s/.test(b.ch) || b.right <= b.left) continue;
          expect.soft(b.left, `${layer} "${b.ch}" left`).toBeGreaterThanOrEqual(safeArea.sidePx - 1);
          expect.soft(b.right, `${layer} "${b.ch}" right`).toBeLessThanOrEqual(width - safeArea.sidePx + 1);
          expect.soft(b.top, `${layer} "${b.ch}" top`).toBeGreaterThanOrEqual(safeArea.topPx - 1);
          expect
            .soft(b.bottom, `${layer} "${b.ch}" bottom`)
            .toBeLessThanOrEqual(height - safeArea.bottomPx + 1);
        }
      }
      const bottomOfTop = Math.max(
        ...[...boxes.headline!, ...(boxes.subheadline ?? [])].map((b) => b.bottom),
      );
      const topOfBottom = Math.min(
        ...[...(boxes['price-label'] ?? []), ...(boxes.price ?? []), ...boxes.cta!].map((b) => b.top),
      );
      expect(topOfBottom - bottomOfTop).toBeGreaterThan(text === WORST ? 0 : 40);
    },
  );

  it('reads right-to-left like the video overlays', async () => {
    const boxes = await layout('4:5', TYPICAL);
    expect(visualOrderRtl(boxes.headline!)).toEqual(['רגע,', 'ראיתם', 'את', 'המבצע', 'ב-Luz?']);
    expect(leftToRight(boxes.headline!, 'ב-Luz')).toBe('Luz-ב');
    expect(leftToRight(boxes.price!, '29.90 ₪')).toBe('₪ 29.90');
    expect(visualOrderRtl(boxes['price-label']!)).toEqual(['קפה', '+', 'מאפה']);
    expect(visualOrderRtl(boxes.cta!)).toEqual(['בואו', 'לנצל', 'את', 'המבצע']);
    expect(visualOrderRtl(boxes['cta-subtext']!)).toEqual(['פלורנטין', '12,', 'תל', 'אביב']);
    expect(leftToRight(boxes.logo!, 'Luz')).toBe('Luz');
  });
});

type Box = { left: number; right: number; top: number; bottom: number };
const bounds = (chars: CharBox[]): Box => ({
  left: Math.min(...chars.map((b) => b.left)),
  right: Math.max(...chars.map((b) => b.right)),
  top: Math.min(...chars.map((b) => b.top)),
  bottom: Math.max(...chars.map((b) => b.bottom)),
});
/**
 * Character boxes span the font's whole content area (≈1.47em for Heebo), taller than the line height, so stacked
 * lines always "touch". Ink sits well inside it: compare boxes trimmed by 15% of their height top and bottom.
 */
const ink = (b: Box): Box => {
  const trim = (b.bottom - b.top) * 0.15;
  return { ...b, top: b.top + trim, bottom: b.bottom - trim };
};
const overlap = (a: Box, b: Box) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;

const FAMILIES = LayoutFamilySchema.options;

describe.skipIf(!chrome)('designed static ads: every layout family (headless Chrome)', () => {
  const cases = FAMILIES.flatMap((family) =>
    FORMATS.flatMap((format) =>
      [true, false].flatMap((picture) =>
        [
          [family, format, picture ? 'picture' : 'no picture', 'typical', TYPICAL] as const,
          [family, format, picture ? 'picture' : 'no picture', 'worst-case', WORST] as const,
        ].map((c) => [...c, picture] as const),
      ),
    ),
  );

  it.each(cases)(
    '%s %s (%s, %s text): inside the safe area, no overlaps, picture uncovered',
    async (family, format, _p, _t, text, picture) => {
      const { width, height, safeArea } = STATIC_AD_FORMATS[format];
      const design = designFor(family, format, BRAND, picture);
      const boxes = await layout(format, text, design, picture);
      expect(boxes.headline, 'headline rendered').toBeDefined();
      expect(boxes.cta, 'cta rendered').toBeDefined();
      const painted = Object.entries(boxes).map(
        ([layer, chars]) => [layer, chars!.filter((b) => !/\s/.test(b.ch) && b.right > b.left)] as const,
      );
      for (const [layer, chars] of painted) {
        for (const b of chars) {
          expect.soft(b.left, `${layer} "${b.ch}" left`).toBeGreaterThanOrEqual(safeArea.sidePx - 1);
          expect.soft(b.right, `${layer} "${b.ch}" right`).toBeLessThanOrEqual(width - safeArea.sidePx + 1);
          expect.soft(b.top, `${layer} "${b.ch}" top`).toBeGreaterThanOrEqual(safeArea.topPx - 1);
          expect
            .soft(b.bottom, `${layer} "${b.ch}" bottom`)
            .toBeLessThanOrEqual(height - safeArea.bottomPx + 1);
        }
      }
      // No two text layers paint over each other.
      const blocks = painted.filter(([, c]) => c.length).map(([layer, c]) => [layer, bounds(c)] as const);
      for (let i = 0; i < blocks.length; i++)
        for (let j = i + 1; j < blocks.length; j++)
          expect
            .soft(
              overlap(ink(blocks[i]![1]), ink(blocks[j]![1])),
              `${blocks[i]![0]} overlaps ${blocks[j]![0]}`,
            )
            .toBe(false);
      // A picture panel is never covered by text (the product stays visible).
      const image = staticAdLayout({ ...input(format, text, design, picture).ad, design }).image;
      if (picture && design.image.mode === 'PANEL' && image) {
        const rect = {
          left: image.x,
          right: image.x + image.width,
          top: image.y,
          bottom: image.y + image.height,
        };
        for (const [layer, box] of blocks)
          expect.soft(overlap(box, rect), `${layer} covers the picture`).toBe(false);
      }
    },
  );

  it('keeps Hebrew reading right-to-left in a designed layout', async () => {
    const design = designFor('SPLIT', '4:5', BRAND, true);
    const boxes = await layout('4:5', TYPICAL, design, true);
    expect(visualOrderRtl(boxes.headline!)).toEqual(['רגע,', 'ראיתם', 'את', 'המבצע', 'ב-Luz?']);
    expect(leftToRight(boxes.price!, '29.90 ₪')).toBe('₪ 29.90');
    expect(visualOrderRtl(boxes.cta!)).toEqual(['בואו', 'לנצל', 'את', 'המבצע']);
  });
});
