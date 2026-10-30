import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { expertiseVersion, type IndustryProfile } from '@kampora/agent-expertise';
import { creativeReviews, type Database } from '@kampora/database';
import type { CritiqueSubject, ReviewHistory } from '@kampora/shared';
import type { AuthContext } from '../common/auth';
import { DATABASE } from '../infra/tokens';

type ReviewRow = typeof creativeReviews.$inferSelect;

/**
 * Stores the Creative Critic's reviews (every round, every revision request) so the owner, the evaluation and
 * later learning can see what was checked and what changed. Scoped by organization and business.
 */
@Injectable()
export class CriticService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async record(
    ctx: AuthContext,
    input: {
      businessId: string;
      videoProjectId?: string;
      campaignBriefId?: string;
      subject: CritiqueSubject;
      history: ReviewHistory;
      industry?: Pick<IndustryProfile, 'id' | 'version'>;
    },
  ) {
    const last = input.history.rounds.at(-1)!.report;
    await this.db.insert(creativeReviews).values({
      orgId: ctx.orgId,
      businessId: input.businessId,
      videoProjectId: input.videoProjectId,
      campaignBriefId: input.campaignBriefId,
      subjectType: input.subject.type,
      subjectRef: input.subject.ref,
      rubricVersion: last.rubricVersion,
      expertiseVersion: expertiseVersion(input.industry),
      verdict: last.verdict,
      rounds: input.history.rounds.length,
      history: input.history,
    });
  }

  /** The latest review of each subject of a project or a campaign. */
  async latest(ctx: AuthContext, scope: { videoProjectId: string } | { campaignBriefId: string }) {
    const rows = await this.db
      .select()
      .from(creativeReviews)
      .where(
        and(
          eq(creativeReviews.orgId, ctx.orgId),
          'videoProjectId' in scope
            ? eq(creativeReviews.videoProjectId, scope.videoProjectId)
            : eq(creativeReviews.campaignBriefId, scope.campaignBriefId),
        ),
      )
      .orderBy(desc(creativeReviews.createdAt));
    const seen = new Set<string>();
    return rows.filter((r) => !seen.has(r.subjectRef) && seen.add(r.subjectRef)).map(toReviewDto);
  }
}

/** What the owner sees: the outcome, what was fixed for free, and what still waits for someone. */
export function toReviewDto(row: ReviewRow) {
  const h = row.history;
  const last = h.rounds.at(-1)!.report;
  return {
    id: row.id,
    subjectType: row.subjectType,
    subjectRef: row.subjectRef,
    verdict: row.verdict,
    rounds: row.rounds,
    stoppedBecause: h.stoppedBecause,
    rubricVersion: row.rubricVersion,
    applied: h.rounds.flatMap((r) => r.revisions.filter((x) => x.status === 'APPLIED')),
    pending: h.rounds.at(-1)!.revisions.filter((x) => x.status !== 'APPLIED'),
    results: last.results.map((r) => ({
      criterion: r.criterion,
      dimension: r.dimension,
      score: r.score,
      method: r.method,
      severity: r.severity,
      explanation: r.explanation,
      evidence: r.evidence,
      recommendedCorrection: r.recommendedCorrection ?? null,
      component: r.component,
      target: r.target ?? null,
    })),
    summary: last.summary,
    createdAt: row.createdAt,
  };
}
export type ReviewDto = ReturnType<typeof toReviewDto>;
