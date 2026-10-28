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
  /** Voiceover audio per storyboard scene key; scene duration grows to fit the narration. */
  voiceovers?: Record<string, { assetId: string; durationSec: number }>;
  musicAssetId?: string;
  logoAssetId?: string;
  fps?: number;
  width?: number;
  height?: number;
}

export class TimelineBuildError extends Error {}

const PRICE_RE = /(₪\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?₪)/;
const VOICE_TAIL_SEC = 0.4;

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
    const durationSec = Math.max(scene.durationSec, voice ? voice.durationSec + VOICE_TAIL_SEC : 0);
    const caption = stripNiqqud(scene.voiceover).trim();
    return {
      id: `scene-${scene.key}`,
      sourceSceneKey: scene.key,
      durationInFrames: Math.round(durationSec * fps),
      visual: visualFor(scene, plan),
      overlays: overlaysFor(scene, input),
      caption: caption ? { text: caption } : undefined,
      voiceover: voice ? { assetId: voice.assetId, volume: 1 } : undefined,
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
        ? { assetId: input.musicAssetId, volume: 0.35, fadeInSec: 0.5, fadeOutSec: 1.2 }
        : undefined,
    },
    captions: { enabled: true, maxWordsPerChunk: 4 },
  });
}
