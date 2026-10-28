'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { formatIls } from '@kampora/shared';
import { Badge, Button, ErrorNote, cn } from '@/components/ui';
import { errorMessage, he } from '@/i18n/he';
import type { SceneImageDto, SceneImageQuoteDto, SceneImagesResponse } from '@/lib/api';
import { decideSceneImageAction, requestSceneImageAction } from '../../actions';

const busyStatus = (i: SceneImageDto) => i.status === 'QUEUED' || i.status === 'RUNNING';

/**
 * Scene image: estimate → (paid: explicit approval) → generate a version → approve or reject. Every version is
 * kept; approving one replaces the planned generation in the production plan.
 */
export function SceneImagePanel({
  projectId,
  quote,
  initialImages,
  setup,
  needed,
  usdToIls,
}: {
  projectId: string;
  quote: SceneImageQuoteDto;
  initialImages: SceneImageDto[];
  setup: Pick<SceneImagesResponse, 'provider' | 'ready' | 'paid' | 'paidEnabled' | 'maxVersions'>;
  /** The plan still waits for an image here. */
  needed: boolean;
  usdToIls: number;
}) {
  const router = useRouter();
  const [images, setImages] = useState(initialImages);
  const [approvedCost, setApprovedCost] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const busy = images.some(busyStatus);
  useEffect(() => setImages(initialImages), [initialImages]);

  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/projects/${projectId}/images`, { cache: 'no-store' });
      if (!res.ok) return;
      const next = (await res.json()) as SceneImagesResponse;
      const mine = next.images.filter((i) => i.sceneKey === quote.sceneKey);
      setImages(mine);
      if (!mine.some(busyStatus)) router.refresh();
    }, 1200);
    return () => clearTimeout(timer);
  }, [busy, images, projectId, quote.sceneKey, router]);

  if (!setup.ready || !quote.eligible) return null;

  const paidBlocked = setup.paid && !setup.paidEnabled;
  const atLimit = quote.nextVersion > setup.maxVersions;
  const canGenerate = !busy && !paidBlocked && !atLimit && (!quote.paid || approvedCost);
  const versions = [...images].sort((a, b) => b.version - a.version);

  const generate = () =>
    startTransition(async () => {
      setError(undefined);
      const result = await requestSceneImageAction(
        projectId,
        quote.sceneKey,
        quote.paid ? quote.estimatedUsd : undefined,
      );
      setApprovedCost(false);
      if (result.error) return setError(result.error);
      const res = await fetch(`/api/projects/${projectId}/images`, { cache: 'no-store' });
      if (res.ok)
        setImages(
          ((await res.json()) as SceneImagesResponse).images.filter((i) => i.sceneKey === quote.sceneKey),
        );
    });

  const decide = (imageId: string, decision: 'APPROVED' | 'REJECTED') =>
    startTransition(async () => {
      setError(undefined);
      const result = await decideSceneImageAction(projectId, imageId, decision);
      if (result.error) setError(result.error);
      else router.refresh();
    });

  return (
    <div className="space-y-3 rounded-2xl border border-line p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{he.images.title}</p>
        <p className="text-xs text-muted">{he.images.hint}</p>
      </div>
      {needed && !versions.some((v) => v.decision === 'APPROVED') && (
        <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">{he.images.needed}</p>
      )}

      {versions.length > 0 && (
        <ul className="flex gap-3 overflow-x-auto pb-1">
          {versions.map((v) => (
            <li
              key={v.id}
              className={cn(
                'w-28 shrink-0 space-y-1.5 rounded-xl border p-1.5',
                v.decision === 'APPROVED' ? 'border-success ring-2 ring-success/20' : 'border-line',
              )}
            >
              <div className="relative aspect-[9/16] overflow-hidden rounded-lg bg-ink/[0.05]">
                {v.url ? (
                  <img src={v.url} alt={he.images.version(v.version)} className="size-full object-cover" />
                ) : (
                  <div className="grid size-full place-items-center p-2 text-center text-xs text-muted">
                    {busyStatus(v) ? (
                      <span
                        aria-hidden
                        className="size-5 animate-spin rounded-full border-2 border-primary/30 border-t-primary"
                      />
                    ) : (
                      he.images.failed
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between gap-1 text-xs">
                <span className="text-muted">{he.images.version(v.version)}</span>
                {v.decision === 'APPROVED' && <Badge tone="success">{he.images.approved}</Badge>}
                {v.decision === 'REJECTED' && <Badge>{he.images.rejected}</Badge>}
              </div>
              {v.status === 'SUCCEEDED' && (
                <div className="flex gap-1">
                  {v.decision !== 'APPROVED' && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => decide(v.id, 'APPROVED')}
                      className="flex-1 rounded-lg bg-primary px-1.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {he.images.approve}
                    </button>
                  )}
                  {v.decision !== 'REJECTED' && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => decide(v.id, 'REJECTED')}
                      className="flex-1 rounded-lg border border-line px-1.5 py-1 text-xs text-muted disabled:opacity-50"
                    >
                      {he.images.reject}
                    </button>
                  )}
                </div>
              )}
              {v.cached && <p className="text-[11px] leading-tight text-muted">{he.images.reused}</p>}
            </li>
          ))}
        </ul>
      )}

      {busy && (
        <p className="flex items-center gap-2 text-sm font-semibold" aria-live="polite">
          <span
            aria-hidden
            className="size-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary"
          />
          {he.images.generating}
        </p>
      )}

      {!busy && (
        <div className="space-y-2 text-sm">
          <p className="text-muted">
            {he.images.cost(quote.paid ? formatIls(quote.estimatedUsd * usdToIls) : he.images.free)}
            {quote.referenceCount > 0 && <> · {he.images.usesPhotos(quote.referenceCount)}</>}
          </p>
          {quote.paid && !paidBlocked && !atLimit && (
            <label className="flex items-center gap-2 font-semibold">
              <input
                type="checkbox"
                checked={approvedCost}
                onChange={(e) => setApprovedCost(e.target.checked)}
                className="size-4 accent-[var(--color-primary)]"
              />
              {he.images.approveCost}
            </label>
          )}
          {paidBlocked && <p className="text-warn">{he.images.paidDisabled}</p>}
          {atLimit ? (
            <p className="text-warn">{he.images.limit}</p>
          ) : (
            <Button
              variant={versions.length ? 'secondary' : undefined}
              disabled={!canGenerate || pending}
              onClick={generate}
            >
              {versions.length ? he.images.regenerate : he.images.generate}
            </Button>
          )}
          {setup.provider === 'mock' && <p className="text-xs text-muted">{he.images.mockNote}</p>}
        </div>
      )}
      {error && <ErrorNote message={errorMessage(error)} />}
    </div>
  );
}
