import { z } from 'zod';
import { BrandColorsSchema, LocaleSchema } from './common';
import { MotionPresetSchema } from './storyboard';

/**
 * VideoProject is the single source of truth for a rendered advertisement.
 * The MP4 is a disposable output of it. Bump `schemaVersion` on breaking changes.
 */

export const AssetSourceSchema = z.enum([
  'CUSTOMER_UPLOAD',
  'STOCK',
  'AI_GENERATED',
  'DEMO',
  'SYSTEM',
  'PROGRAMMATIC',
]);
export type AssetSource = z.infer<typeof AssetSourceSchema>;

export const AssetProvenanceSchema = z.object({
  source: AssetSourceSchema,
  license: z.string().min(1),
  commercialUse: z.boolean(),
  provider: z.string().optional(),
  notes: z.string().optional(),
});
export type AssetProvenance = z.infer<typeof AssetProvenanceSchema>;

export const MediaAssetSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['image', 'video', 'audio']),
  storageKey: z.string().min(1),
  mimeType: z.string().min(1),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSec: z.number().positive().optional(),
  provenance: AssetProvenanceSchema,
});
export type MediaAsset = z.infer<typeof MediaAssetSchema>;

export const MotionSpecSchema = z.object({
  preset: MotionPresetSchema,
  /** 0 = subtle, 1 = strong. */
  intensity: z.number().min(0).max(1).default(0.5),
  focalPoint: z
    .object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })
    .default({ x: 0.5, y: 0.5 }),
});
export type MotionSpec = z.infer<typeof MotionSpecSchema>;

export const SceneVisualSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('image-motion'), assetId: z.string(), motion: MotionSpecSchema }),
  z.object({ type: z.literal('video'), assetId: z.string(), trimStartSec: z.number().min(0).default(0) }),
  z.object({
    type: z.literal('motion-graphics'),
    template: z.enum(['brand-gradient', 'offer-card']),
    /** Optional background image shown subtly behind the graphics. */
    backgroundAssetId: z.string().optional(),
  }),
]);
export type SceneVisual = z.infer<typeof SceneVisualSchema>;

export const OverlaySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('headline'),
    text: z.string().min(1),
    position: z.enum(['top', 'center']).default('top'),
  }),
  z.object({
    type: z.literal('price-tag'),
    price: z.string().min(1),
    label: z.string().optional(),
    note: z.string().optional(),
  }),
  z.object({ type: z.literal('cta'), text: z.string().min(1), subtext: z.string().optional() }),
  z.object({ type: z.literal('logo'), assetId: z.string().optional() }),
]);
export type Overlay = z.infer<typeof OverlaySchema>;

export const TransitionSchema = z.object({
  type: z.enum(['none', 'fade', 'slide-up', 'zoom']),
  durationInFrames: z.number().int().min(0).max(30).default(8),
});
export type Transition = z.infer<typeof TransitionSchema>;

export const CaptionCueSchema = z.object({
  text: z.string().min(1),
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().positive(),
});
export type CaptionCue = z.infer<typeof CaptionCueSchema>;

export const TimelineSceneSchema = z.object({
  id: z.string().min(1),
  /** Storyboard scene key this timeline scene was built from (revision tracking). */
  sourceSceneKey: z.string(),
  durationInFrames: z.number().int().positive(),
  visual: SceneVisualSchema,
  overlays: z.array(OverlaySchema).default([]),
  /**
   * Customer-facing subtitle text: readable Hebrew, no niqqud. When narration exists, `cues` carry the timing
   * of each subtitle chunk (frames relative to the scene start), derived from the actual speech.
   */
  caption: z
    .object({
      text: z.string(),
      cues: z.array(CaptionCueSchema).optional(),
    })
    .optional(),
  voiceover: z
    .object({
      assetId: z.string(),
      volume: z.number().min(0).max(1).default(1),
      /** Narration starts this many frames after the scene starts (breathing room after the transition). */
      startOffsetFrames: z.number().int().min(0).default(0),
      /** Measured narration length (ffprobe), in frames. Used for music ducking. */
      durationInFrames: z.number().int().positive().optional(),
    })
    .optional(),
  transition: TransitionSchema.default({ type: 'fade', durationInFrames: 8 }),
});
export type TimelineScene = z.infer<typeof TimelineSceneSchema>;

export const SafeAreaSchema = z.object({
  topPx: z.number().int().nonnegative(),
  bottomPx: z.number().int().nonnegative(),
  sidePx: z.number().int().nonnegative(),
});
export type SafeArea = z.infer<typeof SafeAreaSchema>;

