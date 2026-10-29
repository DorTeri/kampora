import { afterAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Thumbnail } from '@remotion/player';
import {
  STATIC_AD_FORMATS,
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

function input(format: StaticAdFormat, text: StaticAdText): StaticAdRenderInput {
  const size = STATIC_AD_FORMATS[format];
  return {
    assetUrls: {},
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
        colors: {
          primary: '#2B1B12',
          secondary: '#C8743A',
          accent: '#F2C14E',
          background: '#FBF5EC',
          text: '#1C140F',
        },
        fontFamily: 'Heebo',
      },
      background: { focalPoint: { x: 0.5, y: 0.45 } },
      text,
      assets: [],
    },
  };
}

const chrome = await ChromeLayout.launch();
afterAll(() => chrome?.close());

const LAYERS = ['logo', 'headline', 'subheadline', 'price-label', 'price', 'cta', 'cta-subtext'] as const;

async function layout(format: StaticAdFormat, text: StaticAdText) {
  const { width, height } = STATIC_AD_FORMATS[format];
  await chrome!.setBody(
    renderToStaticMarkup(
      <Thumbnail
        component={KamporaStaticAd}
        inputProps={input(format, text)}
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
