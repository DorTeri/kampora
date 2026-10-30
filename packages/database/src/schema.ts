import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  AssetProvenance,
  BrandColors,
  ArtDirectionPlan,
  CampaignBrief,
  CreativeConcept,
  CreativeFeedbackInput,
  ProfessionalCreativeBrief,
  ReviewHistory,
  NarrationState,
  PlannedGeneration,
  ProductionPlan,
  ScenePlan,
  StaticAd,
  StaticAdFormat,
  Storyboard,
  StoryboardScene,
  VideoProject,
  VisualScenePlan,
} from '@kampora/shared';

/**
 * Tenant isolation: every tenant-owned table carries org_id, and repositories always filter by it.
 * Money is stored as integer micro-USD. Specs that evolve with the product are typed jsonb validated by Zod.
 */

const id = () => uuid('id').primaryKey().defaultRandom();
const orgId = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const memberRole = pgEnum('member_role', ['OWNER', 'ADMIN', 'MEMBER']);
export const assetKind = pgEnum('asset_kind', ['image', 'video', 'audio', 'logo']);
export const campaignStatus = pgEnum('campaign_status', [
  'BRIEF_READY',
  'CONCEPTS_READY',
  'CONCEPT_SELECTED',
]);
export const projectStatus = pgEnum('project_status', [
  'STORYBOARD_READY',
  'PLAN_READY',
  'APPROVED',
  'RENDERING',
  'RENDERED',
  'FAILED',
]);
export const jobStatus = pgEnum('job_status', ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']);
export const renderStage = pgEnum('render_stage', [
  'QUEUED',
  'PREPARING_ASSETS',
  'BUNDLING',
  'RENDERING',
  'UPLOADING',
  'DONE',
  'FAILED',
]);
export const renderQuality = pgEnum('render_quality', ['preview', 'final']);
export const chargeType = pgEnum('charge_type', ['SIMULATED', 'ESTIMATED', 'CONFIRMED']);
export const operationType = pgEnum('operation_type', [
  'LLM_COMPLETION',
  'IMAGE_GENERATION',
  'IMAGE_TO_VIDEO',
  'TEXT_TO_VIDEO',
  'TTS',
  'RENDER',
  'STORAGE',
]);
export const approvalSubject = pgEnum('approval_subject', [
  'STORYBOARD',
  'PRODUCTION_PLAN',
  'FINAL_VIDEO',
  'CREATIVE_GENERATION',
  'NARRATION',
  'VOICE_TEST',
  'SCENE_IMAGE',
]);
export const approvalDecision = pgEnum('approval_decision', ['APPROVED', 'REJECTED']);
export const sceneImageDecision = pgEnum('scene_image_decision', ['PENDING', 'APPROVED', 'REJECTED']);

// ── Identity & tenancy ────────────────────────────────────────────────

export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  'memberships',
  {
    orgId: orgId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull().default('MEMBER'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.userId] })],
);

// ── Business & brand ──────────────────────────────────────────────────

export const businesses = pgTable(
  'businesses',
  {
    id: id(),
    orgId: orgId(),
    name: text('name').notNull(),
    website: text('website'),
    category: text('category').notNull(),
    city: text('city'),
    address: text('address'),
    description: text('description').notNull(),
    products: jsonb('products')
      .$type<{ name: string; description: string; price?: { amount: number; currency: 'ILS' | 'USD' } }[]>()
      .notNull(),
    targetAudience: text('target_audience').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('businesses_org_idx').on(t.orgId)],
);

export const brandProfiles = pgTable('brand_profiles', {
  id: id(),
  orgId: orgId(),
  businessId: uuid('business_id')
    .notNull()
    .unique()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  tone: text('tone').notNull(),
  colors: jsonb('colors').$type<BrandColors>().notNull(),
  logoAssetId: uuid('logo_asset_id'),
  approvedClaims: jsonb('approved_claims').$type<string[]>().notNull().default([]),
  guidelines: jsonb('guidelines').$type<string[]>().notNull().default([]),
  /** Provenance of each profile field (USER / INFERRED_UNCONFIRMED / ...). */
  fieldSources: jsonb('field_sources').$type<Record<string, string>>().notNull().default({}),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  updatedAt: updatedAt(),
});