/**
 * Default Reels safe zone for 1080×1920, following Meta's published guidance (~14% top, ~35% bottom, ~6% sides
 * kept free of key text). Verify against current Meta guidance before relying on it for ad review.
 */
export const REELS_SAFE_AREA: SafeArea = { topPx: 270, bottomPx: 670, sidePx: 65 };

export const VideoProjectSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(1),
    title: z.string(),
    locale: LocaleSchema,
    direction: z.literal('rtl'),
    output: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      fps: z.number().int().min(1).max(60),
      codec: z.literal('h264'),
      crf: z.number().int().min(14).max(32).default(20),
    }),
    safeArea: SafeAreaSchema,
    branding: z.object({
      businessName: z.string().min(1),
      colors: BrandColorsSchema,
      fontFamily: z.enum(['Heebo']),
      logoAssetId: z.string().optional(),
    }),
    assets: z.array(MediaAssetSchema),
    scenes: z.array(TimelineSceneSchema).min(1),
    audio: z.object({
      music: z
        .object({
          assetId: z.string(),
          volume: z.number().min(0).max(1).default(0.35),
          fadeInSec: z.number().min(0).default(0.5),
          fadeOutSec: z.number().min(0).default(1),
          /** Music level while narration is speaking (ducking). */
          duckedVolume: z.number().min(0).max(1).default(0.1),
        })
        .optional(),
    }),
    captions: z.object({
      enabled: z.boolean(),
      maxWordsPerChunk: z.number().int().min(1).max(8).default(4),
    }),
  })
  .superRefine((project, ctx) => {
    const ids = new Set(project.assets.map((a) => a.id));
    const check = (assetId: string | undefined, path: (string | number)[]) => {
      if (assetId && !ids.has(assetId)) {
        ctx.addIssue({ code: 'custom', message: `Unknown asset "${assetId}"`, path });
      }
    };
    check(project.branding.logoAssetId, ['branding', 'logoAssetId']);
    check(project.audio.music?.assetId, ['audio', 'music', 'assetId']);
    project.scenes.forEach((scene, i) => {
      if (scene.visual.type === 'motion-graphics') {
        check(scene.visual.backgroundAssetId, ['scenes', i, 'visual', 'backgroundAssetId']);
      } else {
        check(scene.visual.assetId, ['scenes', i, 'visual', 'assetId']);
      }
      check(scene.voiceover?.assetId, ['scenes', i, 'voiceover', 'assetId']);
      scene.overlays.forEach((o, j) => {
        if (o.type === 'logo') check(o.assetId, ['scenes', i, 'overlays', j, 'assetId']);
      });
    });
  });
export type VideoProject = z.infer<typeof VideoProjectSchema>;
export type VideoProjectInput = z.input<typeof VideoProjectSchema>;

export function projectDurationInFrames(project: Pick<VideoProject, 'scenes'>): number {
  return project.scenes.reduce((sum, s) => sum + s.durationInFrames, 0);
}

/** Start frame of each scene, in order. Scenes are laid out back-to-back (transitions happen inside a scene). */
export function sceneStartFrames(project: Pick<VideoProject, 'scenes'>): number[] {
  const starts: number[] = [];
  let cursor = 0;
  for (const scene of project.scenes) {
    starts.push(cursor);
    cursor += scene.durationInFrames;
  }
  return starts;
}

/** Props passed to the Remotion composition: the project plus resolved, render-time asset URLs. */
export const RenderInputSchema = z.object({
  project: VideoProjectSchema,
  assetUrls: z.record(z.string(), z.string()),
  /** Output scale relative to project.output (0.5 for previews). */
  scale: z.number().min(0.25).max(1).default(1),
});
export type RenderInput = z.infer<typeof RenderInputSchema>;

/**
 * Version of the timeline-building and rendering rules (scene timing, pauses, text layout). Part of the production approval key, so
 * re-approving after a rules change rebuilds the timeline instead of reusing the old one.
 */
export const TIMELINE_RULES_VERSION = 'r7';

/**
 * Approval key of a timeline built from these inputs (also used by the web app to detect stale versions).
 * `imagesKey` (approved scene images) is only appended when present, so keys without images stay unchanged.
 */
export function timelineApprovalReason(narrationKey: string | null | undefined, imagesKey?: string): string {
  const base = `plan-approved:${TIMELINE_RULES_VERSION}:${narrationKey ?? 'no-narration'}`;
  return imagesKey ? `${base}:img:${imagesKey}` : base;
}
