import { NextResponse } from 'next/server';

const API_URL = process.env.KAMPORA_API_URL ?? 'http://localhost:4000';
const API_TOKEN = process.env.KAMPORA_API_TOKEN ?? '';

/** Same-origin upload: the file is forwarded as-is to the API, which validates it; the token stays on the server. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  const query = new URL(req.url).searchParams;
  const forward = new URLSearchParams();
  for (const key of ['subject', 'description', 'rights']) forward.set(key, query.get(key) ?? '');
  const res = await fetch(`${API_URL}/v1/businesses/${id}/assets?${forward}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': req.headers.get('content-type') ?? 'application/octet-stream',
    },
    body: Buffer.from(await req.arrayBuffer()),
    cache: 'no-store',
  });
  const json = await res.json().catch(() => ({ code: 'UNKNOWN' }));
  return NextResponse.json(json, { status: res.status });
}
