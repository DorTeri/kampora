import { describe, expect, it } from 'vitest';
import type { TimelineScene } from '@kampora/shared';
import { duckingGain, voiceSpans } from './audio';

const scene = (durationInFrames: number, voice?: { startOffsetFrames: number; durationInFrames: number }) =>
  ({
    durationInFrames,
    voiceover: voice ? { assetId: 'v', volume: 1, ...voice } : undefined,
  }) as unknown as TimelineScene;

describe('music ducking under narration', () => {
  it('computes absolute voice spans from scene starts and offsets', () => {
    expect(
      voiceSpans({
        scenes: [
          scene(100, { startOffsetFrames: 9, durationInFrames: 60 }),
          scene(50),
          scene(80, { startOffsetFrames: 6, durationInFrames: 40 }),
        ],
      }),
    ).toEqual([
      { start: 9, end: 69 },
      { start: 156, end: 196 },
    ]);
  });

  it('ducks while speaking with a short attack and a slower release', () => {
    const spans = [{ start: 30, end: 90 }];
    expect(duckingGain(0, spans, 0.3)).toBe(1);
    expect(duckingGain(27, spans, 0.3)).toBeCloseTo(0.65); // halfway through the 6-frame attack
    expect(duckingGain(60, spans, 0.3)).toBe(0.3);
    expect(duckingGain(96, spans, 0.3)).toBeCloseTo(0.65); // halfway through the 12-frame release
    expect(duckingGain(120, spans, 0.3)).toBe(1);
  });

  it('never jumps between back-to-back narration lines', () => {
    const spans = [
      { start: 10, end: 50 },
      { start: 58, end: 100 },
    ];
    for (let f = 50; f <= 58; f++) expect(duckingGain(f, spans, 0.3)).toBeLessThan(0.75);
  });
});
