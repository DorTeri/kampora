'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { ConversationListItem, DirectorWorkspaceDto } from '@/lib/director';
import { DirectorWorkspace, type DirectorPort } from './workspace';

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/director/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => null)) as (T & { code?: string }) | null;
  if (!res.ok) throw { code: json?.code ?? 'UNAVAILABLE' };
  return json as T;
}

function livePort(conversationId: string): DirectorPort {
  return {
    load: () => call<DirectorWorkspaceDto>(`conversations/${conversationId}`),
    send: async (text, clientMessageId) => void (await call(`conversations/${conversationId}/messages`, { text, clientMessageId })),
    decide: async (approvalId, decision) => void (await call(`approvals/${approvalId}/decision`, { decision })),
    decideFact: async (key, decision) => void (await call(`conversations/${conversationId}/facts`, { key, decision })),
  };
}

export function LiveDirector({
  initial,
  conversations,
  businesses,
}: {
  initial: DirectorWorkspaceDto;
  conversations: ConversationListItem[];
  businesses: { id: string; name: string }[];
}) {
  const router = useRouter();
  const port = useMemo(() => livePort(initial.id), [initial.id]);
  const [creating, setCreating] = useState(false);
  const [businessId, setBusinessId] = useState(initial.businessId ?? '');

  async function start() {
    setCreating(true);
    try {
      const ws = await call<DirectorWorkspaceDto>('conversations', businessId ? { businessId } : {});
      router.push(`/studio/director?c=${ws.id}`);
    } finally {
      setCreating(false);
    }
  }

  const header = (ws: DirectorWorkspaceDto) => (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-extrabold">מנהל הקמפיין</h1>
        <p className="text-sm text-muted">{ws.businessId ? <bdi>{ws.title}</bdi> : 'עסק חדש'}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {conversations.length > 1 && (
          <label className="flex items-center gap-1">
            <span className="sr-only">שיחה</span>
            <select
              value={initial.id}
              onChange={(e) => router.push(`/studio/director?c=${e.target.value}`)}
              className="min-h-9 max-w-48 rounded-full border border-line bg-surface px-3"
            >
              {conversations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} · {new Date(c.updatedAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-1">
          <span className="sr-only">עסק לשיחה החדשה</span>
          <select value={businessId} onChange={(e) => setBusinessId(e.target.value)} className="min-h-9 max-w-40 rounded-full border border-line bg-surface px-3">
            <option value="">עסק חדש</option>
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void start()} disabled={creating} className="min-h-9 rounded-full bg-primary-soft px-4 font-bold text-primary-ink hover:bg-primary hover:text-white disabled:opacity-50">
          ＋ שיחה חדשה
        </button>
      </div>
    </div>
  );

  return <DirectorWorkspace key={initial.id} port={port} initial={initial} studioLinks header={header} />;
}
