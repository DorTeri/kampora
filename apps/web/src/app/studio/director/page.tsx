import { redirect } from 'next/navigation';
import { DirectorDemo } from '@/components/director/demo';
import { LiveDirector } from '@/components/director/live';
import { api, type BusinessSummary } from '@/lib/api';
import type { ConversationListItem, DirectorWorkspaceDto } from '@/lib/director';
import { DEMO_MODE } from '@/lib/review';

export const dynamic = 'force-dynamic';

/**
 * The Campaign Director workspace: the main entry point. Live, it talks to the API (memory and conversations in
 * Postgres). In demo mode (no backend) it runs the clearly labelled in-browser sandbox and the recorded run.
 */
export default async function DirectorPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  if (DEMO_MODE) return <DirectorDemo />;
  const { c } = await searchParams;
  const [conversations, businesses] = await Promise.all([
    api<ConversationListItem[]>('/v1/director/conversations'),
    api<BusinessSummary[]>('/v1/businesses'),
  ]);
  const id = c && /^[0-9a-f-]{36}$/i.test(c) ? c : conversations[0]?.id;
  if (!id) {
    const created = await api<DirectorWorkspaceDto>('/v1/director/conversations', { method: 'POST', body: {} });
    redirect(`/studio/director?c=${created.id}`);
  }
  const workspace = await api<DirectorWorkspaceDto>(`/v1/director/conversations/${id}`);
  return (
    <div className="animate-rise">
      <LiveDirector initial={workspace} conversations={conversations} businesses={businesses.map((b) => ({ id: b.id, name: b.name }))} />
    </div>
  );
}
