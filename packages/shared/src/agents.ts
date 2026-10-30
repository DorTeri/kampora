import { z } from 'zod';
import { InfoProvenanceSchema, MissingInfoQuestionSchema } from './professional-brief';

/**
 * The professional roles the (future) Campaign Director coordinates. Not every role is an LLM: a role is a
 * reasoning agent only where judgement adds value; the rest are deterministic services or provider adapters.
 */
export const AgentRoleSchema = z.enum([
  'CAMPAIGN_DIRECTOR',
  'BUSINESS_INTELLIGENCE',
  'CREATIVE_STRATEGIST',
  'COPYWRITER',
  'ART_DIRECTOR',
  'VISUAL_PRODUCTION',
  'VOICE_DIRECTION',
  'VIDEO_PRODUCTION',
  'CREATIVE_CRITIC',
]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export interface AgentRoleContract {
  kind: 'REASONING_AGENT' | 'DETERMINISTIC_SERVICE' | 'PROVIDER_ADAPTER';
  /** NONE: rules only. OPTIONAL: deterministic core with an optional model pass. REQUIRED: a model call. */
  llm: 'NONE' | 'OPTIONAL' | 'REQUIRED';
  status: 'ACTIVE' | 'PLANNED';
  /** Typed contracts it reads and writes (schema names in @kampora/shared). */
  input: string[];
  output: string[];
  /** Where it lives. */
  implementation: string;
  /** Spends money (always behind a quote and an approval). */
  paid: boolean;
}

/** The orchestration contract: who does what, with which typed input and output. */
export const AGENT_ROLES: Record<AgentRole, AgentRoleContract> = {
  CAMPAIGN_DIRECTOR: {
    kind: 'REASONING_AGENT',
    llm: 'REQUIRED',
    status: 'PLANNED',
    input: ['DirectorReport', 'ProfessionalCreativeBrief'],
    output: ['next action (tool call)', 'Hebrew message to the owner'],
    implementation:
      'not built (docs/CAMPAIGN_DIRECTOR_ROADMAP.md); directorReport() is its state input today',
    paid: true,
  },
  BUSINESS_INTELLIGENCE: {
    kind: 'DETERMINISTIC_SERVICE',
    llm: 'NONE',
    status: 'ACTIVE',
    input: ['BusinessProfile', 'CampaignRequest', 'AvailableAsset[]', 'IndustryProfile'],
    output: ['ProfessionalCreativeBrief', 'MissingInfoQuestion[]'],
    implementation: '@kampora/creative-engine buildProfessionalBrief',
    paid: false,
  },
  CREATIVE_STRATEGIST: {
    kind: 'REASONING_AGENT',
    llm: 'REQUIRED',
    status: 'ACTIVE',
    input: ['ProfessionalCreativeBrief'],
    output: ['ConceptStrategy (per concept)'],
    implementation:
      '@kampora/creative-engine generateConcepts (same call as the Copywriter, to save a model call)',
    paid: true,
  },
  COPYWRITER: {
    kind: 'REASONING_AGENT',
    llm: 'REQUIRED',
    status: 'ACTIVE',
    input: ['ProfessionalCreativeBrief', 'copywriting playbook', 'industry profile', 'references'],
    output: ['ConceptSet', 'CopywritingProposal'],
    implementation: '@kampora/creative-engine generateConcepts',
    paid: true,
  },
  ART_DIRECTOR: {
    kind: 'REASONING_AGENT',
    llm: 'NONE',
    status: 'ACTIVE',
    input: [
      'ProfessionalCreativeBrief',
      'CreativeConcept',
      'BackgroundCandidate[]',
      'art-direction playbook',
    ],
    output: ['ArtDirectionPlan'],
    implementation: '@kampora/creative-engine directArt (explicit decision rules; no model call)',
    paid: false,
  },
  VISUAL_PRODUCTION: {
    kind: 'PROVIDER_ADAPTER',
    llm: 'NONE',
    status: 'ACTIVE',
    input: ['StoryboardScene', 'ArtDirectionPlan'],
    output: ['VisualScenePlan', 'scene image (paid, approved per quote)'],
    implementation: '@kampora/production-engine planSceneVisual + @kampora/media-providers images',
    paid: true,
  },
  VOICE_DIRECTION: {
    kind: 'DETERMINISTIC_SERVICE',
    llm: 'NONE',
    status: 'ACTIVE',
    input: ['Storyboard', 'ConceptStrategy.voiceStyle'],
    output: ['NarrationPlan', 'narration (paid, approved per quote)'],
    implementation: '@kampora/hebrew-voice voice-director',
    paid: true,
  },
  VIDEO_PRODUCTION: {
    kind: 'DETERMINISTIC_SERVICE',
    llm: 'NONE',
    status: 'ACTIVE',
    input: ['Storyboard', 'ProductionPlan', 'ArtDirectionPlan.motion'],
    output: ['VideoProject (timeline)', 'render'],
    implementation: '@kampora/production-engine planProduction / buildVideoProject + Remotion',
    paid: false,
  },
  CREATIVE_CRITIC: {
    kind: 'REASONING_AGENT',
    llm: 'OPTIONAL',
    status: 'ACTIVE',
    input: ['ConceptSet | StaticAd + ArtDirectionPlan | VideoProject', 'evaluation rubric'],
    output: ['CritiqueReport', 'RevisionRequest[]'],
    implementation: '@kampora/creative-engine critique* (deterministic rubric; optional model opinion pass)',
    paid: false,
  },
};

/** What a project has done and what it waits for, as the future Campaign Director reads it. */
export const WorkflowStageSchema = z.enum([
  'BRIEF',
  'CONCEPTS',
  'STORYBOARD',
  'IMAGES',
  'NARRATION',
  'TIMELINE',
  'STATIC_ADS',
  'RENDER',
  'DONE',
]);
export type WorkflowStage = z.infer<typeof WorkflowStageSchema>;

/**
 * The structured report the Campaign Director will act on: what is known (and how), what is missing, the one
 * proposed next action and why, and whether it needs the owner's approval. Deterministic; no model involved.
 */
export const DirectorReportSchema = z.object({
  knownContext: z.array(z.object({ label: z.string(), value: z.string(), provenance: InfoProvenanceSchema })),
  missing: z.array(MissingInfoQuestionSchema),
  nextAction: z.object({
    action: z.enum([
      'ANSWER_QUESTIONS',
      'CHOOSE_CONCEPT',
      'APPROVE_SCRIPT',
      'GENERATE_IMAGES',
      'APPROVE_PLAN',
      'BUILD_STATIC_ADS',
      'REVIEW_QUALITY',
      'RENDER_PREVIEW',
      'DONE',
    ]),
    reason: z.string(),
    requiresApproval: z.boolean(),
    /** Paid next steps carry their quote; the owner approves that amount, never more. */
    estimatedUsd: z.number().nonnegative().optional(),
  }),
  workflow: z.object({
    stage: WorkflowStageSchema,
    completed: z.array(WorkflowStageSchema),
    pending: z.array(WorkflowStageSchema),
  }),
});
export type DirectorReport = z.infer<typeof DirectorReportSchema>;
