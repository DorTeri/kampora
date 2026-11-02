import { z } from 'zod';
import { CampaignGoalSchema, type CampaignGoal } from './campaign';

/**
 * Campaign Director contracts: the business memory, the marketing decisions and the typed tool calls that connect
 * the conversation to the Studio. Everything the Director stores or executes passes through these schemas.
 */

// ── Business memory ───────────────────────────────────────────────────

/** How a business makes money: decides which customer action a campaign should drive. */
export const BusinessModelSchema = z.enum([
  'RESTAURANT',
  'CAFE',
  'COFFEE_CART',
  'FITNESS_STUDIO',
  'BEAUTY',
  'LOCAL_SERVICE',
  'ECOMMERCE',
  'OTHER',
]);
export type BusinessModel = z.infer<typeof BusinessModelSchema>;

/** What the owner wants more of. */
export const MarketingObjectiveSchema = z.enum([
  'LOCAL_AWARENESS',
  'VISITS',
  'ORDERS',
  'ONLINE_SALES',
  'LEADS',
  'BOOKINGS',
  'PRODUCT_LAUNCH',
  'RETENTION',
  'BRAND',
]);
export type MarketingObjective = z.infer<typeof MarketingObjectiveSchema>;

/** The action a customer takes after seeing the ad. */
export const ConversionActionSchema = z.enum([
  'WHATSAPP',
  'WEBSITE',
  'PRODUCT_PAGE',
  'BOOKING_PAGE',
  'ORDERING_PAGE',
  'INSTAGRAM_DM',
  'LEAD_FORM',
  'PHONE_CALL',
  'NAVIGATION',
]);
export type ConversionAction = z.infer<typeof ConversionActionSchema>;

export const FACT_KEYS = [
  'business.name',
  'business.model',
  'business.category',
  'location.city',
  'location.address',
  'location.serviceArea',
  'location.hours',
  'offering.main',
  'offering.products',
  'offer.current',
  'audience',
  'differentiator',
  'brand.tone',
  'channel.website',
  'channel.instagram',
  'contact.whatsapp',
  'contact.phone',
  'conversion.ordering',
  'conversion.orderUrl',
  'conversion.bookingUrl',
  'media.realPhotos',
  'budget.monthlyIls',
  'goal.primary',
  'preferences.style',
] as const;
export const FactKeySchema = z.enum(FACT_KEYS);
export type FactKey = z.infer<typeof FactKeySchema>;

/** A time-limited promotion. Never assumed to be valid after `validUntil`. */
export const OfferFactSchema = z.object({
  text: z.string().trim().min(1).max(200),
  price: z.string().trim().max(40).optional(),
  /** ISO date (inclusive). Missing: the owner has not said how long it runs. */
  validUntil: z.string().date().optional(),
  /** The owner said it has no end date. Still re-confirmed after a while: standing offers change too. */
  ongoing: z.boolean().optional(),
});
export type OfferFact = z.infer<typeof OfferFactSchema>;

export const FactValueSchema = z.union([
  z.string().trim().min(1).max(500),
  z.number(),
  z.boolean(),
  z.array(z.string().trim().min(1).max(200)).min(1).max(30),
  OfferFactSchema,
]);
export type FactValue = z.infer<typeof FactValueSchema>;

/**
 * Where a fact came from. Only the owner's own words or confirmations can be used in advertising claims;
 * inferences and outside research are proposals until the owner confirms them.
 */
export const FactSourceSchema = z.enum([
  'OWNER_STATED',
  'OWNER_CONFIRMED',
  'OWNER_FORM',
  'IMPORTED_PROFILE',
  'AI_INFERRED',
  'EXTERNAL_RESEARCH',
  'SYSTEM_DEFAULT',
]);
export type FactSource = z.infer<typeof FactSourceSchema>;

export const FactStatusSchema = z.enum(['CONFIRMED', 'PROPOSED', 'REJECTED']);
export type FactStatus = z.infer<typeof FactStatusSchema>;

export const BusinessFactSchema = z.object({
  key: FactKeySchema,
  value: FactValueSchema,
  source: FactSourceSchema,
  status: FactStatusSchema,
  /** The owner's words the fact was taken from (for review and for the anti-hallucination check). */
  evidence: z.string().max(300).optional(),
  updatedAt: z.string().datetime(),
  confirmedAt: z.string().datetime().nullable().optional(),
});
export type BusinessFact = z.infer<typeof BusinessFactSchema>;

