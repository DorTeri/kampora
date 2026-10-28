import { z } from 'zod';

export const SceneRoleSchema = z.enum(['HOOK', 'PROBLEM', 'SOLUTION', 'PRODUCT', 'PROOF', 'OFFER', 'CTA']);
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
