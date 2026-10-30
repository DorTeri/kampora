import { CRITIC_POLICY } from '@kampora/agent-expertise';
import {
  designFor,
  LayoutFamilySchema,
  ReviewHistorySchema,
  type CreativeComponent,
  type CriterionResult,
  type CritiqueReport,
  type CritiqueSubject,
  type LayoutFamily,
  type ReviewHistory,
  type ReviewRound,
  type RevisionRequest,
  type StaticAd,
} from '@kampora/shared';
import { report } from './report';
import { critiqueStaticAd, type StaticAdCritiqueContext } from './static-ad';

const serious = (r: CriterionResult) => r.severity === 'MAJOR' || r.severity === 'CRITICAL';
const isFree = (c: CreativeComponent) => (CRITIC_POLICY.freeComponents as readonly string[]).includes(c);
const isPaid = (c: CreativeComponent) => (CRITIC_POLICY.paidComponents as readonly string[]).includes(c);

/**
 * Turns a report's serious problems into one focused request per component. Paid work (new copy, a new picture)
 * is never started here: it waits for approval. Problems only the owner can solve go back to the owner.
 */
export function routeRevisions(rep: CritiqueReport): RevisionRequest[] {
  const byComponent = new Map<CreativeComponent, CriterionResult[]>();
  for (const r of rep.results.filter(serious))
    byComponent.set(r.component, [...(byComponent.get(r.component) ?? []), r]);
  return [...byComponent].map(([component, rs]): RevisionRequest => {
    const targets = [...new Set(rs.map((r) => r.target).filter(Boolean))];
    return {
      component,
      criteria: [...new Set(rs.map((r) => r.criterion))],
      instruction: rs.map((r) => r.recommendedCorrection ?? r.explanation).join(' '),
      ...(targets.length === 1 ? { target: targets[0] } : {}),
      cost: isPaid(component) ? 'PAID' : 'FREE',
      status: component === 'OWNER' ? 'NEEDS_OWNER' : isPaid(component) ? 'PENDING_APPROVAL' : 'NOT_POSSIBLE',
    };
  });
}

/** A single critique with no automatic fixer (concept sets, videos): the history of one round. */
export function reviewOnce(subject: CritiqueSubject, results: CriterionResult[]): ReviewHistory {
  const rep = report(subject, 0, results);
  return ReviewHistorySchema.parse({
    rounds: [{ round: 0, report: rep, revisions: routeRevisions(rep) }],
    maxRounds: CRITIC_POLICY.maxRevisionRounds,
    stoppedBecause: rep.verdict === 'PASS' ? 'PASSED' : 'NO_AUTOMATIC_FIX',
  });
}

export interface StaticAdReview {
  /** The ad after the free fixes (unchanged when none applied). */
  ad: StaticAd;
  history: ReviewHistory;
}

/**
 * The bounded critique-and-revision loop for one static ad. Only free fixes are applied: the Art Director moves
 * to the next layout family it considered (or re-derives the palette) when that removes serious problems. A
 * layout the owner chose is never replaced. Stops when the checks pass, nothing free can help, a fix does not
 * improve the result, or after `maxRounds` fixes.
 */
export function reviewStaticAd(
  ad: StaticAd,
  ctx: StaticAdCritiqueContext & {
    /** Layout families the Art Director considered, best first. */
    alternatives?: readonly LayoutFamily[];
    maxRounds?: number;
  } = {},
): StaticAdReview {
  const maxRounds = ctx.maxRounds ?? CRITIC_POLICY.maxRevisionRounds;
  const subject: CritiqueSubject = { type: 'STATIC_AD', ref: `${ad.id}:${ad.format}` };
  const evaluate = (candidate: StaticAd, round: number) =>
    report(subject, round, critiqueStaticAd(candidate, ctx));
  const problems = (rep: CritiqueReport) => rep.results.filter(serious).length;
  const rounds: ReviewRound[] = [];
  const tried = new Set<LayoutFamily>();
  let current = ad;
  let stoppedBecause: ReviewHistory['stoppedBecause'];

  for (let round = 0; ; round++) {
    const rep = evaluate(current, round);
    const revisions = routeRevisions(rep);
    const finish = (why: ReviewHistory['stoppedBecause']) => {
      rounds.push({ round, report: rep, revisions });
      stoppedBecause = why;
    };
    if (rep.verdict === 'PASS') {
      finish('PASSED');
      break;
    }
    const free = revisions.filter((r) => isFree(r.component));
    if (!free.length || !current.design) {
      finish('NO_AUTOMATIC_FIX');
      break;
    }
    if (round >= maxRounds) {
      finish('MAX_ROUNDS');
      break;
    }
    const design = current.design;
    if (design.chosenBy === 'OWNER') {
      for (const r of free) r.change = 'The owner chose this layout; it is kept.';
      finish('NO_AUTOMATIC_FIX');
      break;
    }
    tried.add(design.layoutFamily);
    const families = [
      design.layoutFamily,
      ...(ctx.alternatives ?? LayoutFamilySchema.options).filter((f) => !tried.has(f)),
    ];
    const hasPicture = Boolean(current.background.assetId);
    let next: { ad: StaticAd; rep: CritiqueReport; family: LayoutFamily } | undefined;
    for (const family of families) {
      const candidate: StaticAd = {
        ...current,
        design: {
          ...designFor(family, current.format, current.branding.colors, hasPicture),
          chosenBy: 'ART_DIRECTOR',
        },
      };
      if (JSON.stringify(candidate.design) === JSON.stringify(design)) continue;
      const candidateRep = evaluate(candidate, round + 1);
      if (problems(candidateRep) < problems(rep)) {
        next = { ad: candidate, rep: candidateRep, family };
        break;
      }
    }
    if (!next) {
      for (const r of free) r.change = 'No other layout family removes the problem.';
      finish('NO_IMPROVEMENT');
      break;
    }
    for (const r of free) {
      r.status = 'APPLIED';
      r.change =
        next.family === design.layoutFamily
          ? `Rebuilt the ${design.layoutFamily} layout and palette from its recipe and the brand colors.`
          : `Switched the layout from ${design.layoutFamily} to ${next.family}.`;
    }
    rounds.push({ round, report: rep, revisions });
    tried.add(next.family);
    current = next.ad;
  }
  return {
    ad: current,
    history: ReviewHistorySchema.parse({ rounds, maxRounds, stoppedBecause: stoppedBecause! }),
  };
}
