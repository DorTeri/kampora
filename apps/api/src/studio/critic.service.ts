import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { expertiseVersion, type IndustryProfile } from '@kampora/agent-expertise';
import { summarizeLedger } from '@kampora/cost-engine';
import {
  auditLog,
  campaignBriefs,
  creativeConcepts,
  creativeFeedback,
  creativeReviews,
  ledgerEntriesFor,
  staticAds,
  videoProjects,
  type Database,
} from '@kampora/database';
import type { CreativeFeedbackInput, CritiqueSubject, ReviewHistory } from '@kampora/shared';
import type { AuthContext } from '../common/auth';
import { ApiError, notFound } from '../common/errors';
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

  /**
   * The owner's verdict on a piece of work, with reasons: the learning signal. Stored under the business that
   * owns the project or campaign (checked against the organization); never shared across businesses.
   */
  async feedback(
    ctx: AuthContext,
    scope: { videoProjectId: string } | { campaignBriefId: string },
    input: CreativeFeedbackInput,
  ) {
    let businessId: string;
    if ('videoProjectId' in scope) {
      const [project] = await this.db
        .select({ businessId: videoProjects.businessId })
        .from(videoProjects)
        .where(and(eq(videoProjects.id, scope.videoProjectId), eq(videoProjects.orgId, ctx.orgId)));
      if (!project) throw notFound('Project');
      businessId = project.businessId;
      if (input.subjectType === 'CONCEPT') throw invalidSubject();
      if (input.subjectType === 'STATIC_AD') {
        const [ad] = await this.db
          .select({ id: staticAds.id })
          .from(staticAds)
          .where(
            and(
              eq(staticAds.orgId, ctx.orgId),
              eq(staticAds.videoProjectId, scope.videoProjectId),
              eq(staticAds.id, input.subjectRef),
            ),
          );
        if (!ad) throw invalidSubject();
      }
    } else {
      const [brief] = await this.db
        .select({ businessId: campaignBriefs.businessId })
        .from(campaignBriefs)
        .where(and(eq(campaignBriefs.id, scope.campaignBriefId), eq(campaignBriefs.orgId, ctx.orgId)));
      if (!brief) throw notFound('Campaign');
      businessId = brief.businessId;
      if (input.subjectType !== 'CONCEPT') throw invalidSubject();
      const [concept] = await this.db
        .select({ id: creativeConcepts.id })
        .from(creativeConcepts)
        .where(
          and(
            eq(creativeConcepts.orgId, ctx.orgId),
            eq(creativeConcepts.briefId, scope.campaignBriefId),
            eq(creativeConcepts.id, input.subjectRef),
          ),
        );
      if (!concept) throw invalidSubject();
    }
    const [row] = await this.db
      .insert(creativeFeedback)
      .values({
        orgId: ctx.orgId,
        businessId,
        subjectType: input.subjectType,
        subjectRef: input.subjectRef,
        decision: input.decision,
        reasons: input.reasons,
        note: input.note,
        createdBy: ctx.userId,
      })
      .returning();
    await this.db.insert(auditLog).values({
      orgId: ctx.orgId,
      actorUserId: ctx.userId,
      action: 'creative.feedback',
      subjectType: input.subjectType.toLowerCase(),
      subjectId: input.subjectRef,
      metadata: { decision: input.decision, reasons: input.reasons },
    });
    return row!;
  }

  /** Feedback already given on these subjects (latest per subject). */
  async feedbackFor(ctx: AuthContext, subjectRefs: string[]) {
    if (!subjectRefs.length) return [];
    const rows = await this.db
      .select()
      .from(creativeFeedback)
      .where(and(eq(creativeFeedback.orgId, ctx.orgId), inArray(creativeFeedback.subjectRef, subjectRefs)))
      .orderBy(desc(creativeFeedback.createdAt));
    const seen = new Set<string>();
    return rows
      .filter((r) => !seen.has(r.subjectRef) && seen.add(r.subjectRef))
      .map((r) => ({
        subjectRef: r.subjectRef,
        decision: r.decision,
        reasons: r.reasons,
        createdAt: r.createdAt,
      }));
  }

  /**
   * Quality metrics for one business (or the whole organization): what the Critic found and fixed, what owners
   * accepted or rejected and why, and what the creative work cost. Counts, not a quality score.
   */
  async metrics(ctx: AuthContext, businessId?: string) {
    const reviews = await this.db
      .select()
      .from(creativeReviews)
      .where(
        and(
          eq(creativeReviews.orgId, ctx.orgId),
          businessId ? eq(creativeReviews.businessId, businessId) : undefined,
        ),
      );
    const feedback = await this.db
      .select()
      .from(creativeFeedback)
      .where(
        and(
          eq(creativeFeedback.orgId, ctx.orgId),
          businessId ? eq(creativeFeedback.businessId, businessId) : undefined,
        ),
      );
    const projects = await this.db
      .select({ id: videoProjects.id })
      .from(videoProjects)
      .where(
        and(
          eq(videoProjects.orgId, ctx.orgId),
          businessId ? eq(videoProjects.businessId, businessId) : undefined,
        ),
      );
    const briefs = await this.db
      .select({ id: campaignBriefs.id })
      .from(campaignBriefs)
      .where(
        and(
          eq(campaignBriefs.orgId, ctx.orgId),
          businessId ? eq(campaignBriefs.businessId, businessId) : undefined,
        ),
      );
    const ledger = summarizeLedger(
      await ledgerEntriesFor(this.db, ctx.orgId, {
        projectIds: projects.map((p) => p.id),
        briefIds: briefs.map((b) => b.id),
      }),
    );
    const count = (values: string[]) =>
      values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {});
    const revisions = reviews.flatMap((r) => r.history.rounds.flatMap((x) => x.revisions));
    const serious = reviews.flatMap((r) =>
      r.history.rounds
        .at(-1)!
        .report.results.filter((x) => x.severity === 'MAJOR' || x.severity === 'CRITICAL')
        .map((x) => x.criterion),
    );
    return {
      scope: businessId ? { businessId } : { organization: true },
      reviews: {
        total: reviews.length,
        bySubject: count(reviews.map((r) => r.subjectType)),
        byVerdict: count(reviews.map((r) => r.verdict)),
        averageRounds: reviews.length
          ? Math.round((reviews.reduce((a, r) => a + r.rounds, 0) / reviews.length) * 100) / 100
          : null,
        freeFixesApplied: revisions.filter((r) => r.status === 'APPLIED').length,
        waitingForApproval: revisions.filter((r) => r.status === 'PENDING_APPROVAL').length,
        needOwner: revisions.filter((r) => r.status === 'NEEDS_OWNER').length,
        seriousByCriterion: count(serious),
        rubricVersions: [...new Set(reviews.map((r) => r.rubricVersion))],
      },
      feedback: {
        total: feedback.length,
        byDecision: count(feedback.map((f) => f.decision)),
        byReason: count(feedback.flatMap((f) => f.reasons)),
      },
      cost: {
        byChargeTypeUsd: ledger.byChargeTypeUsd,
        byOperationUsd: ledger.byOperationUsd,
        failures: ledger.failures,
        costPerAcceptedAssetUsd: ledger.costPerAcceptedAssetUsd,
      },
      note: 'Counts of measured checks and owner decisions. They describe the process; they do not prove quality.',
    };
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

const invalidSubject = () =>
  new ApiError(HttpStatus.BAD_REQUEST, 'INVALID_SUBJECT', 'The feedback subject does not belong here');

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
