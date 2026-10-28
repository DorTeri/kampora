import { z } from 'zod';

/** Lifecycle of a video project through the Creative Studio. */
export const ProjectStatusSchema = z.enum([
  'STORYBOARD_READY',
  'PLAN_READY',
  'APPROVED',
  'RENDERING',
  'RENDERED',
  'FAILED',
]);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

const PROJECT_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  STORYBOARD_READY: ['PLAN_READY'],
  PLAN_READY: ['APPROVED', 'STORYBOARD_READY'],
  APPROVED: ['RENDERING', 'PLAN_READY'],
  RENDERING: ['RENDERED', 'FAILED'],
  RENDERED: ['RENDERING', 'PLAN_READY', 'APPROVED'],
  FAILED: ['RENDERING', 'PLAN_READY', 'APPROVED'],
};

export function canTransitionProject(from: ProjectStatus, to: ProjectStatus): boolean {
  return PROJECT_TRANSITIONS[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: string,
    readonly to: string,
  ) {
    super(`Invalid workflow transition ${from} → ${to}`);
  }
}

export function assertProjectTransition(from: ProjectStatus, to: ProjectStatus): void {
  if (!canTransitionProject(from, to)) throw new InvalidTransitionError(from, to);
}

export const CampaignStatusSchema = z.enum(['BRIEF_READY', 'CONCEPTS_READY', 'CONCEPT_SELECTED']);
export type CampaignStatus = z.infer<typeof CampaignStatusSchema>;

export const JobStatusSchema = z.enum(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const RenderStageSchema = z.enum([
  'QUEUED',
  'PREPARING_ASSETS',
  'BUNDLING',
  'RENDERING',
  'UPLOADING',
  'DONE',
  'FAILED',
]);
export type RenderStage = z.infer<typeof RenderStageSchema>;

export const RenderQualitySchema = z.enum(['preview', 'final']);
export type RenderQuality = z.infer<typeof RenderQualitySchema>;

export const RENDER_QUEUE_NAME = 'kampora-render';

/** BullMQ payload. Only an ID: the worker always reloads authoritative state from the database. */
export const RenderJobPayloadSchema = z.object({
  renderJobId: z.string().uuid(),
  orgId: z.string().uuid(),
});
export type RenderJobPayload = z.infer<typeof RenderJobPayloadSchema>;
