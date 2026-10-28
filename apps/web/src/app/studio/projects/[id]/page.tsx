import { notFound } from 'next/navigation';
import { formatIls, storyboardDurationSec } from '@kampora/shared';
import { Badge, Card, CardTitle, PageHeader } from '@/components/ui';
import { he } from '@/i18n/he';
import { ApiRequestError, USD_TO_ILS, api, type ProjectDetail, type VoicesResponse } from '@/lib/api';
import { ApproveButton, ApproveScriptButton, ProductionPanel } from './production';
import { VoicePanel } from './voice';

const ROLE_TONE = { HOOK: 'accent', OFFER: 'primary', CTA: 'success' } as const;

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project, voices] = await Promise.all([
    api<ProjectDetail>(`/v1/projects/${id}`).catch((e) => {
      if (e instanceof ApiRequestError && (e.status === 404 || e.status === 400)) notFound();
      throw e;
    }),
    api<VoicesResponse>('/v1/voices'),
  ]);
  const plan = project.plan;
  const scenes = [...project.storyboard.scenes].sort((a, b) => a.order - b.order);
  const approved = Boolean(project.currentTimelineVersionId);
  const paid = plan?.estimatedPaidCostUsd ?? 0;
  const scriptApproved = Boolean(project.scriptApprovedAt);
  const narration = project.narration;
  const narrationReady = narration?.status === 'READY' && !narration.stale;
  // The current production version already includes this narration?
  const narrationKey = narration
    ? `plan-approved:${narration.voiceId}:${narration.segments.map((s) => s.assetId).join(',')}`
    : '';
  const needsUpdate = approved && narrationReady && project.versions[0]?.reason !== narrationKey;
  const narrationBusy = narration?.status === 'QUEUED' || narration?.status === 'RUNNING';
  const currentRenders = project.renders.filter(
    (r) => r.timelineVersionId === project.currentTimelineVersionId,
  );
  const usdToIls = (usd: number) => formatIls(usd * USD_TO_ILS);

  return (
    <div className="animate-rise">
      <PageHeader
        title={he.planning.title}
        subtitle={he.planning.subtitle}
        eyebrow={<Badge tone="primary">{project.concept.title}</Badge>}
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <ol className="space-y-4">
          {scenes.map((scene, i) => {
            const scenePlan = plan?.scenes.find((s) => s.sceneKey === scene.key);
            return (
              <li key={scene.key}>
                <Card className="grid gap-5 sm:grid-cols-[auto_1fr]">
                  <div className="flex items-start gap-3 sm:flex-col sm:items-center">
                    <span className="grid size-12 place-items-center rounded-2xl bg-ink text-lg font-black text-white">
                      {i + 1}
                    </span>
                    <span className="text-xs font-semibold text-muted">
                      {he.planning.seconds(scene.durationSec)}
                    </span>
                  </div>
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={ROLE_TONE[scene.role as keyof typeof ROLE_TONE] ?? 'neutral'}>
                        {he.planning.roles[scene.role]}
                      </Badge>
                      {scenePlan && <Badge>{he.planning.strategies[scenePlan.strategy]}</Badge>}
                    </div>
                    <p className="text-ink-soft">{scene.visual}</p>
                    {scene.onScreenText && (
                      <p>
                        <span className="text-sm font-semibold text-muted">{he.planning.onScreen}: </span>
                        <span className="font-bold">{scene.onScreenText}</span>
                      </p>
                    )}
                    <p className="rounded-2xl bg-ink/[0.03] px-4 py-3">
                      <span className="text-sm font-semibold text-muted">{he.planning.voiceover}: </span>
                      {scene.voiceover}
                    </p>
                    {/* Router warnings are internal (English, technical); customers get a plain-Hebrew note. */}
                    {scenePlan && scenePlan.warnings.length > 0 && (
                      <p className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">
                        {he.planning.sceneNeedsMedia}
                      </p>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ol>

        <aside className="space-y-6 xl:sticky xl:top-8 xl:self-start">
          <Card>
            <CardTitle>{project.title}</CardTitle>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">{he.planning.totalDuration}</dt>
                <dd className="font-bold">
                  {he.planning.seconds(storyboardDurationSec(project.storyboard))}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">{he.planning.format}</dt>
                <dd className="text-left font-bold">{he.planning.formatValue}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-line pt-3">
                <dt className="text-muted">{he.planning.cost}</dt>
                <dd className="font-bold">{paid > 0 ? formatIls(paid * USD_TO_ILS) : formatIls(0)}</dd>
              </div>
            </dl>
            {paid === 0 && <p className="mt-2 text-sm text-success">{he.planning.noExtraCost}</p>}
          </Card>

          <Card>
            <CardTitle hint={he.planning.scriptHint}>{he.planning.scriptTitle}</CardTitle>
            {scriptApproved ? (
              <p className="rounded-xl bg-success-soft px-4 py-3 text-sm font-semibold text-success">
                ✓ {he.planning.scriptApproved}
              </p>
            ) : (
              <ApproveScriptButton projectId={project.id} />
            )}
          </Card>

          {scriptApproved ? (
            <VoicePanel
              projectId={project.id}
              voices={voices}
              initialNarration={narration}
              usdToIls={USD_TO_ILS}
            />
          ) : (
            <p className="px-2 text-sm text-muted">{he.planning.approveFirst}</p>
          )}

          {scriptApproved && (
            <Card>
              {approved && !needsUpdate ? (
                <p className="rounded-xl bg-success-soft px-4 py-3 text-sm font-semibold text-success">
                  ✓ {he.planning.approvedNote}
                </p>
              ) : (
                <ApproveButton
                  projectId={project.id}
                  label={needsUpdate ? he.planning.updateProduction : undefined}
                  disabled={narrationBusy}
                />
              )}
              {paid > 0 && <p className="mt-2 text-sm">{usdToIls(paid)}</p>}
            </Card>
          )}

          <div id="production">
            {approved && !needsUpdate && (
              <ProductionPanel
                key={project.currentTimelineVersionId}
                projectId={project.id}
                initialRenders={currentRenders}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
