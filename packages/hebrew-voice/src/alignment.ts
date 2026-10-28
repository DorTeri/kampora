import { splitCaptionChunks, type PronunciationEntry, type SpeechCue } from '@kampora/shared';
import { normalizeHebrewForSpeech } from './normalize';

/** Character-level timing as returned by ElevenLabs /with-timestamps (alignment for the text we sent). */
export interface CharacterAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface WordTiming {
  text: string;
  startSec: number;
  endSec: number;
}

/** Groups aligned characters into words; skips audio tags like "[excited]" that are not spoken text. */
export function wordsFromAlignment(alignment: CharacterAlignment | null | undefined): WordTiming[] {
  if (!alignment?.characters?.length) return [];
  const words: WordTiming[] = [];
  let current: WordTiming | null = null;
  let inTag = false;
  alignment.characters.forEach((ch, i) => {
    const start = alignment.character_start_times_seconds[i] ?? 0;
    const end = alignment.character_end_times_seconds[i] ?? start;
    if (ch === '[') inTag = true;
    if (inTag) {
      if (ch === ']') inTag = false;
      return;
    }
    if (/\s/.test(ch)) {
      if (current) words.push(current);
      current = null;
      return;
    }
    if (!current) current = { text: ch, startSec: start, endSec: end };
    else {
      current.text += ch;
      current.endSec = Math.max(current.endSec, end);
    }
  });
  if (current) words.push(current);
  return words.filter((w) => /[\p{L}\p{N}]/u.test(w.text));
}

const countWords = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

export interface CueOptions {
  maxWordsPerChunk?: number;
  pronunciation?: PronunciationEntry[];
  /** How long the last subtitle stays after the final word. */
  tailSec?: number;
}

/**
 * Times the customer-facing subtitle chunks (original Hebrew, with "29.90 ₪") against the actual speech.
 *
 * The spoken text differs from the subtitle ("עשרים ותשעה שקלים…"), so each subtitle chunk is normalized on
 * its own to learn how many spoken words it produces; those counts are mapped onto the aligned word timeline.
 * With provider alignment the cues follow the real speech; without it (timing: 'estimated') cues are spread
 * over the MEASURED audio duration proportionally to spoken length — still bounded by the real audio.
 */
export function buildSpeechCues(
  captionText: string,
  words: WordTiming[],
  audioDurationSec: number,
  options: CueOptions = {},
): { cues: SpeechCue[]; timing: 'provider' | 'estimated' } {
  const chunks = splitCaptionChunks(captionText, options.maxWordsPerChunk ?? 4);
  if (!chunks.length || audioDurationSec <= 0) return { cues: [], timing: 'estimated' };
  const tail = options.tailSec ?? 0.3;
  const spoken = chunks.map(
    (c) => normalizeHebrewForSpeech(c, { pronunciation: options.pronunciation }).spoken,
  );

  if (words.length) {
    const counts = spoken.map((s) => Math.max(1, countWords(s)));
    const total = counts.reduce((a, b) => a + b, 0);
    const cues: SpeechCue[] = [];
    let cumulative = 0;
    chunks.forEach((text, i) => {
      const first = Math.min(words.length - 1, Math.round((cumulative / total) * words.length));
      cumulative += counts[i]!;
      const last = Math.max(
        first,
        Math.min(words.length - 1, Math.round((cumulative / total) * words.length) - 1),
      );
      cues.push({ text, startSec: Math.max(0, words[first]!.startSec - 0.05), endSec: words[last]!.endSec });
    });
    // Keep each subtitle up until the next one starts (no flicker in short pauses); hold the last briefly.
    for (let i = 0; i < cues.length - 1; i++)
      cues[i]!.endSec = Math.max(cues[i]!.endSec, cues[i + 1]!.startSec);
    const lastCue = cues[cues.length - 1]!;
    lastCue.endSec = Math.min(audioDurationSec + tail, lastCue.endSec + tail);
    return { cues: monotonic(cues), timing: 'provider' };
  }

  const weights = spoken.map((s) => Math.max(3, s.length));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let cursor = 0;
  const cues = chunks.map((text, i) => {
    const len = (audioDurationSec * weights[i]!) / totalWeight;
    const cue = { text, startSec: cursor, endSec: cursor + len };
    cursor += len;
    return cue;
  });
  cues[cues.length - 1]!.endSec = audioDurationSec + tail;
  return { cues: monotonic(cues), timing: 'estimated' };
}

function monotonic(cues: SpeechCue[]): SpeechCue[] {
  let prevEnd = 0;
  return cues.map((c) => {
    const startSec = Math.max(c.startSec, prevEnd === 0 ? 0 : Math.min(c.startSec, prevEnd));
    const endSec = Math.max(c.endSec, startSec + 0.2);
    prevEnd = endSec;
    return { text: c.text, startSec: round(startSec), endSec: round(endSec) };
  });
}

const round = (n: number) => Math.round(n * 1000) / 1000;
