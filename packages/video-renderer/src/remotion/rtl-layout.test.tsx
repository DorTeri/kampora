import { afterAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Thumbnail } from '@remotion/player';
import {
  REELS_SAFE_AREA,
  projectDurationInFrames,
  type RenderInput,
  type TimelineScene,
} from '@kampora/shared';
import { KamporaAd } from './KamporaAd';
import {
  ChromeLayout,
  centerOf,
  leftToRight,
  lineCount,
  sameLine,
  visualOrderRtl,
  type CharBox,
} from '../../test/chrome-layout';

/**
 * Regression tests for Hebrew RTL rendering. They render real frames of the KamporaAd composition, load them
 * into headless Chrome (the browser Remotion renders with) and check where each word is actually painted, so
 * they catch visual reordering that string-level tests cannot see. Skipped when no browser is configured.
 */

const SCENE = 60;
const scene = (id: string, overlays: TimelineScene['overlays'], caption: string): TimelineScene => ({
  id,
  sourceSceneKey: id,
  durationInFrames: SCENE,
  visual: { type: 'motion-graphics', template: 'brand-gradient' },
  overlays,
  caption: { text: caption, cues: [{ text: caption, startFrame: 0, endFrame: SCENE }] },
  transition: { type: 'none', durationInFrames: 0 },
});

const HEADLINES = [
  'קפה ומאפה לבוקר?',
  'מאפים טריים כל בוקר',
  'הבוקר ב-Luz Cafe רק 29.90 ₪',
  'Luz פתוח עד 22:00',
] as const;

const input: RenderInput = {
  scale: 1,
  assetUrls: {},
  project: {
    schemaVersion: 1,
    id: 'rtl-layout',
    title: 'RTL layout',
    locale: 'he-IL',
    direction: 'rtl',
    output: { width: 1080, height: 1920, fps: 30, codec: 'h264', crf: 20 },
    safeArea: REELS_SAFE_AREA,
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
    assets: [],
    scenes: [
      ...HEADLINES.map((text, i) => scene(`h${i}`, [{ type: 'headline', text, position: 'top' }], text)),
      scene(
        'offer',
        [{ type: 'price-tag', price: '29.90 ₪', label: 'קפה + מאפה', note: 'עד סוף החודש!' }],
        'עכשיו: קפה + מאפה ב-29.90 ₪.',
      ),
      scene(
        'cta',
        [{ type: 'logo' }, { type: 'cta', text: 'בואו ל-Luz היום!', subtext: 'פלורנטין 12, תל אביב' }],
        'בואו ל-Luz היום!',
      ),
    ],
    audio: {},
    captions: { enabled: true, maxWordsPerChunk: 8 },
  },
};

function frameHtml(frame: number): string {
  return renderToStaticMarkup(
    <Thumbnail
      component={KamporaAd}
      inputProps={input}
      compositionWidth={1080}
      compositionHeight={1920}
      durationInFrames={projectDurationInFrames(input.project)}
      fps={30}
      frameToDisplay={frame}
    />,
  );
}

const chrome = await ChromeLayout.launch();
afterAll(() => chrome?.close());

async function boxesAt(frame: number, text: string): Promise<CharBox[]> {
  await chrome!.setBody(frameHtml(frame));
  return chrome!.charBoxes(`[data-kampora-text="${text}"]`);
}

const settled = (sceneIndex: number) => sceneIndex * SCENE + 45;
const words = (s: string) => s.split(' ');