/** A change to the memory proposed during a turn; the engine decides whether it is confirmed or awaits the owner. */
export const FactProposalSchema = z.object({
  key: FactKeySchema,
  value: FactValueSchema,
  source: FactSourceSchema,
  evidence: z.string().max(300).optional(),
});
export type FactProposal = z.infer<typeof FactProposalSchema>;

// ── Strategy ──────────────────────────────────────────────────────────

export const ConversionPlanSchema = z.object({
  action: ConversionActionSchema,
  /** URL, phone or place exactly as the owner gave it; null when it does not exist yet. Never invented. */
  destination: z.string().max(300).nullable(),
  exists: z.boolean(),
  why: z.string().max(400),
  /** When the ideal destination is missing: what to use meanwhile. */
  alternative: z.object({ action: ConversionActionSchema, destination: z.string().max(300).nullable(), why: z.string().max(400) }).optional(),
});
export type ConversionPlan = z.infer<typeof ConversionPlanSchema>;

/** Campaign settings prepared for a future Meta Ads integration. Nothing is published from this. */
export const MetaCampaignDraftSchema = z.object({
  objective: z.enum(['OUTCOME_AWARENESS', 'OUTCOME_TRAFFIC', 'OUTCOME_ENGAGEMENT', 'OUTCOME_LEADS', 'OUTCOME_SALES']),
  destinationType: z.enum(['WEBSITE', 'WHATSAPP', 'INSTAGRAM_DIRECT', 'PHONE_CALL', 'ON_AD', 'NONE']),
  destination: z.string().max(300).nullable(),
  geo: z.object({ city: z.string().max(80), radiusKm: z.number().positive().max(80) }).nullable(),
  placements: z.array(z.enum(['FEED', 'STORIES', 'REELS'])).min(1),
  dailyBudgetIls: z.number().positive().nullable(),
  status: z.literal('DRAFT_NOT_PUBLISHED'),
});
export type MetaCampaignDraft = z.infer<typeof MetaCampaignDraftSchema>;

export const RecommendationKindSchema = z.enum([
  'CAMPAIGN',
  'PROMOTION',
  'LOCAL_AWARENESS',
  'ORGANIC_CONTENT',
  'FIX_DESTINATION',
  'COLLECT_PHOTOS',
  'REFRESH_CREATIVE',
  'WAIT',
]);

export const RecommendationSchema = z.object({
  id: z.string().min(1).max(60),
  kind: RecommendationKindSchema,
  title: z.string().max(120),
  objective: MarketingObjectiveSchema,
  reasoning: z.string().max(800),
  /** Facts the recommendation rests on, in the owner's terms. */
  informationUsed: z.array(z.string().max(200)).max(20),
  missingInformation: z.array(z.string().max(200)).max(20),
  proposedAction: z.string().max(400),
  /** Estimated cost in USD when relevant; null when nothing would be spent. */
  estimatedCostUsd: z.number().nonnegative().nullable(),
  costNote: z.string().max(300),
  approvalRequired: z.boolean(),
});
export type Recommendation = z.infer<typeof RecommendationSchema>;

/** What a campaign the Director prepares is for, stored with its brief. */
export const DirectorCampaignPlanSchema = z.object({
  objective: MarketingObjectiveSchema,
  goal: CampaignGoalSchema,
  conversion: ConversionPlanSchema,
  meta: MetaCampaignDraftSchema,
  recommendationId: z.string().max(60),
});
export type DirectorCampaignPlan = z.infer<typeof DirectorCampaignPlanSchema>;

// ── Tools ─────────────────────────────────────────────────────────────

export const DIRECTOR_TOOLS = [
  'ReadBusinessProfile',
  'ProposeBusinessProfileUpdate',
  'GetCampaignHistory',
  'GetAvailableAssets',
  'CreateCreativeBrief',
  'ProposeCampaignStrategy',
  'GenerateCreativeConcepts',
  'RequestStoryboard',
  'RequestArtDirection',
  'RequestProduction',
  'GetProductionStatus',
  'PresentCreativeForApproval',
  'RequestTargetedRevision',
] as const;
export const DirectorToolNameSchema = z.enum(DIRECTOR_TOOLS);
export type DirectorToolName = z.infer<typeof DirectorToolNameSchema>;

