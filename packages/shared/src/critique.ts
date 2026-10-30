import { z } from 'zod';

/** The component that owns a problem, and so receives the revision request. */
export const CreativeComponentSchema = z.enum([
  'COPYWRITER',
  'ART_DIRECTOR',
  'VISUAL_PLANNER',
  'LAYOUT_ENGINE',
  'VIDEO_PLANNER',
  'VOICE_ENGINE',
  /** Only the owner can fix it (a missing fact or photo). */
  'OWNER',
]);
export type CreativeComponent = z.infer<typeof CreativeComponentSchema>;

export const CritiqueDimensionSchema = z.enum(['MARKETING', 'VISUAL', 'PRODUCTION']);
export type CritiqueDimension = z.infer<typeof CritiqueDimensionSchema>;

export const CritiqueSeveritySchema = z.enum(['OK', 'MINOR', 'MAJOR', 'CRITICAL']);
export type CritiqueSeverity = z.infer<typeof CritiqueSeveritySchema>;

/** One rubric criterion applied to one piece of work. */
export const CriterionResultSchema = z.object({
  criterion: z.string(),
  dimension: CritiqueDimensionSchema,
  /** 1 (weak) – 5 (strong). Null: not applicable to this piece of work. */
  score: z.number().int().min(1).max(5).nullable(),
  /** DETERMINISTIC: a measured check. LLM_OPINION: a model's judgement, never proof of quality. */
  method: z.enum(['DETERMINISTIC', 'LLM_OPINION']),
  explanation: z.string(),
  evidence: z.array(z.string()),
  severity: CritiqueSeveritySchema,
  recommendedCorrection: z.string().optional(),
  component: CreativeComponentSchema,
  /** Format, scene or concept the result is about. */
  target: z.string().optional(),
});
export type CriterionResult = z.infer<typeof CriterionResultSchema>;

export const CritiqueSubjectSchema = z.object({
  type: z.enum(['CONCEPT_SET', 'STATIC_AD', 'STORYBOARD', 'VIDEO']),
  ref: z.string(),
});
export type CritiqueSubject = z.infer<typeof CritiqueSubjectSchema>;

/**
 * The Creative Critic's evaluation. There is deliberately no single overall score: each criterion carries its own
 * score, evidence and owner. `verdict` only says whether the work goes back for a fix; people decide if it is good.
 */
export const CritiqueReportSchema = z.object({
  subject: CritiqueSubjectSchema,
  rubricVersion: z.string(),
  round: z.number().int().nonnegative(),
  results: z.array(CriterionResultSchema),
  verdict: z.enum(['PASS', 'REVISE', 'HUMAN_REVIEW']),
  /** Per dimension: how many criteria were checked and how many found a MAJOR/CRITICAL problem. */
  summary: z.record(CritiqueDimensionSchema, z.object({ checked: z.number(), problems: z.number() })),
});
export type CritiqueReport = z.infer<typeof CritiqueReportSchema>;

/** A focused fix for one component. Paid fixes are never applied automatically. */
export const RevisionRequestSchema = z.object({
  component: CreativeComponentSchema,
  criteria: z.array(z.string()).min(1),
  instruction: z.string(),
  target: z.string().optional(),
  cost: z.enum(['FREE', 'PAID']),
  status: z.enum(['APPLIED', 'PENDING_APPROVAL', 'NEEDS_OWNER', 'NOT_POSSIBLE']),
  /** What the component changed (APPLIED). */
  change: z.string().optional(),
});
export type RevisionRequest = z.infer<typeof RevisionRequestSchema>;

export const ReviewRoundSchema = z.object({
  round: z.number().int().nonnegative(),
  report: CritiqueReportSchema,
  revisions: z.array(RevisionRequestSchema),
});
export type ReviewRound = z.infer<typeof ReviewRoundSchema>;

/** A bounded critique-and-revision cycle: at most `maxRounds` rounds of fixes, then people decide. */
export const ReviewHistorySchema = z.object({
  rounds: z.array(ReviewRoundSchema),
  maxRounds: z.number().int().min(0).max(5),
  stoppedBecause: z.enum(['PASSED', 'MAX_ROUNDS', 'NO_AUTOMATIC_FIX', 'NO_IMPROVEMENT']),
});
export type ReviewHistory = z.infer<typeof ReviewHistorySchema>;

/** Why an owner accepted or rejected a piece of work: the learning signal, kept per business. */
export const FeedbackReasonSchema = z.enum([
  'LIKE_COPY',
  'LIKE_DESIGN',
  'LIKE_PICTURE',
  'WEAK_HOOK',
  'TOO_GENERIC',
  'WRONG_TONE',
  'OFF_BRAND',
  'HARD_TO_READ',
  'WRONG_PRODUCT',
  'PRICE_UNCLEAR',
  'FACT_ERROR',
  'OTHER',
]);
export type FeedbackReason = z.infer<typeof FeedbackReasonSchema>;

export const CreativeFeedbackInputSchema = z.object({
  subjectType: z.enum(['CONCEPT', 'STATIC_AD', 'SCENE_IMAGE', 'VIDEO', 'NARRATION']),
  subjectRef: z.string().min(1).max(200),
  decision: z.enum(['ACCEPTED', 'REJECTED', 'REVISION_REQUESTED']),
  reasons: z.array(FeedbackReasonSchema).max(6).default([]),
  note: z.string().trim().max(1000).optional(),
});
export type CreativeFeedbackInput = z.infer<typeof CreativeFeedbackInputSchema>;
