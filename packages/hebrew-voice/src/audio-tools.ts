import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Silence } from './continuous';

export class AudioToolError extends Error {}

/** Narration clips are mono PCM at 48 kHz: 1,600 samples per frame at 30 fps, so frame cuts are sample-exact. */
export const NARRATION_SAMPLE_RATE = 48_000;

const ffmpegPath = () => process.env.FFMPEG_PATH || 'ffmpeg';

async function withTempInput<T>(
  bytes: Buffer,
  extension: string,
  fn: (file: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'kampora-audio-'));
  const file = path.join(dir, `input.${extension.replace(/[^a-z0-9]/gi, '')}`);
  try {
    await writeFile(file, bytes);
    return await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function run(args: string[]): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      ffmpegPath(),
      args,
      { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, timeout: 60_000, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) return reject(new AudioToolError(`ffmpeg failed: ${error.message.slice(0, 300)}`));
        resolve({ stdout, stderr: stderr.toString() });
      },
    );
  });
}

/** Decodes any audio file to mono 16-bit PCM (no header). */
export function decodeToPcm(
  bytes: Buffer,
  extension: string,
  sampleRate = NARRATION_SAMPLE_RATE,
): Promise<Buffer> {
  return withTempInput(bytes, extension, async (file) => {
    const { stdout } = await run([
      '-v',
      'error',
      '-i',
      file,
      '-ac',
      '1',
      '-ar',
      String(sampleRate),
      '-f',
      's16le',
      '-acodec',
      'pcm_s16le',
      'pipe:1',
    ]);
    if (!stdout.length) throw new AudioToolError('ffmpeg decoded no audio');
    return stdout;
  });
}

/** Pauses in speech (ffmpeg silencedetect). Thresholds suit studio-clean TTS output. */
export function detectSilences(
  bytes: Buffer,
  extension: string,
  options: { noiseDb?: number; minSec?: number } = {},
): Promise<Silence[]> {
  return withTempInput(bytes, extension, async (file) => {
    const { stderr } = await run([
      '-v',
      'info',
      '-i',
      file,
      '-af',
      `silencedetect=noise=${options.noiseDb ?? -35}dB:d=${options.minSec ?? 0.12}`,
      '-f',
      'null',
      '-',
    ]);
    return parseSilences(stderr);
  });
}

export function parseSilences(log: string): Silence[] {
  const silences: Silence[] = [];
  let start: number | undefined;
  for (const line of log.split(/\r?\n/)) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (s) start = Math.max(0, Number(s[1]));
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (e && start !== undefined) {
      silences.push({ startSec: start, endSec: Number(e[1]) });
      start = undefined;
    }
  }
  return silences;
}
