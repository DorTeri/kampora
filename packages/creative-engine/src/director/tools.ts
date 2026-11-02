import { z, type ZodType } from 'zod';
import {
  CampaignGoalSchema,
  DirectorApprovalKindSchema,
  DirectorCampaignPlanSchema,
  DIRECTOR_TOOLS,
  type BusinessFact,
  type DirectorApprovalKind,
  type DirectorApprovalSummary,
  type DirectorCampaignPlan,
  type DirectorCampaignSummary,
  type DirectorToolName,
  BusinessFactSchema,
} from '@kampora/shared';

/**
 * The Director's tools: typed contracts over the existing Studio services. The conversation layer (rules or an
 * LLM) only proposes; this policy validates every call and decides whether it may run. Approval-gated and paid
 * tools run only with an explicit, matching owner approval, never because a model asked.
 */

export type ToolEffect = 'READ' | 'FREE_WRITE' | 'APPROVAL_REQUIRED' | 'PAID';

const uuid = z.string().uuid();
const directionKey = z.enum(['A', 'B', 'C']);

export const TOOL_ARGS = {
  ReadBusinessProfile: z.object({}).strict(),
  ProposeBusinessProfileUpdate: z.object({ facts: z.array(BusinessFactSchema).min(1).max(20) }).strict(),
  GetCampaignHistory: z.object({ limit: z.number().int().min(1).max(20).optional() }).strict(),
  GetAvailableAssets: z.object({}).strict(),
  CreateCreativeBrief: z
    .object({
      goal: CampaignGoalSchema,
      productName: z.string().trim().min(1).max(120),
      offer: z.string().trim().max(200).optional(),
      notes: z.string().trim().max(1000).optional(),
      plan: DirectorCampaignPlanSchema,
      approvedUsd: z.number().positive().max(5).optional(),
    })
    .strict(),
  ProposeCampaignStrategy: z.object({ objective: z.string().max(40) }).strict(),
  GenerateCreativeConcepts: z.object({ campaignId: uuid }).strict(),
  RequestStoryboard: z.object({ campaignId: uuid, conceptId: uuid }).strict(),
  RequestArtDirection: z.object({ projectId: uuid }).strict(),
  RequestProduction: z.object({ projectId: uuid }).strict(),
  GetProductionStatus: z.object({ projectId: uuid.optional() }).strict(),
  PresentCreativeForApproval: z
    .object({
      taskId: uuid,
      kind: DirectorApprovalKindSchema,
      title: z.string().min(1).max(160),
      details: z.array(z.string().max(300)).max(12),
      payload: z.record(z.string(), z.unknown()),
      estimatedUsd: z.number().nonnegative().max(50),
    })
    .strict(),
  RequestTargetedRevision: z
    .object({
      projectId: uuid,
      target: z.enum(['VIDEO_OPENING', 'DIRECTION']),
      directionKey: directionKey.optional(),
      instruction: z.string().trim().min(2).max(500),
    })
    .strict(),
} satisfies Record<DirectorToolName, ZodType>;

export type ToolArgs<T extends DirectorToolName> = z.infer<(typeof TOOL_ARGS)[T]>;

interface ToolSpec {
  effect: (paidProvider: boolean) => ToolEffect;
  /** The approval kind that authorizes an approval-gated tool. */
  approval?: DirectorApprovalKind;
  label: string;
}

const free = () => 'FREE_WRITE' as const;
const read = () => 'READ' as const;
const creative = (paid: boolean): ToolEffect => (paid ? 'PAID' : 'FREE_WRITE');

export const TOOL_SPECS: Record<DirectorToolName, ToolSpec> = {
  ReadBusinessProfile: { effect: read, label: 'קריאת פרופיל העסק' },
  ProposeBusinessProfileUpdate: { effect: free, label: 'עדכון זיכרון העסק' },
  GetCampaignHistory: { effect: read, label: 'היסטוריית קמפיינים' },
  GetAvailableAssets: { effect: read, label: 'תמונות וחומרים זמינים' },
  CreateCreativeBrief: { effect: creative, approval: 'PAID_GENERATION', label: 'יצירת בריף קמפיין' },
  ProposeCampaignStrategy: { effect: read, label: 'אסטרטגיית קמפיין' },
  GenerateCreativeConcepts: { effect: creative, approval: 'PAID_GENERATION', label: 'רעיונות קריאייטיב' },
  RequestStoryboard: { effect: creative, approval: 'PAID_GENERATION', label: 'תסריט וסטוריבורד' },
  RequestArtDirection: { effect: () => 'APPROVAL_REQUIRED', approval: 'SCRIPT', label: 'כיווני עיצוב למודעות' },
  RequestProduction: { effect: () => 'APPROVAL_REQUIRED', approval: 'PRODUCTION', label: 'הפקת סרטון' },
  GetProductionStatus: { effect: read, label: 'סטטוס הפקה' },
  PresentCreativeForApproval: { effect: free, label: 'בקשת אישור' },
  RequestTargetedRevision: { effect: free, label: 'שינוי ממוקד' },
};

