import { NextResponse } from 'next/server';
import { ApiRequestError, api, type VoiceLabOverview } from '@/lib/api';

/** Same-origin voice lab state for client polling (the API token stays on the server). */
export async function GET() {
  try {
    return NextResponse.json(await api<VoiceLabOverview>('/v1/voice-lab'));
  } catch (e) {
    const status = e instanceof ApiRequestError ? e.status : 500;
    return NextResponse.json({ code: e instanceof ApiRequestError ? e.code : 'UNKNOWN' }, { status });
  }
}