/** One executed (or refused) tool call, as shown in the conversation's activity. */
export const ToolCallRecordSchema = z.object({
  tool: DirectorToolNameSchema,
  status: z.enum(['DONE', 'FAILED', 'REFUSED', 'WAITING_FOR_APPROVAL']),
  summary: z.string().max(400),
  error: z.string().max(400).optional(),
});
export type ToolCallRecord = z.infer<typeof ToolCallRecordSchema>;

// ── Approvals ─────────────────────────────────────────────────────────

/** What an owner approval covers. Only an explicit decision through the approvals endpoint authorizes it. */
export const DirectorApprovalKindSchema = z.enum([
  'SCRIPT',
  'CREATIVE_DIRECTION',
  'PRODUCTION',
  'PAID_GENERATION',
  'PUBLISH',
  'AD_BUDGET',
]);
export type DirectorApprovalKind = z.infer<typeof DirectorApprovalKindSchema>;

// ── Marketing recommendation ──────────────────────────────────────────

export const CreativeFormatSchema = z.enum(['REEL_9_16', 'STORY_9_16', 'FEED_4_5', 'SQUARE_1_1', 'CAROUSEL']);
export type CreativeFormat = z.infer<typeof CreativeFormatSchema>;

/**
 * Why a campaign should work for this business, how it runs and how the owner will know. A hypothesis to test,
 * never a forecast: no revenue estimates or promised results.
 */
export const MarketingRecommendationSchema = z.object({
  /** The goal in the owner's terms ("יותר הזמנות בוולט"). */
  businessGoal: z.string().max(200),
  objective: MarketingObjectiveSchema,
  /** Confirmed facts the recommendation rests on. */
  relevantFacts: z.array(z.string().max(200)).max(12),
  hypothesis: z.string().max(400),
  strategy: z.array(z.string().max(240)).min(1).max(6),
  creativeFormats: z.array(z.object({ format: CreativeFormatSchema, why: z.string().max(200) })).min(1).max(4),
  conversion: ConversionPlanSchema.nullable(),
  missingInformation: z.array(z.string().max(200)).max(10),
  requiredApprovals: z.array(DirectorApprovalKindSchema).max(6),
  measurement: z.object({
    primaryMetric: z.string().max(160),
    secondaryMetrics: z.array(z.string().max(160)).max(4),
    /** How the owner measures it with what they already have. */
    method: z.string().max(400),
    /** What to compare against (the weeks before the campaign), since no result is promised. */
    baseline: z.string().max(240),
  }),
});
export type MarketingRecommendation = z.infer<typeof MarketingRecommendationSchema>;

// ── Conversation ──────────────────────────────────────────────────────

export const DirectorCardSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('QUESTION'),
    keys: z.array(FactKeySchema).max(3),
    skippable: z.boolean(),
    suggestions: z.array(z.string().max(80)).max(6),
  }),
  z.object({
    kind: z.literal('RECOMMENDATION'),
    recommendation: RecommendationSchema,
    conversion: ConversionPlanSchema.nullable(),
    marketing: MarketingRecommendationSchema.optional(),
  }),
  z.object({
    kind: z.literal('CONCEPTS'),
    campaignId: z.string().uuid(),
    concepts: z.array(z.object({ id: z.string().uuid(), title: z.string(), hook: z.string(), recommended: z.boolean() })).max(6),
  }),
  z.object({
    kind: z.literal('APPROVAL'),
    approvalId: z.string().uuid(),
    approvalKind: DirectorApprovalKindSchema,
    title: z.string().max(160),
    details: z.array(z.string().max(300)).max(12),
    estimatedCostUsd: z.number().nonnegative(),
  }),
  z.object({
    kind: z.literal('CREATIVE'),
    projectId: z.string().uuid(),
    title: z.string().max(160),
    directions: z.array(z.object({ key: z.string().max(4), name: z.string().max(120), method: z.string().max(40), headline: z.string().max(200) })).max(3),
  }),
  z.object({
    kind: z.literal('CLARIFY'),
    question: z.string().max(200),
    options: z.array(z.object({ id: z.string().max(80), label: z.string().max(160) })).min(2).max(5),
  }),
  z.object({ kind: z.literal('FACTS'), facts: z.array(z.object({ key: FactKeySchema, label: z.string(), value: z.string(), status: FactStatusSchema })).max(20) }),
  z.object({
    kind: z.literal('STATUS'),
    items: z.array(z.object({ label: z.string().max(200), state: z.string().max(80), href: z.string().max(200).optional() })).max(20),
  }),
]);
export type DirectorCard = z.infer<typeof DirectorCardSchema>;

