import type {
  DirectorApprovalSummary,
  DirectorCampaignSummary,
  DirectorCard,
  DirectorToolName,
  FactKey,
  FactSource,
  FactStatus,
  Recommendation,
  ToolCallRecord,
} from '@kampora/shared';

/** Client-safe shapes of the Campaign Director workspace (mirror GET /v1/director/conversations/:id). */

export interface DirectorMessageDto {
  id: string;
  role: 'OWNER' | 'DIRECTOR';
  text: string;
  cards: DirectorCard[];
  tools: ToolCallRecord[];
  createdAt: string;
}

export interface MemoryItem {
  key: FactKey;
  label: string;
  value: string;
  source: FactSource;
  status: FactStatus;
  state: 'MISSING' | 'PROPOSED' | 'REJECTED' | 'DECLINED' | 'EXPIRED' | 'STALE' | 'USABLE';
  updatedAt: string;
}

export type ApprovalItem = Omit<DirectorApprovalSummary, 'payload'>;

export interface DirectorWorkspaceDto {
  id: string;
  title: string;
  businessId: string | null;
  messages: DirectorMessageDto[];
  memory: MemoryItem[];
  pending: ApprovalItem[];
  decided: ApprovalItem[];
  status: { label: string; state: string; href?: string }[];
  work: DirectorCampaignSummary[];
  previews: { projectId: string; imageUrl: string | null; videoUrl: string | null }[];
  recommendations: Recommendation[];
  paidGenerationEnabled: boolean;
  /** Which brain reads the owner's messages: the deterministic Hebrew rules or the validated LLM. */
  brain?: 'rules' | 'llm';
}

export interface ConversationListItem {
  id: string;
  title: string;
  businessId: string | null;
  businessName: string | null;
  updatedAt: string;
}

export interface SendResult {
  owner: DirectorMessageDto;
  reply: DirectorMessageDto;
  replayed: boolean;
}

export interface DecisionResultDto {
  approvalId: string;
  status: DirectorApprovalSummary['status'];
  replayed: boolean;
  reply: DirectorMessageDto | null;
}

/** What the owner sees for each tool the Director used (never the tool's internals). */
export const TOOL_LABELS: Record<DirectorToolName, string> = {
  ReadBusinessProfile: 'קראתי את פרטי העסק',
  ProposeBusinessProfileUpdate: 'עדכנתי את זיכרון העסק',
  GetCampaignHistory: 'בדקתי קמפיינים קודמים',
  GetAvailableAssets: 'בדקתי אילו תמונות יש',
  CreateCreativeBrief: 'בניתי בריף קמפיין',
  ProposeCampaignStrategy: 'בניתי אסטרטגיה',
  GenerateCreativeConcepts: 'הכנתי רעיונות',
  RequestStoryboard: 'כתבתי תסריט',
  RequestArtDirection: 'הכנתי כיווני עיצוב',
  RequestProduction: 'שלחתי להפקה',
  GetProductionStatus: 'בדקתי סטטוס הפקה',
  PresentCreativeForApproval: 'הכנתי כרטיס לאישור שלך',
  RequestTargetedRevision: 'ביצעתי שינוי ממוקד',
};

export const FACT_STATE_LABELS: Record<MemoryItem['state'], { label: string; tone: 'success' | 'warn' | 'accent' | 'neutral' }> = {
  USABLE: { label: 'מאושר', tone: 'success' },
  PROPOSED: { label: 'מחכה לאישורך', tone: 'warn' },
  EXPIRED: { label: 'פג תוקף', tone: 'accent' },
  STALE: { label: 'לבדוק שוב', tone: 'warn' },
  DECLINED: { label: 'אין', tone: 'neutral' },
  REJECTED: { label: 'נדחה', tone: 'neutral' },
  MISSING: { label: 'חסר', tone: 'neutral' },
};

export const APPROVAL_KIND_LABELS: Record<ApprovalItem['kind'], string> = {
  SCRIPT: 'תסריט',
  CREATIVE_DIRECTION: 'עיצוב',
  PRODUCTION: 'הפקה',
  PAID_GENERATION: 'יצירה בתשלום',
  PUBLISH: 'פרסום',
  AD_BUDGET: 'תקציב מודעות',
};

/** Shortcuts the owner can tap; each is sent as an ordinary message. */
export const SUGGESTED_PROMPTS = ['מה נשאר לאישור?', 'איזה פרסומות כבר הכנו?', 'מה כדאי לעשות השבוע?', 'יש לנו מבצע', 'בוא נכין קמפיין'];

export const newClientMessageId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `m-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
