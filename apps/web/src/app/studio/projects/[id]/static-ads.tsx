'use client';

import { useEffect, useState, useTransition, type FormEvent } from 'react';
import type { LayoutFamily, StaticAdEdit } from '@kampora/shared';
import { Button, Card, CardTitle, ErrorNote, cn } from '@/components/ui';
import { errorMessage, he } from '@/i18n/he';
import type { CriticReviewDto, StaticAdDto, StaticAdsResponse } from '@/lib/api';
import { createStaticAdsAction, editStaticAdAction } from '../../actions';
import { CriticReview } from '../../critic-review';

const t = he.staticAds;
const FAMILIES = Object.keys(t.art.families) as LayoutFamily[];
const busyStatus = (ad: StaticAdDto) => ad.status === 'QUEUED' || ad.status === 'RUNNING';
const kb = (bytes: number | null) => (bytes ? `${Math.round(bytes / 1024).toLocaleString('he-IL')} KB` : '');

/** The few reasons that decided the background: the strongest points for it, and anything against it. */
function backgroundReasons(selection: NonNullable<StaticAdDto['backgroundSelection']>): string[] {
  const label = (r: (typeof selection.reasons)[number]) =>
    t.reasons[r.code]?.((r.subjects ?? []).join(', ')) ?? r.detail;
  const forIt = selection.reasons
    .filter((r) => r.points > 0 && r.code !== 'CROP_FIT')
    .sort((a, b) => b.points - a.points)
    .slice(0, 3);
  const against = selection.reasons.filter((r) => r.points < 0 || r.code === 'OFFER_SUBJECTS_MISSING');
  return [...forIt, ...against].map(label);
}

/** Every response signs fresh URLs; a version that was already shown keeps its URLs, so its image does not reload. */
function keepUrls(prev: StaticAdsResponse, next: StaticAdsResponse): StaticAdsResponse {
  return {
    ...next,
    ads: next.ads.map((ad) => {
      const old = prev.ads.find((p) => p.id === ad.id);
      return old?.pngUrl && ad.pngUrl
        ? {
            ...ad,
            pngUrl: old.pngUrl,
            jpegUrl: old.jpegUrl,
            pngDownloadUrl: old.pngDownloadUrl,
            jpegDownloadUrl: old.jpegDownloadUrl,
          }
        : ad;
    }),
    pictures: next.pictures.map((p) => prev.pictures.find((o) => o.assetId === p.assetId) ?? p),
  };
}

/**
 * Static image ads (1:1, 4:5, 9:16) built from the approved script. Rendered locally at no cost; every edit is
 * saved as a new version of that format and rendered again.
 */
