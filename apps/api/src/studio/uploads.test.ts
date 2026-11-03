import { describe, expect, it } from 'vitest';
import { imageSize, sniffUpload } from './uploads';

const png = (w: number, h: number) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};
// Minimal JPEG header: SOI, an APP0 segment, then SOF0 with the frame size.
const jpeg = (w: number, h: number) =>
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 0, 0, 0, 0]);

describe('customer upload validation', () => {
  it('accepts a file only when its bytes match the declared type', () => {
    expect(sniffUpload('image/png', png(10, 10))).toBe(true);
    expect(sniffUpload('image/jpeg', png(10, 10))).toBe(false);
    expect(sniffUpload('video/mp4', Buffer.from('\0\0\0\x18ftypmp42', 'latin1'))).toBe(true);
    expect(sniffUpload('image/svg+xml', Buffer.from('<svg/>'))).toBe(false);
  });

  it('reads the pixel size from PNG and JPEG headers', () => {
    expect(imageSize('image/png', png(1080, 1920))).toEqual({ width: 1080, height: 1920 });
    expect(imageSize('image/jpeg', jpeg(3024, 4032))).toEqual({ width: 3024, height: 4032 });
  });
});