describe.skipIf(!chrome)('RTL layout of rendered frames (headless Chrome)', () => {
  it.each(HEADLINES.map((h, i) => [h, i] as const))(
    'headline "%s" is painted in the same order as its subtitle',
    async (headline, i) => {
      const head = await boxesAt(settled(i), 'headline');
      const caption = await chrome!.charBoxes('[data-kampora-text="caption"]');
      expect(head.map((b) => b.ch).join('')).toBe(headline);
      expect(visualOrderRtl(head, words(headline))).toEqual(visualOrderRtl(caption, words(headline)));
    },
  );

  it('reads Hebrew headlines right-to-left in written order, with "?" at the left end', async () => {
    const q = await boxesAt(settled(0), 'headline');
    expect(visualOrderRtl(q, words(HEADLINES[0]))).toEqual(['קפה', 'ומאפה', 'לבוקר?']);
    expect(leftToRight(q, 'לבוקר?')[0]).toBe('?');

    const fresh = await boxesAt(settled(1), 'headline');
    expect(visualOrderRtl(fresh, words(HEADLINES[1]))).toEqual(['מאפים', 'טריים', 'כל', 'בוקר']);
  });

  it('keeps the order while words are still animating in', async () => {
    for (const frame of [1 * SCENE + 6, 1 * SCENE + 12]) {
      const boxes = await boxesAt(frame, 'headline');
      expect(visualOrderRtl(boxes, words(HEADLINES[1]))).toEqual(['מאפים', 'טריים', 'כל', 'בוקר']);
    }
  });

  it('lays out mixed Hebrew/English, prices and times with the Unicode bidi rules', async () => {
    const mixed = await boxesAt(settled(2), 'headline');
    // Hebrew prefix stays on the right of the English name, and an English phrase reads left-to-right.
    expect(leftToRight(mixed, 'ב-Luz')).toBe('Luz-ב');
    expect(leftToRight(mixed, 'Luz Cafe')).toBe('Luz Cafe');
    // An amount reads left-to-right with the shekel sign on its left, and never wraps away from it.
    expect(leftToRight(mixed, '29.90 ₪')).toBe('₪ 29.90');
    expect(sameLine(mixed, '29.90 ₪')).toBe(true);
    expect(centerOf(mixed, 'הבוקר')).toBeGreaterThan(centerOf(mixed, 'רק'));

    // A line that starts with English or digits is still a right-to-left line.
    const latinFirst = await boxesAt(settled(3), 'headline');
    expect(visualOrderRtl(latinFirst, words(HEADLINES[3]))).toEqual(['Luz', 'פתוח', 'עד', '22:00']);
    expect(leftToRight(latinFirst, '22:00')).toBe('22:00');
  });

  it('renders the price tag and its subtitle consistently', async () => {
    const price = await boxesAt(settled(4), 'price');
    expect(leftToRight(price, '29.90 ₪')).toBe('₪ 29.90');
    expect(lineCount(price)).toBe(1);

    const caption = await chrome!.charBoxes('[data-kampora-text="caption"]');
    expect(leftToRight(caption, '29.90 ₪')).toBe('₪ 29.90');
    expect(visualOrderRtl(caption)).toEqual(['עכשיו:', 'קפה', '+', 'מאפה', 'ב-29.90', '₪.']);

    const label = await chrome!.charBoxes('[data-kampora-text="price-label"]');
    expect(visualOrderRtl(label)).toEqual(['קפה', '+', 'מאפה']);
    const note = await chrome!.charBoxes('[data-kampora-text="price-note"]');
    expect(visualOrderRtl(note)).toEqual(['עד', 'סוף', 'החודש!']);
    expect(leftToRight(note, 'החודש!')[0]).toBe('!');
  });

  it('renders the CTA, address and logo in reading order', async () => {
    const cta = await boxesAt(settled(5), 'cta');
    expect(visualOrderRtl(cta)).toEqual(['בואו', 'ל-Luz', 'היום!']);
    expect(leftToRight(cta, 'ל-Luz')).toBe('Luz-ל');
    expect(leftToRight(cta, 'היום!')[0]).toBe('!');

    const address = await chrome!.charBoxes('[data-kampora-text="cta-subtext"]');
    expect(visualOrderRtl(address)).toEqual(['פלורנטין', '12,', 'תל', 'אביב']);
    expect(leftToRight(address, '12')).toBe('12');

    const logo = await chrome!.charBoxes('[data-kampora-text="logo"]');
    expect(leftToRight(logo, 'Luz')).toBe('Luz');
  });
});
