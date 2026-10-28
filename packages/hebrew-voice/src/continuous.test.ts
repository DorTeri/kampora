import { describe, expect, it } from 'vitest';
import type { Storyboard } from '@kampora/shared';
import {
  MockTtsProvider,
  NARRATION_SAMPLE_RATE,
  decodeToPcm,
  directScript,
  paceLine,
  parseSilences,
  planContinuousNarration,
  planNarration,
  sceneCutsFromAlignment,
  sceneCutsFromSilences,
  slicePcm,
  VOICE_STYLES,
  type CharacterAlignment,
} from './index';

const LINES = [
  { sceneKey: 'hook', text: 'מחפשים קפה ומאפה לבוקר?' },
  { sceneKey: 'offer', text: 'ב-Luz יש קפה + מאפה ב-29.90 ₪ עד סוף החודש!' },
  { sceneKey: 'cta', text: 'מחכים לכם בפלורנטין 12 – בואו היום' },
];
const PRON = [{ term: 'Luz', spoken: 'לוּז', caseSensitive: false }];

describe('Voice Director', () => {
  it('joins the script into one recording text and keeps exact per-line spans', () => {
    const d = directScript(LINES, {
      provider: 'elevenlabs',
      modelId: 'eleven_v3',
      style: 'natural',
      pronunciation: PRON,
    });
    for (const line of d.lines) expect(d.payload.slice(line.start, line.end)).toBe(line.spoken);
    expect(d.lines.map((l) => l.original)).toEqual(LINES.map((l) => l.text));
    expect(d.characters).toBe(d.payload.length);
  });

  it('reads prices colloquially for conversational styles and formally for premium', () => {
    const natural = directScript([LINES[1]!], {
      provider: 'elevenlabs',
      modelId: 'eleven_v3',
      style: 'natural',
      pronunciation: PRON,
    });
    expect(natural.payload).toContain('בעשרים ותשע תשעים');
    const premium = directScript([LINES[1]!], {
      provider: 'elevenlabs',
      modelId: 'eleven_v3',
      style: 'premium',
      pronunciation: PRON,
    });
    expect(premium.payload).toContain('בעשרים ותשעה שקלים ותשעים אגורות');
    // Premium softens "!" so the voice does not push.
    expect(premium.payload.endsWith('.')).toBe(true);
  });

  it('paces with punctuation only: dash → comma, a sentence end, no added ellipses', () => {
    expect(paceLine('מחכים לכם – בואו היום', VOICE_STYLES.natural)).toBe('מחכים לכם, בואו היום.');
    expect(paceLine('וואו!!! איזה מבצע...', VOICE_STYLES.energetic)).toBe('וואו! איזה מבצע.');
    const d = directScript(LINES, { provider: 'elevenlabs', modelId: 'eleven_v3', style: 'natural' });
    expect(d.payload).not.toContain('...');
  });

  it('adds one opening audio tag only when tags are enabled and the style has one', () => {
    const off = directScript(LINES, { provider: 'elevenlabs', modelId: 'eleven_v3', style: 'energetic' });
    expect(off.payload.startsWith('[')).toBe(false);
    const on = directScript(LINES, {
      provider: 'elevenlabs',
      modelId: 'eleven_v3',
      style: 'energetic',
      audioTags: true,
    });
    expect(on.payload.startsWith('[excited] ')).toBe(true);
    expect(on.payload.match(/\[/g)).toHaveLength(1);
    expect(on.payload.slice(on.lines[0]!.start, on.lines[0]!.end)).toBe(on.lines[0]!.spoken);
  });

  it('maps styles to stable provider settings with speed fixed at 1.0', () => {
    const calm = directScript(LINES, { provider: 'elevenlabs', modelId: 'eleven_v3', style: 'calm' });
    expect(calm.settings).toEqual({ voice_settings: { stability: 1.0, similarity_boost: 0.75, speed: 1.0 } });
    expect(
      directScript(LINES, { provider: 'mock', modelId: 'mock-voice-v1', style: 'calm' }).settings,
    ).toEqual({});
  });

  it('plans a continuous narration and a directed per-scene narration from the same storyboard', () => {
    const storyboard = {
      scenes: LINES.map((l, order) => ({ key: l.sceneKey, order, voiceover: l.text })),
    } as unknown as Storyboard;
    const options = {
      provider: 'elevenlabs' as const,
      modelId: 'eleven_v3',
      pronunciation: PRON,
      targetDurationSec: 15,
    };
    const continuous = planContinuousNarration(storyboard, { ...options, style: 'natural' });
    const perScene = planNarration(storyboard, { ...options, style: 'natural' });
    expect(perScene.segments.map((s) => s.speech.payload)).toEqual(
      continuous.script.lines.map((l) => l.spoken),
    );
    expect(continuous.scriptHash).toBe(perScene.scriptHash);
    expect(continuous.scriptCheck.status).toBe('OK');
  });
});

/** Alignment where each character takes `step` seconds and each line is followed by a `gap`-second pause. */
function syntheticAlignment(
  text: string,
  spans: Array<{ start: number; end: number }>,
  step = 0.06,
  gap = 0.5,
) {
  const a: CharacterAlignment = {
    characters: [],
    character_start_times_seconds: [],
    character_end_times_seconds: [],
  };
  let t = 0.1;
  [...text].forEach((ch, i) => {
    if (spans.some((s) => s.start === i) && i > 0) t += gap;
    a.characters.push(ch);
    a.character_start_times_seconds.push(t);
    a.character_end_times_seconds.push(t + step);
    t += step;
  });
  return { alignment: a, duration: t + 0.3 };
}

describe('scene cuts in a continuous recording', () => {
  const d = directScript(LINES, {
    provider: 'elevenlabs',
    modelId: 'eleven_v3',
    style: 'natural',
    pronunciation: PRON,
  });
  const fps = 30;

  it('cuts in the middle of each pause between lines, on frame boundaries', () => {
    const { alignment, duration } = syntheticAlignment(d.payload, d.lines);
    const cuts = sceneCutsFromAlignment(d.payload, alignment, d.lines, duration, fps)!;
    expect(cuts.boundaries).toBe('provider');
    expect(cuts.cuts).toHaveLength(LINES.length + 1);
    expect(cuts.cuts[0]).toBe(0);
    for (const c of cuts.cuts) expect(Math.abs(c * fps - Math.round(c * fps))).toBeLessThan(1e-6);
    for (let i = 0; i < LINES.length - 1; i++) {
      expect(cuts.cuts[i + 1]!).toBeGreaterThanOrEqual(cuts.speech[i]!.endSec);
      expect(cuts.cuts[i + 1]!).toBeLessThanOrEqual(cuts.speech[i + 1]!.startSec);
    }
    expect(cuts.cuts.at(-1)!).toBeGreaterThanOrEqual(duration);
    expect(cuts.words[1]!.map((w) => w.text)).toContain('בלוּז');
  });

  it('refuses an alignment that does not match the text it was given', () => {
    const { alignment, duration } = syntheticAlignment('טקסט אחר לגמרי שלא נשלח', [{ start: 0, end: 5 }]);
    expect(sceneCutsFromAlignment(d.payload, alignment, d.lines, duration, fps)).toBeNull();
  });

  it('falls back to detected pauses closest to where each line should end', () => {
    const silences = [
      { startSec: 0, endSec: 0.12 },
      { startSec: 1.2, endSec: 1.35 }, // comma inside line 1
      { startSec: 1.9, endSec: 2.4 }, // between lines 1 and 2
      { startSec: 5.6, endSec: 6.1 }, // between lines 2 and 3
      { startSec: 7.9, endSec: 8.2 },
    ];
    const cuts = sceneCutsFromSilences(silences, d.lines, d.payload.length, 8.2, fps);
    expect(cuts.boundaries).toBe('silence');
    expect(cuts.cuts[1]!).toBeGreaterThanOrEqual(1.9);
    expect(cuts.cuts[1]!).toBeLessThanOrEqual(2.4);
    expect(cuts.cuts[2]!).toBeGreaterThanOrEqual(5.6);
    expect(cuts.cuts[2]!).toBeLessThanOrEqual(6.1);
  });

  it('parses ffmpeg silencedetect output', () => {
    const log =
      '[silencedetect @ 0x1] silence_start: 1.25\n[silencedetect @ 0x1] silence_end: 1.6 | silence_duration: 0.35\n';
    expect(parseSilences(log)).toEqual([{ startSec: 1.25, endSec: 1.6 }]);
  });
});

describe('sample-exact slicing', () => {
  it('slices PCM into clips that are whole frames long and play back to the original', () => {
    const rate = NARRATION_SAMPLE_RATE;
    const pcm = Buffer.alloc(rate * 2 * 2);
    for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE((i * 7) % 3000, i * 2);
    const cuts = [0, 0.5, 1.2, 2.0];
    const clips = slicePcm(pcm, rate, cuts);
    expect(clips.map((c) => (c.length - 44) / 2)).toEqual([24_000, 33_600, 38_400]);
    expect(Buffer.concat(clips.map((c) => c.subarray(44)))).toEqual(pcm);
  });

  it('records with the mock voice, decodes with ffmpeg and cuts it into scene clips', async () => {
    const d = directScript(LINES, {
      provider: 'mock',
      modelId: 'mock-voice-v1',
      style: 'natural',
      pronunciation: PRON,
    });
    const result = await new MockTtsProvider().synthesize({
      segmentKey: 'continuous',
      speech: {
        provider: 'mock',
        format: 'text',
        payload: d.payload,
        characters: d.characters,
        settings: {},
        ambiguities: [],
      },
    });
    const pcm = await decodeToPcm(result.audio, 'wav');
    const duration = pcm.length / 2 / NARRATION_SAMPLE_RATE;
    const cuts = sceneCutsFromAlignment(d.payload, result.alignment, d.lines, duration, 30)!;
    const clips = slicePcm(pcm, NARRATION_SAMPLE_RATE, cuts.cuts);
    expect(clips).toHaveLength(3);
    for (const [i, clip] of clips.entries()) {
      const frames = ((clip.length - 44) / 2 / NARRATION_SAMPLE_RATE) * 30;
      expect(frames).toBeCloseTo(Math.round(frames), 6);
      expect(frames).toBeCloseTo((cuts.cuts[i + 1]! - cuts.cuts[i]!) * 30, 6);
    }
  });
});
