import type { CSSProperties, ReactNode } from 'react';
import { AbsoluteFill, Img } from 'remotion';
import {
  STATIC_AD_LINE_HEIGHT as LH,
  staticAdLayout,
  type LayoutRect,
  type StaticAd,
  type StaticAdDesign,
} from '@kampora/shared';
import { FONT_FAMILY, alpha } from './context';
import { textBase } from './overlays';
import { displayText } from './display-text';

/**
 * A static ad drawn from the Art Director's design: one of the tested layout families, parameterised (picture
 * placement, text zone, surface, type scale, price / CTA / logo treatment, palette). The geometry and the fitted
 * type sizes come from `staticAdLayout`, so every text block stays inside the safe area in every family.
 */
export function DesignedStaticAd({
  ad,
  design: d,
  background,
  logo,
}: {
  ad: StaticAd;
  design: StaticAdDesign;
  background?: string;
  logo?: string;
}) {
  const L = staticAdLayout({ ...ad, design: d });
  const z = L.sizes;
  const p = d.palette;
  const { text } = ad;
  const scrim = d.surface === 'SCRIM';
  const shadow = scrim ? '0 4px 22px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.45)' : undefined;
  const ink: CSSProperties = {
    ...textBase,
    textAlign: d.align === 'START' ? 'start' : 'center',
    color: p.text,
    textShadow: shadow,
  };
  const focal = `${ad.background.focalPoint.x * 100}% ${ad.background.focalPoint.y * 100}%`;
  const items = d.align === 'START' ? 'flex-start' : 'center';

  const picture = (rect: LayoutRect) => (
    <Img
      src={background!}
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        objectFit: 'cover',
        objectPosition: focal,
      }}
    />
  );

  const logoBlock =
    d.logo === 'NONE' || !text.showLogo ? null : d.logo === 'BADGE' ? (
      <div
        style={{
          width: z.logo,
          height: z.logo,
          borderRadius: '50%',
          background: ad.branding.colors.background,
          border: `6px solid ${p.accent}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          boxShadow: '0 16px 40px rgba(0,0,0,0.3)',
          flexShrink: 0,
        }}
      >
        {logo ? (
          <Img src={logo} style={{ width: '80%', height: '80%', objectFit: 'contain' }} />
        ) : (
          <span
            data-kampora-text="logo"
            style={{
              ...textBase,
              fontSize: z.logo * 0.36,
              fontWeight: 900,
              color: ad.branding.colors.primary,
            }}
          >
            {ad.branding.businessName}
          </span>
        )}
      </div>
    ) : logo ? (
      <Img src={logo} style={{ height: z.logo * 0.46, objectFit: 'contain' }} />
    ) : (
      <span
        data-kampora-text="logo"
        style={{ ...ink, fontSize: z.logo * 0.4, fontWeight: 800, lineHeight: 1.5, letterSpacing: 0.5 }}
      >
        {ad.branding.businessName}
      </span>
    );

  const inset =
    d.image.mode === 'INSET' && background ? (
      <div
        style={{
          position: 'relative',
          width: Math.min(L.text.width, Math.round(L.reserve * 1.3)),
          height: L.reserve,
          borderRadius: 28,
          overflow: 'hidden',
          flexShrink: 0,
          boxShadow: '0 24px 60px rgba(0,0,0,0.18)',
        }}
      >
        <Img
          src={background}
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: focal }}
        />
      </div>
    ) : null;

  const headline = (
    <h1
      dir="rtl"
      data-kampora-text="headline"
      style={{
        ...ink,
        fontSize: z.headline,
        fontWeight: d.headlineWeight,
        lineHeight: LH.headline,
        textWrap: 'balance',
        letterSpacing: d.headlineWeight === 900 ? -0.5 : 0,
      }}
    >
      {displayText(text.headline)}
    </h1>
  );
  const sub = text.subheadline ? (
    <p
      dir="rtl"
      data-kampora-text="subheadline"
      style={{
        ...ink,
        fontSize: z.sub,
        fontWeight: 500,
        lineHeight: LH.sub,
        textWrap: 'balance',
        color: p.muted,
      }}
    >
      {displayText(text.subheadline)}
    </p>
  ) : null;

  const priceText = (size: number, color: string, style?: CSSProperties) => (
    // Isolated RTL run: the same visual order as prices in the video overlays.
    <bdi
      dir="rtl"
      data-kampora-text="price"
      style={{
        ...textBase,
        display: 'block',
        fontSize: size,
        fontWeight: 900,
        lineHeight: LH.price,
        whiteSpace: 'nowrap',
        color,
        ...style,
      }}
    >
      {text.price!.price}
    </bdi>
  );
  const priceLabel = (size: number, color: string) =>
    text.price?.label ? (
      <p
        dir="rtl"
        data-kampora-text="price-label"
        style={{ ...ink, fontSize: size, fontWeight: 800, lineHeight: LH.label, color }}
      >
        {displayText(text.price.label)}
      </p>
    ) : null;

  let price: ReactNode = null;
  if (text.price) {
    const chars = text.price.price.length;
    switch (d.price) {
      case 'STAMP':
        price = (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: items, gap: z.gap * 0.6 }}>
            <div
              style={{
                width: z.stamp,
                height: z.stamp,
                borderRadius: '50%',
                background: p.accent,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transform: 'rotate(-6deg)',
                boxShadow: `0 20px 50px ${alpha('#000000', 0.28)}`,
                flexShrink: 0,
              }}
            >
              {priceText(Math.min(z.price * 0.8, (z.stamp * 0.8) / (chars * 0.5)), p.accentText)}
            </div>
            {priceLabel(z.label, p.text)}
          </div>
        );
        break;
      case 'INLINE':
        price = (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: items, gap: z.gap * 0.5 }}>
            {priceLabel(z.label, p.muted)}
            {priceText(z.price, p.accent)}
          </div>
        );
        break;
      case 'HERO':
        price = (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: items, gap: z.gap * 0.4 }}>
            {priceLabel(z.label, p.text)}
            {priceText(z.price, p.accent, { letterSpacing: -1 })}
          </div>
        );
        break;
      case 'BADGE':
      case 'CARD':
        price = (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: items,
              gap: z.gap * 0.6,
              ...(d.price === 'CARD'
                ? {
                    background: alpha('#ffffff', 0.96),
                    borderRadius: 36,
                    padding: `${z.gap}px ${z.gap * 2}px ${z.gap * 1.2}px`,
                  }
                : {}),
            }}
          >
            {priceLabel(z.label, d.price === 'CARD' ? ad.branding.colors.text : p.text)}
            <div style={{ background: p.accent, borderRadius: 999, padding: `6px ${z.gap * 1.6}px` }}>
              {priceText(z.price, p.accentText)}
            </div>
          </div>
        );
        break;
    }
  }

  const ctaLabel = (color: string, extra?: CSSProperties) => (
    <p
      dir="rtl"
      data-kampora-text="cta"
      style={{
        ...textBase,
        fontSize: z.cta,
        fontWeight: 900,
        lineHeight: LH.cta,
        textWrap: 'balance',
        color,
        ...extra,
      }}
    >
      {displayText(text.cta)}
    </p>
  );
  const linkColor = p.accent === p.field ? p.text : p.accent;
  const cta =
    d.cta === 'TEXT' ? (
      // Inline, so the arrow follows the last word even when the action wraps.
      <div dir="rtl" style={{ textAlign: d.align === 'START' ? 'start' : 'center', paddingBottom: 6 }}>
        {ctaLabel(linkColor, {
          display: 'inline',
          textDecoration: 'underline',
          textUnderlineOffset: z.cta * 0.25,
          textDecorationThickness: Math.max(3, z.cta * 0.07),
        })}
        <span style={{ ...textBase, display: 'inline', fontSize: z.cta, fontWeight: 900, color: linkColor }}>
          {' ←'}
        </span>
      </div>
    ) : (
      <div
        style={{
          background: p.accent,
          borderRadius: d.cta === 'BAR' ? 18 : 999,
          padding: d.cta === 'BAR' ? `${z.gap}px ${z.gap * 1.2}px` : `${z.gap * 0.8}px ${z.gap * 2.4}px`,
          alignSelf: d.cta === 'BAR' ? 'stretch' : undefined,
          boxShadow: `0 16px 40px ${alpha('#000000', 0.22)}`,
          maxWidth: '100%',
        }}
      >
        {ctaLabel(p.accentText)}
      </div>
    );
  const ctaSub = text.ctaSubtext ? (
    <p
      dir="rtl"
      data-kampora-text="cta-subtext"
      style={{ ...ink, fontSize: z.ctaSub, fontWeight: 700, lineHeight: LH.ctaSub, color: p.muted }}
    >
      {displayText(text.ctaSubtext)}
    </p>
  ) : null;

  const panel = (children: ReactNode) =>
    d.surface === 'PANEL' ? (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: items,
          gap: z.gap,
          background: alpha(p.field, 0.94),
          borderRadius: 32,
          padding: z.gap * 1.4,
          boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
          alignSelf: 'stretch',
        }}
      >
        {children}
      </div>
    ) : (
      children
    );
  const group = (name: string, children: ReactNode) => (
    <div
      data-kampora-block={name}
      style={{ display: 'flex', flexDirection: 'column', alignItems: items, gap: z.gap, width: '100%' }}
    >
      {panel(children)}
    </div>
  );

  const scrimGradient =
    d.textZone === 'BOTTOM'
      ? 'linear-gradient(180deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.5) 58%, rgba(0,0,0,0.82) 100%)'
      : d.textZone === 'TOP'
        ? 'linear-gradient(0deg, rgba(0,0,0,0) 30%, rgba(0,0,0,0.5) 58%, rgba(0,0,0,0.82) 100%)'
        : d.textZone === 'CENTER'
          ? 'rgba(0,0,0,0.5)'
          : 'linear-gradient(180deg, rgba(0,0,0,0.66) 0%, rgba(0,0,0,0.24) 30%, rgba(0,0,0,0) 46%, rgba(0,0,0,0.2) 58%, rgba(0,0,0,0.76) 100%)';

  // Thin accent seam where a picture panel meets the brand field.
  const seam =
    L.image && d.image.mode === 'PANEL'
      ? d.image.edge === 'TOP'
        ? { left: 0, top: L.image.height - 5, width: ad.width, height: 10 }
        : d.image.edge === 'BOTTOM'
          ? { left: 0, top: L.image.y - 5, width: ad.width, height: 10 }
          : d.image.edge === 'START'
            ? { left: L.image.x - 5, top: 0, width: 10, height: ad.height }
            : { left: L.image.width - 5, top: 0, width: 10, height: ad.height }
      : undefined;

  const top = (
    <>
      {logoBlock}
      {inset}
      {headline}
      {sub}
    </>
  );
  const bottom = (
    <>
      {price}
      {cta}
      {ctaSub}
    </>
  );

  return (
    <AbsoluteFill style={{ backgroundColor: p.field, fontFamily: FONT_FAMILY, overflow: 'hidden' }}>
      {background && L.image && picture(L.image)}
      {background && scrim && <AbsoluteFill style={{ background: scrimGradient }} />}
      {seam && <div style={{ position: 'absolute', ...seam, background: p.accent }} />}
      <div
        dir="rtl"
        style={{
          position: 'absolute',
          left: L.text.x,
          top: L.text.y,
          width: L.text.width,
          height: L.text.height,
          display: 'flex',
          flexDirection: 'column',
          alignItems: items,
          justifyContent:
            d.textZone === 'SPLIT'
              ? 'space-between'
              : d.textZone === 'TOP'
                ? 'flex-start'
                : d.textZone === 'BOTTOM'
                  ? 'flex-end'
                  : 'center',
          gap: z.gap,
        }}
      >
        {d.textZone === 'SPLIT' ? (
          <>
            {group('top', top)}
            {group('bottom', bottom)}
          </>
        ) : (
          group(
            'all',
            <>
              {top}
              {bottom}
            </>,
          )
        )}
      </div>
    </AbsoluteFill>
  );
}
