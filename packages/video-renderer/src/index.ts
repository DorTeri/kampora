import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import {
  RenderInputSchema,
  StaticAdRenderInputSchema,
  projectDurationInFrames,
  type RenderInput,
  type RenderQuality,
  type StaticAdFileType,
  type StaticAdRenderInput,
} from '@kampora/shared';

/** Must match COMPOSITION_ID in src/remotion/KamporaAd.tsx (not imported to keep React out of Node code). */
export const COMPOSITION_ID = 'KamporaAd';
/** Must match STATIC_COMPOSITION_ID in src/remotion/StaticAd.tsx. */
export const STATIC_COMPOSITION_ID = 'KamporaStaticAd';

/** The Remotion entry is bundled from source; dist/ sits next to src/ in this package. */
export const REMOTION_ENTRY = path.resolve(__dirname, '../src/remotion/index.ts');

let serveUrlPromise: Promise<string> | undefined;

/** Bundles the compositions once per process (webpack, ~10–30 s) and reuses the result for every render. */
export function getServeUrl(onProgress?: (percent: number) => void): Promise<string> {
  serveUrlPromise ??= bundle({ entryPoint: REMOTION_ENTRY, onProgress }).catch((error: unknown) => {
    serveUrlPromise = undefined;
    throw error;
  });
  return serveUrlPromise;
}

export interface RenderVideoOptions {
  input: RenderInput;
  outputPath: string;
  quality: RenderQuality;
  concurrency?: number;
  onProgress?: (progress: number) => void;
  onBundleProgress?: (percent: number) => void;
}

export interface RenderVideoResult {
  outputPath: string;
  width: number;
  height: number;
  durationInFrames: number;
  durationSec: number;
}

/** preview = half resolution, faster encode; final = full 1080×1920. */
export const QUALITY_SETTINGS: Record<RenderQuality, { scale: number; crfOffset: number }> = {
  preview: { scale: 0.5, crfOffset: 4 },
  final: { scale: 1, crfOffset: 0 },
};

/** REMOTION_BROWSER_EXECUTABLE pins a browser; otherwise Remotion downloads its headless shell once. */
async function browser(): Promise<string | null> {
  const executable = process.env.REMOTION_BROWSER_EXECUTABLE || null;
  if (!executable) await ensureBrowser();
  return executable;
}

export interface RenderStaticAdOptions {
  input: StaticAdRenderInput;
  outputPath: string;
  fileType: StaticAdFileType;
}

/** Renders one static image ad (PNG or JPEG) from its validated StaticAd document. */
export async function renderStaticAd(
  options: RenderStaticAdOptions,
): Promise<{ outputPath: string; width: number; height: number }> {
  const inputProps = StaticAdRenderInputSchema.parse(options.input);
  const browserExecutable = await browser();
  const serveUrl = await getServeUrl();
  const composition = await selectComposition({
    serveUrl,
    id: STATIC_COMPOSITION_ID,
    inputProps,
    browserExecutable,
  });
  await renderStill({
    browserExecutable,
    composition,
    serveUrl,
    inputProps,
    output: options.outputPath,
    imageFormat: options.fileType,
    jpegQuality: options.fileType === 'jpeg' ? 90 : undefined,
    overwrite: true,
  });
  return { outputPath: options.outputPath, width: composition.width, height: composition.height };
}

export async function renderVideoProject(options: RenderVideoOptions): Promise<RenderVideoResult> {
  const input = RenderInputSchema.parse(options.input);
  const { scale, crfOffset } = QUALITY_SETTINGS[options.quality];
  const inputProps = { ...input, scale };

  // A pinned browser also avoids Windows' 260-char process path limit when node_modules sits deep.
  const browserExecutable = await browser();
  const serveUrl = await getServeUrl(options.onBundleProgress);
  const composition = await selectComposition({
    serveUrl,
    id: COMPOSITION_ID,
    inputProps,
    browserExecutable,
  });

  await renderMedia({
    browserExecutable,
    composition,
    serveUrl,
    inputProps,
    codec: 'h264',
    audioCodec: 'aac',
    crf: Math.min(51, input.project.output.crf + crfOffset),
    scale,
    imageFormat: 'jpeg',
    jpegQuality: 92,
    pixelFormat: 'yuv420p',
    outputLocation: options.outputPath,
    concurrency: options.concurrency ?? null,
    overwrite: true,
    onProgress: ({ progress }) => options.onProgress?.(progress),
  });

  const durationInFrames = projectDurationInFrames(input.project);
  return {
    outputPath: options.outputPath,
    width: Math.round(input.project.output.width * scale),
    height: Math.round(input.project.output.height * scale),
    durationInFrames,
    durationSec: durationInFrames / input.project.output.fps,
  };
}
