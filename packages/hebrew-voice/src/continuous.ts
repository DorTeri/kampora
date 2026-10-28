import { wordsFromAlignment, type CharacterAlignment, type WordTiming } from './alignment';

/**
 * Continuous narration: the whole script is recorded in one request (so intonation flows across lines) and then
 * cut into one clip per scene. Cuts are placed inside the natural pause between two lines and rounded to a video
 * frame, so the clips play back-to-back with exactly the original rhythm: no added gaps, no audible edits.
 */

export interface LineSpan {
  sceneKey: string;
  /** Character range of the line inside the text that was synthesized: [start, end). */
  start: number;
  end: number;
}

export interface SceneCuts {
  /** Frame-aligned cut times in seconds: cuts[i] … cuts[i+1] is scene i. cuts[0] = 0, last = padded end. */
  cuts: number[];
  /** The same cuts as frame numbers (exact). */
  cutFrames: number[];
  /** First/last spoken sound of each line, in seconds of the full recording. */
  speech: Array<{ startSec: number; endSec: number }>;
  /** Word timings of each line, in seconds of the full recording (empty when boundaries came from silences). */
  words: WordTiming[][];
  boundaries: 'provider' | 'silence';
}

const SPOKEN = /[\p{L}\p{N}]/u;
const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Index of each sent character in the provider alignment. Identity when the provider echoed our text; otherwise a
 * greedy in-order match that tolerates small differences (returns null when too little matches to trust).
 */
export function mapTextToAlignment(
  text: string,
  alignment: CharacterAlignment,
): Array<number | undefined> | null {
  const chars = alignment.characters;
  if (chars.join('') === text) return [...text].map((_, i) => i);
  const map: Array<number | undefined> = [];
  let j = 0;
  let matched = 0;
  let spoken = 0;
  for (const ch of text) {
    if (SPOKEN.test(ch)) spoken++;
    let k = j;
    while (k < chars.length && k < j + 8 && chars[k] !== ch) k++;
    if (k < chars.length && chars[k] === ch) {
      map.push(k);
      j = k + 1;
      if (SPOKEN.test(ch)) matched++;
    } else map.push(undefined);
  }
  return spoken && matched / spoken >= 0.9 ? map : null;
}

/**
 * Cut point between two lines, in frames: the middle of the pause, never inside either line, and at least one
 * frame after the previous cut. Kept as an exact frame/fps value (no millisecond rounding).
 */
function cutBetween(prevEnd: number, nextStart: number, fps: number, minCutFrame: number): number {
  let frame = Math.round(((prevEnd + nextStart) / 2) * fps);
  if (nextStart - prevEnd >= 1 / fps) {
    frame = Math.min(Math.max(frame, Math.ceil(prevEnd * fps)), Math.floor(nextStart * fps));
  }
  return Math.max(frame, minCutFrame + 1);
}

function finish(
  speech: SceneCuts['speech'],
  words: WordTiming[][],
  audioDurationSec: number,
  fps: number,
  boundaries: SceneCuts['boundaries'],
): SceneCuts {
  const frames = [0];
  for (let i = 0; i < speech.length - 1; i++) {
    frames.push(cutBetween(speech[i]!.endSec, speech[i + 1]!.startSec, fps, frames[i]!));
  }
  frames.push(Math.max(Math.ceil(audioDurationSec * fps - 1e-6), frames.at(-1)! + 1));
  return { cuts: frames.map((f) => f / fps), cutFrames: frames, speech, words, boundaries };
}

/** Scene cuts from the TTS character alignment of the continuous recording. Null when it cannot be trusted. */
export function sceneCutsFromAlignment(
  text: string,
  alignment: CharacterAlignment | null | undefined,
  lines: readonly LineSpan[],
  audioDurationSec: number,
  fps: number,
): SceneCuts | null {
  if (!alignment?.characters?.length || !lines.length) return null;
  const map = mapTextToAlignment(text, alignment);
  if (!map) return null;
  const speech: SceneCuts['speech'] = [];
  const words: WordTiming[][] = [];
  for (const line of lines) {
    const indices: number[] = [];
    for (let i = line.start; i < line.end; i++) {
      const k = map[i];
      if (k !== undefined && SPOKEN.test(text[i]!)) indices.push(k);
    }
    if (!indices.length) return null;
    const first = Math.min(...indices);
    const last = Math.max(...indices);
    speech.push({
      startSec: alignment.character_start_times_seconds[first] ?? 0,
      endSec: alignment.character_end_times_seconds[last] ?? audioDurationSec,
    });
    const from = map.slice(line.start, line.end).find((k) => k !== undefined) ?? first;
    words.push(
      wordsFromAlignment({
        characters: alignment.characters.slice(from, last + 1),
        character_start_times_seconds: alignment.character_start_times_seconds.slice(from, last + 1),
        character_end_times_seconds: alignment.character_end_times_seconds.slice(from, last + 1),
      }),
    );
  }
  for (let i = 1; i < speech.length; i++) {
    if (speech[i]!.startSec < speech[i - 1]!.endSec - 0.05) return null; // not in order: do not trust
  }
  return finish(speech, words, audioDurationSec, fps, 'provider');
}

