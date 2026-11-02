import { createPublicKey, verify, type JsonWebKey, type KeyObject } from 'node:crypto';

/**
 * Minimal OIDC access-token verification with node:crypto (no extra dependency): RS256 / ES256 signatures from the
 * issuer's JWKS, exact issuer, audience, expiry and not-before. Anything else (alg "none", HS*, unknown key, missing
 * claims) is rejected.
 */

export interface JwtClaims {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  nbf?: number;
  iat?: number;
  email?: string;
  [claim: string]: unknown;
}

export class JwtError extends Error {}

const ALGS = { RS256: { hash: 'sha256', kty: 'RSA' }, ES256: { hash: 'sha256', kty: 'EC' } } as const;
type Alg = keyof typeof ALGS;

function b64json(part: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new JwtError('malformed token');
  }
}

export interface JwksSource {
  key(kid: string | undefined, alg: Alg): Promise<KeyObject | undefined>;
}

/** Fetches and caches the issuer's JWKS; an unknown kid refreshes it at most once a minute. */
export class RemoteJwks implements JwksSource {
  private keys: (JsonWebKey & { kid?: string; alg?: string })[] = [];
  private fetchedAt = 0;

  constructor(
    private readonly url: string,
    private readonly ttlMs = 10 * 60_000,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async refresh(force: boolean) {
    const age = Date.now() - this.fetchedAt;
    if (!force && age < this.ttlMs && this.keys.length) return;
    if (force && age < 60_000) return;
    const res = await this.fetcher(this.url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new JwtError(`JWKS fetch failed (${res.status})`);
    const body = (await res.json()) as { keys?: unknown };
    this.keys = Array.isArray(body.keys) ? (body.keys as typeof this.keys) : [];
    this.fetchedAt = Date.now();
  }

  async key(kid: string | undefined, alg: Alg) {
    await this.refresh(false);
    const find = () => this.keys.find((k) => k.kty === ALGS[alg].kty && (!kid || k.kid === kid) && (!k.alg || k.alg === alg));
    let jwk = find();
    if (!jwk && kid) {
      await this.refresh(true);
      jwk = find();
    }
    return jwk ? createPublicKey({ key: jwk, format: 'jwk' }) : undefined;
  }
}

export async function verifyJwt(
  token: string,
  opts: { issuer: string; audience: string; jwks: JwksSource; now?: Date; clockSkewSec?: number },
): Promise<JwtClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new JwtError('malformed token');
  const [h, p, s] = parts as [string, string, string];
  const header = b64json(h);
  const alg = header.alg;
  if (typeof alg !== 'string' || !(alg in ALGS)) throw new JwtError('unsupported algorithm');
  const key = await opts.jwks.key(typeof header.kid === 'string' ? header.kid : undefined, alg as Alg);
  if (!key) throw new JwtError('unknown signing key');
  const signature = Buffer.from(s, 'base64url');
  const ok = verify(ALGS[alg as Alg].hash, Buffer.from(`${h}.${p}`), alg === 'ES256' ? { key, dsaEncoding: 'ieee-p1363' } : key, signature);
  if (!ok) throw new JwtError('bad signature');

  const claims = b64json(p);
  const now = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  const skew = opts.clockSkewSec ?? 60;
  if (claims.iss !== opts.issuer) throw new JwtError('wrong issuer');
  const aud = claims.aud;
  if (!(aud === opts.audience || (Array.isArray(aud) && aud.includes(opts.audience)))) throw new JwtError('wrong audience');
  if (typeof claims.exp !== 'number' || claims.exp + skew < now) throw new JwtError('expired');
  if (typeof claims.nbf === 'number' && claims.nbf - skew > now) throw new JwtError('not yet valid');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new JwtError('missing subject');
  return claims as JwtClaims;
}
