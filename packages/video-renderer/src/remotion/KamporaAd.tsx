import type { CSSProperties } from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import {
  projectDurationInFrames,
  sceneStartFrames,
  type RenderInput,
  type TimelineScene,
} from '@kampora/shared';
import { FONT_FAMILY, RenderContext, useAsset } from './context';
import { SceneVisualView } from './visuals';
import { AnimatedCaption, OverlayView } from './overlays';

export const COMPOSITION_ID = 'KamporaAd';

function transitionStyle(scene: TimelineScene, frame: number): CSSProperties {
  const { type, durationInFrames } = scene.transition;
  if (type === 'none' || durationInFrames === 0) return {};
  const p = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  switch (type) {
    case 'fade':
      return { opacity: p };
    case 'slide-up':
      return { opacity: p, transform: `translateY(${interpolate(p, [0, 1], [140, 0])}px)` };
    case 'zoom':
      return { opacity: p, transform: `scale(${interpolate(p, [0, 1], [1.12, 1])})` };
  }
}

/** Gradient scrims keep white text legible on any photo. */
function Scrims() {
  return (
    <>
      <AbsoluteFill
        style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 28%)' }}
      />
      <AbsoluteFill style={{ background: 'linear-gradient(0deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0) 40%)' }} />
    </>
  );
}

function SceneView({ scene, captionsEnabled }: { scene: TimelineScene; captionsEnabled: boolean }) {
  const frame = useCurrentFrame();
  const voice = useAsset(scene.voiceover?.assetId);
  return (
    <AbsoluteFill style={transitionStyle(scene, frame)}>
      <SceneVisualView visual={scene.visual} duration={scene.durationInFrames} />
      {scene.visual.type !== 'motion-graphics' && <Scrims />}
      {scene.overlays.map((overlay, i) => (
        <OverlayView key={i} overlay={overlay} />
      ))}
      {captionsEnabled && scene.caption && (
        <AnimatedCaption text={scene.caption.text} durationInFrames={scene.durationInFrames} />
      )}
      {voice && <Audio src={voice.url} volume={scene.voiceover!.volume} />}
    </AbsoluteFill>
  );
}

function MusicBed({
  assetId,
  volume,
  fadeInSec,
  fadeOutSec,
}: {
  assetId: string;
  volume: number;
  fadeInSec: number;
  fadeOutSec: number;
}) {
  const { fps, durationInFrames } = useVideoConfig();
  const music = useAsset(assetId)!;
  return (
    <Audio
      src={music.url}
      loop
      volume={(f) =>
        volume *
        interpolate(
          f,
          [
            0,
            Math.max(1, fadeInSec * fps),
            durationInFrames - Math.max(1, fadeOutSec * fps),
            durationInFrames,
          ],
          [0, 1, 1, 0],
          { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
        )
      }
    />
  );
}

/**
 * The single, tested composition every Kampora ad is rendered with. It is driven entirely by the validated
 * VideoProject JSON; no per-ad React code is ever generated.
 */
export function KamporaAd({ project, assetUrls }: RenderInput) {
  const starts = sceneStartFrames(project);
  const total = projectDurationInFrames(project);
  return (
    <RenderContext.Provider value={{ project, assetUrls }}>
      <AbsoluteFill style={{ backgroundColor: '#000', fontFamily: FONT_FAMILY, direction: 'rtl' }}>
        {project.scenes.map((scene, i) => {
          // Each scene lingers under the next one for the next scene's transition, giving a true crossfade
          // without shifting any scene's start time.
          const next = project.scenes[i + 1];
          const linger = next && next.transition.type !== 'none' ? next.transition.durationInFrames : 0;
          return (
            <Sequence
              key={scene.id}
              from={starts[i]}
              durationInFrames={Math.min(scene.durationInFrames + linger, total - starts[i]!)}
              name={scene.sourceSceneKey}
            >
              <SceneView scene={scene} captionsEnabled={project.captions.enabled} />
            </Sequence>
          );
        })}
        {project.audio.music && <MusicBed {...project.audio.music} />}
      </AbsoluteFill>
    </RenderContext.Provider>
  );
}
