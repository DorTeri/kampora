'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FactKey } from '@kampora/shared';
import {
  APPROVAL_KIND_LABELS,
  FACT_STATE_LABELS,
  SUGGESTED_PROMPTS,
  newClientMessageId,
  type DirectorMessageDto,
  type DirectorWorkspaceDto,
} from '@/lib/director';
import { Badge, cn } from '../ui';
import { DirectorCardView, ToolActivity, type CardActions } from './cards';

/** How the workspace talks to a Director: the API (live) or the in-browser sandbox (demo). */
export interface DirectorPort {
  load(): Promise<DirectorWorkspaceDto>;
  send(text: string, clientMessageId: string): Promise<void>;
  decide(approvalId: string, decision: 'APPROVED' | 'REJECTED'): Promise<void>;
  decideFact(key: FactKey, decision: 'CONFIRM' | 'REJECT'): Promise<void>;
}

const ERRORS: Record<string, string> = {
  MESSAGE_IN_PROGRESS: 'ההודעה הקודמת עוד בטיפול. רגע אחד.',
  NOT_FOUND: 'השיחה לא נמצאה.',
  UNAVAILABLE: 'אין חיבור לשרת כרגע. ההודעה לא נשלחה; אפשר לנסות שוב.',
};

export function DirectorWorkspace({
  port,
  initial,
  studioLinks,
  header,
  notice,
}: {
  port: DirectorPort;
  initial: DirectorWorkspaceDto;
  studioLinks: boolean;
  /** Rendered from the current workspace, so it follows changes made during the conversation. */
  header?: React.ReactNode | ((ws: DirectorWorkspaceDto) => React.ReactNode);
  notice?: React.ReactNode;
}) {
  const [ws, setWs] = useState(initial);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimistic, setOptimistic] = useState<DirectorMessageDto | null>(null);
  // A failed send keeps its id, so retrying the same text cannot run the turn twice.
  const pendingId = useRef<{ text: string; id: string } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => setWs(initial), [initial]);
  // Block body: some browsers return a Promise from scrollIntoView, which React would call as a cleanup.
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [ws.messages.length, optimistic]);

  const run = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await work();
        setWs(await port.load());
        return true;
      } catch (e) {
        const code = (e as { code?: string }).code ?? 'UNAVAILABLE';
        setError(ERRORS[code] ?? 'משהו השתבש. שום דבר לא חויב; אפשר לנסות שוב.');
        return false;
      } finally {
        setBusy(false);
        setOptimistic(null);
      }
    },
    [port],
  );

  const say = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean || busy) return;
      const id = pendingId.current?.text === clean ? pendingId.current.id : newClientMessageId();
      pendingId.current = { text: clean, id };
      setOptimistic({ id: 'pending', role: 'OWNER', text: clean, cards: [], tools: [], createdAt: new Date().toISOString() });
      setDraft('');
      const ok = await run(() => port.send(clean, id));
      if (ok) pendingId.current = null;
      else setDraft(clean);
    },
    [busy, port, run],
  );

  const actions: CardActions = useMemo(
    () => ({
      say: (t) => void say(t),
      decide: (id, d) => void run(() => port.decide(id, d)),
      approval: (id) => [...ws.pending, ...ws.decided].find((a) => a.id === id),
      busy,
      studioLinks,
    }),
    [say, run, port, ws.pending, ws.decided, busy, studioLinks],
  );

  const messages = optimistic ? [...ws.messages, optimistic] : ws.messages;
  const lastDirector = [...ws.messages].reverse().find((m) => m.role === 'DIRECTOR')?.id;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="flex min-h-[70dvh] flex-col rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-card)]">
        <div className="border-b border-line px-5 py-4">
          {typeof header === 'function' ? header(ws) : header}
          {notice}
        </div>

        <ol className="flex-1 space-y-5 overflow-y-auto px-4 py-6 sm:px-6" aria-live="polite">
          {messages.length === 0 && (
            <li className="mx-auto max-w-md py-10 text-center text-ink-soft">
              <p className="text-lg font-bold text-ink">שלום! אני מנהל הקמפיין שלך.</p>
              <p className="mt-2">ספר לי על העסק ומה תרצה לקדם. אני אשאל רק מה שחסר, ואכין רעיונות, תסריט ועיצובים לאישורך.</p>
            </li>
          )}
          {messages.map((m) => (
            <li key={m.id} className={cn('flex', m.role === 'OWNER' ? 'justify-start' : 'justify-end')}>
              <div
                className={cn(
                  'max-w-[min(42rem,92%)]',
                  m.role === 'OWNER' ? 'rounded-3xl rounded-tr-md bg-primary px-4 py-3 text-white' : 'w-full',
                  m.id === 'pending' && 'opacity-70',
                )}
              >
                {m.role === 'DIRECTOR' && (
                  <span className="mb-1 flex items-center gap-2 text-xs font-bold text-muted">
                    <span aria-hidden className="grid size-6 place-items-center rounded-lg bg-gradient-to-br from-primary to-accent text-[11px] text-white">
                      K
                    </span>
                    מנהל הקמפיין
                  </span>
                )}
                <p className={cn('whitespace-pre-line leading-relaxed', m.role === 'DIRECTOR' && 'rounded-3xl rounded-tl-md bg-canvas px-4 py-3')}>{m.text}</p>
                {m.cards.map((c, i) => (
                  <DirectorCardView key={i} card={c} actions={actions} latest={m.id === lastDirector} />
                ))}
                {m.role === 'DIRECTOR' && <ToolActivity tools={m.tools} />}
              </div>
            </li>
          ))}
          {busy && (
            <li className="flex justify-end text-sm text-muted" role="status">
              מנהל הקמפיין עובד על זה…
            </li>
          )}
          <div ref={bottom} />
        </ol>

        <form
          className="border-t border-line p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void say(draft);
          }}
        >
          {error && (
            <p role="alert" className="mb-2 rounded-xl bg-accent-soft px-3 py-2 text-sm font-semibold text-[#c2410c]">
              {error}
            </p>
          )}
          <div className="mb-3 flex flex-wrap gap-2">
            {SUGGESTED_PROMPTS.map((p) => (
              <button
                key={p}
                type="button"
                disabled={busy}
                onClick={() => void say(p)}
                className="rounded-full bg-ink/5 px-3 py-1 text-xs font-semibold text-ink-soft hover:bg-primary-soft hover:text-primary-ink disabled:opacity-50"
              >
                {p}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <label htmlFor="director-input" className="sr-only">
              הודעה למנהל הקמפיין
            </label>
            <textarea
              id="director-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void say(draft);
                }
              }}
              rows={2}
              maxLength={2000}
              placeholder='למשל: "בוא נקדם השבוע את ההמבורגר החדש"'
              className="min-h-12 flex-1 resize-none rounded-2xl border border-line bg-canvas px-4 py-3 text-[15px] outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="min-h-12 rounded-2xl bg-primary px-5 font-bold text-white hover:bg-primary-ink disabled:bg-primary/40"
            >
              שליחה
            </button>
          </div>
        </form>
      </section>

      <SidePanel ws={ws} port={port} run={run} busy={busy} studioLinks={studioLinks} say={(t) => void say(t)} />
    </div>
  );
}

