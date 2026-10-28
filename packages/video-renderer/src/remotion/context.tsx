import { createContext, useContext } from 'react';
import type { MediaAsset, VideoProject } from '@kampora/shared';
import { loadFont } from '@remotion/google-fonts/Heebo';

const heebo = loadFont('normal', {
  weights: ['400', '500', '700', '800', '900'],
  subsets: ['hebrew', 'latin'],
});
export const FONT_FAMILY = `${heebo.fontFamily}, Arial, sans-serif`;

export interface RenderContextValue {
  project: VideoProject;
  assetUrls: Record<string, string>;
}

export const RenderContext = createContext<RenderContextValue | null>(null);

export function useRenderContext(): RenderContextValue {
  const ctx = useContext(RenderContext);
  if (!ctx) throw new Error('RenderContext missing');
  return ctx;
}

export function useAsset(assetId: string | undefined): { asset: MediaAsset; url: string } | undefined {
  const { project, assetUrls } = useRenderContext();
  if (!assetId) return undefined;
  const asset = project.assets.find((a) => a.id === assetId);
  const url = assetUrls[assetId];
  if (!asset || !url) throw new Error(`Asset "${assetId}" has no resolved URL`);
  return { asset, url };
}

/** Hex color with alpha, e.g. alpha('#112233', 0.5). */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