export interface Silence {
  startSec: number;
  endSec: number;
}

/**
 * Fallback without alignment: each boundary goes into the detected pause closest to where the text says it
 * should be (character position → time). This places the CUTS on real pauses; word timing inside a scene is then
 * unknown, so subtitles inside a scene are marked "estimated".
 */
export function sceneCutsFromSilences(
  silences: readonly Silence[],
  lines: readonly LineSpan[],
  textLength: number,
  audioDurationSec: number,
  fps: number,
): SceneCuts {
  const at = (chars: number) => (audioDurationSec * chars) / Math.max(1, textLength);
  const speech: SceneCuts['speech'] = [];
  let previousEnd = 0;
  let used = -1;
  for (let i = 0; i < lines.length; i++) {
    const startSec = i === 0 ? firstSoundAfter(silences, 0) : previousEnd;
    if (i === lines.length - 1) {
      speech.push({ startSec, endSec: lastSoundBefore(silences, audioDurationSec) });
      break;
    }
    const expected = at((lines[i]!.end + lines[i + 1]!.start) / 2);
    // A sentence break is a longer pause than a comma: prefer long pauses near the expected position.
    const score = (p: Silence) =>
      Math.abs((p.startSec + p.endSec) / 2 - expected) - 2 * (p.endSec - p.startSec);
    let best = -1;
    for (let s = used + 1; s < silences.length; s++) {
      const mid = (silences[s]!.startSec + silences[s]!.endSec) / 2;
      if (mid <= startSec || mid >= audioDurationSec) continue;
      if (best < 0 || score(silences[s]!) < score(silences[best]!)) best = s;
    }
    const pause = best >= 0 ? silences[best]! : { startSec: expected, endSec: expected };
    used = Math.max(used, best);
    speech.push({ startSec, endSec: pause.startSec });
    previousEnd = pause.endSec;
  }
  return finish(
    speech,
    lines.map(() => []),
    audioDurationSec,
    fps,
    'silence',
  );
}

function firstSoundAfter(silences: readonly Silence[], t: number): number {
  const leading = silences.find((s) => s.startSec <= t + 0.01);
  return leading ? leading.endSec : t;
}

function lastSoundBefore(silences: readonly Silence[], end: number): number {
  const trailing = [...silences].reverse().find((s) => s.endSec >= end - 0.05);
  return trailing ? trailing.startSec : end;
}

/** Word timings shifted to be relative to a clip that starts at `offsetSec`. */
export function shiftWords(words: readonly WordTiming[], offsetSec: number): WordTiming[] {
  return words.map((w) => ({
    text: w.text,
    startSec: round(Math.max(0, w.startSec - offsetSec)),
    endSec: round(Math.max(0, w.endSec - offsetSec)),
  }));
}

/** 16-bit mono PCM WAV. */
export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Cuts decoded mono 16-bit PCM at the given times, sample-exact (no re-encoding, no codec padding). Clips are
 * padded with silence to their cut end, so clip i lasts exactly cuts[i+1] - cuts[i] (a whole number of frames).
 */
export function slicePcm(pcm: Buffer, sampleRate: number, cuts: readonly number[]): Buffer[] {
  const clips: Buffer[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const from = Math.round(cuts[i]! * sampleRate) * 2;
    const to = Math.round(cuts[i + 1]! * sampleRate) * 2;
    const clip = Buffer.alloc(Math.max(2, to - from));
    pcm.copy(clip, 0, Math.min(from, pcm.length), Math.min(to, pcm.length));
    clips.push(pcmToWav(clip, sampleRate));
  }
  return clips;
}
