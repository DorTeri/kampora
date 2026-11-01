'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { stripNiqqud, type CreativeDesignSpec, type DesignLayer } from '@kampora/shared';

/**
 * Draws a CreativeDesignSpec in the browser, layer by layer, the same way the renderer's ComposedStaticAd does
 * (same masks, treatments, overlays and measured line breaks). The spec only supplies validated numbers, colours,
 * enums and the approved words; nothing here is generated. It is a preview: the rendered PNG is the deliverable.
 */

/** Every family the type systems use (all SIL OFL, from Google Fonts), Hebrew + Latin. */
export const SPEC_FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Heebo:wght@300..900&family=Rubik:wght@300..900&family=Assistant:wght@200..800&family=Frank+Ruhl+Libre:wght@300..900&family=Secular+One&family=Suez+One&family=Karantina:wght@300;400;700&family=Bellefair&family=Noto+Serif+Hebrew:wght@100..900&family=IBM+Plex+Sans+Hebrew:wght@300;400;500;600;700&family=Amatic+SC:wght@400;700&family=Varela+Round&display=swap';

const TEXT_FACE = 'Heebo, Arial, sans-serif';
const stack = (family: string) => `'${family}', Heebo, Arial, sans-serif`;

function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const abs = (r: { x: number; y: number; w: number; h: number }): CSSProperties => ({
  position: 'absolute',
  left: r.x,
  top: r.y,
  width: r.w,
  height: r.h,
});

const FILTERS: Record<string, string> = {
  NATURAL: 'none',
  WARM: 'sepia(0.16) saturate(1.08) contrast(1.02)',
  COOL: 'saturate(0.9) hue-rotate(-8deg)',
  MONO: 'grayscale(1) contrast(1.06)',
  DUOTONE: 'grayscale(1) contrast(1.12)',
  DARKEN: 'brightness(0.74)',
};

function maskStyle(l: Extract<DesignLayer, { kind: 'image' }>): CSSProperties {
  const wide = l.rect.w >= l.rect.h;
  switch (l.mask) {
    case 'ROUNDED':
      return { borderRadius: l.radius };
    case 'CIRCLE':
      return { borderRadius: '50%' };
    case 'ARCH':
      return { borderRadius: `${l.rect.w / 2}px ${l.rect.w / 2}px 0 0` };
    case 'SLANT_START':
      return { clipPath: wide ? 'polygon(0 9%, 100% 0, 100% 100%, 0 100%)' : 'polygon(12% 0, 100% 0, 100% 100%, 0 100%)' };
    case 'SLANT_END':
      return { clipPath: wide ? 'polygon(0 0, 100% 0, 100% 91%, 0 100%)' : 'polygon(0 0, 100% 0, 88% 100%, 0 100%)' };
    default:
      return {};
  }
}

const GRADIENT_TO: Record<string, string> = { TOP: 'to bottom', BOTTOM: 'to top', START: 'to left', END: 'to right' };

function ImageLayer({ l, url }: { l: Extract<DesignLayer, { kind: 'image' }>; url?: string }) {
  const o = l.overlay;
  return (
    <div style={{ ...abs(l.rect), overflow: 'hidden', background: '#d9d4cc', ...maskStyle(l) }}>
      {url ? (
        <img
          src={url}
          alt=""
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: `${l.focal.x * 100}% ${l.focal.y * 100}%`,
            transform: l.zoom > 1 ? `scale(${l.zoom})` : undefined,
            transformOrigin: `${l.focal.x * 100}% ${l.focal.y * 100}%`,
            filter: FILTERS[l.treatment],
          }}
        />
      ) : null}
      {l.treatment === 'DUOTONE' && l.duotone ? (
        <>
          <div style={{ position: 'absolute', inset: 0, backgroundColor: l.duotone[1], mixBlendMode: 'multiply' }} />
          <div style={{ position: 'absolute', inset: 0, backgroundColor: l.duotone[0], mixBlendMode: 'lighten' }} />
        </>
      ) : null}
      {o ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              o.direction === 'EVEN'
                ? alpha(o.color, (o.from + o.to) / 2)
                : `linear-gradient(${GRADIENT_TO[o.direction]}, ${alpha(o.color, o.from)} 0%, ${alpha(o.color, (o.from + o.to) / 2)} 38%, ${alpha(o.color, o.to)} 78%)`,
          }}
        />
      ) : null}
    </div>
  );
}

function ShapeLayer({ l }: { l: Extract<DesignLayer, { kind: 'shape' }> }) {
  const base: CSSProperties = { ...abs(l.rect), opacity: l.opacity, transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined };
  const border = l.stroke ? `${l.stroke.width}px solid ${l.stroke.color}` : undefined;
  switch (l.shape) {
    case 'CIRCLE':
      return <div style={{ ...base, borderRadius: '50%', backgroundColor: l.fill, border }} />;
    case 'RING':
      return <div style={{ ...base, borderRadius: '50%', border: border ?? `8px solid ${l.fill ?? '#000000'}` }} />;
    case 'ARCH':
      return <div style={{ ...base, borderRadius: `${l.rect.w / 2}px ${l.rect.w / 2}px 0 0`, backgroundColor: l.fill, border }} />;
    default:
      return <div style={{ ...base, borderRadius: l.radius, backgroundColor: l.fill, border }} />;
  }
}

