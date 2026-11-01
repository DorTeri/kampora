import type { CSSProperties } from 'react';
import { useState } from 'react';
import { AbsoluteFill, Img } from 'remotion';
import { loadFont as loadAmatic } from '@remotion/google-fonts/AmaticSC';
import { loadFont as loadAssistant } from '@remotion/google-fonts/Assistant';
import { loadFont as loadBellefair } from '@remotion/google-fonts/Bellefair';
import { loadFont as loadFrank } from '@remotion/google-fonts/FrankRuhlLibre';
import { loadFont as loadHeebo } from '@remotion/google-fonts/Heebo';
import { loadFont as loadPlex } from '@remotion/google-fonts/IBMPlexSansHebrew';
import { loadFont as loadKarantina } from '@remotion/google-fonts/Karantina';
import { loadFont as loadNotoSerif } from '@remotion/google-fonts/NotoSerifHebrew';
import { loadFont as loadRubik } from '@remotion/google-fonts/Rubik';
import { loadFont as loadSecular } from '@remotion/google-fonts/SecularOne';
import { loadFont as loadSuez } from '@remotion/google-fonts/SuezOne';
import { loadFont as loadVarela } from '@remotion/google-fonts/VarelaRound';
import { stripNiqqud, type CreativeDesignSpec, type DesignLayer, type FontFamily } from '@kampora/shared';
import { alpha } from './context';

/* Every loader takes (style, { weights, subsets }); the typed signatures differ per font, so they are called loosely. */
type Loader = (style: 'normal', options: { weights: string[]; subsets: string[] }) => { fontFamily: string };
const LOADERS: Record<FontFamily, Loader> = {
  Heebo: loadHeebo as unknown as Loader,
  Rubik: loadRubik as unknown as Loader,
  Assistant: loadAssistant as unknown as Loader,
  'Frank Ruhl Libre': loadFrank as unknown as Loader,
  'Secular One': loadSecular as unknown as Loader,
  'Suez One': loadSuez as unknown as Loader,
  Karantina: loadKarantina as unknown as Loader,
  Bellefair: loadBellefair as unknown as Loader,
  'Noto Serif Hebrew': loadNotoSerif as unknown as Loader,
  'IBM Plex Sans Hebrew': loadPlex as unknown as Loader,
  'Amatic SC': loadAmatic as unknown as Loader,
  'Varela Round': loadVarela as unknown as Loader,
};

/** Loads exactly the families and weights the spec uses (Hebrew + Latin subsets); returns CSS family names. */
function useFonts(spec: CreativeDesignSpec): Record<string, string> {
  const [names] = useState(() => {
    const wanted = new Map<FontFamily, Set<number>>();
    for (const l of spec.layers)
      if (l.kind === 'text' || l.kind === 'logo') {
        const set = wanted.get(l.font.family) ?? new Set<number>();
        set.add(l.font.weight);
        wanted.set(l.font.family, set);
      }
    const out: Record<string, string> = {};
    for (const [family, weights] of wanted) {
      const loaded = LOADERS[family]('normal', { weights: [...weights].map(String), subsets: ['hebrew', 'latin'] });
      out[family] = `${loaded.fontFamily}, Heebo, Arial, sans-serif`;
    }
    return out;
  });
  return names;
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

function ImageLayerView({ l, url }: { l: Extract<DesignLayer, { kind: 'image' }>; url: string }) {
  const o = l.overlay;
  return (
    <div style={{ ...abs(l.rect), overflow: 'hidden', ...maskStyle(l) }}>
      <Img
        src={url}
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
                : // RTL: START is the right edge, so the strongest end of a START overlay is on the right.
                  `linear-gradient(${GRADIENT_TO[o.direction]}, ${alpha(o.color, o.from)} 0%, ${alpha(o.color, (o.from + o.to) / 2)} 38%, ${alpha(o.color, o.to)} 78%)`,
          }}
        />
      ) : null}
    </div>
  );
}

function ShapeView({ l }: { l: Extract<DesignLayer, { kind: 'shape' }> }) {
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

/** A price set like a professional price: the currency sign smaller than the numerals, sharing their baseline. */
function PriceLine({ text }: { text: string }) {
  const parts = text.split(/([₪$%])/);
  return (
    <>
      {parts.map((p, i) => (/^[₪$%]$/.test(p) ? <span key={i} style={{ fontSize: '0.5em' }}>{p}</span> : <span key={i}>{p}</span>))}
    </>
  );
}

function TextView({ l, family }: { l: Extract<DesignLayer, { kind: 'text' }>; family: string }) {
  const f = l.font;
  const box = l.box;
  return (
    <div
      dir="rtl"
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
        // Lines stretch across the box and align themselves (in an RTL flex box 'flex-end' would mean left).
        alignItems: 'stretch',
        transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined,
      }}
    >
      {l.lines.map((line, i) => (
        <div
          key={i}
          style={{
            fontFamily: family,
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
          {l.arrow && i === l.lines.length - 1 ? <span style={{ textDecoration: 'none', display: 'inline-block', marginRight: f.size * 0.35 }}>←</span> : null}
        </div>
      ))}
    </div>
  );
}

function LogoView({ l, family, url }: { l: Extract<DesignLayer, { kind: 'logo' }>; family: string; url?: string }) {
  if (url) return <Img src={url} style={{ ...abs(l.rect), objectFit: 'contain', objectPosition: 'right center' }} />;
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
        fontFamily: family,
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

/**
 * Draws a CreativeDesignSpec. Each layer kind has one fixed component; the spec only supplies validated numbers,
 * colours, enums and the approved words. All text stays live RTL text.
 */
export function ComposedStaticAd({ spec, assetUrls }: { spec: CreativeDesignSpec; assetUrls: Record<string, string> }) {
  const fonts = useFonts(spec);
  const bg = spec.background;
  const url = (id: string) => {
    const u = assetUrls[id];
    if (!u) throw new Error(`Asset "${id}" has no resolved URL`);
    return u;
  };
  return (
    <AbsoluteFill
      dir="rtl"
      style={{
        background: bg.kind === 'GRADIENT' && bg.to ? `linear-gradient(${bg.angle ?? 180}deg, ${bg.color}, ${bg.to})` : bg.color,
        overflow: 'hidden',
      }}
    >
      {spec.layers.map((l) => {
        switch (l.kind) {
          case 'image':
            return <ImageLayerView key={l.id} l={l} url={url(l.assetId)} />;
          case 'shape':
            return <ShapeView key={l.id} l={l} />;
          case 'text':
            return <TextView key={l.id} l={l} family={fonts[l.font.family]!} />;
          case 'logo':
            return <LogoView key={l.id} l={l} family={fonts[l.font.family]!} url={l.assetId ? url(l.assetId) : undefined} />;
          default:
            return null;
        }
      })}
      {bg.grain > 0 ? <AbsoluteFill style={{ backgroundImage: GRAIN, opacity: bg.grain, mixBlendMode: 'multiply', pointerEvents: 'none' }} /> : null}
    </AbsoluteFill>
  );
}
