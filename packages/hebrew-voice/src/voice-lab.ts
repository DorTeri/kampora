import type { VoiceOption, VoiceStyle } from '@kampora/shared';
import { createHash } from 'node:crypto';
import { directScript, type DirectedScript } from './voice-director';
import { parseVoiceList, type TtsSetup } from './tts-config';

/**
 * Voice lab: the same Hebrew ad script read by several voice configurations, so they can be compared by LISTENING
 * and rated by people. Nothing here decides which voice is "best"; it only makes the comparison fair (same text,
 * same direction, same normalization) and its cost explicit before anything paid is generated.
 */

/**
 * One fixed test script that exercises what Hebrew ads need: a question hook, a brand name, a price, a
 * percentage, a date, an address with a number, and a CTA. Each sentence is one "line" of the directed script.
 */
export const VOICE_LAB_SCRIPT: ReadonlyArray<{ sceneKey: string; text: string }> = [
  { sceneKey: 'hook', text: 'מחפשים מקום טוב לקפה של בוקר?' },
  { sceneKey: 'product', text: 'בלוּז אופים כל בוקר מאפים טריים, וקולים את הקפה ממש כאן.' },
  { sceneKey: 'offer', text: 'עכשיו קפה ומאפה ב-29.90 ₪, ו-20% הנחה על פולי קפה עד ה-15.11.' },
  { sceneKey: 'cta', text: 'מחכים לכם בפלורנטין 12, כל יום משבע בבוקר. בואו לטעום!' },
];

export const VOICE_LAB_SCRIPT_TEXT = VOICE_LAB_SCRIPT.map((l) => l.text).join(' ');

/** Listening criteria (1–5). Subjective: only people fill these in. */
export const VOICE_LAB_CRITERIA = [
  { id: 'accent', label: 'מבטא ישראלי' },
  { id: 'naturalness', label: 'טבעיות' },
  { id: 'emotion', label: 'הבעה רגשית' },
  { id: 'pronunciation', label: 'הגייה נכונה' },
  { id: 'commercial', label: 'מתאים לפרסומת' },
] as const;
export type VoiceLabCriterion = (typeof VOICE_LAB_CRITERIA)[number]['id'];

export interface VoiceLabCandidate {
  /** Stable id: group:voiceId:modelId. */
  id: string;
  /** A = current voice (continuous), B = same voice on Eleven v4, C = another Hebrew voice. */
  group: 'A' | 'B' | 'C';
  title: string;
  voice: VoiceOption;
}

const candidateId = (group: string, voice: VoiceOption) => `${group}:${voice.id}:${voice.modelId}`;

/**
 * The comparison set: A every configured voice as it is used today, B the same ElevenLabs voice on eleven_v4,
 * C extra Hebrew voices configured for the lab only (VOICE_LAB_VOICES). With the mock provider the same groups
 * exist so the whole flow can be exercised offline.
 */
export function voiceLabCandidates(
  setup: TtsSetup,
  extraVoices: readonly VoiceOption[] = [],
): VoiceLabCandidate[] {
  const out: VoiceLabCandidate[] = [];
  for (const voice of setup.voices) {
    out.push({ id: candidateId('A', voice), group: 'A', title: `${voice.label} · ${voice.modelId}`, voice });
    if (voice.provider === 'elevenlabs' && !voice.modelId.startsWith('eleven_v4')) {
      const v4 = { ...voice, modelId: 'eleven_v4' };
      out.push({ id: candidateId('B', v4), group: 'B', title: `${voice.label} · eleven_v4`, voice: v4 });
    }
  }
  for (const voice of extraVoices) {
    out.push({ id: candidateId('C', voice), group: 'C', title: `${voice.label} · ${voice.modelId}`, voice });
  }
  return out;
}

/** Exactly what a candidate would be sent for the lab script in one style. */
export function directLabScript(
  candidate: VoiceLabCandidate,
  style: VoiceStyle,
  options: { audioTags?: boolean; selectiveNiqqud?: boolean } = {},
): DirectedScript {
  return directScript(VOICE_LAB_SCRIPT, {
    provider: candidate.voice.provider,
    modelId: candidate.voice.modelId,
    style,
    audioTags: options.audioTags,
    selectiveNiqqud: options.selectiveNiqqud,
  });
}

export function labScriptHash(): string {
  return createHash('sha256').update(VOICE_LAB_SCRIPT_TEXT).digest('hex').slice(0, 16);
}

/** Approval reference for a lab sample: one approval covers one candidate + style + script version. */
export function voiceLabApprovalRef(candidate: VoiceLabCandidate, style: VoiceStyle): string {
  return `${candidate.id}:${style}:${labScriptHash()}`;
}

/**
 * Lab-only voices (group C). ElevenLabs: VOICE_LAB_VOICES uses the ELEVENLABS_VOICES format and defaults to
 * eleven_v4. Mock: a second mock voice, so the comparison page works offline.
 */
export function voiceLabExtraVoices(setup: TtsSetup, env: NodeJS.ProcessEnv = process.env): VoiceOption[] {
  if (setup.provider === 'elevenlabs') return parseVoiceList(env.VOICE_LAB_VOICES, 'eleven_v4');
  if (setup.provider === 'mock') {
    return [
      { id: 'mock-he-2', label: 'קול לדוגמה 2 (לא אמיתי)', provider: 'mock', modelId: 'mock-voice-v1' },
    ];
  }
  return [];
}
