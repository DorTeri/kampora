import { Badge, ButtonLink, Card, EmptyState, PageHeader } from '@/components/ui';
import { he } from '@/i18n/he';
import { api, type RenderDto } from '@/lib/api';

export default async function VideosPage() {
  const videos = await api<RenderDto[]>('/v1/videos');
  return (
    <div className="animate-rise">
      <PageHeader title={he.videos.title} subtitle={he.videos.subtitle} />
      {videos.length === 0 ? (
        <EmptyState
          title={he.videos.empty}
          action={<ButtonLink href="/studio/campaigns/new">{he.home.startCampaign}</ButtonLink>}
        />
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {videos.map((v) => (
            <Card key={v.id} className="flex flex-col gap-4 p-4">
              <video
                src={v.streamUrl ?? undefined}
                controls
                playsInline
                preload="metadata"
                className="aspect-[9/16] w-full rounded-2xl bg-ink object-cover"
              />
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-bold">{v.title}</p>
                  <p className="text-sm text-muted">
                    {v.durationSec ? he.planning.seconds(v.durationSec) : ''} ·{' '}
                    <bdi dir="ltr">
                      {v.width}×{v.height}
                    </bdi>
                  </p>
                </div>
                <Badge tone={v.quality === 'final' ? 'success' : 'neutral'}>
                  {v.quality === 'final' ? he.videos.finalBadge : he.videos.previewBadge}
                </Badge>
              </div>
              {v.downloadUrl && (
                <a
                  href={v.downloadUrl}
                  className="flex min-h-11 items-center justify-center rounded-full bg-ink font-bold text-white hover:bg-ink/85"
                >
                  ↓ {he.production.download}
                </a>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
