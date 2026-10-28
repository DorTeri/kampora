import { stripNiqqud } from '@kampora/shared';

/**
 * Provider-specific speech text preparation. Providers treat Hebrew diacritics and markup differently,
 * so we never send one universal string. The profiles below are conservative starting assumptions:
 * validate each one with real QC (STT round-trip) before relying on it.
 */

export type TtsProviderId = 'elevenlabs' | 'google' | 'azure' | 'supplied';
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
};

export interface PrepareOptions {
  delivery?: VoiceDelivery;
  pauseAfterMs?: number;
  /** Azure voice name, e.g. "he-IL-HilaNeural". */
  voiceName?: string;
}

export interface PreparedSpeech {
  provider: TtsProviderId;
  format: 'text' | 'ssml';
  payload: string;
  characters: number;
  /** Provider-native settings derived from delivery (e.g. ElevenLabs voice_settings). */
  settings: Record<string, unknown>;
}

const SSML_RATE: Record<VoiceDelivery, string> = {
  conversational: '100%',
  energetic: '108%',
  calm: '92%',
  emotional: '95%',
};

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
  const text = profile.niqqud === 'strip' ? stripNiqqud(spokenText) : spokenText;
  if (text.length > profile.maxChars) throw new SpeechTooLongError(provider, text.length, profile.maxChars);

  if (profile.markup === 'plain') {
    return {
      provider,
      format: 'text',
      payload: text,
      characters: text.length,
      settings: provider === 'elevenlabs' ? { voice_settings: ELEVENLABS_SETTINGS[delivery] } : {},
    };
  }

  const pause = options.pauseAfterMs ? `<break time="${Math.round(options.pauseAfterMs)}ms"/>` : '';
  const body = `<prosody rate="${SSML_RATE[delivery]}">${escapeXml(text)}</prosody>${pause}`;
  const payload =
    provider === 'azure'
      ? `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="he-IL"><voice name="${escapeXml(
          options.voiceName ?? 'he-IL-HilaNeural',
        )}">${body}</voice></speak>`
      : `<speak>${body}</speak>`;
  return { provider, format: 'ssml', payload, characters: text.length, settings: {} };
}
