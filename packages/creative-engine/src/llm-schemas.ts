import { z } from 'zod';
import {
  ComplexitySchema,
  ConceptAngleSchema,
  MotionPresetSchema,
  ProductionFormatSchema,
  SceneRoleSchema,
  ShotTypeSchema,
  VisualStyleSchema,
  VoiceStyleSchema,
} from '@kampora/shared';

/**
 * Provider-facing output schemas. They follow OpenAI Structured Outputs rules (docs checked 2026-10-28):
 * every field required, "optional" expressed as nullable, no string-length keywords, arrays bounded with
 * min/max items. Results are mapped to (and re-validated by) the domain schemas in @kampora/shared.
 */

export const ConceptLlmSchema = z.object({
  title: z.string().describe('Short Hebrew concept title'),
  angle: ConceptAngleSchema,
  audience: z.string().describe('Who exactly this concept speaks to'),
  hook: z.string().describe('The opening spoken line (max ~8 words), plain Hebrew, no labels or prefixes'),
  script: z
    .string()
    .describe('Complete Hebrew voiceover exactly as it appears in subtitles; numbers and prices as digits'),
  mainMessage: z.string(),
  visualDirection: z.string(),
  cta: z.string(),
  rationale: z.string().describe('Why this angle fits the goal and audience'),
  complexity: ComplexitySchema,
  estimatedDurationSec: z.number().int().min(10).max(30),
  objective: z.string().describe('The one thing this ad should achieve (Hebrew)'),
  insight: z
    .string()
    .describe('An audience truth the idea is built on: an observation, never an invented statistic'),
  hypothesis: z.string().describe('What this concept tests: "if we ..., then ... because ..." (Hebrew)'),
  storyStructure: z.array(z.string()).min(3).max(6).describe('Story beats in order (Hebrew, short)'),
  emotionalDirection: z.string(),
  visualStyle: VisualStyleSchema,
  productionFormat: ProductionFormatSchema,
  voiceStyle: VoiceStyleSchema,
});
export type ConceptLlm = z.infer<typeof ConceptLlmSchema>;

export const ConceptSetLlmSchema = z.object({
  concepts: z.array(ConceptLlmSchema).min(3).max(3),
  recommendedIndex: z.number().int().min(0).max(2),
  recommendationReason: z.string(),
});
export type ConceptSetLlm = z.infer<typeof ConceptSetLlmSchema>;

export const SceneLlmSchema = z.object({
  role: SceneRoleSchema,
  durationSec: z.number().min(2).max(10),
  visual: z.string().describe('What the viewer sees (Hebrew)'),
  visualKind: z.enum(['PHOTO', 'FOOTAGE', 'GRAPHIC']),
  voiceover: z
    .string()
    .describe('The line spoken in this scene, exactly as subtitled; numbers/prices as digits (e.g. 29.90 ₪)'),
  onScreenText: z.string().nullable().describe('Max ~6 words, or null'),
  assetTags: z.array(z.string()).describe('Tags chosen ONLY from availableTags'),
  motionPreset: MotionPresetSchema,
  requiresHumanMotion: z.boolean(),
  requiresComplexAction: z.boolean(),
  requiresProductAccuracy: z.boolean(),
  purpose: z.string().describe('What this scene must achieve for the viewer, one Hebrew sentence'),
  shot: ShotTypeSchema,
  editorNote: z
    .string()
    .nullable()
    .describe('Practical note for the editor (pacing, cut, emphasis), or null'),
});
export type SceneLlm = z.infer<typeof SceneLlmSchema>;

export const StoryboardLlmSchema = z.object({
  scenes: z.array(SceneLlmSchema).min(3).max(6),
});
export type StoryboardLlm = z.infer<typeof StoryboardLlmSchema>;
