import { cn } from '@/components/ui';
import { he } from '@/i18n/he';
import type { CriticReviewDto } from '@/lib/api';

const t = he.critic;

/**
 * The Creative Critic's review, in the owner's words: what the checks found, what was fixed for free, and what
 * still waits for someone. It never says the work is good: the measured checks only find problems.
 */
export function CriticReview({ review }: { review: CriticReviewDto }) {
  const problems = review.results.filter((r) => r.severity !== 'OK');
  const label = (c: string) => t.criteria[c] ?? c;
  return (
    <details className="group rounded-xl bg-ink/[0.03] px-3 py-2 text-xs">
      <summary className="cursor-pointer list-none">
        <span className="font-bold">{t.title}: </span>
        <span
          className={cn(
            'font-semibold',
            review.verdict === 'PASS'
              ? 'text-success'
              : review.verdict === 'REVISE'
                ? 'text-warn'
                : 'text-ink',
          )}
        >
          {t.verdict[review.verdict]}
        </span>
        {review.applied.length > 0 && (
          <span className="text-muted"> · {t.fixedCount(review.applied.length)}</span>
        )}
        <span className="text-muted group-open:hidden"> · {t.more}</span>
      </summary>
      <div className="mt-2 space-y-2">
        {review.applied.map((r, i) => (
          <p key={`a${i}`} className="text-success">
            {t.fixed}: {r.criteria.map(label).join(', ')}
          </p>
        ))}
        {review.pending.map((r, i) => (
          <p key={`p${i}`}>
            <span className="font-semibold">{t.status[r.status]}:</span> {r.criteria.map(label).join(', ')}
            {r.cost === 'PAID' && <span className="text-muted"> ({t.paid})</span>}
          </p>
        ))}
        {problems.length > 0 && (
          <ul className="space-y-1">
            {problems.map((r) => (
              <li key={`${r.criterion}${r.target ?? ''}`} className="flex gap-1.5">
                <span
                  className={cn(
                    'shrink-0 rounded px-1.5 font-semibold',
                    r.severity === 'MINOR' ? 'bg-ink/[0.06] text-muted' : 'bg-warn-soft text-warn',
                  )}
                >
                  {t.severity[r.severity]}
                </span>
                <span>
                  {label(r.criterion)}
                  {r.method === 'LLM_OPINION' && <span className="text-muted"> · {t.opinion}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted">
          {t.checked(review.results.filter((r) => r.score !== null).length)} {t.forPeople}
        </p>
      </div>
    </details>
  );
}
