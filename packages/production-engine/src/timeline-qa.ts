import { projectDurationInFrames, type VideoProject } from '@kampora/shared';

export interface TimelineIssue {
  code:
    | 'VOICE_OVERRUN'
    | 'CAPTION_OUT_OF_SCENE'
    | 'SCENE_TOO_SHORT'
    | 'TRANSITION_TOO_LONG'
    | 'SLOW_HOOK'
    | 'CTA_TOO_SHORT'
    | 'NO_CTA'
    | 'DEAD_AIR'
    | 'SILENT_GAP'
    | 'TOTAL_TOO_LONG'
    | 'TOTAL_TOO_SHORT'
    | 'REPEATED_SHOT'
    | 'MUSIC_NOT_DUCKED';
  /** Errors block production approval; warnings are shown for review. */
  severity: 'error' | 'warning';
  sceneId?: string;
  detail: string;
}

/**
 * Technical QA of a built timeline: things a machine can check reliably (sync, cut-off speech, pacing limits,
 * repetition). It does not judge whether the ad is good; that needs people.
 */
export function timelineQa(project: VideoProject): TimelineIssue[] {
  const fps = project.output.fps;
  const sec = (frames: number) => Math.round((frames / fps) * 10) / 10;
  const issues: TimelineIssue[] = [];
  const add = (issue: TimelineIssue) => issues.push(issue);
  const last = project.scenes.length - 1;

  project.scenes.forEach((scene, i) => {
    const next = project.scenes[i + 1];
    // The scene keeps playing under the next scene's transition, so speech may run into it, never beyond.
    const audibleEnd =
      scene.durationInFrames +
      (next && next.transition.type !== 'none' ? next.transition.durationInFrames : 0);
    const vo = scene.voiceover;
    const voiceEnd = vo?.durationInFrames ? vo.startOffsetFrames + vo.durationInFrames : undefined;
    if (voiceEnd !== undefined && voiceEnd > audibleEnd + 1)
      add({
        code: 'VOICE_OVERRUN',
        severity: 'error',
        sceneId: scene.id,
        detail: `narration ends at ${sec(voiceEnd)}s, scene ends at ${sec(audibleEnd)}s`,
      });
    for (const cue of scene.caption?.cues ?? [])
      if (cue.endFrame > scene.durationInFrames || cue.startFrame >= cue.endFrame)
        add({
          code: 'CAPTION_OUT_OF_SCENE',
          severity: 'error',
          sceneId: scene.id,
          detail: `caption "${cue.text}" ${cue.startFrame}-${cue.endFrame} outside 0-${scene.durationInFrames}`,
        });
    if (scene.durationInFrames < 1.2 * fps)
      add({
        code: 'SCENE_TOO_SHORT',
        severity: 'warning',
        sceneId: scene.id,
        detail: `${sec(scene.durationInFrames)}s`,
      });
    if (scene.transition.type !== 'none' && scene.transition.durationInFrames > scene.durationInFrames * 0.25)
      add({
        code: 'TRANSITION_TOO_LONG',
        severity: 'warning',
        sceneId: scene.id,
        detail: `${scene.transition.durationInFrames} of ${scene.durationInFrames} frames`,
      });
    if (i < last && voiceEnd !== undefined && scene.durationInFrames - voiceEnd > 1.2 * fps)
      add({
        code: 'DEAD_AIR',
        severity: 'warning',
        sceneId: scene.id,
        detail: `${sec(scene.durationInFrames - voiceEnd)}s without narration at the end of the scene`,
      });
    if (next?.voiceover?.durationInFrames && voiceEnd !== undefined) {
      const gap = scene.durationInFrames - voiceEnd + next.voiceover.startOffsetFrames;
      if (gap > 1.0 * fps)
        add({
          code: 'SILENT_GAP',
          severity: 'warning',
          sceneId: next.id,
          detail: `${sec(gap)}s between lines`,
        });
    }
    const prev = project.scenes[i - 1];
    if (
      prev &&
      prev.visual.type === 'image-motion' &&
      scene.visual.type === 'image-motion' &&
      prev.visual.assetId === scene.visual.assetId &&
      prev.visual.motion.preset === scene.visual.motion.preset
    )
      add({
        code: 'REPEATED_SHOT',
        severity: 'warning',
        sceneId: scene.id,
        detail: `same image and camera move as the previous scene`,
      });
  });

  const first = project.scenes[0]!;
  if (first.durationInFrames > 4 * fps)
    add({
      code: 'SLOW_HOOK',
      severity: 'warning',
      sceneId: first.id,
      detail: `hook lasts ${sec(first.durationInFrames)}s`,
    });
  const closing = project.scenes[last]!;
  if (!closing.overlays.some((o) => o.type === 'cta'))
    add({
      code: 'NO_CTA',
      severity: 'warning',
      sceneId: closing.id,
      detail: 'last scene has no call-to-action',
    });
  else if (closing.durationInFrames < 3 * fps)
    add({
      code: 'CTA_TOO_SHORT',
      severity: 'warning',
      sceneId: closing.id,
      detail: `call-to-action on screen ${sec(closing.durationInFrames)}s`,
    });

  const total = projectDurationInFrames(project);
  if (total > 30 * fps) add({ code: 'TOTAL_TOO_LONG', severity: 'warning', detail: `${sec(total)}s` });
  if (total < 6 * fps) add({ code: 'TOTAL_TOO_SHORT', severity: 'warning', detail: `${sec(total)}s` });

  const music = project.audio.music;
  if (music && project.scenes.some((s) => s.voiceover) && music.duckedVolume >= music.volume)
    add({ code: 'MUSIC_NOT_DUCKED', severity: 'warning', detail: 'music is not lowered under narration' });

  return issues;
}
