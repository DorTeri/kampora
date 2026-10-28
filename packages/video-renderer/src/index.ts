import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import {
  RenderInputSchema,
  projectDurationInFrames,
  type RenderInput,
  type RenderQuality,
} from '@kampora/shared';

/** Must match COMPOSITION_ID in src/remotion/KamporaAd.tsx (not imported to keep React out of Node code). */
export const COMPOSITION_ID = 'KamporaAd';

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

export async function renderVideoProject(options: RenderVideoOptions): Promise<RenderVideoResult> {
  const input = RenderInputSchema.parse(options.input);
  const { scale, crfOffset } = QUALITY_SETTINGS[options.quality];
  const inputProps = { ...input, scale };

  // REMOTION_BROWSER_EXECUTABLE lets ops pin a browser (e.g. when node_modules sits in a path longer than
  // Windows' 260-char process limit). Otherwise Remotion downloads its headless shell once.
  const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;
  if (!browserExecutable) await ensureBrowser();
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
