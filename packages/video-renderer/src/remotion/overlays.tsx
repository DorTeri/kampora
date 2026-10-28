import type { CSSProperties } from 'react';
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { chunkCaption, stripNiqqud, type CaptionCue, type Overlay } from '@kampora/shared';
import { FONT_FAMILY, alpha, useAsset, useRenderContext } from './context';

const textBase: CSSProperties = {
  fontFamily: FONT_FAMILY,
  direction: 'rtl',
  unicodeBidi: 'plaintext',
  textAlign: 'center',
  margin: 0,
};

function usePop(delay: number, damping = 14) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping, stiffness: 140, mass: 0.7 } });
}

/** Word-by-word reveal of a short headline in the top safe area. */
export function HeadlineOverlay({ text, position }: { text: string; position: 'top' | 'center' }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { project } = useRenderContext();
  const { safeArea } = project;
  const words = stripNiqqud(text).split(/\s+/);
  return (
    <AbsoluteFill
      style={{
        justifyContent: position === 'top' ? 'flex-start' : 'center',
        alignItems: 'center',
        paddingTop: position === 'top' ? safeArea.topPx + 10 : 0,
        paddingInline: safeArea.sidePx + 30,
      }}
    >
      <h1
        dir="rtl"
        style={{
          ...textBase,
          fontSize: 84,
          fontWeight: 900,
          lineHeight: 1.12,
          color: '#fff',
          textShadow: '0 6px 28px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.5)',
          letterSpacing: -0.5,
        }}
      >
        {words.map((word, i) => {
          const p = spring({ frame: frame - 4 - i * 3, fps, config: { damping: 16, stiffness: 160 } });
          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                opacity: p,
                transform: `translateY(${interpolate(p, [0, 1], [30, 0])}px)`,
                marginInline: 10,
              }}
            >
              {word}
            </span>
          );
        })}
      </h1>
    </AbsoluteFill>
  );
}

/** The offer: label + big price in a brand-colored card. Prices are always live text, never baked into images. */
export function PriceTag({ price, label, note }: { price: string; label?: string; note?: string }) {
  const { project } = useRenderContext();
  const { colors } = project.branding;
  const frame = useCurrentFrame();
  const enter = usePop(6, 12);
  const pricePop = usePop(14, 9);
  const pulse = 1 + 0.025 * Math.sin((frame - 30) / 6) * (frame > 30 ? 1 : 0);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 420 }}>
      <div
        style={{
          transform: `scale(${interpolate(enter, [0, 1], [0.85, 1])})`,
          opacity: enter,
          background: alpha('#ffffff', 0.96),
          borderRadius: 56,
          padding: '64px 72px 72px',
          width: 820,
          boxShadow: '0 50px 120px rgba(0,0,0,0.45)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 26,
        }}
      >
        {label && (
          <p
            dir="rtl"
            style={{ ...textBase, fontSize: 76, fontWeight: 800, color: colors.text, lineHeight: 1.1 }}
          >
            {stripNiqqud(label)}
          </p>
        )}
        <div
          style={{
            transform: `scale(${interpolate(pricePop, [0, 1], [0.6, 1]) * pulse})`,
            background: colors.accent,
            color: colors.primary,
            borderRadius: 999,
            padding: '18px 64px',
          }}
        >
          {/* Isolated RTL run: the same visual order as the price inside Hebrew subtitles. */}
          <bdi
            dir="rtl"
            style={{
              ...textBase,
              display: 'block',
              fontSize: 132,
              fontWeight: 900,
              lineHeight: 1.05,
              whiteSpace: 'nowrap',
            }}
          >
            {price}
          </bdi>
        </div>
        {note && (
          <p dir="rtl" style={{ ...textBase, fontSize: 40, fontWeight: 500, color: alpha(colors.text, 0.7) }}>
            {note}
          </p>
        )}
      </div>
    </AbsoluteFill>
  );
}

