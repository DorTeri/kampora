import { describe, expect, it } from 'vitest';
import { REELS_SAFE_AREA, VideoProjectSchema, type MediaAsset, type BrandColors } from '@kampora/shared';
import { composeDesign, derivePalette } from './composer';
import { artDirectVideo, endCardSeconds, pictureBriefFromSpec } from './motion-direction';

const LUZ: BrandColors = { primary: '#2B1B12', secondary: '#C8743A', accent: '#F2C14E', background: '#FBF5EC', text: '#1C140F' };
const img: MediaAsset = { id: 'img', kind: 'image', storageKey: 'a/img.jpg', mimeType: 'image/jpeg', width: 1024, height: 1536, provenance: { source: 'AI_GENERATED', license: 'test', commercialUse: true } };
const copy = { headline: 'הקומבו של הבוקר', subheadline: 'קולים את הפולים בעצמנו', price: { price: '29.90 ₪', label: 'עד סוף החודש' }, cta: 'בואו לבוקר טוב', brandName: 'Luz' };
const spec = (method: 'IMAGE_FIRST' | 'PROMO_PRICE' | 'EDITORIAL') =>
  composeDesign({ format: '9:16', method, moves: [], typeSystem: 'EDITORIAL_SERIF', palette: derivePalette(LUZ, []), copy, picture: { assetId: 'img', focal: { x: 0.5, y: 0.5 } }, emphasis: 'HEADLINE' });

const project = VideoProjectSchema.parse({
  schemaVersion: 1,
  id: 'p',
  title: 't',
  locale: 'he-IL',
  direction: 'rtl',
  output: { width: 1080, height: 1920, fps: 30, codec: 'h264', crf: 20 },
  safeArea: REELS_SAFE_AREA,
  branding: { businessName: 'Luz', colors: LUZ, fontFamily: 'Heebo' },
  assets: [img],
  scenes: [
    { id: 'a', sourceSceneKey: 'hook', durationInFrames: 75, visual: { type: 'image-motion', assetId: 'img', motion: { preset: 'ken-burns-in' } }, overlays: [{ type: 'headline', text: 'הקומבו של הבוקר' }] },
    { id: 'b', sourceSceneKey: 'cta', durationInFrames: 60, visual: { type: 'motion-graphics', template: 'brand-gradient' }, overlays: [{ type: 'cta', text: 'בואו' }], caption: { text: 'בואו לבוקר טוב' } },
  ],
  audio: {},
  captions: { enabled: true },
});

describe('video art direction', () => {
  it('closes on the direction composition, carries its type, and holds the end card long enough to read', () => {
    const s = spec('PROMO_PRICE');
    const v = artDirectVideo(project, { spec: s, typeSystem: 'EDITORIAL_SERIF', method: 'PROMO_PRICE' });
    const last = v.scenes.at(-1)!;
    expect(last.visual.type).toBe('composed');
    expect(last.overlays).toEqual([]);
    expect(last.caption).toBeUndefined();
    expect(last.durationInFrames).toBeGreaterThanOrEqual(Math.round(endCardSeconds(s) * 30));
    expect(v.artDirection?.typeSystem).toBe('EDITORIAL_SERIF');
    expect(v.scenes[0]).toEqual(project.scenes[0]);
  });

  it('refuses an end card of the wrong size', () => {
    const square = composeDesign({ format: '1:1', method: 'BOLD_TYPE', moves: [], typeSystem: 'MODERN_SANS', palette: derivePalette(LUZ, []), copy, emphasis: 'HEADLINE' });
    expect(() => artDirectVideo(project, { spec: square, typeSystem: 'MODERN_SANS', method: 'BOLD_TYPE' })).toThrow(/1080x1080/);
  });

  it('derives a picture brief from the composition the picture is for', () => {
    const brief = pictureBriefFromSpec(spec('IMAGE_FIRST'))!;
    expect(brief.orientation).toBe('PORTRAIT');
    expect(brief.textOverPicture).toBe(true);
    expect(brief.calmSide).not.toBe('NONE');
    expect(brief.guidance).toMatch(/calm/);
    const editorial = pictureBriefFromSpec(spec('EDITORIAL'))!;
    expect(editorial.aspect).not.toBe(brief.aspect);
  });
});