export const brandAssets = pgTable(
  'brand_assets',
  {
    id: id(),
    orgId: orgId(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    kind: assetKind('kind').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    mimeType: text('mime_type').notNull(),
    bytes: integer('bytes').notNull(),
    sha256: text('sha256').notNull(),
    width: integer('width'),
    height: integer('height'),
    durationSec: real('duration_sec'),
    description: text('description').notNull().default(''),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    provenance: jsonb('provenance').$type<AssetProvenance>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('brand_assets_business_idx').on(t.businessId)],
);

export const pronunciationEntries = pgTable(
  'pronunciation_entries',
  {
    id: id(),
    orgId: orgId(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    term: text('term').notNull(),
    spoken: text('spoken').notNull(),
    caseSensitive: boolean('case_sensitive').notNull().default(false),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('pronunciation_business_term_uq').on(t.businessId, t.term)],
);

export const voiceProfiles = pgTable('voice_profiles', {
  id: id(),
  orgId: orgId(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  voiceId: text('voice_id').notNull(),
  label: text('label').notNull(),
  defaultDelivery: text('default_delivery').notNull().default('conversational'),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

// ── Campaigns & creative ──────────────────────────────────────────────

export const campaignBriefs = pgTable(
  'campaign_briefs',
  {
    id: id(),
    orgId: orgId(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    status: campaignStatus('status').notNull().default('BRIEF_READY'),
    brief: jsonb('brief').$type<CampaignBrief>().notNull(),
    /** Snapshot of the professional brief the concepts were written from (null: campaigns before it existed). */
    professionalBrief: jsonb('professional_brief').$type<ProfessionalCreativeBrief>(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('campaign_briefs_business_idx').on(t.businessId)],
);

export const creativeConcepts = pgTable(
  'creative_concepts',
  {
    id: id(),
    orgId: orgId(),
    briefId: uuid('brief_id')
      .notNull()
      .references(() => campaignBriefs.id, { onDelete: 'cascade' }),
    /** Generation batch: "request alternatives" creates a new batch, old ones stay for history. */
    batch: integer('batch').notNull().default(1),
    key: text('key').notNull(),
    concept: jsonb('concept').$type<CreativeConcept>().notNull(),
    isRecommended: boolean('is_recommended').notNull().default(false),
    recommendationReason: text('recommendation_reason'),
    claimFlags: jsonb('claim_flags').$type<{ phrase: string; source: string }[]>().notNull().default([]),
    selectedAt: timestamp('selected_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('creative_concepts_brief_batch_key_uq').on(t.briefId, t.batch, t.key)],
);

export const storyboards = pgTable(
  'storyboards',
  {
    id: id(),
    orgId: orgId(),
    briefId: uuid('brief_id')
      .notNull()
      .references(() => campaignBriefs.id, { onDelete: 'cascade' }),
    conceptId: uuid('concept_id')
      .notNull()
      .references(() => creativeConcepts.id),
    version: integer('version').notNull().default(1),
    storyboard: jsonb('storyboard').$type<Storyboard>().notNull(),
    claimFlags: jsonb('claim_flags').$type<{ phrase: string; source: string }[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('storyboards_concept_version_uq').on(t.conceptId, t.version)],
);

// ── Production ────────────────────────────────────────────────────────

export const videoProjects = pgTable(
  'video_projects',
  {
    id: id(),
    orgId: orgId(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    briefId: uuid('brief_id')
      .notNull()
      .references(() => campaignBriefs.id, { onDelete: 'cascade' }),
    storyboardId: uuid('storyboard_id')
      .notNull()
      .references(() => storyboards.id),
    title: text('title').notNull(),
    status: projectStatus('status').notNull().default('STORYBOARD_READY'),
    plan: jsonb('plan').$type<ProductionPlan>(),
    budgetMicroUsd: bigint('budget_micro_usd', { mode: 'number' }).notNull(),
    currentTimelineVersionId: uuid('current_timeline_version_id'),
    /** The customer approved the script (voiceover lines) of the current storyboard. */
    scriptApprovedAt: timestamp('script_approved_at', { withTimezone: true }),
    /** Active narration (voice, generated segments, timing). */
    narration: jsonb('narration').$type<NarrationState>(),
    /** The Art Director's plan (layout family, hierarchy, photography, motion); null until first needed. */
    artDirection: jsonb('art_direction').$type<ArtDirectionPlan>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('video_projects_org_idx').on(t.orgId),
    uniqueIndex('video_projects_storyboard_uq').on(t.storyboardId),
  ],
);

export const scenes = pgTable(
  'scenes',
  {
    id: id(),
    orgId: orgId(),
    videoProjectId: uuid('video_project_id')
      .notNull()
      .references(() => videoProjects.id, { onDelete: 'cascade' }),
    sceneKey: text('scene_key').notNull(),
    order: integer('order').notNull(),
    spec: jsonb('spec').$type<StoryboardScene>().notNull(),
    plan: jsonb('plan').$type<ScenePlan>(),
    /** Changes only when the scene spec changes → drives selective regeneration. */
    contentHash: text('content_hash').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('scenes_project_key_uq').on(t.videoProjectId, t.sceneKey)],
);

export const timelineVersions = pgTable(
  'timeline_versions',
  {
    id: id(),
    orgId: orgId(),
    videoProjectId: uuid('video_project_id')
      .notNull()
      .references(() => videoProjects.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    project: jsonb('project').$type<VideoProject>().notNull(),
    reason: text('reason').notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('timeline_versions_project_version_uq').on(t.videoProjectId, t.version)],
);

export const generatedAssets = pgTable(
  'generated_assets',
  {
    id: id(),
    orgId: orgId(),
    videoProjectId: uuid('video_project_id').references(() => videoProjects.id, { onDelete: 'set null' }),
    sceneId: uuid('scene_id').references(() => scenes.id, { onDelete: 'set null' }),
    kind: assetKind('kind').notNull(),
    storageKey: text('storage_key').notNull().unique(),
    mimeType: text('mime_type').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    /** Same provider+model+operation+input ⇒ same key ⇒ reuse. */
    idempotencyKey: text('idempotency_key').notNull(),
    provenance: jsonb('provenance').$type<AssetProvenance>().notNull(),
    accepted: boolean('accepted'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('generated_assets_project_idx').on(t.videoProjectId),
    // Cache keys are per tenant: identical requests in different orgs never share or collide.
    uniqueIndex('generated_assets_org_idempotency_uq').on(t.orgId, t.idempotencyKey),
  ],
);

export const generationJobs = pgTable(
  'generation_jobs',
  {
    id: id(),
    orgId: orgId(),
    videoProjectId: uuid('video_project_id')
      .notNull()
      .references(() => videoProjects.id, { onDelete: 'cascade' }),
    sceneId: uuid('scene_id').references(() => scenes.id, { onDelete: 'set null' }),
    operation: operationType('operation').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    status: jobStatus('status').notNull().default('QUEUED'),
    idempotencyKey: text('idempotency_key').notNull(),
    input: jsonb('input').$type<PlannedGeneration & Record<string, unknown>>().notNull(),
    attempt: integer('attempt').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull(),
    estimatedMicroUsd: bigint('estimated_micro_usd', { mode: 'number' }).notNull(),
    actualMicroUsd: bigint('actual_micro_usd', { mode: 'number' }),
    externalJobId: text('external_job_id'),
    resultAssetId: uuid('result_asset_id').references(() => generatedAssets.id),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('generation_jobs_project_idx').on(t.videoProjectId),
    uniqueIndex('generation_jobs_org_idempotency_uq').on(t.orgId, t.idempotencyKey),
  ],
);

export const renderJobs = pgTable(
  'render_jobs',
  {
    id: id(),
    orgId: orgId(),
    videoProjectId: uuid('video_project_id')
      .notNull()
      .references(() => videoProjects.id, { onDelete: 'cascade' }),
    timelineVersionId: uuid('timeline_version_id')
      .notNull()
      .references(() => timelineVersions.id),
    quality: renderQuality('quality').notNull(),
    status: jobStatus('status').notNull().default('QUEUED'),
    stage: renderStage('stage').notNull().default('QUEUED'),
    progress: real('progress').notNull().default(0),
    attempts: integer('attempts').notNull().default(0),
    /** One render per timeline version + quality: re-requests return the existing job. */
    idempotencyKey: text('idempotency_key').notNull().unique(),
    outputKey: text('output_key'),
    outputBytes: integer('output_bytes'),
    width: integer('width'),
    height: integer('height'),
    durationSec: real('duration_sec'),
    error: text('error'),
    requestedBy: uuid('requested_by').references(() => users.id),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('render_jobs_project_idx').on(t.videoProjectId)],
);

// ── Governance ────────────────────────────────────────────────────────

export const approvals = pgTable('approvals', {
  id: id(),
  orgId: orgId(),
  /** Project-level approvals (plan, narration). Null for campaign-level ones (AI creative generation). */
  videoProjectId: uuid('video_project_id').references(() => videoProjects.id, { onDelete: 'cascade' }),
  campaignBriefId: uuid('campaign_brief_id').references(() => campaignBriefs.id, { onDelete: 'cascade' }),
  subject: approvalSubject('subject').notNull(),
  subjectRef: text('subject_ref').notNull(),
  decision: approvalDecision('decision').notNull(),
  /** The estimate the customer saw when approving: paid work above it needs a new approval. */
  approvedEstimateMicroUsd: bigint('approved_estimate_micro_usd', { mode: 'number' }).notNull(),
  decidedBy: uuid('decided_by')
    .notNull()
    .references(() => users.id),
  note: text('note'),
  createdAt: createdAt(),
});

export const revisions = pgTable('revisions', {
  id: id(),
  orgId: orgId(),
  videoProjectId: uuid('video_project_id')
    .notNull()
    .references(() => videoProjects.id, { onDelete: 'cascade' }),
  requestText: text('request_text').notNull(),
  fromVersion: integer('from_version').notNull(),
  toVersion: integer('to_version'),
  affectedScenes: jsonb('affected_scenes').$type<{ key: string; layers: string[] }[]>().notNull().default([]),
  status: text('status').notNull().default('REQUESTED'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: createdAt(),
});

export const usageEvents = pgTable(
  'usage_events',
  {
    id: id(),
    orgId: orgId(),
    videoProjectId: uuid('video_project_id').references(() => videoProjects.id, { onDelete: 'set null' }),
    operation: operationType('operation').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    quantity: real('quantity').notNull(),
    unit: text('unit').notNull(),
    step: text('step'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('usage_events_org_idx').on(t.orgId, t.createdAt)],
);

export const costLedger = pgTable(
  'cost_ledger',
  {
    id: id(),
    orgId: orgId(),
    videoProjectId: uuid('video_project_id').references(() => videoProjects.id, { onDelete: 'set null' }),
    /** Creative steps run before a project exists; they are attributed to the campaign brief. */
    campaignBriefId: uuid('campaign_brief_id').references(() => campaignBriefs.id, { onDelete: 'set null' }),
    usageEventId: uuid('usage_event_id').references(() => usageEvents.id, { onDelete: 'set null' }),
    operation: operationType('operation').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    chargeType: chargeType('charge_type').notNull(),
    amountMicroUsd: bigint('amount_micro_usd', { mode: 'number' }).notNull(),
    attempt: integer('attempt').notNull().default(1),
    success: boolean('success').notNull(),
    reused: boolean('reused').notNull().default(false),
    accepted: boolean('accepted'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    index('cost_ledger_project_idx').on(t.videoProjectId),
    index('cost_ledger_org_idx').on(t.orgId, t.createdAt),
  ],
);

/**
 * Voice lab: one row per (candidate voice configuration × style) reading of the fixed lab script, with the
 * listening ratings people gave it. Org-scoped; not tied to a project.
 */
export const voiceLabSamples = pgTable(
  'voice_lab_samples',
  {
    id: id(),
    orgId: orgId(),
    candidateId: text('candidate_id').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    voiceId: text('voice_id').notNull(),
    style: text('style').notNull(),
    scriptHash: text('script_hash').notNull(),
    spokenText: text('spoken_text').notNull(),
    status: jobStatus('status').notNull().default('QUEUED'),
    error: text('error'),
    assetId: uuid('asset_id').references(() => generatedAssets.id, { onDelete: 'set null' }),
    durationSec: real('duration_sec'),
    characters: integer('characters').notNull(),
    estimatedMicroUsd: bigint('estimated_micro_usd', { mode: 'number' }).notNull(),
    chargeType: chargeType('charge_type'),
    cached: boolean('cached').notNull().default(false),
    /** criterion id → 1..5, filled by people after listening. */
    ratings: jsonb('ratings').$type<Record<string, number>>().notNull().default({}),
    notes: text('notes'),
    ratedBy: uuid('rated_by').references(() => users.id),
    ratedAt: timestamp('rated_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('voice_lab_samples_org_idx').on(t.orgId, t.createdAt)],
);

/**
 * Versioned AI image per storyboard scene. Each generate/regenerate adds a version; the owner approves one, which
 * then feeds the production plan. The plan (prompt, refs, style) is stored so any version can be reproduced.
 */
export const sceneImages = pgTable(
  'scene_images',
  {
    id: id(),
    orgId: orgId(),
    videoProjectId: uuid('video_project_id')
      .notNull()
      .references(() => videoProjects.id, { onDelete: 'cascade' }),
    sceneKey: text('scene_key').notNull(),
    version: integer('version').notNull(),
    plan: jsonb('plan').$type<VisualScenePlan>().notNull(),
    fingerprint: text('fingerprint').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    status: jobStatus('status').notNull().default('QUEUED'),
    error: text('error'),
    assetId: uuid('asset_id').references(() => generatedAssets.id, { onDelete: 'set null' }),
    estimatedMicroUsd: bigint('estimated_micro_usd', { mode: 'number' }).notNull(),
    chargeType: chargeType('charge_type'),
    cached: boolean('cached').notNull().default(false),
    decision: sceneImageDecision('decision').notNull().default('PENDING'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('scene_images_project_idx').on(t.videoProjectId, t.sceneKey),
    uniqueIndex('scene_images_version_uq').on(t.videoProjectId, t.sceneKey, t.version),
  ],
);

/**
 * Static image ad per project and format. Every build or edit is a new version holding the full editable StaticAd
 * document; rendering writes a PNG and a JPEG. The fingerprint lets an identical document reuse its render.
 */
export const staticAds = pgTable(
  'static_ads',
  {
    id: id(),
    orgId: orgId(),
    videoProjectId: uuid('video_project_id')
      .notNull()
      .references(() => videoProjects.id, { onDelete: 'cascade' }),
    format: text('format').$type<StaticAdFormat>().notNull(),
    version: integer('version').notNull(),
    ad: jsonb('ad').$type<StaticAd>().notNull(),
    fingerprint: text('fingerprint').notNull(),
    status: jobStatus('status').notNull().default('QUEUED'),
    error: text('error'),
    pngKey: text('png_key'),
    jpegKey: text('jpeg_key'),
    pngBytes: integer('png_bytes'),
    jpegBytes: integer('jpeg_bytes'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('static_ads_project_idx').on(t.videoProjectId, t.format),
    uniqueIndex('static_ads_version_uq').on(t.videoProjectId, t.format, t.version),
  ],
);

/**
 * Creative Critic results: one row per reviewed piece of work, with every critique-and-revision round. Kept
 * for quality metrics and for comparing expertise versions.
 */
export const creativeReviews = pgTable(
  'creative_reviews',
  {
    id: id(),
    orgId: orgId(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    videoProjectId: uuid('video_project_id').references(() => videoProjects.id, { onDelete: 'cascade' }),
    campaignBriefId: uuid('campaign_brief_id').references(() => campaignBriefs.id, { onDelete: 'cascade' }),
    subjectType: text('subject_type').notNull(),
    subjectRef: text('subject_ref').notNull(),
    rubricVersion: text('rubric_version').notNull(),
    expertiseVersion: text('expertise_version').notNull(),
    verdict: text('verdict').notNull(),
    rounds: integer('rounds').notNull(),
    history: jsonb('history').$type<ReviewHistory>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('creative_reviews_business_idx').on(t.orgId, t.businessId, t.createdAt),
    index('creative_reviews_subject_idx').on(t.subjectType, t.subjectRef),
  ],
);

/**
 * Owner feedback on creative work (accept / reject / revise, with reasons): the learning signal. Scoped to one
 * organization and business; never used to personalise another customer's work.
 */
export const creativeFeedback = pgTable(
  'creative_feedback',
  {
    id: id(),
    orgId: orgId(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    subjectType: text('subject_type').$type<CreativeFeedbackInput['subjectType']>().notNull(),
    subjectRef: text('subject_ref').notNull(),
    decision: text('decision').$type<CreativeFeedbackInput['decision']>().notNull(),
    reasons: jsonb('reasons').$type<CreativeFeedbackInput['reasons']>().notNull().default([]),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('creative_feedback_business_idx').on(t.orgId, t.businessId, t.createdAt)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    orgId: orgId(),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    action: text('action').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [index('audit_log_org_idx').on(t.orgId, t.createdAt)],
);