export function StaticAdsPanel({ projectId, initial }: { projectId: string; initial: StaticAdsResponse }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const busy = data.ads.some(busyStatus);
  useEffect(() => setData(initial), [initial]);

  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/projects/${projectId}/static-ads`, { cache: 'no-store' });
      if (res.ok) {
        const next = (await res.json()) as StaticAdsResponse;
        setData((prev) => keepUrls(prev, next));
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [busy, data, projectId]);

  const run = (action: () => Promise<{ data?: StaticAdsResponse; error?: string }>, onDone?: () => void) =>
    startTransition(async () => {
      setError(undefined);
      const result = await action();
      if (result.error) return setError(result.error);
      const next = result.data;
      if (next) setData((prev) => keepUrls(prev, next));
      onDone?.();
    });

  return (
    <Card>
      <CardTitle hint={t.hint}>{t.title}</CardTitle>
      {!data.scriptApproved ? (
        <p className="text-sm text-muted">{t.approveFirst}</p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant={data.ads.length ? 'secondary' : undefined}
              disabled={pending || busy}
              onClick={() => run(() => createStaticAdsAction(projectId))}
            >
              {data.ads.length ? t.rebuild : t.create}
            </Button>
            <p className="text-sm text-muted">{data.ads.length ? t.rebuildHint : t.free}</p>
          </div>

          {data.artDirection && data.ads.length > 0 && (
            <div className="rounded-xl bg-ink/[0.03] px-3 py-2.5 text-sm">
              <p>
                <span className="font-bold">{t.art.title}:</span>{' '}
                {t.art.families[data.artDirection.layoutFamily] ?? data.artDirection.layoutFamily}
              </p>
              <p className="text-muted">
                {t.art.first}:{' '}
                {data.artDirection.hierarchy
                  .slice(0, 3)
                  .map((e) => t.art.elements[e] ?? e)
                  .join(' ← ')}
                {' · '}
                {t.art.considered}:{' '}
                {data.artDirection.alternatives
                  .filter((a) => a.layoutFamily !== data.artDirection!.layoutFamily)
                  .slice(0, 2)
                  .map((a) => t.art.families[a.layoutFamily] ?? a.layoutFamily)
                  .join(', ')}
              </p>
            </div>
          )}

          {data.ads.length > 0 && (
            <ul className="grid items-start gap-5 md:grid-cols-3">
              {data.ads.map((ad) => (
                <li key={ad.format}>
                  <StaticAdCard
                    ad={ad}
                    review={data.reviews?.find((r) => r.subjectRef === ad.format)}
                    pictures={data.pictures}
                    atLimit={ad.versions >= data.maxVersions}
                    disabled={pending}
                    onSave={(edit, done) => run(() => editStaticAdAction(projectId, ad.id, edit), done)}
                  />
                </li>
              ))}
            </ul>
          )}
          {error && <ErrorNote message={errorMessage(error)} />}
        </div>
      )}
    </Card>
  );
}

function StaticAdCard({
  ad,
  review,
  pictures,
  atLimit,
  disabled,
  onSave,
}: {
  ad: StaticAdDto;
  review?: CriticReviewDto;
  pictures: StaticAdsResponse['pictures'];
  atLimit: boolean;
  disabled: boolean;
  onSave: (edit: StaticAdEdit, done: () => void) => void;
}) {
  const [editing, setEditing] = useState(false);
  const busy = busyStatus(ad);

  return (
    <div className="space-y-3 rounded-2xl border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
        <p className="text-sm font-bold">{t.formats[ad.format]}</p>
        <span className="whitespace-nowrap text-xs text-muted">{t.version(ad.version, ad.versions)}</span>
      </div>
      {ad.design && (
        <p className="text-xs text-muted">
          {t.art.layout}: {t.art.families[ad.design.layoutFamily] ?? ad.design.layoutFamily}
          {ad.design.chosenBy === 'OWNER' && <> · {t.art.ownerLayout}</>}
        </p>
      )}

      <div
        className="relative overflow-hidden rounded-xl bg-ink/[0.05]"
        style={{ aspectRatio: `${ad.width} / ${ad.height}` }}
      >
        {ad.pngUrl && !busy ? (
          <img src={ad.pngUrl} alt={`${t.title} ${ad.format}`} className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center p-4 text-center text-sm text-muted">
            {busy ? (
              <span className="flex flex-col items-center gap-2" aria-live="polite">
                <span
                  aria-hidden
                  className="size-6 animate-spin rounded-full border-2 border-primary/30 border-t-primary"
                />
                {t.rendering}
              </span>
            ) : (
              t.failed
            )}
          </div>
        )}
      </div>

      {ad.backgroundSelection && ad.backgroundAssetId && (
        <div className="space-y-0.5 text-xs text-muted">
          <p>
            <span className="font-semibold text-ink">
              {ad.backgroundSelection.chosenBy === 'OWNER' ? t.background.owner : t.background.auto}
            </span>
            {ad.backgroundSelection.authenticity && (
              <> · {he.authenticity[ad.backgroundSelection.authenticity]}</>
            )}
          </p>
          {ad.backgroundSelection.chosenBy === 'AUTO' && (
            <p>
              {t.background.because} {backgroundReasons(ad.backgroundSelection).join(' · ')}
            </p>
          )}
        </div>
      )}

      {review && <CriticReview review={review} />}

      {ad.qa.length > 0 && (
        <ul className="space-y-1">
          {ad.qa.map((issue) => (
            <li key={issue.code} className="rounded-lg bg-warn-soft px-2.5 py-1.5 text-xs text-warn">
              {t.qa[issue.code] ?? issue.detail}
            </li>
          ))}
        </ul>
      )}

      {ad.status === 'SUCCEEDED' && (
        <div className="flex flex-wrap gap-2 text-sm">
          {ad.pngDownloadUrl && (
            <a
              href={ad.pngDownloadUrl}
              className="rounded-full border border-line px-3 py-1.5 font-semibold hover:border-ink/30"
            >
              {t.downloadPng} <span className="text-xs font-normal text-muted">{kb(ad.pngBytes)}</span>
            </a>
          )}
          {ad.jpegDownloadUrl && (
            <a
              href={ad.jpegDownloadUrl}
              className="rounded-full border border-line px-3 py-1.5 font-semibold hover:border-ink/30"
            >
              {t.downloadJpeg} <span className="text-xs font-normal text-muted">{kb(ad.jpegBytes)}</span>
            </a>
          )}
        </div>
      )}

      {atLimit ? (
        <p className="text-xs text-warn">{he.errors.TOO_MANY_VERSIONS}</p>
      ) : editing ? (
        <StaticAdEditForm
          key={ad.id}
          ad={ad}
          pictures={pictures}
          disabled={disabled || busy}
          onCancel={() => setEditing(false)}
          onSave={(edit) => onSave(edit, () => setEditing(false))}
        />
      ) : (
        <Button
          variant="ghost"
          className="min-h-9 px-3 text-sm"
          disabled={busy}
          onClick={() => setEditing(true)}
        >
          {t.edit}
        </Button>
      )}
    </div>
  );
}

const field =
  'w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-primary';

function StaticAdEditForm({
  ad,
  pictures,
  disabled,
  onCancel,
  onSave,
}: {
  ad: StaticAdDto;
  pictures: StaticAdsResponse['pictures'];
  disabled: boolean;
  onCancel: () => void;
  onSave: (edit: StaticAdEdit) => void;
}) {
  const [background, setBackground] = useState<string | null>(ad.backgroundAssetId);
  const [family, setFamily] = useState<LayoutFamily | undefined>(ad.design?.layoutFamily);
  const [note, setNote] = useState<string>();

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const value = (name: string) => String(form.get(name) ?? '').trim();
    // Only what changed is sent; an emptied optional field removes that layer.
    const current = {
      headline: ad.text.headline,
      subheadline: ad.text.subheadline ?? '',
      price: ad.text.price?.price ?? '',
      priceLabel: ad.text.price?.label ?? '',
      cta: ad.text.cta,
      ctaSubtext: ad.text.ctaSubtext ?? '',
    };
    const edit: StaticAdEdit = {};
    for (const key of Object.keys(current) as Array<keyof typeof current>)
      if (value(key) !== current[key]) edit[key] = value(key);
    const showLogo = form.get('showLogo') === 'on';
    if (showLogo !== ad.text.showLogo) edit.showLogo = showLogo;
    if (background !== ad.backgroundAssetId) edit.backgroundAssetId = background;
    if (family && family !== ad.design?.layoutFamily) edit.layoutFamily = family;
    if (Object.keys(edit).length === 0) return setNote(t.noChanges);
    setNote(undefined);
    onSave(edit);
  };

  const input = (name: keyof typeof t.fields, value: string, maxLength: number, required = false) => (
    <label className="block space-y-1 text-sm">
      <span className="font-semibold">
        {t.fields[name]}
        {!required && <span className="ms-1 text-xs font-normal text-muted">({t.optional})</span>}
      </span>
      <input
        name={name}
        dir="rtl"
        defaultValue={value}
        maxLength={maxLength}
        required={required}
        className={field}
      />
    </label>
  );

  return (
    <form onSubmit={submit} className="space-y-3 border-t border-line pt-3">
      {input('headline', ad.text.headline, 70, true)}
      {input('subheadline', ad.text.subheadline ?? '', 110)}
      <div className="grid grid-cols-2 gap-2">
        {input('price', ad.text.price?.price ?? '', 20)}
        {input('priceLabel', ad.text.price?.label ?? '', 40)}
      </div>
      {input('cta', ad.text.cta, 30, true)}
      {input('ctaSubtext', ad.text.ctaSubtext ?? '', 60)}
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          name="showLogo"
          defaultChecked={ad.text.showLogo}
          className="size-4 accent-[var(--color-primary)]"
        />
        {t.fields.showLogo}
      </label>

      {ad.design && (
        <label className="block space-y-1 text-sm">
          <span className="font-semibold">{t.art.field}</span>
          <select
            value={family}
            onChange={(e) => setFamily(e.target.value as LayoutFamily)}
            className={field}
          >
            {FAMILIES.map((f) => (
              <option key={f} value={f}>
                {t.art.families[f]}
              </option>
            ))}
          </select>
        </label>
      )}

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{t.fields.background}</legend>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={background === null}
            onClick={() => setBackground(null)}
            className={cn(
              'grid size-16 place-items-center rounded-xl border bg-gradient-to-br from-primary to-ink p-1 text-center text-[11px] font-semibold text-white',
              background === null ? 'border-primary ring-2 ring-primary/30' : 'border-line',
            )}
          >
            {t.brandColor}
          </button>
          {pictures.map((p) => (
            <button
              key={p.assetId}
              type="button"
              aria-pressed={background === p.assetId}
              title={he.authenticity[p.authenticity] ?? t.pictureSource[p.source]}
              onClick={() => setBackground(p.assetId)}
              className={cn(
                'relative size-16 overflow-hidden rounded-xl border',
                background === p.assetId ? 'border-primary ring-2 ring-primary/30' : 'border-line',
              )}
            >
              <img src={p.url} alt={t.pictureSource[p.source]} className="size-full object-cover" />
              {p.source === 'AI' && (
                <span className="absolute bottom-0.5 start-0.5 rounded-md bg-ink/70 px-1 text-[10px] font-bold text-white">
                  AI
                </span>
              )}
            </button>
          ))}
        </div>
      </fieldset>

      {note && <p className="text-sm text-muted">{note}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" className="min-h-9 px-4 text-sm" disabled={disabled}>
          {t.save}
        </Button>
        <Button type="button" variant="ghost" className="min-h-9 px-4 text-sm" onClick={onCancel}>
          {t.cancel}
        </Button>
      </div>
    </form>
  );
}
