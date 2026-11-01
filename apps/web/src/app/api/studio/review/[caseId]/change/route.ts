import { NextResponse } from 'next/server';
import { applyCreativeChange, type DirectionInput } from '@kampora/creative-engine/design';
import { DirectionChangeRequestSchema } from '@kampora/shared';
import { demoCase } from '@/lib/demo-cases';

/**
 * Demo change requests: the same deterministic change engine the API runs, on the recorded demo case. Stateless:
 * the client sends the direction's current state; nothing is stored and nothing paid can run.
 */
export async function POST(req: Request, { params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const c = demoCase(caseId);
  if (!c) return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  const json = (await req.json().catch(() => null)) as { key?: unknown } | null;
  const key = json?.key;
  if (key !== 'A' && key !== 'B' && key !== 'C') return NextResponse.json({ code: 'INVALID_KEY' }, { status: 400 });
  const body = DirectionChangeRequestSchema.safeParse(json);
  if (!body.success) return NextResponse.json({ code: 'INVALID_REQUEST', message: body.error.issues[0]?.message }, { status: 400 });
  if (body.data.direction && body.data.direction.key !== key)
    return NextResponse.json({ code: 'INVALID_DIRECTION' }, { status: 400 });
  const set = c.review.set;
  const current = { ...set, directions: set.directions.map((d) => (d.key === key && body.data.direction ? body.data.direction : d)) };
  const input = { ...(c.review.input as DirectionInput), copy: c.review.copy[key] as unknown as DirectionInput['copy'] };
  return NextResponse.json(applyCreativeChange(input, current, key, body.data.text));
}
