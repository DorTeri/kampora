import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertValidKey, LocalDiskStorage, signMediaPath, verifyMediaSignature } from './index';

describe('storage keys', () => {
  it.each(['orgs/a/assets/x.jpg', 'renders/1.mp4'])('accepts %s', (key) => {
    expect(() => assertValidKey(key)).not.toThrow();
  });
  it.each(['../etc/passwd', 'orgs/../x', '/abs', 'a//b', 'with space.jpg', ''])('rejects %s', (key) => {
    expect(() => assertValidKey(key)).toThrow();
  });
});

describe('signed media URLs', () => {
  it('verifies valid signatures and rejects tampering or expiry', () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = signMediaPath('a/b.mp4', exp, 'secret');
    expect(verifyMediaSignature('a/b.mp4', exp, sig, 'secret')).toBe(true);
    expect(verifyMediaSignature('a/c.mp4', exp, sig, 'secret')).toBe(false);
    expect(verifyMediaSignature('a/b.mp4', exp, sig, 'other')).toBe(false);
    expect(verifyMediaSignature('a/b.mp4', exp, sig, 'secret', '', (exp + 1) * 1000)).toBe(false);
  });

  it('round-trips files on local disk and builds signed URLs', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'kampora-storage-'));
    const storage = new LocalDiskStorage({ root, signingSecret: 's', publicBaseUrl: 'http://api' });
    await storage.put('orgs/x/file.txt', Buffer.from('שלום'));
    expect((await storage.getBuffer('orgs/x/file.txt')).toString()).toBe('שלום');
    expect(await storage.exists('orgs/x/missing.txt')).toBe(false);
    const url = new URL(await storage.getReadUrl('orgs/x/file.txt'));
    expect(url.pathname).toBe('/v1/media/orgs/x/file.txt');
    expect(url.searchParams.get('sig')).toBeTruthy();
  });
});