export function CtaOverlay({ text, subtext }: { text: string; subtext?: string }) {
  const { project } = useRenderContext();
  const { colors } = project.branding;
  const frame = useCurrentFrame();
  const enter = usePop(10, 13);
  const shimmer = interpolate((frame % 60) / 60, [0, 1], [-120, 220]);
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: 180 }}>
      <div
        style={{
          opacity: enter,
          transform: `translateY(${interpolate(enter, [0, 1], [80, 0])}px)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 26,
        }}
      >
        <div
          style={{
            position: 'relative',
            overflow: 'hidden',
            background: colors.accent,
            color: colors.primary,
            borderRadius: 999,
            padding: '30px 72px',
            boxShadow: `0 24px 60px ${alpha(colors.accent, 0.45)}`,
          }}
        >
          <p dir="rtl" style={{ ...textBase, fontSize: 66, fontWeight: 900 }}>
            {stripNiqqud(text)}
          </p>
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: 80,
              left: `${shimmer}%`,
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)',
              transform: 'skewX(-20deg)',
            }}
          />
        </div>
        {subtext && (
          <p
            dir="rtl"
            style={{
              ...textBase,
              fontSize: 46,
              fontWeight: 700,
              color: '#fff',
              textShadow: '0 3px 14px rgba(0,0,0,0.6)',
            }}
          >
            {stripNiqqud(subtext)}
          </p>
        )}
      </div>
    </AbsoluteFill>
  );
}

export function LogoBadge({ assetId }: { assetId?: string }) {
  const { project } = useRenderContext();
  const { colors, businessName } = project.branding;
  const logo = useAsset(assetId);
  const enter = usePop(2, 12);
  return (
    <AbsoluteFill
      style={{ alignItems: 'center', justifyContent: 'flex-start', paddingTop: project.safeArea.topPx + 40 }}
    >
      <div
        style={{
          transform: `scale(${interpolate(enter, [0, 1], [0.5, 1])}) rotate(${interpolate(enter, [0, 1], [-8, 0])}deg)`,
          opacity: enter,
          width: 300,
          height: 300,
          borderRadius: '50%',
          background: colors.background,
          border: `10px solid ${colors.accent}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
          overflow: 'hidden',
        }}
      >
        {logo ? (
          <Img src={logo.url} style={{ width: '80%', height: '80%', objectFit: 'contain' }} />
        ) : (
          <span
            style={{ ...textBase, fontSize: 110, fontWeight: 900, color: colors.primary, letterSpacing: -2 }}
          >
            {businessName}
          </span>
        )}
      </div>
    </AbsoluteFill>
  );
}

export function OverlayView({ overlay }: { overlay: Overlay }) {
  switch (overlay.type) {
    case 'headline':
      return <HeadlineOverlay text={overlay.text} position={overlay.position} />;
    case 'price-tag':
      return <PriceTag price={overlay.price} label={overlay.label} note={overlay.note} />;
    case 'cta':
      return <CtaOverlay text={overlay.text} subtext={overlay.subtext} />;
    case 'logo':
      return <LogoBadge assetId={overlay.assetId} />;
  }
}

/** Hebrew RTL subtitles: short chunks inside the bottom safe area, readable without niqqud. */
export function AnimatedCaption({
  text,
  cues,
  durationInFrames,
}: {
  text: string;
  /** Speech-timed cues (from narration). Without them, chunks are spread over the scene. */
  cues?: CaptionCue[];
  durationInFrames: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { project } = useRenderContext();
  const chunks = cues?.length
    ? cues.map((c) => ({ text: stripNiqqud(c.text), startFrame: c.startFrame, endFrame: c.endFrame }))
    : chunkCaption(text, durationInFrames, project.captions.maxWordsPerChunk);
  const active = chunks.find((c) => frame >= c.startFrame && frame < c.endFrame);
  if (!active) return null;
  const p = spring({ frame: frame - active.startFrame, fps, config: { damping: 18, stiffness: 220 } });
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: project.safeArea.bottomPx,
        paddingInline: project.safeArea.sidePx,
      }}
    >
      <p
        dir="rtl"
        style={{
          ...textBase,
          fontSize: 58,
          fontWeight: 800,
          lineHeight: 1.25,
          color: '#fff',
          background: 'rgba(12, 10, 20, 0.72)',
          borderRadius: 26,
          padding: '16px 34px 20px',
          maxWidth: 900,
          opacity: p,
          transform: `scale(${interpolate(p, [0, 1], [0.92, 1])})`,
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
        }}
      >
        {active.text}
      </p>
    </AbsoluteFill>
  );
}
