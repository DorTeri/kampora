'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CreativeDirection, CriterionResult, RevisionRequest } from '@kampora/shared';
import { SpecPreview } from '@/components/spec-preview';
import { Badge, Button, Card, CardTitle, ErrorNote, cn } from '@/components/ui';
import { SAMPLE_REQUESTS, type ChangeOutcomeDto, type ReviewCase } from '@/lib/review';

type Key = CreativeDirection['key'];
type Format = '4:5' | '9:16';

const GOAL: Record<string, string> = { OFFER: 'מבצע', LEADS: 'לידים', AWARENESS: 'מודעות', SALES: 'מכירות', TRAFFIC: 'תנועה' };
const SEVERITY: Record<string, { label: string; tone: 'success' | 'neutral' | 'warn' | 'accent' }> = {
  OK: { label: 'תקין', tone: 'success' },
  MINOR: { label: 'הערה', tone: 'neutral' },
  MAJOR: { label: 'לתיקון', tone: 'warn' },
  CRITICAL: { label: 'חוסם', tone: 'accent' },
};
const STATUS: Record<RevisionRequest['status'], { label: string; tone: 'success' | 'warn' | 'accent' | 'neutral' }> = {
  APPLIED: { label: 'בוצע', tone: 'success' },
  PENDING_APPROVAL: { label: 'ממתין לאישור (בתשלום)', tone: 'warn' },
  NEEDS_OWNER: { label: 'דורש החלטה שלך', tone: 'accent' },
  NOT_POSSIBLE: { label: 'לא אפשרי', tone: 'neutral' },
};
const COMPONENT: Record<string, string> = {
  COPYWRITER: 'קופירייטר',
  ART_DIRECTOR: 'ארט דירקטור',
  VISUAL_PLANNER: 'מתכנן ויזואלי',
  LAYOUT_ENGINE: 'מנוע עימוד',
  VIDEO_PLANNER: 'מתכנן וידאו',
  VOICE_ENGINE: 'קריינות',
  OWNER: 'בעל העסק',
};
const FIT: Record<string, string> = {
  FITS: 'נכנס בגודל המתוכנן',
  REFLOWED: 'נכנס אחרי שבירת שורות מחדש',
  REARRANGED: 'נכנס בסידור אחר',
  SHORTER_COPY_SUGGESTED: 'מוצע קיצור טקסט',
  UNRESOLVED: 'לא נכנס',
};

interface OwnerChange {
  key: Key;
  text: string;
  at: string;
  outcome: ChangeOutcomeDto;
}

interface Approval {
  key: Key;
  decidedAt: string;
  note?: string;
  saved?: { format: string; version: number }[];
}

