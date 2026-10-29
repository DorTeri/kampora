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
  type MotionPreset,
  type TimelineScene,
  type SpeechCue,
  type VideoProject,
} from '@kampora/shared';
import { chooseMotion, chooseTransition } from './motion-router';

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
  voiceovers?: Record<string, { assetId: string; durationSec: number; cues?: SpeechCue[]; slice?: boolean }>;
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
/** At most this much planned silence is kept after a line (social-ad pacing, no dead air). */
const MAX_EXTRA_PAUSE_SEC = 0.8;
/** The closing CTA (logo, button, address) stays on screen at least this long, even after a short line. */
const MIN_LAST_SCENE_SEC = 4.0;

/**
 * Scene timing driven by real narration. Speech is never sped up or cut: the scene always fits
 * lead-in + speech + tail. A planned scene that is longer than its line keeps at most MAX_EXTRA_PAUSE_SEC of
 * extra pause (beyond that it is dead air on a social ad); the last scene keeps the CTA readable. Footage is
 * never stretched or time-scaled — scenes only get shorter or longer cuts of the same motion.
 */
export function computeSceneTiming(
  storyboardSec: number,
  voiceSec: number | undefined,
  options: { fps: number; isFirst: boolean; isLast: boolean; slice?: boolean },
): SceneTiming {
  const { fps } = options;
  if (!voiceSec)
    return { durationInFrames: Math.round(storyboardSec * fps), voiceStartFrames: 0, extended: false };
  if (options.slice) {
    // A slice of one continuous recording already carries its natural pauses (it was cut mid-pause, on a frame).
    // Scenes play the slices back-to-back with nothing added, so the read sounds exactly as recorded; only the
    // opening breath and the CTA hold are added.
    const leadIn = options.isFirst ? LEAD_IN_FIRST_SEC : 0;
    const needed = leadIn + voiceSec + (options.isLast ? TAIL_LAST_SEC : 0);
    const durationSec = Math.max(needed, options.isLast ? MIN_LAST_SCENE_SEC : 0);
    return {
      durationInFrames: Math.round(durationSec * fps),
      voiceStartFrames: Math.round(leadIn * fps),
      extended: needed > storyboardSec + 0.05,
    };
  }
  const leadIn = options.isFirst ? LEAD_IN_FIRST_SEC : LEAD_IN_SEC;
  const tail = options.isLast ? TAIL_LAST_SEC : TAIL_SEC;
  const needed = leadIn + voiceSec + tail;
  const planned = Math.min(storyboardSec, needed + MAX_EXTRA_PAUSE_SEC);
  const durationSec = Math.max(planned, needed, options.isLast ? MIN_LAST_SCENE_SEC : 0);
  return {
    durationInFrames: Math.ceil(durationSec * fps),
    voiceStartFrames: Math.round(leadIn * fps),
    extended: needed > storyboardSec + 0.05,
  };
}

function visualFor(
  scene: StoryboardScene,
  plan: ProductionPlan['scenes'][number],
  motionContext: { previous?: MotionPreset; durationSec: number },
): SceneVisual {
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
        motion: chooseMotion(scene, { ...motionContext, parallax: plan.strategy === 'LAYERED_PARALLAX' })
          .motion,
      };
    case 'MOTION_GRAPHICS':
      return {
        type: 'motion-graphics',
        template: scene.role === 'OFFER' ? 'offer-card' : 'brand-gradient',
        backgroundAssetId: assetId,
      };
  }
}

const words = (text: string) =>
  stripNiqqud(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1);

/**
 * The CTA card (button + address) is the on-screen text of the closing scene. A caption that only repeats it
 * covers the picture and splits the address into fragments, so it is dropped; a caption that says something
 * the card does not (an extra reason to come) stays.
 */
function shownOnCtaCard(spoken: string, overlays: Overlay[]): boolean {
  const card = overlays.find((o) => o.type === 'cta');
  if (!card || card.type !== 'cta') return false;
  const shown = new Set(words(`${card.text} ${card.subtext ?? ''}`));
  const said = words(spoken);
  return said.length > 0 && said.filter((w) => shown.has(w)).length / said.length >= 0.8;
}

/** The button carries the call to action; the address goes underneath — never the same text twice. */
export function ctaCard(
  onScreenText: string | undefined,
  address: string | undefined,
  briefCta: string,
): { text: string; subtext?: string } {
  const text = onScreenText?.trim();
  const addr = address?.trim();
  const textIsAddress = Boolean(text && addr && (addr.includes(text) || text.includes(addr)));
  const buttonText = text && !textIsAddress ? text : briefCta;
  return { text: buttonText, subtext: addr && addr !== buttonText ? addr : undefined };
}

/** A price in on-screen offer text, split into the amount and the words around it. */
export function splitPrice(text: string): { price: string; label?: string } | undefined {
  const price = text.match(PRICE_RE)?.[0];
  if (!price) return undefined;
  const label = text
    .replace(price, '')
    .replace(/\s*(ב-|ב)\s*$/, '')
    .trim();
  return { price: price.trim(), label: label || undefined };
}

function overlaysFor(scene: StoryboardScene, input: BuildVideoProjectInput): Overlay[] {
  const text = scene.onScreenText?.trim();
  if (scene.role === 'CTA') {
    return [
      { type: 'logo', assetId: input.logoAssetId },
      { type: 'cta', ...ctaCard(text, input.business.address, input.brief.cta) },
    ];
  }
  if (!text) return [];
  const price = scene.role === 'OFFER' ? splitPrice(text) : undefined;
  if (price) return [{ type: 'price-tag', ...price }];
  return [{ type: 'headline', text, position: 'top' }];
}

/**
 * Deterministically turns an approved storyboard + production plan into a renderable VideoProject.
 * No AI involved: the same inputs always produce the same timeline.
 */
export function buildVideoProject(input: BuildVideoProjectInput): VideoProject {
  const fps = input.fps ?? 30;
  const planByKey = new Map(input.plan.scenes.map((p) => [p.sceneKey, p]));
  const ordered = [...input.storyboard.scenes].sort((a, b) => a.order - b.order);

  let previousPreset: MotionPreset | undefined;
  const scenes: TimelineScene[] = ordered.map((scene, index) => {
    const plan = planByKey.get(scene.key);
    if (!plan) throw new TimelineBuildError(`No production plan for scene "${scene.key}"`);
    const voice = input.voiceovers?.[scene.key];
    const timing = computeSceneTiming(scene.durationSec, voice?.durationSec, {
      fps,
      isFirst: index === 0,
      isLast: index === ordered.length - 1,
      slice: voice?.slice,
    });
    const visual = visualFor(scene, plan, {
      previous: previousPreset,
      durationSec: timing.durationInFrames / fps,
    });
    previousPreset = visual.type === 'image-motion' ? visual.motion.preset : undefined;
    const overlays = overlaysFor(scene, input);
    const spoken = stripNiqqud(scene.voiceover).trim();
    const caption = shownOnCtaCard(spoken, overlays) ? '' : spoken;
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
      visual,
      overlays,
      caption: caption ? { text: caption, cues } : undefined,
      voiceover: voice
        ? {
            assetId: voice.assetId,
            volume: 1,
            startOffsetFrames: timing.voiceStartFrames,
            durationInFrames: Math.max(1, Math.round(voice.durationSec * fps)),
          }
        : undefined,
      transition: chooseTransition(scene, index, timing.durationInFrames),
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
