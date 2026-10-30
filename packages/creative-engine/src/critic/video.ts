import {
  hasNiqqud,
  REELS_SAFE_AREA,
  VideoProjectSchema,
  type CriterionResult,
  type VideoProject,
} from '@kampora/shared';
import { timelineQa, type TimelineIssue } from '@kampora/production-engine';
import { measured, type Finding } from './report';

const SEVERITY: Partial<Record<TimelineIssue['code'], Finding['severity']>> = {
  VOICE_OVERRUN: 'CRITICAL',
  CAPTION_OUT_OF_SCENE: 'MAJOR',
  SLOW_HOOK: 'MAJOR',
  NO_CTA: 'MAJOR',
};

/**
 * The Critic on a built video timeline. Camera moves on still pictures are the only motion this pipeline makes;
 * the Critic checks that they vary and never claims subject motion that is not in the source media.
 */
export function critiqueVideo(project: VideoProject): CriterionResult[] {
  const qa = timelineQa(project);
  const from = (codes: TimelineIssue['code'][], correction?: string): Finding[] =>
    qa
      .filter((i) => codes.includes(i.code))
      .map((i) => ({
        severity: SEVERITY[i.code] ?? 'MINOR',
        explanation: `${i.code}: ${i.detail}.`,
        evidence: [i.sceneId ?? 'timeline'],
        correction,
        target: i.sceneId,
      }));
  const fps = project.output.fps;
  const first = project.scenes[0]!;

  const presets = project.scenes.map((s) =>
    s.visual.type === 'image-motion' ? s.visual.motion.preset : s.visual.type,
  );
  const motion: Finding[] = [];
  for (let i = 2; i < presets.length; i++)
    if (presets[i] === presets[i - 1] && presets[i] === presets[i - 2] && presets[i] !== 'video')
      motion.push(
        presets[i] === 'motion-graphics'
          ? {
              // Usually scenes that need real movement (people, an action): stills cannot fake it honestly.
              severity: 'MAJOR',
              explanation: 'Three graphic cards in a row: the video shows no picture for most of its length.',
              evidence: presets.slice(i - 2, i + 1),
              correction: 'Add photos or short clips of the business for these scenes.',
              component: 'OWNER',
              target: project.scenes[i]!.id,
            }
          : {
              severity: 'MAJOR',
              explanation: `Three scenes in a row use the same move (${presets[i]}).`,
              evidence: presets.slice(i - 2, i + 1),
              correction: 'Vary the camera move.',
              target: project.scenes[i]!.id,
            },
      );
  const stills = project.scenes.filter((s) => s.visual.type === 'image-motion').length;

  const sa = project.safeArea;
  const safe: Finding[] =
    sa.topPx < REELS_SAFE_AREA.topPx ||
    sa.bottomPx < REELS_SAFE_AREA.bottomPx ||
    sa.sidePx < REELS_SAFE_AREA.sidePx
      ? [
          {
            severity: 'MAJOR',
            explanation: 'The safe area is smaller than the Reels interface needs.',
            evidence: [JSON.stringify(sa)],
            correction: 'Use the Reels safe area.',
            component: 'LAYOUT_ENGINE',
          },
        ]
      : [];

  const onScreen = project.scenes.flatMap((s) => [
    ...s.overlays.flatMap((o) =>
      o.type === 'headline'
        ? [o.text]
        : o.type === 'cta'
          ? [o.text, o.subtext ?? '']
          : o.type === 'price-tag'
            ? [o.price, o.label ?? '']
            : [],
    ),
    s.caption?.text ?? '',
    ...(s.caption?.cues ?? []).map((c) => c.text),
  ]);
  const niqqud = onScreen.filter((x) => x && hasNiqqud(x));

  const ai = project.assets.filter(
    (a) =>
      a.provenance.source === 'AI_GENERATED' &&
      project.scenes.some(
        (s) => (s.visual.type === 'motion-graphics' ? s.visual.backgroundAssetId : s.visual.assetId) === a.id,
      ),
  );
  const parsed = VideoProjectSchema.safeParse(project);

  return [
    measured(
      'PACING',
      from(
        [
          'SLOW_HOOK',
          'SCENE_TOO_SHORT',
          'TOTAL_TOO_LONG',
          'TOTAL_TOO_SHORT',
          'TRANSITION_TOO_LONG',
          'NO_CTA',
          'CTA_TOO_SHORT',
        ],
        'Rebalance scene durations.',
      ),
      `Hook ${Math.round((first.durationInFrames / fps) * 10) / 10}s; scene lengths within limits.`,
    ),
    measured(
      'AUDIO_SYNC',
      from(
        ['VOICE_OVERRUN', 'CAPTION_OUT_OF_SCENE', 'DEAD_AIR', 'SILENT_GAP', 'MUSIC_NOT_DUCKED'],
        'Re-time the scene to its narration.',
      ),
      'Narration and captions fit their scenes.',
    ),
    measured(
      'SCENE_CONTINUITY',
      from(['REPEATED_SHOT'], 'Use another picture or move.'),
      'Consecutive scenes vary picture or move.',
    ),
    measured(
      'MOTION_APPROPRIATENESS',
      motion,
      `${stills} of ${project.scenes.length} scenes are still pictures with a camera move; no subject motion is implied.`,
      presets,
    ),
    measured('SAFE_ZONES', safe, 'Text inside the Reels safe area.', [JSON.stringify(sa)]),
    measured(
      'HEBREW_RENDERING',
      niqqud.length
        ? [
            {
              severity: 'MAJOR',
              explanation: 'On-screen text with niqqud.',
              evidence: niqqud,
              correction: 'Remove the niqqud.',
            },
          ]
        : [],
      'RTL text without niqqud.',
      [`direction: ${project.direction}`],
    ),
    measured(
      'PRODUCT_AUTHENTICITY',
      ai.length
        ? [
            {
              severity: 'MINOR',
              explanation: `${ai.length} AI picture(s): labelled for the owner as stand-ins.`,
              evidence: ai.map((a) => a.id),
            },
          ]
        : [],
      'Only the business’s own or licensed pictures.',
    ),
    measured(
      'TECHNICAL_CORRECTNESS',
      parsed.success
        ? []
        : [{ severity: 'CRITICAL', explanation: parsed.error.issues[0]?.message ?? 'Invalid project.' }],
      `${project.output.width}×${project.output.height} @ ${fps}fps, valid timeline.`,
    ),
  ];
}