export interface ToolAuthContext {
  /** WORKFLOW: the engine's own deterministic step. BRAIN: a model's request. APPROVAL: running an approved action. */
  source: 'WORKFLOW' | 'BRAIN' | 'APPROVAL';
  paidProvider: boolean;
  /** The kill switch for paid generation (KAMPORA_ALLOW_PAID_GENERATION). */
  paidEnabled: boolean;
  approval?: Pick<DirectorApprovalSummary, 'id' | 'kind' | 'status' | 'payload'>;
}

export type Authorization<T extends DirectorToolName = DirectorToolName> =
  | { ok: true; tool: T; args: ToolArgs<T>; effect: ToolEffect }
  | { ok: false; tool: string; reason: string };

export function isDirectorTool(name: string): name is DirectorToolName {
  return (DIRECTOR_TOOLS as readonly string[]).includes(name);
}

export function authorizeTool<T extends DirectorToolName>(name: T | string, rawArgs: unknown, ctx: ToolAuthContext): Authorization<T> {
  if (!isDirectorTool(name)) return { ok: false, tool: name, reason: 'כלי לא מוכר' };
  const spec = TOOL_SPECS[name];
  const parsed = TOOL_ARGS[name].safeParse(rawArgs ?? {});
  if (!parsed.success) return { ok: false, tool: name, reason: 'פרמטרים לא תקינים' };
  const effect = spec.effect(ctx.paidProvider);
  // A model may look things up; anything that changes state goes through the deterministic workflow.
  if (ctx.source === 'BRAIN' && effect !== 'READ') return { ok: false, tool: name, reason: 'הצעה של המודל אינה הרשאה לפעולה' };
  if (effect === 'APPROVAL_REQUIRED' || effect === 'PAID') {
    if (effect === 'PAID' && !ctx.paidEnabled) return { ok: false, tool: name, reason: 'יצירה בתשלום כבויה' };
    const a = ctx.approval;
    if (!a || a.kind !== spec.approval || a.status !== 'APPROVED')
      return { ok: false, tool: name, reason: 'נדרש אישור מפורש של בעל העסק' };
    // The approval covers exactly what the owner saw.
    const args = parsed.data as Record<string, unknown>;
    for (const k of ['projectId', 'campaignId'] as const)
      if (args[k] !== undefined && a.payload[k] !== undefined && a.payload[k] !== args[k])
        return { ok: false, tool: name, reason: 'האישור ניתן לפריט אחר' };
  }
  return { ok: true, tool: name as T, args: parsed.data as ToolArgs<T>, effect };
}

// ── Results the executor returns ──────────────────────────────────────

export interface ConceptSummary {
  id: string;
  title: string;
  hook: string;
  recommended: boolean;
}

export interface DirectionSummary {
  key: 'A' | 'B' | 'C';
  name: string;
  method: string;
  headline: string;
  /** The full direction (opaque to the engine), stored in the approval so the approved design is the one shown. */
  direction: unknown;
}

export interface AssetSummary {
  photos: number;
  verified: number;
  demonstration: number;
}

export interface StatusItem {
  label: string;
  state: string;
  href?: string;
}

export interface RevisionResult {
  applied: boolean;
  summary: string;
  before?: string;
  after?: string;
  suggestions?: string[];
  direction?: DirectionSummary;
}

/** Thrown by executors with a message safe to show the owner (no internals). */
export class DirectorToolError extends Error {
  constructor(
    readonly userMessage: string,
    readonly code: string,
  ) {
    super(userMessage);
  }
}

/** Implemented by the API over the Studio services (and by the in-browser demo over a local store). */
export interface DirectorToolExecutor {
  ReadBusinessProfile(): Promise<{ facts: BusinessFact[] }>;
  ProposeBusinessProfileUpdate(args: ToolArgs<'ProposeBusinessProfileUpdate'>): Promise<{ saved: number }>;
  GetCampaignHistory(args: ToolArgs<'GetCampaignHistory'>): Promise<DirectorCampaignSummary[]>;
  GetAvailableAssets(): Promise<AssetSummary>;
  CreateCreativeBrief(args: ToolArgs<'CreateCreativeBrief'>): Promise<{ campaignId: string; concepts: ConceptSummary[] }>;
  GenerateCreativeConcepts(args: ToolArgs<'GenerateCreativeConcepts'>): Promise<{ concepts: ConceptSummary[] }>;
  RequestStoryboard(args: ToolArgs<'RequestStoryboard'>): Promise<{ projectId: string; title: string; script: string[] }>;
  RequestArtDirection(args: ToolArgs<'RequestArtDirection'>): Promise<{ directions: DirectionSummary[] }>;
  RequestProduction(args: ToolArgs<'RequestProduction'>): Promise<{ status: string; detail: string }>;
  GetProductionStatus(args: ToolArgs<'GetProductionStatus'>): Promise<StatusItem[]>;
  PresentCreativeForApproval(args: ToolArgs<'PresentCreativeForApproval'>): Promise<{ approvalId: string }>;
  RequestTargetedRevision(args: ToolArgs<'RequestTargetedRevision'>): Promise<RevisionResult>;
}

/** Actions that run only when the owner approves (the approvals endpoint), never from the conversation. */
export interface DirectorApprovalActions {
  approveScript(projectId: string): Promise<void>;
  approveDirection(projectId: string, key: 'A' | 'B' | 'C', direction: unknown): Promise<{ formats: string[] }>;
}

export type { DirectorCampaignPlan };
