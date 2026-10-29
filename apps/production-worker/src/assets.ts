import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { MediaAsset, VideoProject } from '@kampora/shared';

/** Extension per allowed MIME type. Anything else is rejected before it reaches the renderer. */
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
};

export class AssetValidationError extends Error {}

/** Cheap magic-byte sniffing: the declared MIME type must match the actual bytes. */
export function sniffMatches(mimeType: string, bytes: Buffer): boolean {
  const head = bytes.subarray(0, 64);
  const ascii = head.toString('latin1');
  switch (mimeType) {
    case 'image/jpeg':
      return head[0] === 0xff && head[1] === 0xd8;
    case 'image/png':
      return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp':
      return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
    case 'image/svg+xml': {
      const text = bytes.subarray(0, 512).toString('utf8').trimStart();
      return text.startsWith('<svg') || text.startsWith('<?xml');
    }
    case 'audio/wav':
      return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE';
    case 'audio/mpeg':
      return ascii.startsWith('ID3') || (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0);
    case 'video/mp4':
    case 'video/quicktime':
    case 'audio/mp4':
      return ascii.slice(4, 8) === 'ftyp';
    default:
      return false;
  }
}

/** SVGs are rendered by Chromium: refuse active content even though the page is sandboxed. */
function assertSafeSvg(bytes: Buffer): void {
  const text = bytes.toString('utf8');
  if (/<script|javascript:|<foreignObject|\son\w+\s*=/i.test(text)) {
    throw new AssetValidationError('SVG contains active content');
  }
}

export interface PreparedAssets {
  assetUrls: Record<string, string>;
  close(): Promise<void>;
}

/**
 * Copies every asset referenced by the project into a private temp directory (validated: type, size,
 * content) and serves it on 127.0.0.1:<random port> for the renderer. The renderer never touches storage
 * credentials, and long renders cannot hit expiring URLs.
 */
/** Downloads, validates and serves the assets of a video timeline or a static ad. */
export async function prepareAssets(
  project: Pick<VideoProject, 'assets'>,
  dir: string,
  loadBytes: (asset: MediaAsset) => Promise<Buffer>,
  maxBytes: number,
): Promise<PreparedAssets> {
  await mkdir(dir, { recursive: true });
  const files = new Map<string, { file: string; mimeType: string }>();

  for (const asset of project.assets) {
    const ext = ALLOWED_TYPES[asset.mimeType];
    if (!ext) throw new AssetValidationError(`Unsupported asset type ${asset.mimeType} (${asset.id})`);
    const bytes = await loadBytes(asset);
    if (bytes.length > maxBytes)
      throw new AssetValidationError(`Asset ${asset.id} exceeds ${maxBytes} bytes`);
    if (!sniffMatches(asset.mimeType, bytes)) {
      throw new AssetValidationError(`Asset ${asset.id} content does not match ${asset.mimeType}`);
    }
    if (asset.mimeType === 'image/svg+xml') assertSafeSvg(bytes);
    const name = `${asset.id.replace(/[^a-zA-Z0-9-]/g, '')}.${ext}`;
    await writeFile(path.join(dir, name), bytes);
    files.set(`/${name}`, { file: path.join(dir, name), mimeType: asset.mimeType });
  }

  const server = http.createServer((req, res) => {
    const entry =
      req.method === 'GET' || req.method === 'HEAD'
        ? files.get(new URL(req.url ?? '/', 'http://x').pathname)
        : undefined;
    if (!entry) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': entry.mimeType,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(entry.file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const assetUrls: Record<string, string> = {};
  for (const asset of project.assets) {
    assetUrls[asset.id] =
      `http://127.0.0.1:${port}/${asset.id.replace(/[^a-zA-Z0-9-]/g, '')}.${ALLOWED_TYPES[asset.mimeType]}`;
  }
  return {
    assetUrls,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
