import { NextResponse } from 'next/server';
import { ApiRequestError, api } from '@/lib/api';

/** Same-origin proxy for direction changes and approval (the API token stays on the server). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; key: string; action: string }> }) {
  const { id, key, action } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !['A', 'B', 'C'].includes(key) || !['changes', 'approve'].includes(action))
    return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  try {
    const body = await req.json();
    return NextResponse.json(await api(`/v1/projects/${id}/directions/${key}/${action}`, { method: 'POST', body }));
  } catch (e) {
    const status = e instanceof ApiRequestError ? e.status : 500;
    return NextResponse.json(
      { code: e instanceof ApiRequestError ? e.code : 'UNKNOWN', message: e instanceof Error ? e.message : '' },
      { status },
    );
  }
}
