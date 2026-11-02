import { NextResponse } from 'next/server';
import { ApiRequestError, api } from '@/lib/api';

/**
 * Same-origin proxy for the Campaign Director (the API token stays on the server). Only these routes pass;
 * the API checks the organization of every id again.
 */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ALLOWED: Record<'GET' | 'POST', RegExp[]> = {
  GET: [/^conversations$/, new RegExp(`^conversations/${UUID}$`, 'i')],
  POST: [
    /^conversations$/,
    new RegExp(`^conversations/${UUID}/(messages|facts)$`, 'i'),
    new RegExp(`^approvals/${UUID}/decision$`, 'i'),
  ],
};

async function forward(method: 'GET' | 'POST', req: Request, params: Promise<{ path: string[] }>) {
  const path = (await params).path.join('/');
  if (!ALLOWED[method].some((re) => re.test(path))) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  try {
    const body = method === 'POST' ? await req.json().catch(() => ({})) : undefined;
    return NextResponse.json(await api(`/v1/director/${path}`, { method, body }));
  } catch (e) {
    const status = e instanceof ApiRequestError ? e.status : 502;
    return NextResponse.json({ code: e instanceof ApiRequestError ? e.code : 'UNAVAILABLE' }, { status });
  }
}

export function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward('GET', req, ctx.params);
}

export function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return forward('POST', req, ctx.params);
}
