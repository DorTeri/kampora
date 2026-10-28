import type { MotionPreset, MotionSpec, ShotType, StoryboardScene, Transition } from '@kampora/shared';

/**
 * Camera moves that suit each framing. Programmatic motion only moves a virtual camera over existing pixels;
 * it never pretends the subject moves.
 */
const SHOT_PRESETS: Record<ShotType, MotionPreset[]> = {
  'extreme-close-up': ['cinematic-zoom', 'ken-burns-in', 'pan-left'],
  'close-up': ['ken-burns-in', 'product-reveal', 'pan-right'],
  medium: ['ken-burns-out', 'pan-left', 'ken-burns-in'],
  wide: ['pan-right', 'ken-burns-out', 'parallax'],
  overhead: ['ken-burns-in', 'pan-left', 'static'],
  detail: ['product-reveal', 'cinematic-zoom', 'ken-burns-in'],
  graphic: ['static', 'ken-burns-in'],
};

/** Fallback framing by role when the storyboard has no direction. */
const ROLE_SHOT: Record<StoryboardScene['role'], ShotType> = {
  HOOK: 'extreme-close-up',
  PROBLEM: 'medium',
  SOLUTION: 'medium',
  PRODUCT: 'close-up',
  DEMO: 'medium',
  BENEFIT: 'medium',
  PROOF: 'detail',
  OFFER: 'graphic',
  CTA: 'wide',
};

/** Where the subject usually sits for each framing (the camera drifts towards it). */
const SHOT_FOCUS: Record<ShotType, { x: number; y: number }> = {
  'extreme-close-up': { x: 0.5, y: 0.5 },
  'close-up': { x: 0.5, y: 0.47 },
  medium: { x: 0.5, y: 0.45 },
  wide: { x: 0.5, y: 0.42 },
  overhead: { x: 0.5, y: 0.5 },
  detail: { x: 0.5, y: 0.5 },
  graphic: { x: 0.5, y: 0.5 },
};

export interface MotionChoice {
  motion: MotionSpec;
  /** Why this move (internal, for review). */
  reason: string;
}

/**
 * Deterministic camera-move choice for an image scene. Keeps the storyboard's preset when it suits the
 * framing and does not repeat the previous scene; otherwise picks the first suitable alternative. Intensity
 * scales with time on screen: short scenes get gentle moves (no jitter), long ones a little more travel.
 */
export function chooseMotion(
  scene: StoryboardScene,
  options: { previous?: MotionPreset; durationSec: number; parallax?: boolean },
): MotionChoice {
  const shot = scene.direction?.shot ?? ROLE_SHOT[scene.role];
  const focalPoint = SHOT_FOCUS[shot];
  const intensity = Math.round(Math.min(0.7, Math.max(0.3, 0.25 + options.durationSec * 0.07)) * 100) / 100;
  if (options.parallax) {
    return { motion: { preset: 'parallax', intensity, focalPoint }, reason: 'layered parallax (depth)' };
  }
  const suitable = SHOT_PRESETS[shot];
  const requested = scene.motion.preset;
  if (requested !== options.previous && (suitable.includes(requested) || requested === 'product-reveal')) {
    return { motion: { preset: requested, intensity, focalPoint }, reason: `storyboard preset fits ${shot}` };
  }
  const preset = suitable.find((p) => p !== options.previous) ?? 'ken-burns-in';
  return {
    motion: { preset, intensity, focalPoint },
    reason:
      requested === options.previous
        ? `avoid repeating ${requested} from the previous scene`
        : `${requested} does not suit a ${shot} shot`,
  };
}

/**
 * Transition into a scene. Durations are capped at 20% of the scene so the cut never eats the content:
 * the hook fades in fast, the offer lands with a zoom, the CTA slides up; everything else crossfades.
 */
export function chooseTransition(
  scene: Pick<StoryboardScene, 'role'>,
  index: number,
  durationInFrames: number,
): Transition {
  const cap = Math.max(4, Math.floor(durationInFrames * 0.2));
  const pick = (type: Transition['type'], frames: number): Transition => ({
    type,
    durationInFrames: Math.min(frames, cap),
  });
  if (index === 0) return pick('fade', 6);
  if (scene.role === 'OFFER') return pick('zoom', 10);
  if (scene.role === 'CTA') return pick('slide-up', 10);
  return pick('fade', 8);
}
