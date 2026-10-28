'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { Badge, Button, Card, CardTitle, ErrorNote } from '@/components/ui';
import { errorMessage, he } from '@/i18n/he';
import type { RenderDto } from '@/lib/api';
import { approvePlanAction, requestRenderAction, type ActionState } from '../../actions';

export function ApproveButton({ projectId }: { projectId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(approvePlanAction, {});
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="projectId" value={projectId} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? he.planning.approving : he.planning.approve}
      </Button>
      {state.error && <ErrorNote message={errorMessage(state.error)} />}
    </form>
  );
}

const isActive = (r: RenderDto) => r.status === 'QUEUED' || r.status === 'RUNNING';

/** Polls the same-origin status route until the render settles. */
function useRenderPolling(initial: RenderDto | undefined) {
  const [render, setRender] = useState(initial);
  useEffect(() => setRender(initial), [initial]);
  useEffect(() => {
    if (!render || !isActive(render)) return;
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/renders/${render.id}`, { cache: 'no-store' });
      if (res.ok) setRender((await res.json()) as RenderDto);
    }, 1500);
    return () => clearTimeout(timer);
  }, [render]);
  return [render, setRender] as const;
}

function RenderStatus({ render }: { render: RenderDto }) {
  const pct = Math.round(render.progress * 100);
  if (render.status === 'FAILED') return <ErrorNote message={he.production.failed} />;
  if (render.status !== 'SUCCEEDED') {
    return (
      <div className="space-y-2" aria-live="polite">
        <div className="flex justify-between text-sm">
          <span className="font-semibold">{he.production.stages[render.stage]}</span>
          <span className="tabular-nums text-muted">{pct}%</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-ink/5">
          <div
            className="h-full rounded-full bg-gradient-to-l from-primary to-accent transition-[width] duration-700"
            style={{ width: `${Math.max(4, pct)}%` }}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="font-bold text-success">✓ {he.production.ready}</p>
      <video
        key={render.streamUrl}
        src={render.streamUrl ?? undefined}
        controls
        playsInline
        className="mx-auto aspect-[9/16] w-full max-w-[300px] rounded-3xl bg-ink shadow-[var(--shadow-lift)]"
      />
      {render.downloadUrl && (
        <a
          href={render.downloadUrl}
          className="flex min-h-11 items-center justify-center rounded-full border border-line bg-surface font-bold hover:border-ink/30"
        >
          ↓ {he.production.download}
        </a>
      )}
    </div>
  );
}

export function ProductionPanel({
  projectId,
  initialRenders,
}: {
  projectId: string;
  initialRenders: RenderDto[];
}) {
  const latestOf = (q: 'preview' | 'final') => initialRenders.find((r) => r.quality === q);
  const [preview, setPreview] = useRenderPolling(latestOf('preview'));
  const [final, setFinal] = useRenderPolling(latestOf('final'));
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  const start = (quality: 'preview' | 'final') =>
    startTransition(async () => {
      setError(undefined);
      const result = await requestRenderAction(projectId, quality);
      if (result.error) setError(result.error);
      else if (result.render) (quality === 'preview' ? setPreview : setFinal)(result.render);
    });

  const options = [
    {
      quality: 'preview' as const,
      title: he.production.preview,
      hint: he.production.previewHint,
      render: preview,
    },
    { quality: 'final' as const, title: he.production.final, hint: he.production.finalHint, render: final },
  ];

  return (
    <Card>
      <CardTitle hint={he.production.audioNote}>{he.production.title}</CardTitle>
      <div className="space-y-6">
        {options.map(({ quality, title, hint, render }) => (
          <div key={quality} className="space-y-3 rounded-2xl border border-line p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-bold">{title}</p>
                <p className="text-sm text-muted">{hint}</p>
              </div>
              {render?.status === 'SUCCEEDED' && <Badge tone="success">✓</Badge>}
            </div>
            {render && <RenderStatus render={render} />}
            {(!render || render.status === 'FAILED') && (
              <Button
                variant={quality === 'final' ? 'primary' : 'secondary'}
                disabled={pending}
                onClick={() => start(quality)}
                className="w-full"
              >
                {render?.status === 'FAILED' ? he.production.retry : title}
              </Button>
            )}
          </div>
        ))}
        {error && <ErrorNote message={errorMessage(error)} />}
      </div>
    </Card>
  );
}
