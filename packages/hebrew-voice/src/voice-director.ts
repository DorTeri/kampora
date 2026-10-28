import type { PronunciationEntry, VoiceStyle } from '@kampora/shared';
import { normalizeHebrewForSpeech } from './normalize';
import { prepareForProvider, type TtsProviderId } from './providers';
import { estimateSpeechSec } from './speech-timing';

/**
 * Voice Director: turns approved script lines into what the voice actually receives, for one delivery style.
 * It controls only delivery — provider settings, price phrasing, punctuation-based pacing and (optionally) one
 * opening audio tag. It never changes facts, claims or the on-screen text (subtitles keep the original lines).
 */

export interface VoiceDirection {
  /** Hebrew label for customers. */
  label: string;
  description: string;
  /** How prices are read: colloquial "עשרים ותשע תשעים" or formal "עשרים ותשעה שקלים ותשעים אגורות". */
  priceStyle: 'colloquial' | 'formal';
  /**
   * ElevenLabs stability for expressive models (v3 family). Lower = more expressive and less predictable.
   * 0.5 is the documented "Natural" setting; we never go to the unstable extreme for ads.
   */
  stability: number;
  /** One opening audio tag, used only when audio tags are enabled after listening tests. */
  audioTag?: string;
  /** Calm/premium reads avoid exclamation marks, which push the voice toward shouting. */
  softenExclamations: boolean;
}

export const VOICE_STYLES: Record<VoiceStyle, VoiceDirection> = {
  natural: {
    label: 'טבעי ושיחתי',
    description: 'כמו חבר שממליץ – ישראלי, פשוט, בלי "קול של פרסומת"',
    priceStyle: 'colloquial',
    stability: 0.5,
    softenExclamations: false,
  },
  energetic: {
    label: 'צעיר ואנרגטי',
    description: 'קצב חי ומחויך, מתאים לקהל צעיר ולמבצעים',
    priceStyle: 'colloquial',
    stability: 0.5,
    audioTag: '[excited]',
    softenExclamations: false,
  },
  warm: {
    label: 'חם ומזמין',
    description: 'אישי ונעים, מתאים לעסקים שכונתיים ולמשפחות',
    priceStyle: 'colloquial',
    stability: 0.5,
    audioTag: '[warmly]',
    softenExclamations: false,
  },
  premium: {
    label: 'יוקרתי ובטוח',
    description: 'רגוע, מדויק ובטוח בעצמו – למותגים איכותיים',
    priceStyle: 'formal',
    stability: 1.0,
    softenExclamations: true,
  },
  calm: {
    label: 'רגוע ומקצועי',
    description: 'ברור ושקול, מתאים לשירותים מקצועיים',
    priceStyle: 'formal',
    stability: 1.0,
    audioTag: '[calm]',
    softenExclamations: true,
  },
  social: {
    label: 'רילס מודרני',
    description: 'ישיר וקצבי, משפטים קצרים כמו ברשתות',
    priceStyle: 'colloquial',
    stability: 0.5,
    softenExclamations: false,
  },
};

export interface DirectionOptions {
  provider: TtsProviderId;
  modelId: string;
  style: VoiceStyle;
  pronunciation?: PronunciationEntry[];
  /** Off by default: enable only after listening tests confirm tags help this voice. */
  audioTags?: boolean;
  selectiveNiqqud?: boolean;
}

export interface DirectedLine {
  sceneKey: string;
  /** Customer-facing line (subtitles). */
  original: string;
  /** What this line becomes in the spoken script (normalized, directed). */
  spoken: string;
  /** Character range of `spoken` inside the payload: [start, end). */
  start: number;
  end: number;
  estimatedSec: number;
  warnings: string[];
}

export interface DirectedScript {
  style: VoiceStyle;
  /** Exact text sent to the TTS provider. */
  payload: string;
  characters: number;
  /** Provider request settings (ElevenLabs: voice_settings). */
  settings: Record<string, unknown>;
  lines: DirectedLine[];
  estimatedSec: number;
  warnings: string[];
}

