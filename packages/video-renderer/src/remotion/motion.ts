import type { CSSProperties } from 'react';
import { Easing, interpolate } from 'remotion';
import type { MotionSpec } from '@kampora/shared';

export interface LayerTransform {
  scale: number;
  /** Percent of the layer's own size. */
  x: number;
  y: number;
  blurPx: number;
  opacity: number;
}

const ease = Easing.bezier(0.33, 0, 0.2, 1);

/**
 * Programmatic camera motion for a still image. Pure function of scene progress so it is deterministic and
 * testable. Note: this moves a virtual camera over existing pixels; it cannot create subject motion.
 */
export function cameraMotion(motion: MotionSpec, frame: number, durationInFrames: number): LayerTransform {
  const t = ease(Math.min(1, Math.max(0, frame / Math.max(1, durationInFrames - 1))));
  const k = 0.4 + motion.intensity * 1.2; // 0.4 … 1.6
  const fx = (0.5 - motion.focalPoint.x) * 10;
  const fy = (0.5 - motion.focalPoint.y) * 10;
  const base: LayerTransform = { scale: 1, x: 0, y: 0, blurPx: 0, opacity: 1 };

  switch (motion.preset) {
    case 'ken-burns-in':
      return { ...base, scale: 1.04 + 0.14 * k * t, x: fx * t, y: fy * t };
    case 'ken-burns-out':
      return { ...base, scale: 1.04 + 0.14 * k * (1 - t), x: fx * (1 - t), y: fy * (1 - t) };
    case 'pan-left':
      return { ...base, scale: 1.18, x: interpolate(t, [0, 1], [5 * k, -5 * k]) };
    case 'pan-right':
      return { ...base, scale: 1.18, x: interpolate(t, [0, 1], [-5 * k, 5 * k]) };
    case 'cinematic-zoom': {
      const z = Easing.inOut(Easing.cubic)(Math.min(1, frame / Math.max(1, durationInFrames - 1)));
      return { ...base, scale: 1.02 + 0.22 * k * z, y: fy * z - 1.5 * z };
    }
    case 'product-reveal': {
      const reveal = Math.min(1, t / 0.35);
      return {
        ...base,
        scale: interpolate(t, [0, 1], [1.28, 1.04]),
        blurPx: interpolate(reveal, [0, 1], [14, 0]),
        opacity: interpolate(reveal, [0, 1], [0.2, 1]),
      };
    }
    case 'parallax':
      // Handled as two layers by the scene; this is the foreground layer.
      return { ...base, scale: 1 + 0.06 * k * t, x: interpolate(t, [0, 1], [-2 * k, 2 * k]) };
    case 'static':
      return { ...base, scale: 1.02 };
  }
}

/** Background layer for parallax: moves opposite to the foreground and slower, creating depth. */
export function parallaxBackground(
  motion: MotionSpec,
  frame: number,
  durationInFrames: number,
): LayerTransform {
  const t = ease(Math.min(1, frame / Math.max(1, durationInFrames - 1)));
  const k = 0.4 + motion.intensity * 1.2;
  return { scale: 1.25, x: interpolate(t, [0, 1], [3 * k, -3 * k]), y: 0, blurPx: 0, opacity: 1 };
}

export function transformCss(t: LayerTransform): CSSProperties {
  return {
    transform: `translate(${t.x}%, ${t.y}%) scale(${t.scale})`,
    filter: t.blurPx ? `blur(${t.blurPx}px)` : undefined,
    opacity: t.opacity,
  };
}
