import { z } from 'zod';
import { ComplexitySchema, ConceptAngleSchema, MotionPresetSchema, SceneRoleSchema } from '@kampora/shared';

/**
 * Provider-facing output schemas. They follow OpenAI Structured Outputs rules (docs checked 2026-10-28):
 * every field required, "optional" expressed as nullable, no string-length keywords, arrays bounded with
 * min/max items. Results are mapped to (and re-validated by) the domain schemas in @kampora/shared.
 */

export const ConceptLlmSchema = z.object({
  title: z.string().describe('Short Hebrew concept title'),
  angle: ConceptAngleSchema,
  audience: z.string().describe('Who exactly this concept speaks to'),
  hook: z.string().describe('First 2 seconds: spoken + on-screen hook, Hebrew'),
  script: z.string().describe('Complete Hebrew voiceover script, spoken style'),
  mainMessage: z.string(),
  visualDirection: z.string(),
  cta: z.string(),
  rationale: z.string().describe('Why this angle fits the goal and audience'),
  complexity: ComplexitySchema,
  estimatedDurationSec: z.number().int().min(10).max(30),
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
  voiceover: z.string().describe('The part of the script spoken in this scene (Hebrew)'),
  onScreenText: z.string().nullable().describe('Max ~6 words, or null'),
  assetTags: z.array(z.string()).describe('Tags chosen ONLY from availableTags'),
  motionPreset: MotionPresetSchema,
  requiresHumanMotion: z.boolean(),
  requiresComplexAction: z.boolean(),
  requiresProductAccuracy: z.boolean(),
});
export type SceneLlm = z.infer<typeof SceneLlmSchema>;

export const StoryboardLlmSchema = z.object({
  scenes: z.array(SceneLlmSchema).min(3).max(6),
});
export type StoryboardLlm = z.infer<typeof StoryboardLlmSchema>;