function Panel({ title, children, count }: { title: string; children: React.ReactNode; count?: number }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
      <h2 className="mb-3 flex items-center gap-2 text-base font-bold">
        {title}
        {count !== undefined && count > 0 && <Badge tone="warn">{count}</Badge>}
      </h2>
      {children}
    </section>
  );
}

function SidePanel({
  ws,
  port,
  run,
  busy,
  studioLinks,
  say,
}: {
  ws: DirectorWorkspaceDto;
  port: DirectorPort;
  run: (work: () => Promise<void>) => Promise<boolean>;
  busy: boolean;
  studioLinks: boolean;
  say(text: string): void;
}) {
  return (
    <aside className="space-y-4" aria-label="הקשר העסק">
      <Panel title="ממתין לאישור שלך" count={ws.pending.length}>
        {ws.pending.length === 0 ? (
          <p className="text-sm text-muted">אין כרגע שום דבר שמחכה לך.</p>
        ) : (
          <ul className="space-y-3">
            {ws.pending.map((a) => (
              <li key={a.id} className="rounded-2xl bg-warn-soft/50 p-3 text-sm">
                <span className="text-xs font-bold text-warn">{APPROVAL_KIND_LABELS[a.kind]}</span>
                <p className="font-semibold">{a.title}</p>
                <p className="text-xs text-muted">{a.estimatedUsd > 0 ? `$${a.estimatedUsd.toFixed(2)}` : 'ללא עלות'}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => port.decide(a.id, 'APPROVED'))}
                    className="min-h-9 rounded-full bg-primary px-4 text-xs font-bold text-white disabled:opacity-50"
                  >
                    אישור
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run(() => port.decide(a.id, 'REJECTED'))}
                    className="min-h-9 rounded-full border border-line px-4 text-xs font-bold text-ink-soft disabled:opacity-50"
                  >
                    לא עכשיו
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="מה אני יודע על העסק">
        {ws.memory.length === 0 ? (
          <p className="text-sm text-muted">עוד לא סיפרת לי על העסק. כל פרט שתאשר יישמר לפעם הבאה.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {ws.memory.map((f) => {
              const s = FACT_STATE_LABELS[f.state];
              return (
                <li key={f.key} className="flex flex-col gap-1 border-b border-line/70 pb-2 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-muted">{f.label}</span>
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </div>
                  <bdi className="break-words">{f.value}</bdi>
                  {f.state === 'PROPOSED' && (
                    <div className="flex gap-2">
                      <button type="button" disabled={busy} onClick={() => void run(() => port.decideFact(f.key, 'CONFIRM'))} className="text-xs font-bold text-primary disabled:opacity-50">
                        נכון, לאשר
                      </button>
                      <button type="button" disabled={busy} onClick={() => void run(() => port.decideFact(f.key, 'REJECT'))} className="text-xs font-bold text-muted disabled:opacity-50">
                        לא נכון
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {ws.recommendations.length > 0 && (
        <Panel title="מה הייתי עושה עכשיו">
          <ul className="space-y-3 text-sm">
            {ws.recommendations.slice(0, 3).map((r) => (
              <li key={r.id}>
                <p className="font-semibold">{r.title}</p>
                <p className="text-ink-soft">{r.reasoning}</p>
                <p className="mt-1 text-xs text-muted">
                  {r.costNote}
                  {r.approvalRequired ? ' · דורש אישור' : ''}
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="סטטוס הפקה">
        {ws.status.length === 0 ? (
          <p className="text-sm text-muted">עוד אין הפקות.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {ws.status.map((s, i) => (
              <li key={`${s.label}-${i}`} className="flex items-center justify-between gap-2">
                {s.href && studioLinks ? (
                  <Link href={s.href} className="font-semibold text-primary hover:underline">
                    {s.label}
                  </Link>
                ) : (
                  <span className="font-semibold">{s.label}</span>
                )}
                <Badge>{s.state}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {ws.previews.length > 0 && (
        <Panel title="תצוגות מקדימות">
          <div className="grid grid-cols-2 gap-2">
            {ws.previews.map((p) =>
              p.videoUrl ? (
                <video key={p.projectId} src={p.videoUrl} controls preload="metadata" className="aspect-[9/16] w-full rounded-xl bg-ink object-cover" />
              ) : p.imageUrl ? (
                <img key={p.projectId} src={p.imageUrl} alt="מודעה לדוגמה" className="aspect-[4/5] w-full rounded-xl object-cover" />
              ) : null,
            )}
          </div>
        </Panel>
      )}

      <Panel title="עבודות אחרונות">
        {ws.work.length === 0 ? (
          <p className="text-sm text-muted">עוד לא הכנו קמפיינים.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {ws.work.slice(0, 6).map((w) => (
              <li key={w.campaignId} className="flex flex-col">
                {w.projectId && studioLinks ? (
                  <Link href={`/studio/projects/${w.projectId}`} className="font-semibold text-primary hover:underline">
                    {w.title}
                  </Link>
                ) : (
                  <span className="font-semibold">{w.title}</span>
                )}
                <span className="text-xs text-muted">
                  {new Date(w.createdAt).toLocaleDateString('he-IL')} · {w.scriptApproved ? 'תסריט מאושר' : w.hasVideo ? 'תסריט ממתין' : 'רעיונות'}
                  {w.staticAds ? ` · ${w.staticAds} מודעות` : ''}
                  {w.directionApproved ? ' · עיצוב מאושר' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="צעדים מוצעים">
        <div className="flex flex-wrap gap-2">
          {['מה נשאר לאישור?', 'תשנה את הפתיחה של הסרטון הקודם', 'אני רוצה לנסות משהו יותר יוקרתי', 'מה כדאי לעשות השבוע?'].map((p) => (
            <button key={p} type="button" disabled={busy} onClick={() => say(p)} className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink-soft hover:border-primary hover:text-primary disabled:opacity-50">
              {p}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">
          {ws.paidGenerationEnabled ? 'יצירה בתשלום זמינה רק אחרי אישור מפורש שלך.' : 'יצירה בתשלום כבויה.'} שום מודעה לא מתפרסמת ושום הודעה לא נשלחת ללקוחות מכאן.
        </p>
      </Panel>
    </aside>
  );
}
