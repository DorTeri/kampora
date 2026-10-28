'use client';

import { useEffect, useState, useTransition } from 'react';
import { formatIls, type VoiceStyle } from '@kampora/shared';
import { Badge, Button, Card, CardTitle, ErrorNote, cn } from '@/components/ui';
import { errorMessage } from '@/i18n/he';
import type { VoiceLabOverview, VoiceLabSample } from '@/lib/api';
import { rateVoiceLabSampleAction, requestVoiceLabSampleAction } from '../actions';

const GROUP_LABEL = { A: 'A · הקול הנוכחי', B: 'B · אותו קול על Eleven v4', C: 'C · קול עברי נוסף' } as const;

export function VoiceLab({ initial, usdToIls }: { initial: VoiceLabOverview; usdToIls: number }) {
  const [data, setData] = useState(initial);
  const [style, setStyle] = useState<VoiceStyle>('natural');
  const [approved, setApproved] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const busy = data.samples.some((s) => s.status === 'QUEUED' || s.status === 'RUNNING');

  const refresh = async () => {
    const res = await fetch('/api/voice-lab', { cache: 'no-store' });
    if (res.ok) setData((await res.json()) as VoiceLabOverview);
  };

  useEffect(() => {
    if (!busy) return;
    const t = setTimeout(refresh, 1500);
    return () => clearTimeout(t);
  }, [busy, data]);

  const record = (candidateId: string, paid: boolean, estimatedUsd: number) =>
    startTransition(async () => {
      setError(undefined);
      const result = await requestVoiceLabSampleAction(candidateId, style, paid ? estimatedUsd : undefined);
      if (result.error) setError(result.error);
      setApproved((a) => ({ ...a, [candidateId]: false }));
      await refresh();
    });

  const styleLabel = (id: string) => data.styles.find((s) => s.id === id)?.label ?? id;

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle hint="אותו טקסט לכל הקולות, אחרי אותה הכנה לדיבור (מחירים, אחוזים, תאריכים, שם המותג).">
          התסריט לבדיקה
        </CardTitle>
        <ol className="list-decimal space-y-1 ps-5 text-sm">
          {data.script.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-muted">
          ספק: <bdi dir="ltr">{data.provider}</bdi> · הקלטות בתשלום: {data.paidEnabled ? 'פעילות' : 'כבויות'}{' '}
          · תקרת מעבדה: <bdi dir="ltr">${data.labMaxUsd.toFixed(2)}</bdi> · נוצל:{' '}
          <bdi dir="ltr">${data.spentUsd.toFixed(3)}</bdi>
        </p>
      </Card>

      <Card>
        <CardTitle>סגנון</CardTitle>
        <div className="flex flex-wrap gap-2">
          {data.styles.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStyle(s.id)}
              className={cn(
                'rounded-full border border-line px-3 py-1.5 text-sm font-semibold',
                style === s.id && 'border-primary bg-primary-soft',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Card>

      {error && <ErrorNote message={errorMessage(error)} />}

      <div className="grid gap-4 lg:grid-cols-2">
        {data.candidates.map((c) => {
          const samples = data.samples.filter((s) => s.candidateId === c.id);
          const blocked = c.quote.paid && !data.paidEnabled;
          return (
            <Card key={c.id} className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-muted">{GROUP_LABEL[c.group]}</p>
                  <p className="font-bold">{c.title}</p>
                  <p className="text-xs text-muted">
                    <bdi dir="ltr">
                      {c.provider} · {c.model} · {c.voiceId}
                    </bdi>
                  </p>
                </div>
                {(c.gender === 'female' || c.gender === 'male') && (
                  <Badge>{c.gender === 'female' ? 'נשי' : 'גברי'}</Badge>
                )}
              </div>
              <p className="text-sm">
                {c.quote.characters} תווים · כ-{Math.round(c.quote.estimatedSec)} שניות · עלות משוערת:{' '}
                {c.quote.paid ? (
                  <>
                    <bdi dir="ltr">${c.quote.estimatedUsd.toFixed(3)}</bdi> (
                    {formatIls(c.quote.estimatedUsd * usdToIls)})
                  </>
                ) : (
                  'ללא עלות'
                )}
              </p>
              {c.quote.paid && !blocked && (
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input
                    type="checkbox"
                    checked={Boolean(approved[c.id])}
                    onChange={(e) => setApproved((a) => ({ ...a, [c.id]: e.target.checked }))}
                    className="size-4 accent-[var(--color-primary)]"
                  />
                  אני מאשר/ת את העלות של ההקלטה הזו
                </label>
              )}
              {blocked && <p className="text-sm text-warn">הקלטה בתשלום כבויה במערכת.</p>}
              <Button
                className="w-full"
                disabled={pending || blocked || (c.quote.paid && !approved[c.id])}
                onClick={() => record(c.id, c.quote.paid, c.quote.estimatedUsd)}
              >
                הקלטה בסגנון &quot;{styleLabel(style)}&quot;
              </Button>
              {samples.map((s) => (
                <SampleRow key={s.id} sample={s} criteria={data.criteria} styleLabel={styleLabel(s.style)} />
              ))}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function SampleRow({
  sample,
  criteria,
  styleLabel,
}: {
  sample: VoiceLabSample;
  criteria: VoiceLabOverview['criteria'];
  styleLabel: string;
}) {
  const [ratings, setRatings] = useState<Record<string, number>>(sample.ratings);
  const [notes, setNotes] = useState(sample.notes ?? '');
  const [saved, setSaved] = useState(Boolean(sample.ratedAt));
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const result = await rateVoiceLabSampleAction(sample.id, ratings, notes);
      if (result.error) setError(result.error);
      else setSaved(true);
    });

  return (
    <div className="rounded-2xl border border-line p-3 text-sm">
      <p className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-semibold">{styleLabel}</span>
        {sample.durationSec && <span className="text-muted">{sample.durationSec.toFixed(1)} שנ׳</span>}
        {sample.cached && <Badge>שימוש חוזר</Badge>}
        {!sample.current && <Badge tone="warn">תסריט ישן</Badge>}
        {(sample.status === 'QUEUED' || sample.status === 'RUNNING') && (
          <Badge tone="primary">מקליטים…</Badge>
        )}
        {sample.status === 'FAILED' && <Badge tone="warn">נכשל</Badge>}
      </p>
      {sample.error && <p className="mb-2 text-xs text-warn">{sample.error}</p>}
      {sample.url && <audio controls preload="none" src={sample.url} className="mb-2 h-9 w-full" />}
      {sample.status === 'SUCCEEDED' && (
        <div className="space-y-2">
          {criteria.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2">
              <span>{c.label}</span>
              <span className="flex gap-1" role="radiogroup" aria-label={c.label}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={ratings[c.id] === n}
                    onClick={() => {
                      setRatings((r) => ({ ...r, [c.id]: n }));
                      setSaved(false);
                    }}
                    className={cn(
                      'size-7 rounded-lg border border-line text-xs font-bold',
                      ratings[c.id] === n && 'border-primary bg-primary text-white',
                    )}
                  >
                    {n}
                  </button>
                ))}
              </span>
            </div>
          ))}
          <textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setSaved(false);
            }}
            placeholder="הערות מההאזנה (מילים שנשמעו לא נכון, קצב, טון…)"
            className="min-h-16 w-full rounded-xl border border-line p-2"
          />
          <div className="flex items-center gap-3">
            <Button disabled={pending || saved} onClick={save}>
              {saved ? 'נשמר ✓' : 'שמירת דירוג'}
            </Button>
            {error && <span className="text-xs text-warn">{errorMessage(error)}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
