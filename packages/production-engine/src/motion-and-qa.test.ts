import { describe, expect, it } from 'vitest';
import {
  REELS_SAFE_AREA,
  VideoProjectSchema,
  type StoryboardScene,
  type TimelineScene,
  type VideoProjectInput,
} from '@kampora/shared';
import { chooseMotion, chooseTransition } from './motion-router';
import { timelineQa } from './timeline-qa';

const scene = (overrides: Partial<StoryboardScene> = {}): StoryboardScene => ({
  key: 'hook',
  order: 0,
  role: 'HOOK',
  durationSec: 3,
  visual: 'x',
  visualKind: 'PHOTO',
  voiceover: 'שלום',
  requiredAssets: [],
  motion: { preset: 'cinematic-zoom' },
  quality: {
    requiresHumanMotion: false,
    requiresComplexAction: false,
    requiresProductAccuracy: false,
    brandCritical: false,
  },
  ...overrides,
});

describe('chooseMotion', () => {
  it('keeps a storyboard preset that suits the shot', () => {
    const c = chooseMotion(scene({ direction: { purpose: 'p', shot: 'extreme-close-up' } }), {
      durationSec: 3,
    });
    expect(c.motion.preset).toBe('cinematic-zoom');
  });

  it('never repeats the previous camera move', () => {
    const c = chooseMotion(
      scene({ motion: { preset: 'ken-burns-in' }, direction: { purpose: 'p', shot: 'close-up' } }),
      {
        durationSec: 4,
        previous: 'ken-burns-in',
      },
    );
    expect(c.motion.preset).not.toBe('ken-burns-in');
    expect(c.reason).toMatch(/repeat/);
  });

  it('replaces a move that does not suit the framing', () => {
    const c = chooseMotion(
      scene({ motion: { preset: 'static' }, direction: { purpose: 'p', shot: 'wide' } }),
      {
        durationSec: 4,
      },
    );
    expect(c.motion.preset).toBe('pan-right');
  });

  it('short scenes move gently, long ones more; parallax stays parallax', () => {
    const short = chooseMotion(scene(), { durationSec: 1.5 }).motion.intensity;
    const long = chooseMotion(scene(), { durationSec: 6 }).motion.intensity;
    expect(short).toBeLessThan(long);
    expect(long).toBeLessThanOrEqual(0.7);
    expect(chooseMotion(scene(), { durationSec: 4, parallax: true }).motion.preset).toBe('parallax');
  });
});

describe('chooseTransition', () => {
  it('uses role-based transitions capped at 20% of the scene', () => {
    expect(chooseTransition({ role: 'HOOK' }, 0, 90)).toEqual({ type: 'fade', durationInFrames: 6 });
    expect(chooseTransition({ role: 'OFFER' }, 2, 150)).toEqual({ type: 'zoom', durationInFrames: 10 });
    expect(chooseTransition({ role: 'CTA' }, 3, 30).durationInFrames).toBe(6);
  });
});

const timelineScene = (id: string, overrides: Partial<TimelineScene> = {}): TimelineScene => ({
  id,
  sourceSceneKey: id,
  durationInFrames: 120,
  visual: {
    type: 'image-motion',
    assetId: 'img',
    motion: { preset: 'ken-burns-in', intensity: 0.5, focalPoint: { x: 0.5, y: 0.5 } },
  },
  overlays: [],
  transition: { type: 'fade', durationInFrames: 8 },
  ...overrides,
});

function project(scenes: TimelineScene[]) {
  const input: VideoProjectInput = {
    schemaVersion: 1,
    id: 'p',
    title: 't',
    locale: 'he-IL',
    direction: 'rtl',
    output: { width: 1080, height: 1920, fps: 30, codec: 'h264', crf: 20 },
    safeArea: REELS_SAFE_AREA,
    branding: {
      businessName: 'Luz',
      colors: {
        primary: '#111111',
        secondary: '#222222',
        accent: '#333333',
        background: '#ffffff',
        text: '#000000',
      },
      fontFamily: 'Heebo',
    },
    assets: [
      {
        id: 'img',
        kind: 'image',
        storageKey: 'a/img.png',
        mimeType: 'image/png',
        provenance: { source: 'DEMO', license: 'x', commercialUse: true },
      },
      {
        id: 'img2',
        kind: 'image',
        storageKey: 'a/img2.png',
        mimeType: 'image/png',
        provenance: { source: 'DEMO', license: 'x', commercialUse: true },
      },
      {
        id: 'vo',
        kind: 'audio',
        storageKey: 'a/vo.wav',
        mimeType: 'audio/wav',
        provenance: { source: 'DEMO', license: 'x', commercialUse: true },
      },
    ],
    scenes,
    audio: {},
    captions: { enabled: true, maxWordsPerChunk: 4 },
  };
  return VideoProjectSchema.parse(input);
}

const cta = { type: 'cta' as const, text: 'בואו' };

describe('timelineQa', () => {
  it('passes a clean timeline', () => {
    const p = project([
      timelineScene('hook', {
        durationInFrames: 90,
        voiceover: { assetId: 'vo', volume: 1, startOffsetFrames: 9, durationInFrames: 75 },
      }),
      timelineScene('cta', {
        visual: {
          type: 'image-motion',
          assetId: 'img2',
          motion: { preset: 'pan-right', intensity: 0.5, focalPoint: { x: 0.5, y: 0.5 } },
        },
        overlays: [cta],
        voiceover: { assetId: 'vo', volume: 1, startOffsetFrames: 0, durationInFrames: 80 },
      }),
    ]);
    expect(timelineQa(p)).toEqual([]);
  });

  it('blocks cut-off narration and captions outside the scene', () => {
    const p = project([
      timelineScene('hook', {
        durationInFrames: 60,
        voiceover: { assetId: 'vo', volume: 1, startOffsetFrames: 9, durationInFrames: 90 },
        caption: { text: 'שלום', cues: [{ text: 'שלום', startFrame: 10, endFrame: 80 }] },
      }),
      timelineScene('cta', { overlays: [cta] }),
    ]);
    const errors = timelineQa(p)
      .filter((i) => i.severity === 'error')
      .map((i) => i.code);
    expect(errors).toEqual(['VOICE_OVERRUN', 'CAPTION_OUT_OF_SCENE']);
  });

  it('warns about pacing, repetition, dead air and a short or missing CTA', () => {
    const p = project([
      timelineScene('hook', {
        durationInFrames: 150,
        voiceover: { assetId: 'vo', volume: 1, startOffsetFrames: 0, durationInFrames: 60 },
      }),
      timelineScene('product', { durationInFrames: 30 }),
      timelineScene('cta', { durationInFrames: 60, overlays: [cta] }),
    ]);
    const codes = timelineQa(p).map((i) => i.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        'SLOW_HOOK',
        'DEAD_AIR',
        'REPEATED_SHOT',
        'SCENE_TOO_SHORT',
        'TRANSITION_TOO_LONG',
        'CTA_TOO_SHORT',
      ]),
    );
    expect(timelineQa(project([timelineScene('only')])).map((i) => i.code)).toContain('NO_CTA');
  });
});
