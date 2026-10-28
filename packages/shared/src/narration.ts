import { z } from 'zod';

/** Subtitle timing in seconds, relative to the start of the narration clip. */
export const SpeechCueSchema = z.object({
  text: z.string().min(1),
  startSec: z.number().min(0),
  endSec: z.number().positive(),
});
export type SpeechCue = z.infer<typeof SpeechCueSchema>;

export const NarrationSegmentSchema = z.object({
  sceneKey: z.string(),
  assetId: z.string().uuid(),
  /** Measured with ffprobe from the generated audio. */
  durationSec: z.number().positive(),
  cues: z.array(SpeechCueSchema),
  /** provider: cue times come from the TTS character alignment; estimated: proportional fallback. */
  timing: z.enum(['provider', 'estimated']),
  cached: z.boolean(),
  spokenText: z.string(),
});
export type NarrationSegment = z.infer<typeof NarrationSegmentSchema>;

export const NarrationStatusSchema = z.enum(['QUEUED', 'RUNNING', 'READY', 'FAILED']);
export type NarrationStatus = z.infer<typeof NarrationStatusSchema>;

/** Narration state stored on the video project (one active narration per project). */
export const NarrationStateSchema = z.object({
  status: NarrationStatusSchema,
  provider: z.enum(['elevenlabs', 'mock', 'supplied']),
  voiceId: z.string(),
  voiceLabel: z.string(),
  modelId: z.string(),
  /** Hash of the storyboard voiceover lines the narration was generated from (stale detection). */
  scriptHash: z.string(),
  segments: z.array(NarrationSegmentSchema),
  totalSec: z.number().min(0),
  estimate: z.object({ characters: z.number().int().min(0), usd: z.number().min(0) }),
  warnings: z.array(z.string()),
  error: z.string().optional(),
  updatedAt: z.string(),
});
export type NarrationState = z.infer<typeof NarrationStateSchema>;

export const NARRATION_QUEUE_NAME = 'kampora-narration';

export const NarrationJobPayloadSchema = z.object({
  projectId: z.string().uuid(),
  orgId: z.string().uuid(),
});
export type NarrationJobPayload = z.infer<typeof NarrationJobPayloadSchema>;

/** A voice the business can choose (configured by ops; never discovered from the browser). */
export const VoiceOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  provider: z.enum(['elevenlabs', 'mock', 'supplied']),
  modelId: z.string(),
  gender: z.enum(['female', 'male', 'neutral']).optional(),
  description: z.string().optional(),
});
export type VoiceOption = z.infer<typeof VoiceOptionSchema>;
