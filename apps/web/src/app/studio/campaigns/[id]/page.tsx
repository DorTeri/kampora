import { notFound } from 'next/navigation';
import { Badge, ButtonLink, Card, PageHeader, cn } from '@/components/ui';
import { he } from '@/i18n/he';
import { ApiRequestError, api, type CampaignDetail } from '@/lib/api';
import { SelectConceptButton } from './select-button';

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await api<CampaignDetail>(`/v1/campaigns/${id}`).catch((e) => {
    if (e instanceof ApiRequestError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  });
  const { brief } = campaign;
  // Recommended first, so the customer sees our pick before the alternatives.
  const concepts = [...campaign.concepts].sort((a, b) => Number(b.isRecommended) - Number(a.isRecommended));
  const selected = campaign.concepts.find((c) => c.selected);

  return (
    <div className="animate-rise">
      <PageHeader
        title={he.concepts.title}
        subtitle={he.concepts.subtitle}
        action={
          campaign.project ? (
            <ButtonLink href={`/studio/projects/${campaign.project.id}`}>{he.nav.planning} ←</ButtonLink>
          ) : undefined
        }
      />

      <Card className="mb-8">
        <h2 className="mb-3 text-sm font-bold text-muted">{he.concepts.brief}</h2>
        <div className="grid gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-muted">מטרה</p>
            <p className="font-bold">{he.campaign.goals[brief.goal].title}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-muted">מה מקדמים</p>
            <p className="font-bold">{brief.offer ?? brief.productName}</p>
          </div>
          <div>
            <p className="text-muted">{he.concepts.cta}</p>
            <p className="font-bold">{brief.cta}</p>
          </div>
          <div className="sm:col-span-4">
            <p className="text-muted">{he.concepts.audience}</p>
            <p>{brief.audience}</p>
          </div>
        </div>
      </Card>

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {concepts.map(
          ({
            id: conceptId,
            concept,
            isRecommended,
            recommendationReason,
            claimFlags,
            selected: isSelected,
          }) => (
            <Card
              key={conceptId}
              className={cn(
                'flex flex-col gap-5',
                isRecommended && 'border-primary/40 ring-4 ring-primary/10',
                isSelected && 'border-success ring-4 ring-success/15',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                {isSelected && <Badge tone="success">✓ {he.concepts.chosen}</Badge>}
                {isRecommended && !isSelected && <Badge tone="primary">★ {he.concepts.recommended}</Badge>}
                <Badge>{he.concepts.complexity[concept.complexity]}</Badge>
              </div>
              <div>
                <h3 className="text-2xl font-black">{concept.title}</h3>
                <p className="mt-3 rounded-2xl bg-ink/[0.03] p-4 text-lg font-bold leading-snug">
                  <span className="ms-1 text-sm font-semibold text-muted">{he.concepts.hook}:</span> “
                  {concept.hook}”
                </p>
              </div>
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="font-semibold text-muted">{he.concepts.message}</dt>
                  <dd className="mt-0.5">{concept.mainMessage}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-muted">{he.concepts.visual}</dt>
                  <dd className="mt-0.5">{concept.visualDirection}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-muted">{he.concepts.voiceover}</dt>
                  <dd className="mt-0.5 italic">{concept.voiceover}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-muted">{he.concepts.why}</dt>
                  <dd className="mt-0.5">
                    {isRecommended && recommendationReason ? recommendationReason : concept.rationale}
                  </dd>
                </div>
              </dl>
              {claimFlags.length > 0 && (
                <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn">
                  {he.concepts.claimWarning} {claimFlags.map((f) => `“${f.phrase}”`).join(', ')}
                </p>
              )}
              <div className="mt-auto">
                {!selected && (
                  <SelectConceptButton
                    campaignId={campaign.id}
                    conceptId={conceptId}
                    primary={isRecommended}
                  />
                )}
              </div>
            </Card>
          ),
        )}
      </div>
    </div>
  );
}
