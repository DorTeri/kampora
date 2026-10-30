import { notFound } from 'next/navigation';
import { Badge, ButtonLink, Card, PageHeader, cn } from '@/components/ui';
import { he } from '@/i18n/he';
import { ApiRequestError, api, type CampaignDetail } from '@/lib/api';
import { SelectConceptButton } from './select-button';

const k = he.knowledge;

/** One known fact with where it came from (never shows an inference as a fact). */
function Fact({
  label,
  field,
}: {
  label: string;
  field: { value: string | string[] | null; provenance: string };
}) {
  if (field.value === null || (Array.isArray(field.value) && !field.value.length)) return null;
  return (
    <div>
      <p className="flex items-center gap-2 text-muted">
        {label}
        <span
          className={cn(
            'rounded-full px-2 py-px text-[11px] font-semibold',
            field.provenance === 'AI_INFERRED' ? 'bg-warn-soft text-warn' : 'bg-ink/[0.05] text-muted',
          )}
        >
          {k.provenance[field.provenance]}
        </span>
      </p>
      <p className="mt-0.5">{Array.isArray(field.value) ? field.value.join(' · ') : field.value}</p>
    </div>
  );
}

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
  const pro = campaign.professionalBrief;

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

      <Card className="mb-8">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-bold text-muted">{k.title}</h2>
          <Badge>{k.industry(pro.industry.label)}</Badge>
          <Badge>
            {k.media(
              pro.business.media.verifiedProductPhotos + pro.business.media.verifiedBusinessPhotos,
              pro.business.media.aiImages,
            )}
          </Badge>
        </div>
        <div className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Fact label={k.valueProposition} field={pro.strategy.valueProposition} />
          <Fact label={k.reasons} field={pro.strategy.reasonsToBelieve} />
          <Fact label={k.emotion} field={pro.strategy.emotionalDirection} />
          <Fact label={k.insight} field={pro.strategy.coreInsight} />
          <Fact label={k.restrictions} field={pro.strategy.restrictions} />
        </div>
        {pro.questions.length > 0 ? (
          <div className="mt-5 border-t border-ink/10 pt-4">
            <h3 className="mb-2 text-sm font-bold">{k.questions}</h3>
            <ul className="space-y-2 text-sm">
              {pro.questions.map((q) => (
                <li key={q.field} className="flex items-start gap-2">
                  <Badge tone={q.priority === 'REQUIRED' ? 'accent' : undefined}>
                    {q.priority === 'REQUIRED' ? k.required : k.recommended}
                  </Badge>
                  <span>
                    <span className="font-semibold">{q.question}</span>{' '}
                    <span className="text-muted">{q.reason}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted">{k.ready}</p>
        )}
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
                <Badge tone="accent">{he.concepts.angles[concept.angle]}</Badge>
                {concept.copy && <Badge>{he.concepts.hookTechniques[concept.copy.hookTechnique]}</Badge>}
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
                {concept.copy && (
                  <div>
                    <dt className="font-semibold text-muted">{he.concepts.headline}</dt>
                    <dd className="mt-0.5 font-bold">
                      {concept.copy.headline}
                      {concept.copy.subheadline && (
                        <span className="block font-normal text-muted">{concept.copy.subheadline}</span>
                      )}
                    </dd>
                  </div>
                )}
                {concept.copy && concept.copy.claimsUsed.length > 0 && (
                  <div>
                    <dt className="font-semibold text-muted">{he.concepts.claimsUsed}</dt>
                    <dd className="mt-0.5">{concept.copy.claimsUsed.join(' · ')}</dd>
                  </div>
                )}
                {concept.strategy && (
                  <>
                    <div>
                      <dt className="font-semibold text-muted">{he.concepts.objective}</dt>
                      <dd className="mt-0.5">{concept.strategy.objective}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-muted">{he.concepts.insight}</dt>
                      <dd className="mt-0.5">{concept.strategy.insight}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-muted">{he.concepts.hypothesis}</dt>
                      <dd className="mt-0.5">{concept.strategy.hypothesis}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-muted">{he.concepts.structure}</dt>
                      <dd className="mt-1">
                        <ol className="flex flex-wrap gap-1.5">
                          {concept.strategy.storyStructure.map((beat, i) => (
                            <li key={i} className="rounded-full bg-ink/[0.05] px-2.5 py-0.5 text-xs">
                              {i + 1}. {beat}
                            </li>
                          ))}
                        </ol>
                      </dd>
                    </div>
                  </>
                )}
                <div>
                  <dt className="font-semibold text-muted">{he.concepts.visual}</dt>
                  <dd className="mt-0.5">{concept.visualDirection}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-muted">
                    {he.concepts.script} · {he.concepts.duration(concept.estimatedDurationSec ?? 20)}
                  </dt>
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
