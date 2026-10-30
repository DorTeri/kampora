import { z } from 'zod';
import { MediaAuthenticitySchema } from './authenticity';
import { CampaignGoalSchema, VisualStyleSchema } from './campaign';

/**
 * Where a piece of brief information came from. Only VERIFIED and CUSTOMER_PROVIDED information may be stated as
 * fact in an ad; AI_INFERRED information guides creative choices but is never asserted; MISSING produces a question.
 */
export const InfoProvenanceSchema = z.enum(['VERIFIED', 'CUSTOMER_PROVIDED', 'AI_INFERRED', 'MISSING']);
export type InfoProvenance = z.infer<typeof InfoProvenanceSchema>;

const briefField = <T extends z.ZodType>(value: T) =>
  z.object({
    value: value.nullable(),
    provenance: InfoProvenanceSchema,
    /** What it was taken from, e.g. "business.approvedClaims", "request.offer", "industry:cafe-restaurant". */
    source: z.string().optional(),
  });

export const BriefTextSchema = briefField(z.string());
export type BriefText = z.infer<typeof BriefTextSchema>;
export const BriefListSchema = briefField(z.array(z.string()));
export type BriefList = z.infer<typeof BriefListSchema>;

/** A question the (future) Campaign Director asks the owner. Never asked again once the answer is confirmed. */
export const MissingInfoQuestionSchema = z.object({
  /** Dotted path of the brief field it fills, e.g. "strategy.reasonsToBelieve". */
  field: z.string().min(1),
  /** The question, in natural Hebrew. */
  question: z.string().min(1),
  /** Why it matters for this campaign (Hebrew). */
  reason: z.string().min(1),
  /** REQUIRED: the ad cannot be made honestly without it. RECOMMENDED: the ad is better with it. */
  priority: z.enum(['REQUIRED', 'RECOMMENDED']),
  answer: z.enum(['TEXT', 'CHOICE', 'MEDIA', 'CONFIRM']),
  options: z.array(z.string()).optional(),
  /** CONFIRM questions: the inferred value the owner is asked to confirm or correct. */
  proposedValue: z.string().optional(),
});
export type MissingInfoQuestion = z.infer<typeof MissingInfoQuestionSchema>;

export const BriefMediaSchema = z.object({
  assetId: z.string(),
  authenticity: MediaAuthenticitySchema,
  description: z.string(),
});

/**
 * The foundation of all advertising work: what is known (and how), what the campaign must achieve, the strategy
 * and the visual direction. Built deterministically from the business memory, the owner's request and the
 * industry profile; nothing in it is invented.
 */
export const ProfessionalCreativeBriefSchema = z.object({
  version: z.literal(1),
  /** Versions of the expertise used to infer defaults (traceable, can be rolled back). */
  expertiseVersion: z.string(),
  industry: z.object({ id: z.string(), label: z.string(), matched: z.boolean() }),
  business: z.object({
    identity: BriefTextSchema,
    products: BriefListSchema,
    brandDetails: BriefListSchema,
    approvedClaims: BriefListSchema,
    productConstraints: BriefListSchema,
    positioning: BriefTextSchema,
    media: z.object({
      verifiedProductPhotos: z.number().int().nonnegative(),
      verifiedBusinessPhotos: z.number().int().nonnegative(),
      aiImages: z.number().int().nonnegative(),
      items: z.array(BriefMediaSchema).max(24),
    }),
  }),
  campaign: z.object({
    goal: CampaignGoalSchema,
    objective: BriefTextSchema,
    audience: BriefTextSchema,
    desiredAction: BriefTextSchema,
    offer: BriefTextSchema,
    duration: BriefTextSchema,
    distribution: BriefListSchema,
    budgetUsd: z.number().nonnegative(),
  }),
  strategy: z.object({
    customerProblem: BriefTextSchema,
    coreInsight: BriefTextSchema,
    valueProposition: BriefTextSchema,
    primaryMessage: BriefTextSchema,
    emotionalDirection: BriefTextSchema,
    reasonsToBelieve: BriefListSchema,
    tone: BriefTextSchema,
    restrictions: BriefListSchema,
  }),
  visual: z.object({
    brandPersonality: BriefTextSchema,
    visualStyle: briefField(VisualStyleSchema),
    typography: BriefTextSchema,
    colorDirection: BriefListSchema,
    photographyDirection: BriefTextSchema,
    references: BriefListSchema,
    productRepresentation: BriefTextSchema,
  }),
  questions: z.array(MissingInfoQuestionSchema),
  readiness: z.object({
    /** False when a REQUIRED question is open: the Director asks before producing. */
    ready: z.boolean(),
    missingRequired: z.array(z.string()),
  }),
});
export type ProfessionalCreativeBrief = z.infer<typeof ProfessionalCreativeBriefSchema>;
