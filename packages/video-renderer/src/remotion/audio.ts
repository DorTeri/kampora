import { sceneStartFrames, type VideoProject } from '@kampora/shared';

export interface FrameSpan {
  start: number;
  end: number;
}

/** Absolute frame ranges where narration is audible. */
export function voiceSpans(project: Pick<VideoProject, 'scenes'>): FrameSpan[] {
  const starts = sceneStartFrames(project);
  return project.scenes.flatMap((scene, i) => {
    const vo = scene.voiceover;
    if (!vo?.durationInFrames) return [];
    const start = starts[i]! + vo.startOffsetFrames;
    return [{ start, end: start + vo.durationInFrames }];
  });
}

/**
 * Music gain multiplier (0..1) for ducking: drops to `duckRatio` while the voice speaks, with a short attack
 * before speech starts and a slower release after it ends, so the music never "pumps" abruptly.
 */
export function duckingGain(
  frame: number,
  spans: readonly FrameSpan[],
  duckRatio: number,
  attackFrames = 6,
  releaseFrames = 12,
): number {
  let gain = 1;
  for (const { start, end } of spans) {
    let g = 1;
    if (frame >= start && frame <= end) g = duckRatio;
    else if (frame < start && frame >= start - attackFrames) {
      g = 1 - (1 - duckRatio) * ((frame - (start - attackFrames)) / attackFrames);
    } else if (frame > end && frame <= end + releaseFrames) {
      g = duckRatio + (1 - duckRatio) * ((frame - end) / releaseFrames);
    }
    gain = Math.min(gain, g);
  }
  return gain;
}
