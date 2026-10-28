'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { formatIls, type VoiceStyle } from '@kampora/shared';
import { Badge, Button, Card, CardTitle, ErrorNote, cn } from '@/components/ui';
import { errorMessage, he } from '@/i18n/he';
import type { NarrationDto, NarrationQuote, VoicesResponse } from '@/lib/api';
import { requestNarrationAction, rerecordLineAction } from '../../actions';

const seconds = (n: number) => he.planning.seconds(Math.round(n * 10) / 10);

async function fetchQuote(
  projectId: string,
  params: { voiceId: string; style: VoiceStyle; sceneKey?: string },
): Promise<NarrationQuote | null> {
  const query = new URLSearchParams({ voiceId: params.voiceId, style: params.style, mode: 'continuous' });
  if (params.sceneKey) query.set('sceneKey', params.sceneKey);
  const res = await fetch(`/api/projects/${projectId}/narration/quote?${query}`, { cache: 'no-store' });
  return res.ok ? ((await res.json()) as NarrationQuote) : null;
}

/**
 * Voice + delivery style → quote → (paid: explicit approval) → one continuous recording → listen. The quote
 * comes from the API, computed from exactly the directed text that will be synthesized. A single line can be
 * re-recorded on its own (with its own quote and approval) without touching the rest.
 */
export function VoicePanel({
  projectId,
  voices,
  initialNarration,
  suggestedStyle,
  usdToIls,
}: {
  projectId: string;
  voices: VoicesResponse;
  initialNarration: NarrationDto | null;
  /** The concept's suggested delivery; the owner can change it. */
  suggestedStyle?: VoiceStyle;
  usdToIls: number;
}) {
  const router = useRouter();
  const [voiceId, setVoiceId] = useState(initialNarration?.voiceId ?? voices.voices[0]?.id ?? '');
  const [style, setStyle] = useState<VoiceStyle>(initialNarration?.style ?? suggestedStyle ?? 'natural');
  const [quote, setQuote] = useState<NarrationQuote | null>(null);
  const [lineQuote, setLineQuote] = useState<NarrationQuote | null>(null);
  const [narration, setNarration] = useState(initialNarration);
  const [approved, setApproved] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const busy = narration?.status === 'QUEUED' || narration?.status === 'RUNNING';
  const styles = voices.styles ?? [];

  useEffect(() => {
    if (!voiceId) return;
    setApproved(false);
    let cancelled = false;
    fetchQuote(projectId, { voiceId, style })
      .then((q) => !cancelled && setQuote(q))
      .catch(() => !cancelled && setQuote(null));
    return () => {
      cancelled = true;
    };
  }, [projectId, voiceId, style]);

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
  const sameReady =
    narration?.status === 'READY' &&
    narration.voiceId === voiceId &&
    (narration.style ?? 'natural') === style &&
    !narration.stale;
  const canRecord = Boolean(quote) && !busy && !tooLong && !paidBlocked && (!quote?.paid || approved);
  const canReplaceLines = narration?.status === 'READY' && narration.voiceId === voiceId && !narration.stale;

  const refresh = async () => {
    const res = await fetch(`/api/projects/${projectId}/narration`, { cache: 'no-store' });
    if (res.ok) setNarration((await res.json()) as NarrationDto);
  };

  const record = () =>
    startTransition(async () => {
      setError(undefined);
      const result = await requestNarrationAction(
        projectId,
        voiceId,
        quote?.paid ? quote.estimatedUsd : undefined,
        style,
      );
      if (result.error) setError(result.error);
      else await refresh();
    });

  const askLine = (sceneKey: string) =>
    startTransition(async () => {
      setError(undefined);
      setLineQuote(await fetchQuote(projectId, { voiceId, style, sceneKey }));
    });

  const recordLine = () =>
    startTransition(async () => {
      if (!lineQuote?.sceneKey) return;
      const result = await rerecordLineAction(
        projectId,
        lineQuote.sceneKey,
        voiceId,
        lineQuote.paid ? lineQuote.estimatedUsd : undefined,
      );
      setLineQuote(null);
      if (result.error) setError(result.error);
      else await refresh();
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

      {styles.length > 0 && (
        <fieldset className="mt-4" disabled={busy}>
          <legend className="mb-2 text-sm font-semibold text-muted">{he.voice.style}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {styles.map((s) => (
              <label
                key={s.id}
                className={cn(
                  'cursor-pointer rounded-2xl border border-line px-3 py-2 transition',
                  'has-[:checked]:border-primary has-[:checked]:bg-primary-soft',
                )}
              >
                <input
                  type="radio"
                  name="style"
                  value={s.id}
                  checked={style === s.id}
                  onChange={() => setStyle(s.id)}
                  className="sr-only"
                />
                <span className="block text-sm font-semibold">{s.label}</span>
                <span className="block text-xs text-muted">{s.description}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

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
          {quote.paid && !paidBlocked && !sameReady && (
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
          {he.voice.recording}{' '}
          {quote && narration.mode !== 'continuous'
            ? he.voice.progress(narration.segments.length, quote.lines.length)
            : ''}
        </p>
      )}

      {!busy && !sameReady && (
        <Button className="mt-4 w-full" disabled={!canRecord || pending} onClick={record}>
          {narration?.status === 'READY' ? he.voice.rerecord : he.voice.record}
        </Button>
      )}

      {narration?.status === 'FAILED' && (
        <div className="mt-3">
          <ErrorNote message={he.voice.failed} />
        </div>
      )}
      {narration?.status === 'READY' && narration.error && (
        <p className="mt-3 text-sm text-warn">{he.voice.lineFailed}</p>
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
          {narration.masterUrl && (
            <div>
              <p className="mb-1 text-sm font-semibold">{he.voice.listenAll}</p>
              <audio controls preload="none" src={narration.masterUrl} className="h-9 w-full" />
            </div>
          )}
          <ol className="space-y-3">
            {narration.segments.map((s, i) => (
              <li key={s.sceneKey} className="rounded-2xl border border-line p-3">
                <p className="mb-2 text-sm">
                  <span className="font-bold">{i + 1}.</span> {s.cues.map((c) => c.text).join(' ')}{' '}
                  <span className="text-xs text-muted">({seconds(s.durationSec)})</span>
                  {narration.mode === 'continuous' && s.source === 'separate' && (
                    <Badge tone="accent">{he.voice.lineRerecorded}</Badge>
                  )}
                </p>
                {s.url && <audio controls preload="none" src={s.url} className="h-9 w-full" />}
                {canReplaceLines && !busy && lineQuote?.sceneKey !== s.sceneKey && (
                  <button
                    type="button"
                    className="mt-2 text-xs font-semibold text-primary underline-offset-2 hover:underline"
                    disabled={pending}
                    onClick={() => askLine(s.sceneKey)}
                  >
                    {he.voice.rerecordLine}
                  </button>
                )}
                {lineQuote?.sceneKey === s.sceneKey && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl bg-ink/[0.03] p-2 text-sm">
                    <span>
                      {he.voice.rerecordLineConfirm(
                        lineQuote.paid ? formatIls(lineQuote.estimatedUsd * usdToIls) : he.voice.free,
                      )}
                    </span>
                    <Button disabled={pending || (lineQuote.paid && paidBlocked)} onClick={recordLine}>
                      {he.voice.rerecordLineGo}
                    </Button>
                    <button type="button" className="text-xs text-muted" onClick={() => setLineQuote(null)}>
                      {he.voice.cancel}
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  );
}
