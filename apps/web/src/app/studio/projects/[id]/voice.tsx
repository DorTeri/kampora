'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { formatIls } from '@kampora/shared';
import { Badge, Button, Card, CardTitle, ErrorNote, cn } from '@/components/ui';
import { errorMessage, he } from '@/i18n/he';
import type { NarrationDto, NarrationQuote, VoicesResponse } from '@/lib/api';
import { requestNarrationAction } from '../../actions';

const seconds = (n: number) => he.planning.seconds(Math.round(n * 10) / 10);

/**
 * Voice choice → quote → (paid: explicit approval) → record → listen. The quote comes from the API, computed
 * from exactly the normalized text that will be synthesized.
 */
export function VoicePanel({
  projectId,
  voices,
  initialNarration,
  usdToIls,
}: {
  projectId: string;
  voices: VoicesResponse;
  initialNarration: NarrationDto | null;
  usdToIls: number;
}) {
  const router = useRouter();
  const [voiceId, setVoiceId] = useState(initialNarration?.voiceId ?? voices.voices[0]?.id ?? '');
  const [quote, setQuote] = useState<NarrationQuote | null>(null);
  const [narration, setNarration] = useState(initialNarration);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const busy = narration?.status === 'QUEUED' || narration?.status === 'RUNNING';

  useEffect(() => {
    if (!voiceId) return;
    setApproved(false);
    let cancelled = false;
    fetch(`/api/projects/${projectId}/narration/quote?voiceId=${encodeURIComponent(voiceId)}`, {
      cache: 'no-store',
    })
      .then(async (res) => (res.ok ? ((await res.json()) as NarrationQuote) : null))
      .then((q) => !cancelled && setQuote(q))
      .catch(() => !cancelled && setQuote(null));
    return () => {
      cancelled = true;
    };
  }, [projectId, voiceId]);

  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/projects/${projectId}/narration`, { cache: 'no-store' });
      if (!res.ok) return;
      const next = (await res.json()) as NarrationDto | null;
      setNarration(next);
      if (next && (next.status === 'READY' || next.status === 'FAILED')) router.refresh();
    }, 1500);
    return () => clearTimeout(timer);
  }, [busy, narration, projectId, router]);

  if (!voices.ready || !voices.voices.length) {
    return (
      <Card>
        <CardTitle>{he.voice.title}</CardTitle>
        <p className="text-sm text-warn">{he.voice.unavailable}</p>
      </Card>
    );
  }

  const paidBlocked = voices.paid && !voices.paidEnabled;
  const tooLong = quote?.scriptCheck.status === 'TOO_LONG';
  const sameVoiceReady = narration?.status === 'READY' && narration.voiceId === voiceId && !narration.stale;
  const canRecord = Boolean(quote) && !busy && !tooLong && !paidBlocked && (!quote?.paid || approved);

  const record = () =>
    startTransition(async () => {
      setError(undefined);
      const result = await requestNarrationAction(
        projectId,
        voiceId,
        quote?.paid ? quote.estimatedUsd : undefined,
      );
      if (result.error) setError(result.error);
      else {
        const res = await fetch(`/api/projects/${projectId}/narration`, { cache: 'no-store' });
        if (res.ok) setNarration((await res.json()) as NarrationDto);
      }
    });

  return (
    <Card>
      <CardTitle hint={he.voice.hint}>{he.voice.title}</CardTitle>

      <fieldset className="space-y-2" disabled={busy}>
        <legend className="mb-2 text-sm font-semibold text-muted">{he.voice.choose}</legend>
        {voices.voices.map((v) => (
          <label
            key={v.id}
            className={cn(
              'flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3 transition',
              'has-[:checked]:border-primary has-[:checked]:bg-primary-soft',
            )}
          >
            <span className="flex items-center gap-3">
              <input
                type="radio"
                name="voice"
                value={v.id}
                checked={voiceId === v.id}
                onChange={() => setVoiceId(v.id)}
                className="size-4 accent-[var(--color-primary)]"
              />
              <span className="font-semibold">{v.label}</span>
            </span>
            {v.gender && v.gender !== 'neutral' && (
              <Badge>{v.gender === 'female' ? 'קול נשי' : 'קול גברי'}</Badge>
            )}
          </label>
        ))}
      </fieldset>
      {voices.provider === 'mock' && <p className="mt-2 text-xs text-muted">{he.voice.mockNote}</p>}

      {quote && (
        <div className="mt-4 space-y-2 rounded-2xl bg-ink/[0.03] p-4 text-sm">
          <p>
            {he.voice.estimate(
              seconds(quote.estimatedSec),
              quote.paid ? formatIls(quote.estimatedUsd * usdToIls) : he.voice.free,
            )}
          </p>
          {quote.paid && <p className="text-xs text-muted">{he.voice.estimatedNote}</p>}
          {quote.scriptCheck.message && (
            <p className={cn('font-semibold', tooLong ? 'text-[#9a3412]' : 'text-warn')}>
              {quote.scriptCheck.message}
            </p>
          )}
          {quote.paid && !paidBlocked && !sameVoiceReady && (
            <label className="flex items-center gap-3 pt-1 font-semibold">
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
                className="size-5 accent-[var(--color-primary)]"
              />
              {he.voice.approveCost}
            </label>
          )}
          {paidBlocked && <p className="text-warn">{he.voice.paidDisabled}</p>}
        </div>
      )}

      {busy && narration && (
        <p className="mt-4 flex items-center gap-2 text-sm font-semibold" aria-live="polite">
          <span
            aria-hidden
            className="size-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary"
          />
          {he.voice.recording} {quote ? he.voice.progress(narration.segments.length, quote.lines.length) : ''}
        </p>
      )}

      {!busy && !sameVoiceReady && (
        <Button className="mt-4 w-full" disabled={!canRecord || pending} onClick={record}>
          {narration?.status === 'READY' ? he.voice.rerecord : he.voice.record}
        </Button>
      )}

      {narration?.status === 'FAILED' && (
        <div className="mt-3">
          <ErrorNote message={he.voice.failed} />
        </div>
      )}
      {narration?.stale && <p className="mt-3 text-sm text-warn">{he.voice.stale}</p>}
      {error && (
        <div className="mt-3">
          <ErrorNote message={errorMessage(error)} />
        </div>
      )}

      {narration && narration.segments.length > 0 && (
        <div className="mt-5 space-y-3">
          {narration.status === 'READY' && (
            <p className="font-bold text-success">
              ✓ {he.voice.ready} · {he.voice.total(seconds(narration.totalSec))}
            </p>
          )}
          {narration.warnings.some((w) => w.startsWith('NARRATION_LONG')) && (
            <p className="text-sm text-warn">{he.voice.long}</p>
          )}
          <ol className="space-y-3">
            {narration.segments.map((s, i) => (
              <li key={s.sceneKey} className="rounded-2xl border border-line p-3">
                <p className="mb-2 text-sm">
                  <span className="font-bold">{i + 1}.</span> {s.cues.map((c) => c.text).join(' ')}{' '}
                  <span className="text-xs text-muted">({seconds(s.durationSec)})</span>
                </p>
                {s.url && <audio controls preload="none" src={s.url} className="h-9 w-full" />}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
}
