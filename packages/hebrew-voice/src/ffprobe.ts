import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export class MediaProbeError extends Error {}

/**
 * Measures media duration with ffprobe (FFPROBE_PATH or `ffprobe` on PATH). Executed with execFile (no shell)
 * and a timeout; the input is always a file we wrote ourselves.
 */
export function probeDurationSec(
  file: string,
  ffprobePath = process.env.FFPROBE_PATH || 'ffprobe',
): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(
      ffprobePath,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
      { timeout: 20_000, windowsHide: true },
      (error, stdout) => {
        if (error) return reject(new MediaProbeError(`ffprobe failed: ${error.message}`));
        const value = Number.parseFloat(String(stdout).trim());
        if (!Number.isFinite(value) || value <= 0)
          return reject(new MediaProbeError(`ffprobe returned "${stdout}"`));
        resolve(Math.round(value * 1000) / 1000);
      },
    );
  });
}

export async function probeBufferDurationSec(
  bytes: Buffer,
  extension: string,
  ffprobePath?: string,
): Promise<number> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kampora-probe-'));
  const file = path.join(dir, `media.${extension.replace(/[^a-z0-9]/gi, '')}`);
  try {
    await writeFile(file, bytes);
    return await probeDurationSec(file, ffprobePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
