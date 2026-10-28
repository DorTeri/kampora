import { stripNiqqud } from '@kampora/shared';
import { resolveAmbiguities } from './ambiguity';

/**
 * Provider-specific speech text preparation. Providers treat Hebrew diacritics and markup differently,
 * so we never send one universal string. The profiles below are conservative starting assumptions:
 * validate each one with real QC (STT round-trip) before relying on it.
 */

export type TtsProviderId = 'elevenlabs' | 'google' | 'azure' | 'supplied' | 'mock';
export type VoiceDelivery = 'conversational' | 'energetic' | 'calm' | 'emotional';

export interface ProviderTextProfile {
  /** preserve: keep niqqud only where the pronunciation dictionary added it. strip: remove all niqqud. */
  niqqud: 'preserve' | 'strip';
  markup: 'plain' | 'ssml';
  maxChars: number;
}

export const PROVIDER_TEXT_PROFILES: Record<TtsProviderId, ProviderTextProfile> = {
  // eleven_v3: Hebrew supported, 5,000 chars/request (docs verified 2026-10-28). No SSML; pauses via punctuation.
  elevenlabs: { niqqud: 'preserve', markup: 'plain', maxChars: 5000 },
  google: { niqqud: 'strip', markup: 'ssml', maxChars: 5000 },
  azure: { niqqud: 'preserve', markup: 'ssml', maxChars: 5000 },
  supplied: { niqqud: 'preserve', markup: 'plain', maxChars: Number.POSITIVE_INFINITY },
  mock: { niqqud: 'preserve', markup: 'plain', maxChars: 5000 },
};

export interface PrepareOptions {
  delivery?: VoiceDelivery;
  pauseAfterMs?: number;
  /** Azure voice name, e.g. "he-IL-HilaNeural". */
  voiceName?: string;
  /** ElevenLabs model, e.g. eleven_v3 / eleven_v4 (expressive models: audio tags, no SSML). */
  modelId?: string;
  /** Prefix an ElevenLabs audio tag (e.g. "[excited]") for delivery. Off by default until listening tests pass. */
  audioTags?: boolean;
  /** Vocalize known ambiguous ad words (מבצע, הנחה…) with their ad reading. Off by default. */
  selectiveNiqqud?: boolean;
}

export interface PreparedSpeech {
  provider: TtsProviderId;
  format: 'text' | 'ssml';
  payload: string;
  characters: number;
  /** Provider-native settings derived from delivery (e.g. ElevenLabs voice_settings). */
  settings: Record<string, unknown>;
  /** Ambiguous words found (and whether niqqud was applied), for QC review. */
  ambiguities: Array<{ word: string; applied: boolean }>;
}

const SSML_RATE: Record<VoiceDelivery, string> = {
  conversational: '100%',
  energetic: '108%',
  calm: '92%',
  emotional: '95%',
};

/** Expressive ElevenLabs models (docs 2026-10-28): audio tags supported, SSML <break> not supported. */
const EXPRESSIVE_MODELS = /^eleven_v[34]/;

const AUDIO_TAGS: Record<VoiceDelivery, string> = {
  conversational: '',
  energetic: '[excited]',
  calm: '[calm]',
  emotional: '[warmly]',
};

/**
 * Speed is always 1.0: we never speed narration up to fit a timeline (the timeline adapts instead).
 * Expressive models get a neutral "Natural" stability; delivery comes from audio tags and punctuation.
 */
const EXPRESSIVE_SETTINGS = { stability: 0.5, similarity_boost: 0.75, speed: 1.0 };

const ELEVENLABS_SETTINGS: Record<VoiceDelivery, Record<string, number>> = {
  conversational: { stability: 0.5, similarity_boost: 0.75, style: 0.2 },
  energetic: { stability: 0.35, similarity_boost: 0.75, style: 0.5 },
  calm: { stability: 0.7, similarity_boost: 0.75, style: 0.1 },
  emotional: { stability: 0.3, similarity_boost: 0.8, style: 0.6 },
};

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export class SpeechTooLongError extends Error {
  constructor(provider: string, length: number, max: number) {
    super(`Speech text for ${provider} is ${length} chars; max is ${max}`);
  }
}

export function prepareForProvider(
  spokenText: string,
  provider: TtsProviderId,
  options: PrepareOptions = {},
): PreparedSpeech {
  const profile = PROVIDER_TEXT_PROFILES[provider];
  const delivery = options.delivery ?? 'conversational';
  const ambiguity = resolveAmbiguities(
    spokenText,
    Boolean(options.selectiveNiqqud) && profile.niqqud !== 'strip',
  );
  let text = profile.niqqud === 'strip' ? stripNiqqud(ambiguity.text) : ambiguity.text;
  const expressive = provider === 'elevenlabs' && EXPRESSIVE_MODELS.test(options.modelId ?? 'eleven_v3');

  if (profile.markup === 'plain') {
    if (expressive) {
      if (options.pauseAfterMs && !/[.!?…]$/.test(text)) text = `${text}...`;
      const tag = options.audioTags ? AUDIO_TAGS[delivery] : '';
      if (tag) text = `${tag} ${text}`;
    }
    if (text.length > profile.maxChars) throw new SpeechTooLongError(provider, text.length, profile.maxChars);
    return {
      provider,
      format: 'text',
      payload: text,
      characters: text.length,
      settings:
        provider === 'elevenlabs'
          ? {
              voice_settings: expressive
                ? EXPRESSIVE_SETTINGS
                : { ...ELEVENLABS_SETTINGS[delivery], speed: 1.0 },
            }
          : {},
      ambiguities: ambiguity.flagged,
    };
  }
  if (text.length > profile.maxChars) throw new SpeechTooLongError(provider, text.length, profile.maxChars);

  const pause = options.pauseAfterMs ? `<break time="${Math.round(options.pauseAfterMs)}ms"/>` : '';
  const body = `<prosody rate="${SSML_RATE[delivery]}">${escapeXml(text)}</prosody>${pause}`;
  const payload =
    provider === 'azure'
      ? `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="he-IL"><voice name="${escapeXml(
          options.voiceName ?? 'he-IL-HilaNeural',
        )}">${body}</voice></speak>`
      : `<speak>${body}</speak>`;
  return {
    provider,
    format: 'ssml',
    payload,
    characters: text.length,
    settings: {},
    ambiguities: ambiguity.flagged,
  };
}