const EXPRESSIVE_MODELS = /^eleven_v[34]/;

/**
 * Provider settings for a style (ElevenLabs docs checked 2026-10-28). Speed is never raised: pacing comes from
 * punctuation and the model.
 *  - eleven_v3: Similarity, Speed and Speaker Boost are not available; stability is the delivery control. We keep
 *    sending the neutral similarity/speed values that the Phase 2 run accepted.
 *  - eleven_v4 / v4_turbo: Stability and Similarity only (no Style or Speed, no SSML).
 */
export function styleSettings(
  provider: TtsProviderId,
  modelId: string,
  style: VoiceStyle,
): Record<string, unknown> {
  if (provider !== 'elevenlabs') return {};
  const direction = VOICE_STYLES[style];
  if (/^eleven_v4/.test(modelId)) {
    return { voice_settings: { stability: direction.stability, similarity_boost: 0.75 } };
  }
  if (EXPRESSIVE_MODELS.test(modelId)) {
    return { voice_settings: { stability: direction.stability, similarity_boost: 0.75, speed: 1.0 } };
  }
  return {
    voice_settings: { stability: direction.stability, similarity_boost: 0.75, style: 0.2, speed: 1.0 },
  };
}

/** Punctuation pacing for one spoken line: a clear sentence end, natural commas instead of dashes. */
export function paceLine(spoken: string, direction: VoiceDirection): string {
  let text = spoken
    .replace(/\s+[–—-]\s+/g, ', ')
    .replace(/\.{2,}|…/g, '.')
    .replace(/!{2,}/g, '!')
    .replace(/\?{2,}/g, '?')
    .replace(/\s+([,.!?])/g, '$1')
    .trim();
  if (direction.softenExclamations) text = text.replace(/!/g, '.');
  if (!/[.!?]$/.test(text)) text = `${text}.`;
  return text;
}

/**
 * Directs a whole script for ONE continuous recording: every line is normalized for speech with the style's
 * price phrasing, paced with punctuation and joined into one text. Line spans let the alignment of the single
 * recording be split back into scenes.
 */
export function directScript(
  lines: ReadonlyArray<{ sceneKey: string; text: string }>,
  options: DirectionOptions,
): DirectedScript {
  const direction = VOICE_STYLES[options.style];
  const tag = options.audioTags && EXPRESSIVE_MODELS.test(options.modelId) ? direction.audioTag : undefined;
  let payload = tag ? `${tag} ` : '';
  const directed: DirectedLine[] = [];
  for (const line of lines) {
    const original = line.text.trim();
    if (!original) continue;
    const normalized = normalizeHebrewForSpeech(original, {
      pronunciation: options.pronunciation,
      priceStyle: direction.priceStyle,
    });
    const prepared = prepareForProvider(paceLine(normalized.spoken, direction), options.provider, {
      modelId: options.modelId,
      selectiveNiqqud: options.selectiveNiqqud,
    });
    if (directed.length) payload += ' ';
    const start = payload.length;
    payload += prepared.payload;
    directed.push({
      sceneKey: line.sceneKey,
      original,
      spoken: prepared.payload,
      start,
      end: payload.length,
      estimatedSec: estimateSpeechSec(prepared.payload),
      warnings: [
        ...normalized.warnings,
        ...prepared.ambiguities
          .filter((a) => !a.applied)
          .map((a) => `AMBIGUOUS_WORD: "${a.word}" may be misread`),
      ],
    });
  }
  const estimatedSec = Math.round(directed.reduce((s, l) => s + l.estimatedSec, 0) * 10) / 10;
  return {
    style: options.style,
    payload,
    characters: payload.length,
    settings: styleSettings(options.provider, options.modelId, options.style),
    lines: directed,
    estimatedSec,
    warnings: directed.flatMap((l) => l.warnings.map((w) => `[${l.sceneKey}] ${w}`)),
  };
}
