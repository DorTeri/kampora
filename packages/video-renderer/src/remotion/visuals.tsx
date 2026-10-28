import type { CSSProperties } from 'react';
import { AbsoluteFill, Img, OffthreadVideo, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { MediaAsset, MotionSpec, SceneVisual } from '@kampora/shared';
import { alpha, useAsset, useRenderContext } from './context';
import { cameraMotion, parallaxBackground, transformCss } from './motion';

const fill: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' };

function isVertical(asset: MediaAsset): boolean {
  if (!asset.width || !asset.height) return true; // unknown → assume it was prepared for 9:16
  const ratio = asset.width / asset.height;
  return ratio > 0.5 && ratio < 0.66;
}

/** Blurred, darkened cover copy of the image: fills 9:16 when the source has a different aspect ratio. */
function BlurredBackdrop({ src, transform }: { src: string; transform?: CSSProperties }) {
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Img
        src={src}
        style={{
          ...fill,
          objectFit: 'cover',
          filter: 'blur(48px) brightness(0.55) saturate(1.2)',
          scale: '1.25',
          ...transform,
        }}
      />
    </AbsoluteFill>
  );
}

export function ImageMotionScene({
  assetId,
  motion,
  duration,
}: {
  assetId: string;
  motion: MotionSpec;
  duration: number;
}) {
  const frame = useCurrentFrame();
  const resolved = useAsset(assetId)!;
  const vertical = isVertical(resolved.asset);
  const fg = cameraMotion(motion, frame, duration);

  if (motion.preset === 'parallax') {
    // Pseudo-depth from a single still: a slower, wider background layer and a framed foreground layer
    // moving in opposite directions.
    const bg = parallaxBackground(motion, frame, duration);
    return (
      <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: '#000' }}>
        <AbsoluteFill style={{ ...transformCss(bg) }}>
          <Img
            src={resolved.url}
            style={{ ...fill, objectFit: 'cover', filter: 'brightness(0.62) blur(3px)' }}
          />
        </AbsoluteFill>
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
          <div
            style={{
              width: '78%',
              height: '58%',
              borderRadius: 36,
              overflow: 'hidden',
              boxShadow: '0 40px 90px rgba(0,0,0,0.55)',
              ...transformCss(fg),
            }}
          >
            <Img src={resolved.url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: '#000' }}>
      {!vertical && <BlurredBackdrop src={resolved.url} />}
      <AbsoluteFill style={transformCss(fg)}>
        <Img src={resolved.url} style={{ ...fill, objectFit: vertical ? 'cover' : 'contain' }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

export function VideoScene({ assetId, trimStartSec }: { assetId: string; trimStartSec: number }) {
  const { fps } = useVideoConfig();
  const resolved = useAsset(assetId)!;
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {!isVertical(resolved.asset) && <BlurredBackdrop src={resolved.url} />}
      <OffthreadVideo
        src={resolved.url}
        muted
        trimBefore={Math.round(trimStartSec * fps)}
        style={{ ...fill, objectFit: isVertical(resolved.asset) ? 'cover' : 'contain' }}
      />
    </AbsoluteFill>
  );
}

export function MotionGraphicsScene({
  template,
  backgroundAssetId,
  duration,
}: {
  template: 'brand-gradient' | 'offer-card';
  backgroundAssetId?: string;
  duration: number;
}) {
  const frame = useCurrentFrame();
  const { project } = useRenderContext();
  const { colors } = project.branding;
  const bg = useAsset(backgroundAssetId);
  const t = frame / Math.max(1, duration);
  const angle = interpolate(t, [0, 1], [135, 165]);
  const drift = interpolate(t, [0, 1], [-60, 60]);

  return (
    <AbsoluteFill
      style={{
        background:
          template === 'offer-card'
            ? `linear-gradient(${angle}deg, ${colors.primary} 0%, ${alpha(colors.primary, 0.92)} 45%, ${colors.secondary} 130%)`
            : `linear-gradient(${angle}deg, ${colors.secondary} 0%, ${colors.primary} 100%)`,
        overflow: 'hidden',
      }}
    >
      {bg && (
        <Img
          src={bg.url}
          style={{
            ...fill,
            objectFit: 'cover',
            opacity: 0.22,
            filter: 'blur(6px) saturate(0.9)',
            scale: `${1.1 + 0.05 * t}`,
          }}
        />
      )}
      {/* Soft light orbs give depth and slow motion without distracting from the message. */}
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            position: 'absolute',
            width: 720 - i * 160,
            height: 720 - i * 160,
            borderRadius: '50%',
            left: 180 + i * 260 + drift * (i % 2 ? -1 : 1),
            top: 260 + i * 520 - drift * 0.6,
            background: `radial-gradient(circle, ${alpha(i === 1 ? colors.accent : colors.secondary, 0.35)} 0%, transparent 70%)`,
          }}
        />
      ))}
      <AbsoluteFill
        style={{
          backgroundImage: `repeating-linear-gradient(${angle + 90}deg, ${alpha('#ffffff', 0.025)} 0 2px, transparent 2px 18px)`,
        }}
      />
    </AbsoluteFill>
  );
}

export function SceneVisualView({ visual, duration }: { visual: SceneVisual; duration: number }) {
  switch (visual.type) {
    case 'image-motion':
      return <ImageMotionScene assetId={visual.assetId} motion={visual.motion} duration={duration} />;
    case 'video':
      return <VideoScene assetId={visual.assetId} trimStartSec={visual.trimStartSec} />;
    case 'motion-graphics':
      return (
        <MotionGraphicsScene
          template={visual.template}
          backgroundAssetId={visual.backgroundAssetId}
          duration={duration}
        />
      );
  }
}
