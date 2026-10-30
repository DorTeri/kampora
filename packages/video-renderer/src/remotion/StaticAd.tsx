import type { CSSProperties } from 'react';
import { AbsoluteFill, Img } from 'remotion';
import { STATIC_AD_LINE_HEIGHT as LH, fitStaticAdType, type StaticAdRenderInput } from '@kampora/shared';
import { FONT_FAMILY, alpha } from './context';
import { displayText } from './display-text';
import { textBase } from './overlays';
import { DesignedStaticAd } from './StaticAdDesigned';

export { displayText } from './display-text';

export const STATIC_COMPOSITION_ID = 'KamporaStaticAd';

const fill: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' };
const column: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  width: '100%',
};

/**
 * One static image ad, rendered from the validated StaticAd document (never from generated code). With a design
 * from the Art Director it is drawn by DesignedStaticAd; otherwise the original template: logo,
 * headline and sub-headline at the top; price, CTA and address at the bottom; the picture between them. Type is
 * scaled as one system (fitStaticAdType) so every block stays inside the safe area, and all text is live RTL text.
 */
export function KamporaStaticAd({ ad, assetUrls }: StaticAdRenderInput) {
  const { colors, businessName } = ad.branding;
  const t = fitStaticAdType(ad).sizes;
  const { safeArea, text } = ad;
  const background = ad.background.assetId ? assetUrls[ad.background.assetId] : undefined;
  const logo = ad.branding.logoAssetId ? assetUrls[ad.branding.logoAssetId] : undefined;
  if (ad.background.assetId && !background)
    throw new Error(`Asset "${ad.background.assetId}" has no resolved URL`);
  if (ad.design) return <DesignedStaticAd ad={ad} design={ad.design} background={background} logo={logo} />;

  return (
    <AbsoluteFill style={{ backgroundColor: colors.primary, fontFamily: FONT_FAMILY, overflow: 'hidden' }}>
      {background ? (
        <Img
          src={background}
          style={{
            ...fill,
            objectFit: 'cover',
            objectPosition: `${ad.background.focalPoint.x * 100}% ${ad.background.focalPoint.y * 100}%`,
          }}
        />
      ) : (
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle at 30% 35%, ${alpha(colors.secondary, 0.9)} 0%, ${colors.primary} 70%)`,
          }}
        />
      )}
      {/* Scrims keep white text legible on any picture, under the top and bottom text blocks. */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.22) 30%, rgba(0,0,0,0) 46%, rgba(0,0,0,0.18) 58%, rgba(0,0,0,0.72) 100%)',
        }}
      />
      <AbsoluteFill
        style={{
          // AbsoluteFill is 100% high: border-box keeps the safe-area padding inside the frame, not added to it.
          boxSizing: 'border-box',
          padding: `${safeArea.topPx}px ${safeArea.sidePx}px ${safeArea.bottomPx}px`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div data-kampora-block="top" style={{ ...column, gap: t.gap }}>
          {text.showLogo && (
            <div
              style={{
                width: t.logo,
                height: t.logo,
                borderRadius: '50%',
                background: colors.background,
                border: `6px solid ${colors.accent}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                boxShadow: '0 16px 40px rgba(0,0,0,0.4)',
                flexShrink: 0,
              }}
            >
              {logo ? (
                <Img src={logo} style={{ width: '80%', height: '80%', objectFit: 'contain' }} />
              ) : (
                <span
                  data-kampora-text="logo"
                  style={{ ...textBase, fontSize: t.logo * 0.36, fontWeight: 900, color: colors.primary }}
                >
                  {businessName}
                </span>
              )}
            </div>
          )}
          <h1
            dir="rtl"
            data-kampora-text="headline"
            style={{
              ...textBase,
              fontSize: t.headline,
              fontWeight: 900,
              lineHeight: LH.headline,
              textWrap: 'balance',
              letterSpacing: -0.5,
              color: '#fff',
              textShadow: '0 6px 28px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.5)',
            }}
          >
            {displayText(text.headline)}
          </h1>
          {text.subheadline && (
            <p
              dir="rtl"
              data-kampora-text="subheadline"
              style={{
                ...textBase,
                fontSize: t.sub,
                fontWeight: 600,
                lineHeight: LH.sub,
                textWrap: 'balance',
                color: 'rgba(255,255,255,0.92)',
                textShadow: '0 3px 14px rgba(0,0,0,0.6)',
              }}
            >
              {displayText(text.subheadline)}
            </p>
          )}
        </div>

        <div data-kampora-block="bottom" style={{ ...column, gap: t.gap }}>
          {text.price && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: t.gap * 0.6,
                background: alpha('#ffffff', 0.96),
                borderRadius: 40,
                padding: `${t.gap}px ${t.gap * 2}px ${t.gap * 1.2}px`,
                boxShadow: '0 30px 80px rgba(0,0,0,0.4)',
              }}
            >
              {text.price.label && (
                <p
                  dir="rtl"
                  data-kampora-text="price-label"
                  style={{
                    ...textBase,
                    fontSize: t.label,
                    fontWeight: 800,
                    lineHeight: LH.label,
                    color: colors.text,
                  }}
                >
                  {displayText(text.price.label)}
                </p>
              )}
              <div
                style={{
                  background: colors.accent,
                  color: colors.primary,
                  borderRadius: 999,
                  padding: `6px ${t.gap * 1.8}px`,
                }}
              >
                {/* Isolated RTL run: the same visual order as prices in the video overlays. */}
                <bdi
                  dir="rtl"
                  data-kampora-text="price"
                  style={{
                    ...textBase,
                    display: 'block',
                    fontSize: t.price,
                    fontWeight: 900,
                    lineHeight: LH.price,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {text.price.price}
                </bdi>
              </div>
            </div>
          )}
          <div
            style={{
              background: colors.accent,
              color: colors.primary,
              borderRadius: 999,
              padding: `${t.gap * 0.8}px ${t.gap * 2.4}px`,
              boxShadow: `0 18px 44px ${alpha(colors.accent, 0.4)}`,
              maxWidth: '100%',
            }}
          >
            <p
              dir="rtl"
              data-kampora-text="cta"
              style={{
                ...textBase,
                fontSize: t.cta,
                fontWeight: 900,
                lineHeight: LH.cta,
                textWrap: 'balance',
              }}
            >
              {displayText(text.cta)}
            </p>
          </div>
          {text.ctaSubtext && (
            <p
              dir="rtl"
              data-kampora-text="cta-subtext"
              style={{
                ...textBase,
                fontSize: t.ctaSub,
                fontWeight: 700,
                lineHeight: LH.ctaSub,
                color: '#fff',
                textShadow: '0 3px 14px rgba(0,0,0,0.6)',
              }}
            >
              {displayText(text.ctaSubtext)}
            </p>
          )}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
