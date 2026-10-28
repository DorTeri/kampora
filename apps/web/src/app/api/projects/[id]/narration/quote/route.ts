import { NextResponse } from 'next/server';
import { NarrationModeSchema, VoiceStyleSchema } from '@kampora/shared';
import { ApiRequestError, api, type NarrationQuote } from '@/lib/api';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const search = new URL(request.url).searchParams;
  const voiceId = search.get('voiceId') ?? '';
  const sceneKey = search.get('sceneKey') ?? '';
  const mode = NarrationModeSchema.safeParse(search.get('mode') ?? 'continuous');
  const style = VoiceStyleSchema.safeParse(search.get('style') ?? 'natural');
  if (
    !/^[0-9a-f-]{36}$/i.test(id) ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(voiceId) ||
    (sceneKey && !/^[A-Za-z0-9_-]{1,64}$/.test(sceneKey)) ||
    !mode.success ||
    !style.success
  ) {
    return NextResponse.json({ code: 'VALIDATION_FAILED' }, { status: 400 });
  }
  const query = new URLSearchParams({ voiceId, mode: mode.data, style: style.data });
  if (sceneKey) query.set('sceneKey', sceneKey);
  try {
    return NextResponse.json(await api<NarrationQuote>(`/v1/projects/${id}/narration/quote?${query}`));
  } catch (e) {
    const status = e instanceof ApiRequestError ? e.status : 500;
    return NextResponse.json({ code: e instanceof ApiRequestError ? e.code : 'UNKNOWN' }, { status });
  }
}
