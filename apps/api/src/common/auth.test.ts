import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { pickOrg, type AuthContext } from './auth';
import { RemoteJwks, verifyJwt, type JwksSource } from './jwt';

const ISSUER = 'https://auth.example.test/';
const AUDIENCE = 'kampora-api';
const NOW = new Date('2026-11-02T10:00:00Z');
const t = Math.floor(NOW.getTime() / 1000);

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function token(claims: Record<string, unknown>, opts: { alg?: string; kid?: string; key?: KeyObject } = {}) {
  const alg = opts.alg ?? 'RS256';
  const head = b64({ alg, kid: opts.kid ?? 'rsa-1', typ: 'JWT' });
  const body = b64(claims);
  if (alg === 'none') return `${head}.${body}.`;
  const key = opts.key ?? (alg === 'ES256' ? ec.privateKey : rsa.privateKey);
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key);
  return `${head}.${body}.${sig.toString('base64url')}`;
}
const good = { sub: 'user-123', iss: ISSUER, aud: AUDIENCE, exp: t + 300, iat: t };

const jwksBody = {
  keys: [
    { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'rsa-1', alg: 'RS256' },
    { ...ec.publicKey.export({ format: 'jwk' }), kid: 'ec-1', alg: 'ES256' },
  ],
};
const jwks: JwksSource = new RemoteJwks('https://auth.example.test/jwks', 60_000, (async () => new Response(JSON.stringify(jwksBody))) as typeof fetch);
const verifyAt = (tok: string) => verifyJwt(tok, { issuer: ISSUER, audience: AUDIENCE, jwks, now: NOW });

describe('OIDC access token verification', () => {
  it('accepts a valid RS256 or ES256 token', async () => {
    expect((await verifyAt(token(good))).sub).toBe('user-123');
    expect((await verifyAt(token(good, { alg: 'ES256', kid: 'ec-1' }))).sub).toBe('user-123');
    expect((await verifyAt(token({ ...good, aud: ['other', AUDIENCE] }))).sub).toBe('user-123');
  });

  it('rejects wrong issuer, audience, expired, not-yet-valid and subject-less tokens', async () => {
    await expect(verifyAt(token({ ...good, iss: 'https://evil.test/' }))).rejects.toThrow('wrong issuer');
    await expect(verifyAt(token({ ...good, aud: 'another-api' }))).rejects.toThrow('wrong audience');
    await expect(verifyAt(token({ ...good, exp: t - 3600 }))).rejects.toThrow('expired');
    await expect(verifyAt(token({ ...good, nbf: t + 3600 }))).rejects.toThrow('not yet valid');
    await expect(verifyAt(token({ ...good, sub: '' }))).rejects.toThrow('missing subject');
  });

  it('rejects unsigned, HMAC, forged and tampered tokens', async () => {
    await expect(verifyAt(token(good, { alg: 'none' }))).rejects.toThrow('unsupported algorithm');
    await expect(verifyAt(token(good, { alg: 'HS256' }))).rejects.toThrow('unsupported algorithm');
    await expect(verifyAt(token(good, { key: other.privateKey }))).rejects.toThrow('bad signature');
    const [h, , s] = token(good).split('.');
    await expect(verifyAt(`${h}.${b64({ ...good, sub: 'admin' })}.${s}`)).rejects.toThrow('bad signature');
    await expect(verifyAt(token(good, { kid: 'unknown' }))).rejects.toThrow('unknown signing key');
    await expect(verifyAt('not-a-token')).rejects.toThrow('malformed');
  });
});

describe('organization selection', () => {
  const a: AuthContext = { userId: 'u', orgId: 'org-a', role: 'OWNER' };
  const b: AuthContext = { userId: 'u', orgId: 'org-b', role: 'MEMBER' };

  it('uses the only membership, or the requested one the user belongs to', () => {
    expect(pickOrg([a], undefined)).toBe(a);
    expect(pickOrg([a, b], 'org-b')).toBe(b);
  });

  it('refuses an organization the user is not a member of, and asks when there are several', () => {
    expect(() => pickOrg([a], 'org-b')).toThrow('Not a member');
    expect(() => pickOrg([a, b], undefined)).toThrow('Choose an organization');
  });
});

describe('auth configuration', () => {
  const env = { DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://x' };
  it('refuses dev authentication in production and incomplete OIDC settings', () => {
    expect(() => loadConfig({ ...env, NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow('AUTH_MODE must be "oidc"');
    expect(() => loadConfig({ ...env, NODE_ENV: 'production', AUTH_MODE: 'oidc', DEV_API_TOKEN: 'x'.repeat(20), OIDC_ISSUER: ISSUER, OIDC_AUDIENCE: AUDIENCE } as NodeJS.ProcessEnv)).toThrow('DEV_API_TOKEN');
    expect(() => loadConfig({ ...env, AUTH_MODE: 'oidc' } as NodeJS.ProcessEnv)).toThrow('OIDC_ISSUER');
    expect(loadConfig({ ...env, NODE_ENV: 'production', AUTH_MODE: 'oidc', OIDC_ISSUER: ISSUER, OIDC_AUDIENCE: AUDIENCE } as NodeJS.ProcessEnv).AUTH_MODE).toBe('oidc');
  });
});
