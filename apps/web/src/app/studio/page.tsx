import Link from 'next/link';
import { Badge, ButtonLink, Card, CardTitle, EmptyState, PageHeader } from '@/components/ui';
import { he } from '@/i18n/he';
import { api, type BusinessSummary, type CampaignListItem, type RenderDto } from '@/lib/api';

const PROJECT_STATUS: Record<
  string,
  { label: string; tone: 'primary' | 'success' | 'warn' | 'neutral' | 'accent' }
> = {
  PLAN_READY: { label: 'ממתין לאישור', tone: 'warn' },
  APPROVED: { label: 'מאושר להפקה', tone: 'primary' },
  RENDERING: { label: 'בהפקה', tone: 'primary' },
  RENDERED: { label: 'מוכן', tone: 'success' },
  FAILED: { label: 'נכשל', tone: 'accent' },
};

export default async function StudioHome() {
  const [businesses, campaigns, videos] = await Promise.all([
    api<BusinessSummary[]>('/v1/businesses'),
    api<CampaignListItem[]>('/v1/campaigns'),
    api<RenderDto[]>('/v1/videos'),
  ]);
  const business = businesses[0];

  return (
    <div className="animate-rise">
      <PageHeader
        title={he.home.greeting(business ? `צוות ${business.name}` : '')}
        subtitle={he.home.subtitle}
        action={<ButtonLink href="/studio/campaigns/new">＋ {he.home.startCampaign}</ButtonLink>}
      />

      {business && (
        <Card className="mb-8 overflow-hidden bg-gradient-to-l from-primary-soft via-surface to-accent-soft">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-muted">{he.nav.business}</p>
              <p className="text-2xl font-black">
                <bdi>{business.name}</bdi> ·{' '}
                <span className="font-semibold text-ink-soft">{business.category}</span>
              </p>
            </div>
            <Link href="/studio/business" className="text-sm font-bold text-primary hover:underline">
              {he.business.title} ←
            </Link>
          </div>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardTitle>{he.home.recentCampaigns}</CardTitle>
          {campaigns.length === 0 ? (
            <EmptyState
              title={he.home.noCampaigns}
              action={<ButtonLink href="/studio/campaigns/new">{he.home.startCampaign}</ButtonLink>}
            />
          ) : (
            <ul className="divide-y divide-line">
              {campaigns.slice(0, 6).map((c) => {
                const status = c.projectStatus ? PROJECT_STATUS[c.projectStatus] : undefined;
                return (
                  <li key={c.id}>
                    <Link
                      href={c.projectId ? `/studio/projects/${c.projectId}` : `/studio/campaigns/${c.id}`}
                      className="flex items-center justify-between gap-4 py-3 hover:text-primary"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-bold">
                          {c.brief.offer ?? c.brief.productName}
                        </span>
                        <span className="block text-sm text-muted">
                          {he.campaign.goals[c.brief.goal].title}
                        </span>
                      </span>
                      {status ? (
                        <Badge tone={status.tone}>{status.label}</Badge>
                      ) : (
                        <Badge tone="neutral">{he.nav.concepts}</Badge>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>{he.home.recentVideos}</CardTitle>
          {videos.length === 0 ? (
            <EmptyState title={he.home.noVideos} />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {videos.slice(0, 3).map((v) => (
                <Link key={v.id} href="/studio/videos" className="group block">
                  <video
                    // #t= seeks past the opening fade so the thumbnail is not a black frame.
                    src={v.streamUrl ? `${v.streamUrl}#t=1.5` : undefined}
                    muted
                    playsInline
                    preload="metadata"
                    className="aspect-[9/16] w-full rounded-2xl bg-ink object-cover shadow-[var(--shadow-card)] transition group-hover:shadow-[var(--shadow-lift)]"
                  />
                  <p className="mt-2 truncate text-sm font-semibold">{v.title}</p>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
