import { SPEC_FONTS_HREF } from '@/components/spec-preview';

/** The type systems' faces (SIL OFL, Google Fonts), so live previews draw with the fonts the layout was measured in. */
export default function ReviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link rel="stylesheet" href={SPEC_FONTS_HREF} precedence="default" />
      {children}
    </>
  );
}