const ALIGN: Record<string, CSSProperties['textAlign']> = { START: 'right', CENTER: 'center', END: 'left' };

function PriceLine({ text }: { text: string }) {
  // The currency sign in the neutral text face, half size: some display faces stylise ₪ into ש״ח.
  return (
    <>
      {text.split(/([₪$%])/).map((p, i) =>
        /^[₪$%]$/.test(p) ? (
          <span key={i} style={{ fontSize: '0.5em', fontFamily: TEXT_FACE, fontWeight: 700 }}>
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function TextLayer({ l }: { l: Extract<DesignLayer, { kind: 'text' }> }) {
  const f = l.font;
  const box = l.box;
  return (
    <div
      dir="rtl"
      data-role={l.role}
      style={{
        ...abs(l.rect),
        boxSizing: 'border-box',
        padding: box ? `${box.padY}px ${box.padX}px` : 0,
        backgroundColor: box?.fill,
        border: box?.stroke ? `2px solid ${box.stroke}` : undefined,
        borderRadius: box?.radius,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'stretch',
        transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined,
      }}
    >
      {l.lines.map((line, i) => (
        <div
          key={i}
          style={{
            fontFamily: stack(f.family),
            fontWeight: f.weight,
            fontSize: f.size,
            lineHeight: `${f.size * f.lineHeight}px`,
            letterSpacing: `${f.letterSpacing}em`,
            color: l.color,
            whiteSpace: 'nowrap',
            textAlign: ALIGN[l.align],
            textDecoration: l.underline ? 'underline' : undefined,
            textDecorationThickness: l.underline ? Math.max(2, f.size * 0.06) : undefined,
            textUnderlineOffset: l.underline ? f.size * 0.22 : undefined,
          }}
        >
          {l.role === 'PRICE' ? <PriceLine text={stripNiqqud(line)} /> : stripNiqqud(line)}
          {l.arrow && i === l.lines.length - 1 ? (
            <span style={{ textDecoration: 'none', display: 'inline-block', marginRight: f.size * 0.35 }}>←</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function LogoLayer({ l, url }: { l: Extract<DesignLayer, { kind: 'logo' }>; url?: string }) {
  if (url)
    return <img src={url} alt="" style={{ ...abs(l.rect), objectFit: 'contain', objectPosition: 'right center' }} />;
  const round = l.style !== 'WORDMARK';
  return (
    <div
      dir="rtl"
      style={{
        ...abs(l.rect),
        display: 'flex',
        alignItems: 'center',
        justifyContent: round ? 'center' : 'flex-end',
        borderRadius: round ? '50%' : 0,
        backgroundColor: round ? l.fill : undefined,
        fontFamily: stack(l.font.family),
        fontWeight: l.font.weight,
        fontSize: l.font.size,
        letterSpacing: `${l.font.letterSpacing}em`,
        color: l.color,
        whiteSpace: 'nowrap',
        lineHeight: 1,
      }}
    >
      {l.style === 'MONOGRAM' ? l.text.slice(0, 1) : l.text}
    </div>
  );
}

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** A spec scaled to the width of its container. */
export function SpecPreview({
  spec,
  assetUrls,
  label,
  className,
}: {
  spec: CreativeDesignSpec;
  assetUrls: Record<string, string>;
  label?: string;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScale(el.clientWidth / spec.width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [spec.width]);
  const bg = spec.background;
  return (
    <div
      ref={ref}
      role="img"
      aria-label={label ?? spec.layers.flatMap((l) => (l.kind === 'text' ? [l.text] : [])).join(' · ')}
      className={className}
      style={{ position: 'relative', width: '100%', aspectRatio: `${spec.width} / ${spec.height}`, overflow: 'hidden' }}
    >
      <div
        dir="rtl"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: spec.width,
          height: spec.height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          visibility: scale ? 'visible' : 'hidden',
          background: bg.kind === 'GRADIENT' && bg.to ? `linear-gradient(${bg.angle ?? 180}deg, ${bg.color}, ${bg.to})` : bg.color,
          overflow: 'hidden',
        }}
      >
        {spec.layers.map((l) => {
          switch (l.kind) {
            case 'image':
              return <ImageLayer key={l.id} l={l} url={assetUrls[l.assetId]} />;
            case 'shape':
              return <ShapeLayer key={l.id} l={l} />;
            case 'text':
              return <TextLayer key={l.id} l={l} />;
            case 'logo':
              return <LogoLayer key={l.id} l={l} url={l.assetId ? assetUrls[l.assetId] : undefined} />;
            default:
              return null;
          }
        })}
        {bg.grain > 0 ? (
          <div style={{ position: 'absolute', inset: 0, backgroundImage: GRAIN, opacity: bg.grain, mixBlendMode: 'multiply', pointerEvents: 'none' }} />
        ) : null}
      </div>
    </div>
  );
}
