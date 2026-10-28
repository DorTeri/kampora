import { z } from 'zod';
import { VisualStyleSchema } from './campaign';
import { ShotTypeSchema } from './storyboard';

/** Image formats Kampora produces: Reels/Stories, feed portrait, feed square. */
export const ImageAspectSchema = z.enum(['9:16', '4:5', '1:1']);
export type ImageAspect = z.infer<typeof ImageAspectSchema>;

/**
 * Everything needed to generate (or regenerate) one scene image, decided deterministically before any provider
 * call. The prompt is derived from it; the fingerprint identifies the exact request so identical requests are
 * reused instead of paid for again.
 */
export const VisualScenePlanSchema = z.object({
  sceneKey: z.string(),
  aspect: ImageAspectSchema,
  style: VisualStyleSchema,
  /** What is in the picture (the scene's visual description). */
  subject: z.string().min(1),
  shot: ShotTypeSchema,
  lighting: z.string(),
  mood: z.string(),
  /** Brand colors (#hex) used as accents, never as text. */
  palette: z.array(z.string()),
  /** Shared across all scenes of one ad, so the images look like one shoot. */
  look: z.string(),
  /** Customer photos sent as references (product accuracy). */
  referenceAssetIds: z.array(z.string()),
  /** Areas the renderer will cover with overlays: keep them calm. */
  overlaySafeZones: z.string(),
  /** Things the image must not contain. Always includes text/letters/logos. */
  avoid: z.array(z.string()),
  /** The final provider prompt. */
  prompt: z.string(),
  /** Regeneration variant (0 = first attempt). Part of the fingerprint. */
  variant: z.number().int().nonnegative(),
  fingerprint: z.string(),
});
export type VisualScenePlan = z.infer<typeof VisualScenePlanSchema>;

export const SceneImageDecisionSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);
export type SceneImageDecision = z.infer<typeof SceneImageDecisionSchema>;

/** Queue payload: generate one scene image version. */
export const SceneImageJobPayloadSchema = z.object({
  orgId: z.string().uuid(),
  sceneImageId: z.string().uuid(),
});
export type SceneImageJobPayload = z.infer<typeof SceneImageJobPayloadSchema>;

/** Stable key of the approved scene images (part of the timeline approval key). Empty when there are none. */
export function sceneImagesKey(images: readonly { sceneKey: string; assetId: string }[]): string {
  return [...images]
    .sort((a, b) => a.sceneKey.localeCompare(b.sceneKey))
    .map((i) => `${i.sceneKey}=${i.assetId}`)
    .join(',');
}
