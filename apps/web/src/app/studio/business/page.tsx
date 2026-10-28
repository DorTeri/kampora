import { formatIls } from '@kampora/shared';
import { Badge, Card, CardTitle, PageHeader } from '@/components/ui';
import { he } from '@/i18n/he';
import { api, type BusinessDetail, type BusinessSummary } from '@/lib/api';

export default async function BusinessPage() {
  const [summary] = await api<BusinessSummary[]>('/v1/businesses');
  if (!summary) return null;
  const { profile, assets } = await api<BusinessDetail>(`/v1/businesses/${summary.id}`);
  const isDemo = Object.values(profile.fieldSources).includes('DEMO_SEED');

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow={isDemo ? <Badge tone="warn">{he.business.demoNote}</Badge> : undefined}
        title={profile.name}
        subtitle={he.business.subtitle}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>{he.business.about}</CardTitle>
          <p className="text-lg leading-relaxed">{profile.description}</p>
          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-semibold text-muted">{he.business.audience}</dt>
              <dd className="mt-1">{profile.targetAudience}</dd>
            </div>
            <div>
              <dt className="text-sm font-semibold text-muted">{he.business.tone}</dt>
              <dd className="mt-1">{he.business.tones[profile.tone]}</dd>
            </div>
            {profile.address && (
              <div>
                <dt className="text-sm font-semibold text-muted">כתובת</dt>
                <dd className="mt-1">{profile.address}</dd>
              </div>
            )}
            {profile.website && (
              <div>
                <dt className="text-sm font-semibold text-muted">אתר</dt>
                <dd className="mt-1">
                  <bdi dir="ltr" className="font-medium text-primary">
                    {profile.website.replace(/^https?:\/\//, '')}
                  </bdi>
                </dd>
              </div>
            )}
          </dl>
        </Card>

        <Card>
          <CardTitle>{he.business.colors}</CardTitle>
          <div className="flex flex-wrap gap-3">
            {Object.entries(profile.brandColors).map(([name, color]) => (
              <div key={name} className="flex flex-col items-center gap-1">
                <span
                  className="size-12 rounded-2xl border border-line shadow-[var(--shadow-card)]"
                  style={{ background: color }}
                />
                <bdi dir="ltr" className="text-[11px] text-muted">
                  {color}
                </bdi>
              </div>
            ))}
          </div>
          <CardTitle>{he.business.pronunciation}</CardTitle>
          <ul className="space-y-2">
            {profile.pronunciation.map((p) => (
              <li
                key={p.term}
                className="flex items-center justify-between rounded-xl bg-ink/[0.03] px-3 py-2 text-sm"
              >
                <bdi dir="ltr" className="font-bold">
                  {p.term}
                </bdi>
                <span>נהגה: {p.spoken}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardTitle hint={he.business.claimsHint}>{he.business.claims}</CardTitle>
          <ul className="space-y-2">
            {profile.approvedClaims.map((claim) => (
              <li key={claim} className="flex items-start gap-2">
                <span aria-hidden className="mt-1 text-success">
                  ✓
                </span>
                <span>{claim}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardTitle>{he.business.products}</CardTitle>
          <ul className="space-y-3">
            {profile.products.map((p) => (
              <li key={p.name}>
                <p className="font-bold">
                  {p.name}
                  {p.price && (
                    <span className="ms-2 text-sm font-semibold text-primary">
                      {formatIls(p.price.amount)}
                    </span>
                  )}
                </p>
                <p className="text-sm text-ink-soft">{p.description}</p>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardTitle>{he.business.media}</CardTitle>
          <div className="grid grid-cols-3 gap-3">
            {assets
              .filter((a) => a.kind === 'image' || a.kind === 'logo')
              .map((a) => (
                <figure key={a.id}>
                  {/* Plain <img>: short-lived signed URLs, no Next image optimizer. */}
                  <img
                    src={a.url}
                    alt={a.description}
                    className="aspect-[9/16] w-full rounded-xl object-cover"
                  />
                </figure>
              ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            {assets.find((a) => a.kind === 'image')?.provenance.license}
          </p>
        </Card>
      </div>
    </div>
  );
}
