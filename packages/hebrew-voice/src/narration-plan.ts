import { createHash } from 'node:crypto';
import type { PronunciationEntry, Storyboard } from '@kampora/shared';
import { normalizeHebrewForSpeech } from './normalize';
import { prepareForProvider, type PreparedSpeech, type TtsProviderId, type VoiceDelivery } from './providers';
import { assessScriptLength, estimateSpeechSec, type ScriptLengthAssessment } from './speech-timing';

export interface NarrationPlanOptions {
  provider: TtsProviderId;
  modelId: string;
  pronunciation: PronunciationEntry[];
  targetDurationSec: number;
  delivery?: VoiceDelivery;
  audioTags?: boolean;
  selectiveNiqqud?: boolean;
}

export interface PlannedNarrationSegment {
  sceneKey: string;
  /** Customer-facing script line (subtitles use this). */
  original: string;
  /** Normalized Hebrew actually spoken. */
  spoken: string;
  speech: PreparedSpeech;
  estimatedSec: number;
  warnings: string[];
}

export interface NarrationPlan {
  segments: PlannedNarrationSegment[];
  characters: number;
  estimatedSec: number;
  scriptCheck: ScriptLengthAssessment;
  /** Stable hash of the voiceover lines: a narration is stale when the script changes. */
  scriptHash: string;
  warnings: string[];
}

export function scriptHash(storyboard: Pick<Storyboard, 'scenes'>): string {
  const lines = [...storyboard.scenes]
    .sort((a, b) => a.order - b.order)
    .map((s) => `${s.key}:${s.voiceover.trim()}`);
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 24);
}

/**
 * Deterministic narration plan: normalize each scene's line for speech (numbers, ₪, dictionary), prepare the
 * provider payload, estimate speaking time. Used for the customer's quote AND by the worker, so the approved
 * estimate is computed from exactly the text that will be synthesized.
 */
export function planNarration(
  storyboard: Pick<Storyboard, 'scenes'>,
  options: NarrationPlanOptions,
): NarrationPlan {
  const ordered = [...storyboard.scenes].sort((a, b) => a.order - b.order);
  const segments: PlannedNarrationSegment[] = ordered
    .filter((s) => s.voiceover.trim())
    .map((scene, i, all) => {
      const normalized = normalizeHebrewForSpeech(scene.voiceover, { pronunciation: options.pronunciation });
      const speech = prepareForProvider(normalized.spoken, options.provider, {
        modelId: options.modelId,
        delivery: options.delivery,
        audioTags: options.audioTags,
        selectiveNiqqud: options.selectiveNiqqud,
        pauseAfterMs: i < all.length - 1 ? 250 : undefined,
      });
      const warnings = [
        ...normalized.warnings,
        ...speech.ambiguities
          .filter((a) => !a.applied)
          .map((a) => `AMBIGUOUS_WORD: "${a.word}" may be misread`),
      ];
      return {
        sceneKey: scene.key,
        original: scene.voiceover.trim(),
        spoken: normalized.spoken,
        speech,
        estimatedSec: estimateSpeechSec(normalized.spoken),
        warnings,
      };
    });
  const estimatedSec = Math.round(segments.reduce((sum, s) => sum + s.estimatedSec, 0) * 10) / 10;
  return {
    segments,
    characters: segments.reduce((sum, s) => sum + s.speech.characters, 0),
    estimatedSec,
    scriptCheck: assessScriptLength(estimatedSec, options.targetDurationSec),
    scriptHash: scriptHash(storyboard),
    warnings: segments.flatMap((s) => s.warnings.map((w) => `[${s.sceneKey}] ${w}`)),
  };
}
