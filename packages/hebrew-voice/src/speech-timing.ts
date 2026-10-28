/**
 * Speaking-time estimates for Hebrew ad narration, used BEFORE any audio exists (script-length checks,
 * cost/duration quotes). After generation, real durations come from ffprobe and replace these estimates.
 *
 * Calibration: ~14 spoken characters per second (incl. spaces) is a typical natural Israeli ad read.
 * Recalibrate with measured ElevenLabs output (see docs/VOICE_ENGINE.md).
 */
export const DEFAULT_CHARS_PER_SECOND = 14;
const PAUSE_SEC = 0.25;

export function estimateSpeechSec(spokenText: string, charsPerSecond = DEFAULT_CHARS_PER_SECOND): number {
  const text = spokenText.trim();
  if (!text) return 0;
  const pauses = (text.match(/[.!?…,:;–-](\s|$)/g) ?? []).length;
  return Math.round((text.length / charsPerSecond + pauses * PAUSE_SEC) * 100) / 100;
}

export type ScriptLengthStatus = 'OK' | 'LONG' | 'TOO_LONG';

export interface ScriptLengthAssessment {
  status: ScriptLengthStatus;
  estimatedSec: number;
  targetSec: number;
  /** Hebrew, customer-facing. */
  message?: string;
}

/**
 * Narration must fit the ad. We never speed speech up to fit: a script that is too long must be shortened.
 * LONG = scenes will be stretched noticeably; TOO_LONG = blocks narration until the script is shortened.
 */
export function assessScriptLength(
  estimatedSec: number,
  targetSec: number,
  hardMaxSec = 45,
): ScriptLengthAssessment {
  const longLimit = targetSec * 1.15 + 1;
  const tooLongLimit = Math.min(hardMaxSec, targetSec * 1.4 + 2);
  if (estimatedSec > tooLongLimit) {
    return {
      status: 'TOO_LONG',
      estimatedSec,
      targetSec,
      message: `התסריט ארוך מדי: כ-${Math.round(estimatedSec)} שניות דיבור לסרטון של ${targetSec} שניות. צריך לקצר לפני ההקלטה.`,
    };
  }
  if (estimatedSec > longLimit) {
    return {
      status: 'LONG',
      estimatedSec,
      targetSec,
      message: `התסריט מעט ארוך (כ-${Math.round(estimatedSec)} שניות). הסרטון יתארך בהתאם.`,
    };
  }
  return { status: 'OK', estimatedSec, targetSec };
}
