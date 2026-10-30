import { CREATIVE_RUBRIC, rubricCriterion, rubricTag } from '@kampora/agent-expertise';
import {
  CritiqueReportSchema,
  type CreativeComponent,
  type CriterionResult,
  type CritiqueDimension,
  type CritiqueReport,
  type CritiqueSeverity,
  type CritiqueSubject,
} from '@kampora/shared';

/** Deterministic checks score by what they found; there is no hidden overall score. */
const SCORE: Record<CritiqueSeverity, number> = { OK: 5, MINOR: 3, MAJOR: 2, CRITICAL: 1 };

export interface Finding {
  severity: CritiqueSeverity;
  explanation: string;
  evidence?: string[];
  correction?: string;
  /** Overrides the rubric's default owner of the criterion. */
  component?: CreativeComponent;
  target?: string;
}

/** One deterministic rubric result; the worst finding sets the severity, all findings are kept as evidence. */
export function measured(
  criterion: string,
  findings: Finding[],
  ok: string,
  okEvidence: string[] = [],
): CriterionResult {
  const c = rubricCriterion(criterion);
  const order: CritiqueSeverity[] = ['OK', 'MINOR', 'MAJOR', 'CRITICAL'];
  const worst = findings.reduce<Finding | undefined>(
    (w, f) => (!w || order.indexOf(f.severity) > order.indexOf(w.severity) ? f : w),
    undefined,
  );
  if (!worst || worst.severity === 'OK')
    return {
      criterion,
      dimension: c.dimension,
      score: SCORE.OK,
      method: 'DETERMINISTIC',
      explanation: ok,
      evidence: [...okEvidence, ...findings.flatMap((f) => f.evidence ?? [])],
      severity: 'OK',
      component: c.component,
    };
  return {
    criterion,
    dimension: c.dimension,
    score: SCORE[worst.severity],
    method: 'DETERMINISTIC',
    explanation: findings.map((f) => f.explanation).join(' '),
    evidence: findings.flatMap((f) => f.evidence ?? []),
    severity: worst.severity,
    recommendedCorrection: worst.correction,
    component: worst.component ?? c.component,
    target: worst.target,
  };
}

/** A criterion the code cannot measure: left to the optional opinion pass and to people. */
export function notMeasured(criterion: string, why: string): CriterionResult {
  const c = rubricCriterion(criterion);
  return {
    criterion,
    dimension: c.dimension,
    score: null,
    method: c.method,
    explanation: why,
    evidence: [],
    severity: 'OK',
    component: c.component,
  };
}

/**
 * The report. REVISE: a MAJOR/CRITICAL problem has an owner who can fix it; HUMAN_REVIEW: a serious problem
 * only the owner (or a paid step) can fix; PASS: no serious problem found by the checks. PASS never means
 * "good": the subjective criteria are for people.
 */
export function report(subject: CritiqueSubject, round: number, results: CriterionResult[]): CritiqueReport {
  const serious = results.filter((r) => r.severity === 'MAJOR' || r.severity === 'CRITICAL');
  const verdict = !serious.length
    ? 'PASS'
    : serious.some((r) => r.component !== 'OWNER')
      ? 'REVISE'
      : 'HUMAN_REVIEW';
  const summary = {} as Record<CritiqueDimension, { checked: number; problems: number }>;
  for (const d of ['MARKETING', 'VISUAL', 'PRODUCTION'] as const) {
    const mine = results.filter((r) => r.dimension === d && r.score !== null);
    summary[d] = {
      checked: mine.length,
      problems: mine.filter((r) => r.severity === 'MAJOR' || r.severity === 'CRITICAL').length,
    };
  }
  return CritiqueReportSchema.parse({
    subject,
    rubricVersion: rubricTag(),
    round,
    results,
    verdict,
    summary,
  });
}

/** Criteria of the rubric that apply to a kind of work (for completeness checks). */
export const criteriaFor = (kind: 'CONCEPT_SET' | 'STATIC_AD' | 'VIDEO') =>
  CREATIVE_RUBRIC.criteria.filter((c) => (c.appliesTo as readonly string[]).includes(kind)).map((c) => c.id);
