import { HttpStatus } from '@nestjs/common';
import { ApiError } from '../common/errors';

/**
 * Customer media the studio accepts. Video is limited to the containers the renderer already plays (MP4/MOV,
 * H.264 inside); there is no transcoding, so other codecs are refused by the renderer rather than converted.
 */
export const UPLOAD_TYPES: Record<string, { kind: 'image' | 'video'; ext: string; maxBytes: number }> = {
  'image/jpeg': { kind: 'image', ext: 'jpg', maxBytes: 20 * 1024 * 1024 },
  'image/png': { kind: 'image', ext: 'png', maxBytes: 20 * 1024 * 1024 },
  'image/webp': { kind: 'image', ext: 'webp', maxBytes: 20 * 1024 * 1024 },
  'video/mp4': { kind: 'video', ext: 'mp4', maxBytes: 100 * 1024 * 1024 },
  'video/quicktime': { kind: 'video', ext: 'mov', maxBytes: 100 * 1024 * 1024 },
};

/** What the picture shows, chosen by the owner: these tags are what the Art and Video Directors match on. */
export const UPLOAD_SUBJECTS: Record<string, string[]> = {
  product: ['product', 'hero'],
  place: ['store', 'interior'],
  people: ['people', 'store'],
  process: ['kitchen', 'process'],
};

export const uploadError = (code: string, message: string) =>
  new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, code, message);

/** The declared type must match the bytes (magic numbers), so a renamed file is refused. */
export function sniffUpload(mimeType: string, bytes: Buffer): boolean {
  const ascii = bytes.subarray(0, 16).toString('latin1');
  switch (mimeType) {
    case 'image/jpeg':
      return bytes[0] === 0xff && bytes[1] === 0xd8;
    case 'image/png':
      return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/webp':
      return ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP';
    case 'video/mp4':
    case 'video/quicktime':
      return ascii.slice(4, 8) === 'ftyp';
    default:
      return false;
  }
}

/** Pixel size from the file header (PNG, JPEG, WebP); undefined when the header is not understood. */
export function imageSize(mimeType: string, b: Buffer): { width: number; height: number } | undefined {
  if (mimeType === 'image/png' && b.length >= 24) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (mimeType === 'image/jpeg') {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return undefined;
      const marker = b[i + 1]!;
      const len = b.readUInt16BE(i + 2);
      // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      i += 2 + len;
    }
    return undefined;
  }
  if (mimeType === 'image/webp' && b.length >= 30) {
    const chunk = b.subarray(12, 16).toString('latin1');
    if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return undefined;
}
