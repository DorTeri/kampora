import { NextResponse, type NextRequest } from 'next/server';
import { DEMO_MODE } from '@/lib/review';

/**
 * Demo mode (no Kampora backend): only the Campaign Director sandbox (runs in the browser) and the recorded creative
 * review are served. Every other Studio page needs the API, so it redirects to the Director; every other API route
 * answers 503 DEMO_MODE instead of trying to reach a backend (nothing paid can run either way).
 */
export function proxy(req: NextRequest) {
  if (!DEMO_MODE) return NextResponse.next();
  const path = req.nextUrl.pathname;
  if (path.startsWith('/studio/director') || path.startsWith('/studio/review') || path.startsWith('/api/studio/review/'))
    return NextResponse.next();
  if (path.startsWith('/api/'))
    return NextResponse.json(
      { code: 'DEMO_MODE', message: 'This demo runs without the Kampora backend; only the Director sandbox and the creative review are available.' },
      { status: 503 },
    );
  return NextResponse.redirect(new URL('/studio/director', req.url));
}

export const config = { matcher: ['/studio/:path*', '/api/:path*'] };
