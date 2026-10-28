import { NextResponse } from 'next/server';
import { ApiRequestError, api, type ProjectDetail } from '@/lib/api';

/** Same-origin narration status for client polling (the API token stays on the server). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  try {
    const project = await api<ProjectDetail>(`/v1/projects/${id}`);
    return NextResponse.json(project.narration);
  } catch (e) {
    const status = e instanceof ApiRequestError ? e.status : 500;
    return NextResponse.json({ code: e instanceof ApiRequestError ? e.code : 'UNKNOWN' }, { status });
  }
}
