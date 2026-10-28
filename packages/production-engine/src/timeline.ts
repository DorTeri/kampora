import {
  REELS_SAFE_AREA,
  VideoProjectSchema,
  stripNiqqud,
  type BusinessProfile,
  type CampaignBrief,
  type MediaAsset,
  type Overlay,
  type ProductionPlan,
  type SceneVisual,
  type Storyboard,
  type StoryboardScene,
  type TimelineScene,
  type SpeechCue,
  type Transition,
  type VideoProject,
} from '@kampora/shared';

export interface BuildVideoProjectInput {
  projectId: string;
  title: string;
  business: BusinessProfile;
  brief: CampaignBrief;
  storyboard: Storyboard;
  plan: ProductionPlan;
  /** Every asset the timeline may reference (brand assets + generated assets), with storage keys. */
  assets: readonly MediaAsset[];
  /**
   * Narration per storyboard scene key: measured duration (ffprobe) and subtitle cues in seconds relative to
   * the clip. Scene durations are recomputed from the real speech.
   */
  voiceovers?: Record<string, { assetId: string; durationSec: number; cues?: SpeechCue[] }>;
  musicAssetId?: string;
  logoAssetId?: string;
  fps?: number;
  width?: number;
  height?: number;
}

export class TimelineBuildError extends Error {}

const PRICE_RE = /(₪\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?₪)/;

export interface SceneTiming {
  /** Total scene length in frames. */
  durationInFrames: number;
  /** Narration starts this many frames into the scene. */
  voiceStartFrames: number;
  /** True when the scene had to grow beyond the storyboard duration to fit the speech. */
  extended: boolean;
}

/** Breathing room so words never collide with a transition, and the last line is never cut. */
const LEAD_IN_FIRST_SEC = 0.3;
const LEAD_IN_SEC = 0.2;
const TAIL_SEC = 0.4;
const TAIL_LAST_SEC = 1.0;

/**
 * Scene timing driven by real narration. Speech is never sped up or cut: the scene grows to fit
 * lead-in + speech + tail. When the storyboard scene is longer than the speech, the visuals keep their
 * planned length (a natural pause) — footage is never stretched or time-scaled to force a match.
 */
export function computeSceneTiming(
  storyboardSec: number,
  voiceSec: number | undefined,
  options: { fps: number; isFirst: boolean; isLast: boolean },
): SceneTiming {
  const { fps } = options;
  if (!voiceSec)
    return { durationInFrames: Math.round(storyboardSec * fps), voiceStartFrames: 0, extended: false };
  const leadIn = options.isFirst ? LEAD_IN_FIRST_SEC : LEAD_IN_SEC;
  const tail = options.isLast ? TAIL_LAST_SEC : TAIL_SEC;
  const needed = leadIn + voiceSec + tail;
  const durationSec = Math.max(storyboardSec, needed);
  return {
    durationInFrames: Math.ceil(durationSec * fps),
    voiceStartFrames: Math.round(leadIn * fps),
    extended: needed > storyboardSec + 0.05,
  };
}

function visualFor(scene: StoryboardScene, plan: ProductionPlan['scenes'][number]): SceneVisual {
  const assetId = plan.assetIds[0];
  switch (plan.strategy) {
    case 'EXISTING_VIDEO':
    case 'AI_IMAGE_TO_VIDEO':
    case 'AI_TEXT_TO_VIDEO':
      if (!assetId) throw new TimelineBuildError(`Scene "${scene.key}" has no produced video asset yet`);
      return { type: 'video', assetId, trimStartSec: 0 };
    case 'EXISTING_IMAGE_MOTION':
    case 'AI_IMAGE_MOTION':
    case 'LAYERED_PARALLAX':
      if (!assetId) throw new TimelineBuildError(`Scene "${scene.key}" has no image asset yet`);
      return {
        type: 'image-motion',
        assetId,
        motion: {
          preset: plan.strategy === 'LAYERED_PARALLAX' ? 'parallax' : scene.motion.preset,
          intensity: 0.5,
          focalPoint: { x: 0.5, y: 0.45 },
        },
      };
    case 'MOTION_GRAPHICS':
      return {
        type: 'motion-graphics',
        template: scene.role === 'OFFER' ? 'offer-card' : 'brand-gradient',
        backgroundAssetId: assetId,
      };
  }
}

