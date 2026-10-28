import type { VoiceOption } from '@kampora/shared';
import {
  ELEVENLABS_HEBREW_MODELS,
  ElevenLabsTtsProvider,
  MockTtsProvider,
  SuppliedNarrationProvider,
  type TtsProvider,
} from './tts';

export interface TtsSetup {
  provider: 'elevenlabs' | 'mock' | 'supplied' | 'none';
  /** Ready = configured well enough to synthesize (key present, voices configured…). */
  ready: boolean;
  reason?: string;
  paid: boolean;
  voices: VoiceOption[];
  audioTags: boolean;
  selectiveNiqqud: boolean;
}

const MOCK_VOICE: VoiceOption = {
  id: 'mock-he',
  label: 'קול לדוגמה (לא אמיתי – לבדיקות)',
  provider: 'mock',
  modelId: 'mock-voice-v1',
  gender: 'neutral',
};

/**
 * ELEVENLABS_VOICES="voiceId|Label|female|eleven_v4;voiceId2|Label 2|male" (model optional, defaults to
 * ELEVENLABS_MODEL_ID). Voice IDs are chosen by ops after listening tests; the browser only sees this list.
 */
export function parseVoiceList(raw: string | undefined, defaultModel: string): VoiceOption[] {
  if (!raw?.trim()) return [];
  return raw
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [id, label, gender, model] = entry.split('|').map((p) => p.trim());
      if (!id || !/^[A-Za-z0-9_-]{6,64}$/.test(id))
        throw new Error(`Invalid ElevenLabs voice id in ELEVENLABS_VOICES: "${entry}"`);
      const modelId = model || defaultModel;
      if (!(ELEVENLABS_HEBREW_MODELS as readonly string[]).includes(modelId)) {
        throw new Error(`Model "${modelId}" for voice ${id} is not a Hebrew-capable ElevenLabs model`);
      }
      return {
        id,
        label: label || id,
        provider: 'elevenlabs' as const,
        modelId,
        gender: gender === 'female' || gender === 'male' ? gender : undefined,
      };
    });
}

export function ttsSetupFromEnv(env: NodeJS.ProcessEnv = process.env): TtsSetup {
  const provider = (env.TTS_PROVIDER ?? 'mock') as TtsSetup['provider'];
  const common = {
    audioTags: env.ELEVENLABS_AUDIO_TAGS === 'true',
    selectiveNiqqud: env.HEBREW_SELECTIVE_NIQQUD === 'true',
  };
  switch (provider) {
    case 'elevenlabs': {
      const voices = parseVoiceList(env.ELEVENLABS_VOICES, env.ELEVENLABS_MODEL_ID || 'eleven_v3');
      const reason = !env.ELEVENLABS_API_KEY
        ? 'ELEVENLABS_API_KEY is not set'
        : !voices.length
          ? 'ELEVENLABS_VOICES is empty'
          : undefined;
      return { provider, ready: !reason, reason, paid: true, voices, ...common };
    }
    case 'supplied':
      return {
        provider,
        ready: Boolean(env.SUPPLIED_NARRATION_DIR),
        reason: env.SUPPLIED_NARRATION_DIR ? undefined : 'SUPPLIED_NARRATION_DIR is not set',
        paid: false,
        voices: [
          {
            id: 'supplied',
            label: 'הקלטה שסופקה על ידי העסק',
            provider: 'supplied',
            modelId: 'supplied-file',
          },
        ],
        ...common,
      };
    case 'none':
      return {
        provider,
        ready: false,
        reason: 'Narration disabled (TTS_PROVIDER=none)',
        paid: false,
        voices: [],
        ...common,
      };
    default:
      return { provider: 'mock', ready: true, paid: false, voices: [MOCK_VOICE], ...common };
  }
}

/** Builds the provider for one voice. Throws if not configured (callers check `ready` first). */
export function createTtsProvider(voice: VoiceOption, env: NodeJS.ProcessEnv = process.env): TtsProvider {
  switch (voice.provider) {
    case 'elevenlabs':
      return new ElevenLabsTtsProvider({
        apiKey: env.ELEVENLABS_API_KEY ?? '',
        voiceId: voice.id,
        modelId: voice.modelId,
        timeoutMs: env.ELEVENLABS_TIMEOUT_MS ? Number(env.ELEVENLABS_TIMEOUT_MS) : undefined,
      });
    case 'supplied':
      return new SuppliedNarrationProvider(env.SUPPLIED_NARRATION_DIR ?? '');
    case 'mock':
      return new MockTtsProvider();
  }
}
