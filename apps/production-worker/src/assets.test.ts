import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MediaAsset, VideoProject } from '@kampora/shared';
import { AssetValidationError, prepareAssets, sniffMatches } from './assets';

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
const wavHeader = Buffer.from('RIFF\0\0\0\0WAVEfmt ', 'latin1');

const asset = (id: string, mimeType: string): MediaAsset => ({
  id,
  kind: mimeType.startsWith('audio') ? 'audio' : 'image',
  storageKey: `k/${id}`,
  mimeType,
  provenance: { source: 'DEMO', license: 'test', commercialUse: true },
});

const projectWith = (assets: MediaAsset[]) => ({ assets }) as unknown as VideoProject;

describe('sniffMatches', () => {
  it('accepts matching content and rejects mislabeled bytes', () => {
    expect(sniffMatches('image/svg+xml', svg)).toBe(true);
    expect(sniffMatches('audio/wav', wavHeader)).toBe(true);
    expect(sniffMatches('image/png', svg)).toBe(false);
    expect(sniffMatches('video/mp4', wavHeader)).toBe(false);
  });
});

describe('prepareAssets', () => {
  it('serves validated assets on loopback only', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'kampora-assets-'));
    const prepared = await prepareAssets(
      projectWith([asset('a1', 'image/svg+xml')]),
      dir,
      async () => svg,
      1024,
    );
    try {
      const url = prepared.assetUrls.a1!;
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/a1\.svg$/);
      const res = await fetch(url);
      expect(res.headers.get('content-type')).toBe('image/svg+xml');
      expect(await res.text()).toBe(svg.toString());
      expect((await fetch(url.replace('a1.svg', '../secret'))).status).toBe(404);
    } finally {
      await prepared.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects oversized, mislabeled and active-content assets', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'kampora-assets-'));
    try {
      await expect(
        prepareAssets(projectWith([asset('a', 'image/svg+xml')]), dir, async () => svg, 10),
      ).rejects.toThrow(AssetValidationError);
      await expect(
        prepareAssets(projectWith([asset('a', 'image/png')]), dir, async () => svg, 1024),
      ).rejects.toThrow(AssetValidationError);
      await expect(
        prepareAssets(projectWith([asset('a', 'application/x-sh')]), dir, async () => svg, 1024),
      ).rejects.toThrow(AssetValidationError);
      const evil = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
      await expect(
        prepareAssets(projectWith([asset('a', 'image/svg+xml')]), dir, async () => evil, 1024),
      ).rejects.toThrow('active content');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