function overlaysFor(scene: StoryboardScene, input: BuildVideoProjectInput): Overlay[] {
  const text = scene.onScreenText?.trim();
  if (scene.role === 'CTA') {
    return [
      { type: 'logo', assetId: input.logoAssetId },
      { type: 'cta', text: text || input.brief.cta, subtext: input.business.address },
    ];
  }
  if (!text) return [];
  const price = scene.role === 'OFFER' ? text.match(PRICE_RE)?.[0] : undefined;
  if (price) {
    const label = text
      .replace(price, '')
      .replace(/\s*(ב-|ב)\s*$/, '')
      .trim();
    return [{ type: 'price-tag', price: price.trim(), label: label || undefined }];
  }
  return [{ type: 'headline', text, position: 'top' }];
}

function transitionFor(scene: StoryboardScene, index: number): Transition {
  if (index === 0) return { type: 'fade', durationInFrames: 6 };
  if (scene.role === 'OFFER') return { type: 'zoom', durationInFrames: 10 };
  if (scene.role === 'CTA') return { type: 'slide-up', durationInFrames: 10 };
  return { type: 'fade', durationInFrames: 8 };
}

/**
 * Deterministically turns an approved storyboard + production plan into a renderable VideoProject.
 * No AI involved: the same inputs always produce the same timeline.
 */
export function buildVideoProject(input: BuildVideoProjectInput): VideoProject {
  const fps = input.fps ?? 30;
  const planByKey = new Map(input.plan.scenes.map((p) => [p.sceneKey, p]));
  const ordered = [...input.storyboard.scenes].sort((a, b) => a.order - b.order);

  const scenes: TimelineScene[] = ordered.map((scene, index) => {
    const plan = planByKey.get(scene.key);
    if (!plan) throw new TimelineBuildError(`No production plan for scene "${scene.key}"`);
    const voice = input.voiceovers?.[scene.key];
    const timing = computeSceneTiming(scene.durationSec, voice?.durationSec, {
      fps,
      isFirst: index === 0,
      isLast: index === ordered.length - 1,
    });
    const caption = stripNiqqud(scene.voiceover).trim();
    // Subtitle cues follow the speech: shift by the narration offset, clamp to the scene.
    const cues = voice?.cues?.length
      ? voice.cues
          .map((c) => ({
            text: stripNiqqud(c.text),
            startFrame: Math.min(
              timing.durationInFrames - 1,
              timing.voiceStartFrames + Math.round(c.startSec * fps),
            ),
            endFrame: Math.min(timing.durationInFrames, timing.voiceStartFrames + Math.round(c.endSec * fps)),
          }))
          .filter((c) => c.endFrame > c.startFrame)
      : undefined;
    return {
      id: `scene-${scene.key}`,
      sourceSceneKey: scene.key,
      durationInFrames: timing.durationInFrames,
      visual: visualFor(scene, plan),
      overlays: overlaysFor(scene, input),
      caption: caption ? { text: caption, cues } : undefined,
      voiceover: voice
        ? {
            assetId: voice.assetId,
            volume: 1,
            startOffsetFrames: timing.voiceStartFrames,
            durationInFrames: Math.max(1, Math.round(voice.durationSec * fps)),
          }
        : undefined,
      transition: transitionFor(scene, index),
    };
  });

  // Only ship assets the timeline actually references.
  const referenced = new Set<string>();
  for (const s of scenes) {
    if (s.visual.type === 'motion-graphics') {
      if (s.visual.backgroundAssetId) referenced.add(s.visual.backgroundAssetId);
    } else referenced.add(s.visual.assetId);
    if (s.voiceover) referenced.add(s.voiceover.assetId);
    for (const o of s.overlays) if (o.type === 'logo' && o.assetId) referenced.add(o.assetId);
  }
  if (input.musicAssetId) referenced.add(input.musicAssetId);
  if (input.logoAssetId) referenced.add(input.logoAssetId);

  return VideoProjectSchema.parse({
    schemaVersion: 1,
    id: input.projectId,
    title: input.title,
    locale: 'he-IL',
    direction: 'rtl',
    output: { width: input.width ?? 1080, height: input.height ?? 1920, fps, codec: 'h264', crf: 20 },
    safeArea: REELS_SAFE_AREA,
    branding: {
      businessName: input.business.name,
      colors: input.business.brandColors,
      fontFamily: 'Heebo',
      logoAssetId: input.logoAssetId,
    },
    assets: input.assets.filter((a) => referenced.has(a.id)),
    scenes,
    audio: {
      music: input.musicAssetId
        ? { assetId: input.musicAssetId, volume: 0.35, fadeInSec: 0.5, fadeOutSec: 1.2, duckedVolume: 0.1 }
        : undefined,
    },
    captions: { enabled: true, maxWordsPerChunk: 4 },
  });
}
