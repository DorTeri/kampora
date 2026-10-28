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
import { DEMO_USER_EMAIL, memberships, users, type Database } from '@kampora/database';
import type { AppConfig } from '../config';
import { CONFIG, DATABASE } from '../infra/tokens';
import { ApiError } from './errors';

export interface AuthContext {
  userId: string;
  orgId: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
}

const IS_PUBLIC = 'kampora:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

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

/**
 * DEV-ONLY authentication: a static bearer token (sent server-to-server by the Next.js backend) mapped to the
 * seeded demo user. Refused in production by loadConfig(). Replace with real auth in Phase 3.
 * Every request still resolves an explicit org scope that all queries filter on.
 */
@Injectable()
export class DevAuthGuard implements CanActivate {
  private cached?: AuthContext;

  constructor(
    private readonly reflector: Reflector,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | undefined>; auth?: AuthContext }>();
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
    if (!this.config.DEV_API_TOKEN || !token || !safeEqual(token, this.config.DEV_API_TOKEN)) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Invalid or missing token');
    }
    if (!this.cached) {
      const [row] = await this.db
        .select({ userId: users.id, orgId: memberships.orgId, role: memberships.role })
        .from(users)
        .innerJoin(memberships, eq(memberships.userId, users.id))
        .where(eq(users.email, DEMO_USER_EMAIL));
      if (!row)
        throw new ApiError(
          HttpStatus.UNAUTHORIZED,
          'UNAUTHENTICATED',
          'Demo user not seeded (run npm run db:seed)',
        );
      this.cached = row;
    }
    req.auth = this.cached;
    return true;
  }
}
