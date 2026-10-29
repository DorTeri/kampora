import { z } from 'zod';

export const SceneRoleSchema = z.enum([
  'HOOK',
  'PROBLEM',
  'SOLUTION',
  'PRODUCT',
  'DEMO',
  'BENEFIT',
  'PROOF',
  'OFFER',
  'CTA',
]);
export type SceneRole = z.infer<typeof SceneRoleSchema>;

export const ProductionStrategySchema = z.enum([
  'EXISTING_VIDEO',
  'EXISTING_IMAGE_MOTION',
  'AI_IMAGE_MOTION',
  'LAYERED_PARALLAX',
  'MOTION_GRAPHICS',
  'AI_IMAGE_TO_VIDEO',
  'AI_TEXT_TO_VIDEO',
]);
export type ProductionStrategy = z.infer<typeof ProductionStrategySchema>;

export const MotionPresetSchema = z.enum([
  'ken-burns-in',
  'ken-burns-out',
  'pan-left',
  'pan-right',
  'cinematic-zoom',
  'product-reveal',
  'parallax',
  'static',
]);
export type MotionPreset = z.infer<typeof MotionPresetSchema>;

export const AssetRequirementSchema = z.object({
  kind: z.enum(['image', 'video', 'logo']),
  description: z.string(),
  /** Tags used to match existing assets, e.g. ["coffee", "close-up"]. */
  tags: z.array(z.string()).default([]),
  preferredAssetId: z.string().optional(),
});
export type AssetRequirement = z.infer<typeof AssetRequirementSchema>;

/**
 * What the scene genuinely needs. The router uses these flags to decide whether programmatic motion
 * is enough or whether real/generated footage is required.
 */
export const SceneQualitySchema = z.object({
  /** A person must visibly move (walk, gesture, speak). Programmatic motion cannot fake this. */
  requiresHumanMotion: z.boolean().default(false),
  /** A complex physical action must be shown (pouring, cooking, unboxing in motion). */
  requiresComplexAction: z.boolean().default(false),
  /** The real product must be shown accurately (no generated look-alikes without a reference). */
  requiresProductAccuracy: z.boolean().default(false),
  brandCritical: z.boolean().default(false),
});
export type SceneQuality = z.infer<typeof SceneQualitySchema>;

/** Framing an editor/photographer can act on. Consecutive scenes should not repeat the same framing and motion. */
export const ShotTypeSchema = z.enum([
  'extreme-close-up',
  'close-up',
  'medium',
  'wide',
  'overhead',
  'detail',
  'graphic',
]);
export type ShotType = z.infer<typeof ShotTypeSchema>;

/**
 * What the picture must contain, as opposed to how the camera frames it. When the two disagree (an assortment
 * asked for as a macro detail shot), the composition wins: it is what the scene is for.
 */
export const CompositionTypeSchema = z.enum([
  /** One product (or one pairing, e.g. coffee and pastry) as the hero. */
  'SINGLE_HERO',
  /** Several products together: a spread, a selection, a tray. */
  'ASSORTMENT',
  /** People using or enjoying the product in a real moment. */
  'LIFESTYLE',
  /** One meaningful detail of the product: texture, a cut, a pour. */
  'DETAIL',
  /** The place itself: storefront, interior, atmosphere. */
  'ENVIRONMENT',
  /** The product being made, prepared or used, step visible. */
  'DEMONSTRATION',
]);
export type CompositionType = z.infer<typeof CompositionTypeSchema>;

/** Something that must be visible in the picture, with an approximate count. */
export const SceneSubjectSchema = z.object({
  name: z.string().trim().min(1).max(60),
  /** Approximate number visible (1 = exactly one); absent = any. */
  quantity: z.number().int().min(1).max(24).optional(),
});
export type SceneSubject = z.infer<typeof SceneSubjectSchema>;

export const SceneCompositionSchema = z.object({
  type: CompositionTypeSchema,
  /** Required subjects, most important first. */
  subjects: z.array(SceneSubjectSchema).max(6).default([]),
});
export type SceneComposition = z.infer<typeof SceneCompositionSchema>;

/** Editor guidance for one scene (Phase 3 storyboards; older ones have none). */
export const SceneDirectionSchema = z.object({
  /** What this scene must achieve for the viewer, in one sentence. */
  purpose: z.string().min(1),
  shot: ShotTypeSchema,
  /** Practical note for the editor (pacing, cut, what to emphasize), or empty. */
  editorNote: z.string().optional(),
  /** What the picture must contain. Older storyboards have none; it is then inferred from the visual. */
  composition: SceneCompositionSchema.optional(),
});
export type SceneDirection = z.infer<typeof SceneDirectionSchema>;

export const StoryboardSceneSchema = z.object({
  key: z.string().regex(/^[a-z0-9-]+$/),
  order: z.number().int().nonnegative(),
  role: SceneRoleSchema,
  durationSec: z.number().min(1.5).max(12),
  /** Visual description for humans and for image generation prompts. */
  visual: z.string().min(1),
  /** Primary visual medium the scene calls for. */
  visualKind: z.enum(['PHOTO', 'FOOTAGE', 'GRAPHIC']),
  voiceover: z.string(),
  onScreenText: z.string().optional(),
  requiredAssets: z.array(AssetRequirementSchema),
  motion: z.object({ preset: MotionPresetSchema, notes: z.string().optional() }),
  quality: SceneQualitySchema,
  direction: SceneDirectionSchema.optional(),
});
export type StoryboardScene = z.infer<typeof StoryboardSceneSchema>;

export const StoryboardSchema = z
  .object({
    conceptKey: z.string(),
    aspectRatio: z.literal('9:16'),
    scenes: z.array(StoryboardSceneSchema).min(3).max(8),
  })
  .refine((s) => new Set(s.scenes.map((x) => x.key)).size === s.scenes.length, {
    message: 'Scene keys must be unique',
  })
  .refine(
    (s) => {
      const total = s.scenes.reduce((sum, x) => sum + x.durationSec, 0);
      return total >= 10 && total <= 60;
    },
    { message: 'Total storyboard duration must be between 10 and 60 seconds' },
  );
export type Storyboard = z.infer<typeof StoryboardSchema>;

export function storyboardDurationSec(storyboard: Pick<Storyboard, 'scenes'>): number {
  return storyboard.scenes.reduce((sum, s) => sum + s.durationSec, 0);
}
