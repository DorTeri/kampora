import { notFound } from 'next/navigation';
import { DEMO, demoCase } from '@/lib/demo-cases';
import { ReviewBoard } from '../review-board';

export function generateStaticParams() {
  return DEMO.cases.map((c) => ({ caseId: c.id }));
}

export default async function DemoReviewPage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const c = demoCase(caseId);
  if (!c) notFound();
  // The direction input stays on the server (the change route reads it); the page gets what it shows.
  const { input: _input, ...review } = c.review;
  return (
    <ReviewBoard
      data={{ ...c, review }}
      mode="demo"
      changeUrl={`/api/studio/review/${c.id}/change`}
      approveUrl={null}
      storageKey={`kampora-demo-approval-${c.id}`}
    />
  );
}
