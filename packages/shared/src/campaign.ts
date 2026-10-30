import { z } from 'zod';
import { QualityTierSchema } from './common';
import { VoiceStyleSchema } from './narration';

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

/** Concept types. Each has its own hook mechanism, structure and emotional driver (see CONCEPT_TYPES). */
export const ConceptAngleSchema = z.enum([
  'PROBLEM_SOLUTION',
  'UGC',
  'PRODUCT_DEMO',
  'EMOTIONAL',
  'OFFER_DRIVEN',
  'HUMOR',
  'EDUCATIONAL',
  'LIFESTYLE',
]);
export type ConceptAngle = z.infer<typeof ConceptAngleSchema>;

export const ComplexitySchema = z.enum(['LOW', 'MEDIUM', 'HIGH']);

/**
 * How the ad should look. Photographic styles are the default for products; illustration is a deliberate choice,
 * never a fallback. Text is never part of the picture (overlays are added by the renderer).
 */
export const VisualStyleSchema = z.enum([
  'photoreal-product',
  'lifestyle-photo',
  'cinematic',
  'ugc-handheld',
  'flat-graphic',
  'illustration',
]);
export type VisualStyle = z.infer<typeof VisualStyleSchema>;

/** How the video is produced (what the editor/renderer builds it from). */
export const ProductionFormatSchema = z.enum([
  'image-motion',
  'motion-graphics',
  'ugc-style',
  'product-demo',
  'mixed',
]);
export type ProductionFormat = z.infer<typeof ProductionFormatSchema>;

/** The strategic core of a concept: what it is for, what it believes, and how it should feel and be made. */
export const ConceptStrategySchema = z.object({
  /** The one thing this ad should achieve (measurable where possible). */
  objective: z.string().min(1),
  /** Audience truth the idea is built on (an observation, not an invented statistic). */
  insight: z.string().min(1),
  /** What this concept tests: "if we X, then Y because Z". */
  hypothesis: z.string().min(1),
  /** Story beats in order, e.g. ["hook: ...", "problem: ...", "solution: ...", "cta: ..."]. */
  storyStructure: z.array(z.string().min(1)).min(3).max(6),
  emotionalDirection: z.string().min(1),
  visualStyle: VisualStyleSchema,
  productionFormat: ProductionFormatSchema,
  /** Narration delivery style suggested for this concept (the owner can change it). */
  voiceStyle: VoiceStyleSchema,
});
export type ConceptStrategy = z.infer<typeof ConceptStrategySchema>;

/** How a hook stops the scroll (from the copywriting playbook). Three concepts never share one. */
export const HookTechniqueSchema = z.enum([
  'QUESTION',
  'BOLD_STATEMENT',
  'OFFER_FIRST',
  'PATTERN_INTERRUPT',
  'FIRST_PERSON',
  'SENSORY_DETAIL',
  'CONTRAST',
  'HOW_TO',
]);
export type HookTechnique = z.infer<typeof HookTechniqueSchema>;

/** Where a piece of copy runs. */
export const CopyFormatSchema = z.enum(['VIDEO_9_16', 'STATIC_1_1', 'STATIC_4_5', 'STATIC_9_16']);
export type CopyFormat = z.infer<typeof CopyFormatSchema>;

/**
 * The Copywriter's written layer of a concept. The spoken script (voiceover) and the written copy are separate:
 * a headline is read in a second, a voice line is heard once.
 */
export const ConceptCopySchema = z.object({
  hookTechnique: HookTechniqueSchema,
  /** Written headline for static ads and the opening title card (not a transcript of the voice line). */
  headline: z.string().trim().min(1).max(70),
  subheadline: z.string().trim().min(1).max(110).optional(),
  /** Approved claims (verbatim) or verified facts the copy relies on. */
  claimsUsed: z.array(z.string()),
  formats: z.array(CopyFormatSchema).min(1),
  density: z.object({
    spokenWords: z.number().int().nonnegative(),
    estimatedSec: z.number().nonnegative(),
    headlineWords: z.number().int().nonnegative(),
  }),
  /** Copywriting playbook version that produced it. */
  playbookVersion: z.string(),
});
export type ConceptCopy = z.infer<typeof ConceptCopySchema>;

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
  /** Intended ad length; the storyboard and narration are checked against it. */
  estimatedDurationSec: z.number().int().min(8).max(60).default(20),
  /** Phase 3 concepts carry their strategy; concepts stored before it do not. */
  strategy: ConceptStrategySchema.optional(),
  /** Written copy and copywriting metadata. Concepts stored before the Copywriter upgrade do not have it. */
  copy: ConceptCopySchema.optional(),
});
export type CreativeConcept = z.infer<typeof CreativeConceptSchema>;

/** The Copywriter's deliverable for one concept, as the Campaign Director and the Critic read it. */
export const CopywritingProposalSchema = z.object({
  conceptKey: z.string(),
  concept: z.object({ title: z.string(), angle: ConceptAngleSchema, hypothesis: z.string().nullable() }),
  hook: z.string(),
  hookTechnique: HookTechniqueSchema.nullable(),
  mainMessage: z.string(),
  spokenScript: z.string(),
  headline: z.string(),
  subheadline: z.string().nullable(),
  emotionalDirection: z.string().nullable(),
  cta: z.string(),
  rationale: z.string(),
  claimsUsed: z.array(z.string()),
  targetFormats: z.array(CopyFormatSchema),
  estimatedDurationSec: z.number(),
  textDensity: z.object({ spokenWords: z.number(), headlineWords: z.number() }),
});
export type CopywritingProposal = z.infer<typeof CopywritingProposalSchema>;

export function toCopywritingProposal(c: CreativeConcept): CopywritingProposal {
  const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
  return {
    conceptKey: c.key,
    concept: { title: c.title, angle: c.angle, hypothesis: c.strategy?.hypothesis ?? null },
    hook: c.hook,
    hookTechnique: c.copy?.hookTechnique ?? null,
    mainMessage: c.mainMessage,
    spokenScript: c.voiceover,
    headline: c.copy?.headline ?? c.hook,
    subheadline: c.copy?.subheadline ?? null,
    emotionalDirection: c.strategy?.emotionalDirection ?? null,
    cta: c.cta,
    rationale: c.rationale,
    claimsUsed: c.copy?.claimsUsed ?? [],
    targetFormats: c.copy?.formats ?? ['VIDEO_9_16'],
    estimatedDurationSec: c.estimatedDurationSec,
    textDensity: {
      spokenWords: c.copy?.density.spokenWords ?? words(c.voiceover),
      headlineWords: c.copy?.density.headlineWords ?? words(c.copy?.headline ?? c.hook),
    },
  };
}

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
