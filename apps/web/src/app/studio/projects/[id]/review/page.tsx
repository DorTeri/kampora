import { notFound } from 'next/navigation';
import type { CreativeDirectionSet, CreativeReview } from '@kampora/shared';
import { SPEC_FONTS_HREF } from '@/components/spec-preview';
import { EmptyState } from '@/components/ui';
import { ApiRequestError, api, type ProjectDetail } from '@/lib/api';
import type { DirectionCopy, ReviewCase } from '@/lib/review';
import { ReviewBoard } from '../../../review/review-board';

interface DirectionsResponse {
  baseStaticAdId: string;
  set: CreativeDirectionSet;
  copy: Record<string, DirectionCopy>;
  reviews: Record<string, Record<string, CreativeReview>>;
  assetUrls: Record<string, string>;
}

/** Live review of a project's design directions (needs the Kampora API). */
export default async function ProjectReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let res: DirectionsResponse;
  let project: ProjectDetail;
  try {
    [res, project] = await Promise.all([api<DirectionsResponse>(`/v1/projects/${id}/directions`), api<ProjectDetail>(`/v1/projects/${id}`)]);
  } catch (e) {
    if (e instanceof ApiRequestError && e.code === 'NO_STATIC_AD')
      return <EmptyState title="צריך קודם ליצור מודעות סטטיות לפרויקט; הכיוונים נבנים מהן." />;
    throw e;
  }
  const data: ReviewCase = {
    id,
    business: { name: project.title, category: '', tone: '', colors: {} },
    brief: { goal: project.brief.goal, productName: project.brief.productName, offer: project.brief.offer, keyMessage: project.brief.keyMessage, audience: project.brief.audience },
    concepts: project.concept ? [{ title: project.concept.title, angle: project.concept.angle, headline: project.concept.copy?.headline, chosen: true }] : [],
    moodboard: [],
    directions: res.set.directions.map((d) => ({ key: d.key, name: d.name, renders: {}, reviews: res.reviews[d.key] ?? {}, pictureBrief: null })),
    storyboard: [],
    video: null,
    q6: { render: '', adText: { headline: '', cta: '' } as ReviewCase['q6']['adText'] },
    pictures: '',
    review: { set: res.set, copy: res.copy, assetUrls: res.assetUrls },
  };
  return (
    <>
      <link rel="stylesheet" href={SPEC_FONTS_HREF} precedence="default" />
      <ReviewBoard data={data} mode="live" changeUrl={`/api/projects/${id}/directions/{key}/changes`} approveUrl={`/api/projects/${id}/directions/{key}/approve`} storageKey={`kampora-approval-${id}`} />
    </>
  );
}
