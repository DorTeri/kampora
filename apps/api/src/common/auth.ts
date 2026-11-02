import { timingSafeEqual } from 'node:crypto';
import {
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import { DEMO_USER_EMAIL, FIXTURES_USER_EMAIL, memberships, users, type Database } from '@kampora/database';
import type { AppConfig } from '../config';
import { CONFIG, DATABASE } from '../infra/tokens';
import { ApiError } from './errors';
import { JwtError, RemoteJwks, verifyJwt, type JwksSource } from './jwt';

export type Role = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface AuthContext {
  userId: string;
  orgId: string;
  role: Role;
}

const IS_PUBLIC = 'kampora:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

const ROLES = 'kampora:roles';
/** Only these membership roles may call the endpoint (checked after authentication, per organization). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<{ auth?: AuthContext }>().auth;
  if (!auth) throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Not authenticated');
  return auth;
});

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Synthetic users the dev token may act as (the `x-kampora-dev-user` header). Never real accounts. */
const DEV_USERS = [DEMO_USER_EMAIL, FIXTURES_USER_EMAIL];

type Req = { headers: Record<string, string | string[] | undefined>; auth?: AuthContext };
const header = (req: Req, name: string) => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

/**
 * Resolves who is calling and in which organization; every query then filters on that org.
 *
 *  - AUTH_MODE=dev (local only; refused in production): a static server-to-server token mapped to a seeded,
 *    synthetic user (demo by default, or one of DEV_USERS via `x-kampora-dev-user`).
 *  - AUTH_MODE=oidc: an OIDC access token (RS256/ES256; issuer, audience and expiry checked against the JWKS).
 *    `sub` must match a provisioned user (users.auth_subject); there is no self sign-up here. The organization
 *    comes from `x-kampora-org` and must be one of the user's memberships (a single membership is the default).
 *
 * `@Roles(...)` then restricts endpoints to membership roles in that organization.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly cache = new Map<string, { at: number; auth: AuthContext[] }>();
  private readonly jwks?: JwksSource;

  constructor(
    private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
  ) {
    if (config.AUTH_MODE === 'oidc')
      this.jwks = new RemoteJwks(config.OIDC_JWKS_URL ?? `${config.OIDC_ISSUER!.replace(/\/$/, '')}/.well-known/jwks.json`);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = context.switchToHttp().getRequest<Req>();
    const token = (header(req, 'authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Missing token');

    const found =
      this.config.AUTH_MODE === 'oidc' ? await this.oidcMemberships(token) : await this.devMemberships(token, header(req, 'x-kampora-dev-user'));
    req.auth = pickOrg(found, header(req, 'x-kampora-org'));

    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(req.auth.role))
      throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Your role in this organization cannot do this');
    return true;
  }

  private async devMemberships(token: string, as: string | undefined) {
    if (!this.config.DEV_API_TOKEN || !safeEqual(token, this.config.DEV_API_TOKEN))
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Invalid or missing token');
    const email = as ?? DEMO_USER_EMAIL;
    if (!DEV_USERS.includes(email)) throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Unknown dev user');
    const found = await this.memberships('email', email);
    if (!found.length) throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Dev user not seeded (run npm run db:seed)');
    return found;
  }

  private async oidcMemberships(token: string) {
    let sub: string;
    try {
      ({ sub } = await verifyJwt(token, { issuer: this.config.OIDC_ISSUER!, audience: this.config.OIDC_AUDIENCE!, jwks: this.jwks! }));
    } catch (e) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', e instanceof JwtError ? `Invalid token: ${e.message}` : 'Invalid token');
    }
    const found = await this.memberships('sub', sub);
    if (!found.length) throw new ApiError(HttpStatus.FORBIDDEN, 'NOT_PROVISIONED', 'This account has no Kampora organization');
    return found;
  }

  /** The user's memberships, cached for a minute (role changes apply within that window). */
  private async memberships(by: 'email' | 'sub', value: string): Promise<AuthContext[]> {
    const key = `${by}:${value}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.auth;
    const rows = await this.db
      .select({ userId: users.id, orgId: memberships.orgId, role: memberships.role })
      .from(users)
      .innerJoin(memberships, eq(memberships.userId, users.id))
      .where(by === 'email' ? eq(users.email, value) : eq(users.authSubject, value));
    this.cache.set(key, { at: Date.now(), auth: rows });
    return rows;
  }
}

/** The organization the request acts in: the requested one if the user belongs to it, else the only one. */
export function pickOrg(found: AuthContext[], requested: string | undefined): AuthContext {
  if (requested) {
    const m = found.find((x) => x.orgId === requested);
    // Same answer for "no such org" and "not yours": org ids are not enumerable through this API.
    if (!m) throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Not a member of this organization');
    return m;
  }
  if (found.length === 1) return found[0]!;
  throw new ApiError(HttpStatus.BAD_REQUEST, 'ORG_REQUIRED', 'Choose an organization (x-kampora-org)');
}