export const DirectorMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(['OWNER', 'DIRECTOR']),
  text: z.string().max(4000),
  cards: z.array(DirectorCardSchema).max(8),
  tools: z.array(ToolCallRecordSchema).max(12),
  createdAt: z.string(),
});
export type DirectorMessage = z.infer<typeof DirectorMessageSchema>;

/** The owner's message. `clientMessageId` makes a resend (double click, retry) a no-op. */
export const DirectorMessageRequestSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  clientMessageId: z.string().trim().min(8).max(64),
});
export type DirectorMessageRequest = z.infer<typeof DirectorMessageRequestSchema>;

// ── Workflow state ────────────────────────────────────────────────────

/** Compact working context of a conversation, so a turn never needs the whole chat history. */
export interface DirectorConversationState {
  /** The open workflow the conversation is in (resumed when the owner answers). */
  activeTaskId?: string;
  awaiting?:
    | { kind: 'FACTS'; keys: FactKey[]; taskId?: string }
    | { kind: 'CLARIFY'; taskId: string; options: { id: string; label: string }[] }
    | { kind: 'CONCEPT'; taskId: string; campaignId: string; conceptIds: string[]; recommendedId?: string }
    | { kind: 'INSTRUCTION'; taskId: string };
  /** Non-essential questions the owner chose to skip: not asked again in this conversation. */
  skipped: FactKey[];
  focus?: { campaignId?: string; projectId?: string };
  /** The last few decisions in one line each (newest last). */
  notes: string[];
  turns: number;
  /**
   * The owner said something that contradicts a confirmed fact. The confirmed value stays until they confirm the
   * change ("כן" applies `value`, "לא" keeps the old one).
   */
  conflict?: { key: FactKey; value: FactValue; evidence: string };
}

export const emptyDirectorState = (): DirectorConversationState => ({ skipped: [], notes: [], turns: 0 });

export type DirectorTaskKind = 'CAMPAIGN' | 'PROMOTION' | 'LAUNCH' | 'MODIFY';
export type DirectorTaskStatus = 'COLLECTING' | 'RUNNING' | 'WAITING_CHOICE' | 'WAITING_APPROVAL' | 'DONE' | 'FAILED' | 'CANCELLED';
export type RevisionTarget = 'VIDEO_OPENING' | 'DIRECTION' | 'VIDEO_OTHER';

export interface DirectorTaskParams {
  objective?: MarketingObjective;
  /** The product the owner named for this campaign (their words). */
  product?: string;
  productIsNew?: boolean;
  /** What the owner said about the product ("עם בריסקט מעושן"), passed to the brief as their words. */
  productDetail?: string;
  /** "השבוע", "החודש": when the owner wants it to run. */
  window?: string;
  target?: RevisionTarget;
  /** The owner's change request, verbatim. */
  instruction?: string;
  /** The step that failed, to resume from it on "נסה שוב". */
  failedStep?: string;
  /** "יותר לקוחות": a goal without a channel; the business's playbook decides, or asks when it depends. */
  growth?: boolean;
}

export interface DirectorTask {
  id: string;
  kind: DirectorTaskKind;
  status: DirectorTaskStatus;
  params: DirectorTaskParams;
  missing: FactKey[];
  refs: { campaignId?: string; projectId?: string; conceptId?: string; directionKey?: string };
  error?: string | null;
}

/** One campaign as the Director sees it (for references, history and status). */
export interface DirectorCampaignSummary {
  campaignId: string;
  projectId: string | null;
  title: string;
  product: string;
  goal: CampaignGoal;
  objective?: MarketingObjective;
  createdAt: string;
  hasVideo: boolean;
  scriptApproved: boolean;
  staticAds: number;
  directionApproved: boolean;
  renderStatus?: string | null;
}

export interface DirectorApprovalSummary {
  id: string;
  taskId: string;
  kind: DirectorApprovalKind;
  title: string;
  details: string[];
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED';
  payload: Record<string, unknown>;
  estimatedUsd: number;
  createdAt: string;
}

export const DirectorApprovalDecisionSchema =z.object({ decision: z.enum(['APPROVED', 'REJECTED']), note: z.string().trim().max(300).optional() });
export type DirectorApprovalDecision = z.infer<typeof DirectorApprovalDecisionSchema>;

export const FactDecisionRequestSchema = z.object({ key: FactKeySchema, decision: z.enum(['CONFIRM', 'REJECT']) });
export type FactDecisionRequest = z.infer<typeof FactDecisionRequestSchema>;
