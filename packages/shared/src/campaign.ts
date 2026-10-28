import { z } from 'zod';
import { QualityTierSchema } from './common';

export const CampaignGoalSchema = z.enum(['LEADS', 'SALES', 'PRODUCT_PROMO', 'OFFER', 'AWARENESS']);
export type CampaignGoal = z.infer<typeof CampaignGoalSchema>;

/** What the business owner tells us. Everything else is derived. */
export const CampaignRequestSchema = z.object({
  goal: CampaignGoalSchema,
  productName: z.string().min(1).max(120),
  offer: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
});
export type CampaignRequest = z.infer<typeof CampaignRequestSchema>;

export const CampaignBriefSchema = z.object({
  goal: CampaignGoalSchema,
  productName: z.string().min(1),
  offer: z.string().optional(),
  audience: z.string().min(1),
  keyMessage: z.string().min(1),
  cta: z.string().min(1),
  platform: z.enum(['META_REELS']),
  targetDurationSec: z.number().int().min(10).max(60),
  tone: z.string(),
  /** Must-follow constraints, e.g. "use only approved claims". */
  constraints: z.array(z.string()),
  productionBudgetUsd: z.number().positive(),
  qualityTier: QualityTierSchema,
});
export type CampaignBrief = z.infer<typeof CampaignBriefSchema>;

export const ConceptAngleSchema = z.enum([
  'PROBLEM_SOLUTION',
  'UGC',
  'PRODUCT_DEMO',
  'EMOTIONAL',
  'OFFER_DRIVEN',
]);
export type ConceptAngle = z.infer<typeof ConceptAngleSchema>;

export const ComplexitySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

export const CreativeConceptSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  angle: ConceptAngleSchema,
  audience: z.string(),
  hook: z.string().min(1),
  mainMessage: z.string().min(1),
  visualDirection: z.string(),
  voiceover: z.string().min(1),
  cta: z.string().min(1),
  rationale: z.string(),
  complexity: ComplexitySchema,
});
export type CreativeConcept = z.infer<typeof CreativeConceptSchema>;

export const ConceptSetSchema = z
  .object({
    concepts: z.array(CreativeConceptSchema).length(3),
    recommendedKey: z.string(),
    recommendationReason: z.string(),
  })
  .refine((s) => s.concepts.some((c) => c.key === s.recommendedKey), {
    message: 'recommendedKey must reference one of the concepts',
  })
  .refine((s) => new Set(s.concepts.map((c) => c.angle)).size === s.concepts.length, {
    message: 'Concepts must use meaningfully different angles',
  });
export type ConceptSet = z.infer<typeof ConceptSetSchema>;