export function ReviewBoard({
  data,
  mode,
  changeUrl,
  approveUrl,
  storageKey,
}: {
  data: ReviewCase;
  mode: 'demo' | 'live';
  /** POST target; `{key}` is replaced by the direction key. */
  changeUrl: string;
  approveUrl: string | null;
  storageKey: string;
}) {
  const original = data.review.set;
  const [directions, setDirections] = useState<Record<Key, CreativeDirection>>(
    () => Object.fromEntries(original.directions.map((d) => [d.key, d])) as Record<Key, CreativeDirection>,
  );
  const [undo, setUndo] = useState<{ key: Key; direction: CreativeDirection }[]>([]);
  const [selected, setSelected] = useState<Key>(original.recommended);
  const [format, setFormat] = useState<Format>('4:5');
  const [changes, setChanges] = useState<OwnerChange[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [note, setNote] = useState('');
  const [compare, setCompare] = useState(false);

  // Demo approvals live only in this browser.
  useEffect(() => {
    if (mode !== 'demo') return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setApproval(JSON.parse(raw) as Approval);
    } catch {
      /* storage unavailable: approval is per page view */
    }
  }, [mode, storageKey]);

  const d = directions[selected];
  const base = original.directions.find((x) => x.key === selected)!;
  const revised = d !== base;
  const meta = data.directions.find((x) => x.key === selected);
  const assetUrls = data.review.assetUrls;
  const lastOutcome = changes.filter((c) => c.key === selected).at(-1)?.outcome;

  async function submit(request: string) {
    const t = request.trim();
    if (t.length < 2 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(changeUrl.replace('{key}', selected), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: selected, text: t, direction: d }),
      });
      const json = (await res.json()) as ChangeOutcomeDto & { message?: string };
      if (!res.ok) throw new Error(json.message || 'הבקשה נכשלה');
      setChanges((cs) => [...cs, { key: selected, text: t, at: new Date().toISOString(), outcome: json }]);
      if (json.changes.some((c) => c.status === 'APPLIED')) {
        setUndo((u) => [...u, { key: selected, direction: d }]);
        setDirections((ds) => ({ ...ds, [selected]: json.direction }));
      }
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'הבקשה נכשלה');
    } finally {
      setBusy(false);
    }
  }

  function revert() {
    const last = [...undo].reverse().find((u) => u.key === selected);
    if (!last) return;
    setUndo((u) => u.filter((x) => x !== last));
    setDirections((ds) => ({ ...ds, [selected]: last.direction }));
  }

  async function approve() {
    setError(null);
    if (mode === 'demo' || !approveUrl) {
      const a: Approval = { key: selected, decidedAt: new Date().toISOString(), ...(note.trim() ? { note: note.trim() } : {}) };
      setApproval(a);
      try {
        localStorage.setItem(storageKey, JSON.stringify(a));
      } catch {
        /* storage unavailable */
      }
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(approveUrl.replace('{key}', selected), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction: d, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      const json = (await res.json()) as { approved?: Approval; saved?: Approval['saved']; message?: string };
      if (!res.ok) throw new Error(json.message || 'האישור נכשל');
      setApproval({ key: selected, decidedAt: json.approved?.decidedAt ?? new Date().toISOString(), note: note.trim() || undefined, saved: json.saved });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'האישור נכשל');
    } finally {
      setBusy(false);
    }
  }

  const reviews = meta?.reviews ?? {};
  const chosen = data.concepts.find((c) => c.chosen) ?? data.concepts[0]!;

  return (
    <div className="animate-rise space-y-8">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {mode === 'demo' ? <Badge tone="warn">מצב הדגמה · בלי שרת</Badge> : <Badge tone="primary">מחובר לשרת</Badge>}
          <Badge tone="success">יצירה בתשלום כבויה · ‎$0</Badge>
          <Badge>{GOAL[data.brief.goal] ?? data.brief.goal}</Badge>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">
          <bdi>{data.business.name}</bdi> · {chosen.title}
        </h1>
        <p className="max-w-3xl text-ink-soft">
          שלושה כיווני עיצוב לאותו קונספט, עם הנימוק, ההשראות, ממצאי הבדיקה וההיסטוריה. בקשו שינוי במילים שלכם; שינויים חינמיים
          מבוצעים ונבדקים מחדש, ושינויים שדורשים טקסט חדש או תמונה חדשה ממתינים לאישור.
        </p>
        <nav aria-label="חלקי הסקירה" className="flex flex-wrap gap-2 text-sm">
          {[
            ['brief', 'בריף'],
            ['concepts', 'קונספטים'],
            ['moodboard', 'השראות'],
            ['directions', 'כיוונים'],
            ['review', 'סקירה ושינויים'],
            ['motion', 'סטוריבורד ווידאו'],
            ['trace', 'השפעת ההשראות'],
            ['compare', 'השוואה'],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="rounded-full border border-line bg-surface px-3 py-1 font-semibold text-ink-soft hover:border-ink/30">
              {label}
            </a>
          ))}
        </nav>
      </header>

      <Card id="brief">
        <CardTitle hint={`${data.business.category}${data.business.city ? ` · ${data.business.city}` : ''} · טון: ${data.business.tone}`}>בריף</CardTitle>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ['מוצר', data.brief.productName],
            ['הצעה', data.brief.offer],
            ['מסר מרכזי', data.brief.keyMessage],
            ['קהל', data.brief.audience],
            ['קריאה לפעולה', data.brief.cta],
          ]
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs font-bold text-muted">{k}</dt>
                <dd className="mt-1 font-medium">{v}</dd>
              </div>
            ))}
        </dl>
      </Card>

      {data.concepts.length ? (
      <section id="concepts">
        <h2 className="mb-3 text-xl font-bold">קונספטים</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {data.concepts.map((c) => (
            <Card key={c.title} className={cn('p-5', c.chosen && 'border-primary ring-2 ring-primary/20')}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="font-bold">{c.title}</h3>
                {c.chosen ? <Badge tone="primary">נבחר</Badge> : null}
              </div>
              <p className="text-sm text-ink-soft">{c.headline ?? c.hook}</p>
              {c.insight ? <p className="mt-2 text-xs text-muted">תובנה: {c.insight}</p> : null}
              <p className="mt-3 text-xs font-semibold text-muted" dir="ltr">
                {c.angle}
                {c.hookTechnique ? ` · ${c.hookTechnique}` : ''}
              </p>
            </Card>
          ))}
        </div>
      </section>

      ) : null}

      {data.moodboard.length ? (
      <section id="moodboard">
        <h2 className="mb-1 text-xl font-bold">השראות (מודבורד)</h2>
        <p className="mb-3 text-sm text-muted">
          ניתוח של עבודות מקצועיות ממקורות ציבוריים, עם קישור למקור. התמונות לא הועתקו ולא נשמרו. עבודה שסומנה &quot;נצפתה&quot; נבדקה
          בעיניים מול המקור והניתוח שלה תוקן לפי מה שנראה; עבודה שסומנה &quot;ניתוח כתוב&quot; נותחה רק מתיאורים, ומשקלה בבחירות העיצוב נמוך יותר.
          ההשפעה על כל כיוון מתועדת למטה.
        </p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.moodboard.map((r) => (
            <Card key={r.id} className="p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-muted" dir="ltr">
                    {r.brand}
                    {r.year ? ` · ${r.year}` : ''}
                  </p>
                  <h3 className="mt-1 font-bold leading-snug" dir="ltr">
                    {r.title}
                  </h3>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge>{r.score.toFixed(1)}</Badge>
                  {r.analysisBasis === 'IMAGES_VIEWED' ? <Badge tone="success">נצפתה</Badge> : <Badge tone="warn">ניתוח כתוב</Badge>}
                </div>
              </div>
              <p className="mt-2 text-sm text-ink-soft" dir="ltr">
                {r.principle}
              </p>
              {r.seen ? (
                <p className="mt-2 text-xs text-muted" dir="ltr">
                  Seen ({r.seen.confidence.toLowerCase()} confidence): {r.seen.whatWasSeen}
                </p>
              ) : null}
              {r.corrections?.length ? (
                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer font-bold text-ink-soft">{r.corrections.length} תיקונים אחרי הצפייה</summary>
                  <ul className="mt-1 space-y-1" dir="ltr">
                    {r.corrections.map((c) => (
                      <li key={c.field + c.wasClaimed} className="text-muted">
                        <span className="font-semibold">{c.field}:</span> <s>{c.wasClaimed}</s> → {c.actuallySeen}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-1">
                {r.moves.map((m) => (
                  <span key={m} className="rounded-full bg-ink/5 px-2 py-0.5 text-[11px] font-semibold text-ink-soft" dir="ltr">
                    {m}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted" dir="ltr">
                Why retrieved: {r.reasons.join('; ')}
              </p>
              <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-bold text-primary hover:underline">
                למקור ↗
              </a>
            </Card>
          ))}
        </div>
      </section>

      ) : null}

      <section id="directions">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">שלושה כיוונים</h2>
            <p className="text-sm text-muted">
              מומלץ: {original.recommended} · <span dir="ltr">{original.recommendedBecause}</span>
            </p>
          </div>
          <div role="radiogroup" aria-label="פורמט" className="flex rounded-full border border-line bg-surface p-1">
            {(['4:5', '9:16'] as Format[]).map((f) => (
              <button
                key={f}
                role="radio"
                aria-checked={format === f}
                onClick={() => setFormat(f)}
                className={cn('min-h-9 rounded-full px-4 text-sm font-bold', format === f ? 'bg-ink text-white' : 'text-ink-soft')}
              >
                <bdi>{f}</bdi>
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {(['A', 'B', 'C'] as Key[]).map((k) => {
            const x = directions[k];
            const spec = x.specs[format];
            return (
              <button
                key={k}
                onClick={() => setSelected(k)}
                aria-pressed={selected === k}
                className={cn(
                  'group flex flex-col overflow-hidden rounded-[var(--radius-card)] border bg-surface text-right shadow-[var(--shadow-card)] transition',
                  selected === k ? 'border-primary ring-2 ring-primary/25' : 'border-line hover:border-ink/30',
                )}
              >
                <div className={cn('mx-auto w-full', format === '9:16' && 'max-w-[300px]')}>
                  {spec ? <SpecPreview spec={spec} assetUrls={assetUrls} /> : null}
                </div>
                <div className="flex flex-1 flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid size-7 place-items-center rounded-full bg-ink text-sm font-black text-white">{k}</span>
                    <span className="font-bold">{x.name}</span>
                    {original.recommended === k ? <Badge tone="primary">מומלץ</Badge> : null}
                    {x !== original.directions.find((o) => o.key === k) ? <Badge tone="warn">עודכן</Badge> : null}
                    {approval?.key === k ? <Badge tone="success">אושר</Badge> : null}
                  </div>
                  <p className="text-sm text-ink-soft">{x.idea}</p>
                  <p className="mt-auto text-xs font-semibold text-muted" dir="ltr">
                    {x.method} · {x.typeSystem}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section id="review" className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold">
                כיוון {selected}: {d.name}
              </h2>
              {revised ? (
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
                  להשוות למקור
                </label>
              ) : null}
            </div>
            <div className={cn('grid gap-3', compare && revised ? 'grid-cols-2' : 'grid-cols-1')}>
              {compare && revised ? (
                <figure>
                  <SpecPreview spec={base.specs[format]!} assetUrls={assetUrls} />
                  <figcaption className="mt-1 text-center text-xs text-muted">לפני</figcaption>
                </figure>
              ) : null}
              <figure className={cn(!compare && format === '9:16' && 'mx-auto w-full max-w-[340px]')}>
                <SpecPreview spec={d.specs[format]!} assetUrls={assetUrls} />
                {compare && revised ? <figcaption className="mt-1 text-center text-xs text-muted">אחרי</figcaption> : null}
              </figure>
            </div>
            <p className="mt-3 text-xs text-muted">
              תצוגה חיה של מפרט העיצוב (אותם מספרים שהרנדר משתמש בהם).
              {meta?.renders?.[format] && !revised ? (
                <>
                  {' '}
                  <a className="font-bold text-primary hover:underline" href={`/demo-media/${meta.renders[format]}`} target="_blank" rel="noopener noreferrer">
                    הרנדר המלא ↗
                  </a>
                </>
              ) : revised ? ' אחרי אישור, הגרסה המעודכנת מרונדרת מקומית ב-worker.' : null}
            </p>
          </Card>

          <Card className="p-5">
            <CardTitle hint="שינוי חינמי מבוצע ונבדק מחדש. שינוי שדורש מילים חדשות או תמונה חדשה נרשם כבקשה בתשלום וממתין לאישור.">בקשת שינוי</CardTitle>
            <div className="mb-3 flex flex-wrap gap-2">
              {SAMPLE_REQUESTS.map((s) => (
                <button
                  key={s}
                  disabled={busy}
                  onClick={() => void submit(s)}
                  className="rounded-full border border-line bg-canvas px-3 py-1.5 text-sm font-semibold hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit(text);
              }}
              className="flex flex-col gap-2 sm:flex-row"
            >
              <label htmlFor="change-text" className="sr-only">
                מה לשנות?
              </label>
              <input
                id="change-text"
                value={text}
                maxLength={300}
                onChange={(e) => setText(e.target.value)}
                placeholder="למשל: זה עמוס מדי, הכותרת קטנה מדי…"
                className="min-h-11 flex-1 rounded-2xl border border-line bg-surface px-4 text-[15px] outline-none focus:border-primary"
              />
              <Button type="submit" disabled={busy || text.trim().length < 2}>
                {busy ? 'מעבד…' : 'בקש שינוי'}
              </Button>
            </form>
            {error ? (
              <div className="mt-3">
                <ErrorNote message={error} />
              </div>
            ) : null}
            {lastOutcome ? (
              <div className="mt-4 rounded-2xl bg-canvas p-4" aria-live="polite">
                <p className="font-semibold">{lastOutcome.summary}</p>
                {lastOutcome.parsed.intents.length ? (
                  <p className="mt-1 text-xs text-muted">
                    זוהה:{' '}
                    {lastOutcome.parsed.intents.map((i) => (
                      <span key={i.intent} dir="ltr" className="ml-2">
                        {i.intent} (“{i.matched}”)
                      </span>
                    ))}
                  </p>
                ) : null}
                <ul className="mt-3 space-y-2">
                  {lastOutcome.changes.map((c, i) => (
                    <li key={i} className="flex flex-wrap items-start gap-2 text-sm">
                      <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
                      <span className="font-semibold">{COMPONENT[c.component] ?? c.component}:</span>
                      <span>{c.change ?? c.instruction}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-muted">
                  בדיקה טכנית אחרי השינוי:{' '}
                  {Object.entries(lastOutcome.technical).map(([f, t]) => (
                    <span key={f} className="ml-3">
                      <bdi>{f}</bdi> {t.verdict === 'PASS' ? 'עבר' : `לתיקון (${t.problems.join('; ')})`}
                    </span>
                  ))}
                </p>
              </div>
            ) : null}
            {undo.some((u) => u.key === selected) ? (
              <button onClick={revert} className="mt-3 text-sm font-bold text-primary hover:underline">
                ↩ בטל את השינוי האחרון
              </button>
            ) : null}
          </Card>

          <Card className="p-5">
            <CardTitle hint="בדיקה טכנית שעברה אינה אישור מקצועי. ההחלטה שלך.">אישור</CardTitle>
            {approval ? (
              <div className="rounded-2xl bg-success-soft p-4 text-sm">
                <p className="font-bold text-success">
                  כיוון {approval.key} אושר · {new Date(approval.decidedAt).toLocaleString('he-IL')}
                </p>
                {approval.note ? <p className="mt-1">הערה: {approval.note}</p> : null}
                {approval.saved?.length ? (
                  <p className="mt-1">נשמרו גרסאות חדשות: {approval.saved.map((s) => `${s.format} v${s.version}`).join(', ')} (ברינדור מקומי)</p>
                ) : null}
                {mode === 'demo' ? <p className="mt-1 text-xs text-ink-soft">בהדגמה האישור נשמר רק בדפדפן הזה; שום דבר לא נשלח לשרת.</p> : null}
              </div>
            ) : (
              <p className="mb-3 text-sm text-ink-soft">סטטוס: ממתין לאישורך.</p>
            )}
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <label htmlFor="approval-note" className="sr-only">
                הערה לאישור
              </label>
              <input
                id="approval-note"
                value={note}
                maxLength={500}
                onChange={(e) => setNote(e.target.value)}
                placeholder="הערה (לא חובה)"
                className="min-h-11 flex-1 rounded-2xl border border-line bg-surface px-4 text-[15px] outline-none focus:border-primary"
              />
              <Button onClick={() => void approve()} disabled={busy}>
                אשר את כיוון {selected}
              </Button>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <CardTitle hint={d.idea}>נימוק</CardTitle>
            <div className="mb-3 flex flex-wrap gap-1">
              {d.moves.map((m) => (
                <span key={m} className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-bold text-primary-ink" dir="ltr">
                  {m}
                </span>
              ))}
            </div>
            <ul className="space-y-2 text-sm">
              {d.rationale.map((r, i) => (
                <li key={i} className="rounded-xl bg-canvas px-3 py-2">
                  <span className="font-bold" dir="ltr">
                    {r.topic}:
                  </span>{' '}
                  <span dir="auto">{r.decision}</span>
                  <span className="block text-xs text-muted" dir="auto">
                    {r.because}
                  </span>
                </li>
              ))}
            </ul>
            {d.references.length ? (
              <>
                <h3 className="mt-4 mb-2 text-sm font-bold">השראות שהשפיעו על הכיוון</h3>
                <ul className="space-y-1 text-xs text-ink-soft" dir="ltr">
                  {d.references.map((r) => (
                    <li key={r.referenceId}>{r.influence}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {meta?.pictureBrief ? (
              <p className="mt-4 text-xs text-muted" dir="ltr">
                Picture brief: {meta.pictureBrief.guidance}
              </p>
            ) : null}
            <p className="mt-4 text-xs text-muted">
              התאמת טקסט:{' '}
              {Object.entries(d.specs).map(([f, s]) => (
                <span key={f} className="ml-3">
                  <bdi>{f}</bdi> {FIT[s.fit.status] ?? s.fit.status} ({Math.round(s.fit.headlineRatio * 100)}% מגודל הכותרת)
                </span>
              ))}
            </p>
          </Card>

          <Findings reviews={reviews} format={format} revised={revised} />

          <Card className="p-5">
            <CardTitle hint="סבבי המבקר (עד 2, חינמיים בלבד) ובקשות השינוי שלך">היסטוריית תיקונים</CardTitle>
            <ol className="space-y-3 text-sm">
              {(reviews[format]?.history?.rounds ?? []).flatMap((round) =>
                round.revisions.map((r, i) => (
                  <li key={`${round.round}-${i}`} className="flex flex-wrap items-start gap-2">
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                    <span className="font-semibold">
                      מבקר, סבב {round.round + 1} · {COMPONENT[r.component] ?? r.component}:
                    </span>
                    <span dir="auto">{r.change ?? r.instruction}</span>
                  </li>
                )),
              )}
              {changes
                .filter((c) => c.key === selected)
                .map((c, i) => (
                  <li key={`o-${i}`} className="rounded-xl bg-canvas px-3 py-2">
                    <span className="font-bold">בקשה שלך:</span> “{c.text}”
                    <span className="block text-xs text-ink-soft">{c.outcome.summary}</span>
                  </li>
                ))}
              {!(reviews[format]?.history?.rounds ?? []).some((r) => r.revisions.length) && !changes.some((c) => c.key === selected) ? (
                <li className="text-muted">אין תיקונים עדיין.</li>
              ) : null}
            </ol>
            {reviews[format]?.history ? (
              <p className="mt-3 text-xs text-muted" dir="ltr">
                Critic stopped: {reviews[format]!.history!.stoppedBecause}
              </p>
            ) : null}
          </Card>
        </div>
      </section>

      {data.storyboard.length || data.video ? (
      <section id="motion" className="grid gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
        <Card>
          <CardTitle hint="נגזר באופן דטרמיניסטי מתסריט הקריינות של הקונספט שנבחר">סטוריבורד</CardTitle>
          <ol className="space-y-3">
            {data.storyboard.map((s, i) => (
              <li key={s.key} className="grid grid-cols-[auto_1fr] gap-3 rounded-2xl bg-canvas p-3">
                <span className="grid size-8 place-items-center rounded-full bg-ink text-sm font-black text-white">{i + 1}</span>
                <div>
                  <p className="text-xs font-bold text-muted">
                    <span dir="ltr">{s.role}</span> · <bdi>{s.durationSec}</bdi> שניות · ויזואל: <span dir="ltr">{s.visual}</span>
                  </p>
                  {s.onScreenText ? <p className="mt-1 font-bold">{s.onScreenText}</p> : null}
                  <p className="mt-1 text-sm text-ink-soft">{s.voiceover}</p>
                </div>
              </li>
            ))}
            <li className="grid grid-cols-[auto_1fr] gap-3 rounded-2xl border border-dashed border-line p-3">
              <span className="grid size-8 place-items-center rounded-full bg-primary text-sm font-black text-white">★</span>
              <p className="text-sm">
                {data.video && data.video.endCard !== 'composed'
                  ? 'אין צילום לעסק הזה, ולכן כל התצוגה היא הקומפוזיציה של הכיוון המומלץ '
                  : 'כרטיס סיום: הקומפוזיציה של הכיוון המומלץ '}
                (<bdi>9:16</bdi>), השכבות נכנסות לפי סדר הקריאה.
              </p>
            </li>
          </ol>
        </Card>
        <Card>
          <CardTitle hint={data.video ? `${data.video.seconds} שניות · גופן כותרת ${data.video.titleFace} · ${data.video.silent ? 'ללא קול (תצוגה מקדימה)' : ''}` : undefined}>
            תצוגת תנועה (Remotion, מקומי)
          </CardTitle>
          {data.video ? (
            <video
              src={`/demo-media/${data.video.file}`}
              controls
              muted
              playsInline
              preload="metadata"
              className="mx-auto aspect-[9/16] w-full max-w-[320px] rounded-2xl bg-ink"
            />
          ) : (
            <p className="text-sm text-muted">אין תצוגת תנועה למקרה הזה.</p>
          )}
          <p className="mt-3 text-xs text-muted">רונדר מקומית, בלי יצירת וידאו בתשלום. {data.pictures}</p>
        </Card>
      </section>

      ) : null}

      {data.trace?.length ? <TraceSection data={data} /> : null}

      {data.q6.render ? (
      <Card id="compare">
        <CardTitle
          hint={
            data.copyRevision
              ? 'משמאל: מודעת Q6 (תבנית אחת, הטקסט של Q6). מימין: הכיוון המומלץ של Q7 עם הטקסט המתוקן.'
              : 'אותו טקסט מאושר. משמאל: מודעת Q6 (תבנית אחת). מימין: הכיוון המומלץ של Q7.'
          }
        >
          השוואה ל-Q6
        </CardTitle>
        {data.copyRevision ? <CopyRevision revision={data.copyRevision} /> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <figure>
            <SpecPreview spec={directions[original.recommended].specs['4:5']!} assetUrls={assetUrls} />
            <figcaption className="mt-2 text-center text-sm font-semibold">Q7 · כיוון {original.recommended}</figcaption>
          </figure>
          <figure>
            <img src={`/demo-media/${data.q6.render}`} alt={`מודעת Q6: ${data.q6.adText.headline}`} className="w-full rounded-xl bg-canvas" />
            <figcaption className="mt-2 text-center text-sm font-semibold">Q6</figcaption>
          </figure>
        </div>
      </Card>
      ) : null}
    </div>
  );
}

const COPY_FIELDS: [string, string][] = [
  ['headline', 'כותרת'],
  ['subheadline', 'כותרת משנה'],
  ['cta', 'קריאה לפעולה'],
  ['ctaSubtext', 'שורה מתחת'],
];

function CopyRevision({ revision }: { revision: NonNullable<ReviewCase['copyRevision']> }) {
  const read = (t: Record<string, unknown>, k: string) => (typeof t[k] === 'string' ? (t[k] as string) : '');
  return (
    <div className="mb-5 rounded-2xl bg-canvas p-4">
      <h3 className="mb-2 font-bold">הטקסט: מה השתנה מ-Q6 ולמה</h3>
      <dl className="grid gap-2 text-sm">
        {COPY_FIELDS.filter(([k]) => read(revision.q6, k) || read(revision.q7, k)).map(([k, label]) => (
          <div key={k} className="grid gap-1 sm:grid-cols-[8rem_1fr_1fr]">
            <dt className="text-xs font-bold text-muted">{label}</dt>
            <dd className="text-muted">
              <s>{read(revision.q6, k)}</s>
            </dd>
            <dd className="font-semibold">{read(revision.q7, k)}</dd>
          </div>
        ))}
      </dl>
      <ul className="mt-3 list-disc space-y-1 ps-5 text-xs text-ink-soft">
        {revision.why.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">נכתב בלי קריאה למודל, מתוך הטענות המאושרות בלבד. ממתין לאישור בעל העסק.</p>
    </div>
  );
}

function TraceSection({ data }: { data: ReviewCase }) {
  const byId = new Map(data.moodboard.map((r) => [r.id, r]));
  return (
    <section id="trace">
      <h2 className="mb-1 text-xl font-bold">איך ההשראות שינו את העיצוב</h2>
      <p className="mb-3 text-sm text-muted">
        לכל כיוון הרצנו את אותו מנוע פעמיים: פעם מהבריף בלבד, בלי אף השראה (נקודת הבסיס), ופעם עם ההשראות שנבחרו. ההבדל בשכבות הוא מה שההשראות
        שינו בפועל. ההשראות לא מכילות תמונות או טקסט, ולכן בעמוד מופיעים רק הטקסט המאושר והתמונות של העסק.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        {data.trace!.map((t) => {
          const d = data.directions.find((x) => x.key === t.key);
          const baseline = t.withoutAnyReference.layers?.['4:5'];
          const changes = baseline ?? t.withoutReferenceMoves['4:5'] ?? [];
          const pair = d?.baseline?.['4:5'] ?? d?.withoutReferences;
          return (
            <Card key={t.key} className="p-5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="font-bold">
                  כיוון {t.key}
                  {d ? ` · ${d.name}` : ''}
                </h3>
                <span className="text-xs font-semibold text-muted" dir="ltr">
                  {t.method}
                </span>
              </div>
              {d && pair ? (
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <figure>
                    <img src={`/demo-media/${pair}`} alt={`כיוון ${t.key} מהבריף בלבד, בלי השראות`} className="w-full rounded-lg bg-canvas" />
                    <figcaption className="mt-1 text-center text-[11px] text-muted">{baseline ? 'בסיס: בלי השראות' : 'בלי ההשראות'}</figcaption>
                  </figure>
                  <figure>
                    <img src={`/demo-media/${d.renders['4:5']}`} alt={`כיוון ${t.key} כפי שהוצע`} className="w-full rounded-lg bg-canvas" />
                    <figcaption className="mt-1 text-center text-[11px] text-muted">עם ההשראות</figcaption>
                  </figure>
                </div>
              ) : null}
              {t.referenceOnlyMoves.length ? (
                <p className="text-xs text-ink-soft">
                  החלטות שרק ההשראות הביאו: <span dir="ltr">{t.referenceOnlyMoves.join(', ')}</span>
                </p>
              ) : (
                <p className="text-xs text-muted">כל ההחלטות בכיוון הזה הגיעו גם מהקונספט או מברירת המחדל של הגישה.</p>
              )}
              {t.withoutAnyReference.changed.length ? (
                <p className="mt-1 text-xs text-ink-soft" dir="ltr">
                  baseline → with references: {t.withoutAnyReference.changed.join('; ')}
                </p>
              ) : null}
              {!changes.length ? (
                <p className="mt-2 text-xs font-semibold text-ink-soft">
                  אין הבדל נראה בעמוד בין נקודת הבסיס לכיוון הזה.
                  {t.withoutAnyReference.samePage ? ' ההשראות שינו את התוכנית, אבל גם בלעדיהן מנוע העימוד מגיע לאותו סידור.' : ''}
                </p>
              ) : null}
              {changes.length ? (
                <ul className="mt-2 space-y-0.5 text-[11px] text-muted" dir="ltr">
                  {changes.slice(0, 10).map((c) => (
                    <li key={c.change}>{c.change}</li>
                  ))}
                </ul>
              ) : null}
              <ul className="mt-3 space-y-1 text-xs">
                {t.effects.map((e) => (
                  <li key={e.referenceId}>
                    <span className="font-semibold" dir="ltr">
                      {e.brand}
                    </span>{' '}
                    {byId.get(e.referenceId)?.analysisBasis === 'IMAGES_VIEWED' ? <Badge tone="success">נצפתה</Badge> : <Badge tone="warn">ניתוח כתוב</Badge>}
                    <span className="block text-muted" dir="ltr">
                      {e.withoutReference.length ? `without it: ${e.withoutReference.join('; ')}` : 'without it: the same direction'}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">
                מקוריות: חפיפה מרבית של <bdi>{Math.round(t.originality.maxOverlap * 100)}%</bdi> עם השראה אחת, שילוב של{' '}
                <bdi>{t.originality.referencesCombined}</bdi> השראות{t.originality.ownAssetsOnly ? ', רק תמונות של העסק' : ''}.
              </p>
            </Card>
          );
        })}
      </div>
    </section>
  );
}

function Findings({ reviews, format, revised }: { reviews: ReviewCase['directions'][number]['reviews']; format: Format; revised: boolean }) {
  const r = reviews[format];
  const sorted = useMemo(() => {
    const rank = { CRITICAL: 0, MAJOR: 1, MINOR: 2, OK: 3 } as Record<string, number>;
    return (xs: CriterionResult[]) => [...xs].sort((a, b) => rank[a.severity]! - rank[b.severity]!);
  }, []);
  if (!r) return null;
  return (
    <Card className="p-5">
      <CardTitle hint={revised ? 'ממצאי הכיוון כפי שהוצע (לפני השינויים שלך). הבדיקה הטכנית אחרי כל שינוי מופיעה בתוצאת הבקשה.' : undefined}>
        ממצאי המבקר · <bdi>{format}</bdi>
      </CardTitle>
      <h3 className="mb-2 text-sm font-bold">
        בדיקה טכנית (נמדדת):{' '}
        <Badge tone={r.technical.verdict === 'PASS' ? 'success' : 'warn'}>{r.technical.verdict === 'PASS' ? 'עבר' : 'לתיקון'}</Badge>
      </h3>
      <ul className="mb-4 space-y-1 text-sm">
        {sorted(r.technical.results).map((x) => (
          <li key={x.criterion} className="flex flex-wrap items-start gap-2">
            <Badge tone={SEVERITY[x.severity]!.tone}>{SEVERITY[x.severity]!.label}</Badge>
            <span className="font-semibold" dir="ltr">
              {x.criterion}
            </span>
            <span className="text-ink-soft" dir="ltr">
              {x.explanation}
            </span>
          </li>
        ))}
      </ul>
      <h3 className="mb-2 text-sm font-bold">ניתוח קריאייטיבי (ייעוץ בלבד, לא ציון)</h3>
      <ul className="space-y-1 text-sm">
        {sorted(r.creative.results).map((x) => (
          <li key={x.criterion} className="flex flex-wrap items-start gap-2">
            <Badge tone={x.score === null ? 'neutral' : SEVERITY[x.severity]!.tone}>{x.score === null ? 'לא נמדד' : SEVERITY[x.severity]!.label}</Badge>
            <span className="font-semibold" dir="ltr">
              {x.criterion}
            </span>
            <span className="text-ink-soft" dir="ltr">
              {x.explanation}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
