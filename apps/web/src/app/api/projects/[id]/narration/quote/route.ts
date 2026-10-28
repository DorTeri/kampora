import { NextResponse } from 'next/server';
import { ApiRequestError, api, type NarrationQuote } from '@/lib/api';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const voiceId = new URL(request.url).searchParams.get('voiceId') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[A-Za-z0-9_-]{1,64}$/.test(voiceId)) {
    return NextResponse.json({ code: 'VALIDATION_FAILED' }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await api<NarrationQuote>(`/v1/projects/${id}/narration/quote?voiceId=${encodeURIComponent(voiceId)}`),
    );
  } catch (e) {
    const status = e instanceof ApiRequestError ? e.status : 500;
    return NextResponse.json({ code: e instanceof ApiRequestError ? e.code : 'UNKNOWN' }, { status });
  }
}
