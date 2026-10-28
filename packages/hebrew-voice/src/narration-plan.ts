import { createHash } from 'node:crypto';
import type { PronunciationEntry, Storyboard, VoiceStyle } from '@kampora/shared';
import { normalizeHebrewForSpeech } from './normalize';
import { prepareForProvider, type PreparedSpeech, type TtsProviderId, type VoiceDelivery } from './providers';
import { assessScriptLength, estimateSpeechSec, type ScriptLengthAssessment } from './speech-timing';
import { directScript, type DirectedScript } from './voice-director';

export interface NarrationPlanOptions {
  provider: TtsProviderId;
  modelId: string;
  pronunciation: PronunciationEntry[];
  targetDurationSec: number;
  delivery?: VoiceDelivery;
  /** Voice Director style. When set, every line is directed (price phrasing, pacing, settings) for this style. */
  style?: VoiceStyle;
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
  const style = options.style;
  const segments: PlannedNarrationSegment[] = ordered
    .filter((s) => s.voiceover.trim())
    .map((scene, i, all) => {
      if (style) {
        const directed = directScript([{ sceneKey: scene.key, text: scene.voiceover }], {
          ...options,
          style,
        });
        const line = directed.lines[0]!;
        return {
          sceneKey: scene.key,
          original: line.original,
          spoken: line.spoken,
          speech: {
            provider: options.provider,
            format: 'text' as const,
            payload: directed.payload,
            characters: directed.characters,
            settings: directed.settings,
            ambiguities: [],
          },
          estimatedSec: line.estimatedSec,
          warnings: line.warnings,
        };
      }
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

export interface ContinuousNarrationPlan {
  script: DirectedScript;
  estimatedSec: number;
  scriptCheck: ScriptLengthAssessment;
  scriptHash: string;
  warnings: string[];
}

/**
 * The whole storyboard script as ONE directed recording (continuous mode). The same function produces the
 * customer's quote and the worker's request, so the approved estimate covers exactly the text synthesized.
 */
export function planContinuousNarration(
  storyboard: Pick<Storyboard, 'scenes'>,
  options: NarrationPlanOptions & { style: VoiceStyle },
): ContinuousNarrationPlan {
  const ordered = [...storyboard.scenes].sort((a, b) => a.order - b.order);
  const script = directScript(
    ordered.map((s) => ({ sceneKey: s.key, text: s.voiceover })),
    options,
  );
  return {
    script,
    estimatedSec: script.estimatedSec,
    scriptCheck: assessScriptLength(script.estimatedSec, options.targetDurationSec),
    scriptHash: scriptHash(storyboard),
    warnings: script.warnings,
  };
}
