import { NextResponse } from 'next/server';
import { ApiRequestError, api, type StaticAdsResponse } from '@/lib/api';

/** Same-origin static ads for client polling (the API token stays on the server). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  try {
    return NextResponse.json(await api<StaticAdsResponse>(`/v1/projects/${id}/static-ads`));
  } catch (e) {
    const status = e instanceof ApiRequestError ? e.status : 500;
    return NextResponse.json({ code: e instanceof ApiRequestError ? e.code : 'UNKNOWN' }, { status });
  }
}
