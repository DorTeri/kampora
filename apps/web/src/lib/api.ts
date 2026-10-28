import type {
  BusinessProfile,
  CampaignBrief,
  CampaignStatus,
  CreativeConcept,
  NarrationState,
  ProductionPlan,
  ProjectStatus,
  Storyboard,
  VoiceOption,
} from '@kampora/shared';

/**
 * Server-side API client. Only imported from server components, server actions and route handlers:
 * the API token never reaches the browser.
 */
const API_URL = process.env.KAMPORA_API_URL ?? 'http://localhost:4000';
const API_TOKEN = process.env.KAMPORA_API_TOKEN ?? '';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  if (typeof window !== 'undefined') throw new Error('api() is server-only');
  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: 'no-store',
  });
  const json = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
  if (!res.ok)
    throw new ApiRequestError(res.status, json?.code ?? 'UNKNOWN', json?.message ?? res.statusText);
  return json as T;
}

// ── DTOs (mirror the API responses) ───────────────────────────────────

export interface BusinessSummary {
  id: string;
  name: string;
  category: string;
  city: string | null;
}

export interface BusinessDetail {
  id: string;
  profile: BusinessProfile;
  assets: Array<{
    id: string;
    kind: 'image' | 'video' | 'audio' | 'logo';
    description: string;
    tags: string[];
    mimeType: string;
    url: string;
    provenance: { source: string; license: string; commercialUse: boolean };
  }>;
}

export interface CampaignListItem {
  id: string;
  status: CampaignStatus;
  brief: CampaignBrief;
  createdAt: string;
  businessName: string;
  projectId: string | null;
  projectStatus: ProjectStatus | null;
}

export interface ConceptItem {
  id: string;
  batch: number;
  concept: CreativeConcept;
  isRecommended: boolean;
  recommendationReason: string | null;
  claimFlags: Array<{ phrase: string; source: string }>;
  selected: boolean;
}

export interface CampaignDetail {
  id: string;
  businessId: string;
  status: CampaignStatus;
  brief: CampaignBrief;
  concepts: ConceptItem[];
  project: { id: string; status: ProjectStatus } | null;
}

export interface RenderDto {
  id: string;
  projectId: string;
  timelineVersionId: string;
  quality: 'preview' | 'final';
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  stage: 'QUEUED' | 'PREPARING_ASSETS' | 'BUNDLING' | 'RENDERING' | 'UPLOADING' | 'DONE' | 'FAILED';
  progress: number;
  error: string | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  outputBytes: number | null;
  createdAt: string;
  finishedAt: string | null;
  streamUrl: string | null;
  downloadUrl: string | null;
  title?: string;
}

export interface ProjectDetail {
  id: string;
  title: string;
  status: ProjectStatus;
  budgetUsd: number;
  plan: ProductionPlan | null;
  brief: CampaignBrief;
  briefId: string;
  concept: CreativeConcept;
  storyboard: Storyboard;
  claimFlags: Array<{ phrase: string; source: string }>;
  scriptApprovedAt: string | null;
  narration: NarrationDto | null;
  currentTimelineVersionId: string | null;
  versions: Array<{ id: string; version: number; reason: string; createdAt: string }>;
  renders: RenderDto[];
}

export interface NarrationDto extends Omit<NarrationState, 'segments'> {
  stale: boolean;
  segments: Array<NarrationState['segments'][number] & { url: string | null }>;
}

export interface CreativeQuote {
  provider: string;
  model: string;
  paid: boolean;
  ready: boolean;
  reason?: string;
  expectedUsd: number;
  maxUsd: number;
}

export interface VoicesResponse {
  provider: 'elevenlabs' | 'mock' | 'supplied' | 'none';
  ready: boolean;
  reason?: string;
  paid: boolean;
  paidEnabled: boolean;
  voices: VoiceOption[];
}

export interface NarrationQuote {
  provider: string;
  ready: boolean;
  reason?: string;
  paid: boolean;
  paidEnabled: boolean;
  voice: VoiceOption;
  characters: number;
  estimatedUsd: number;
  estimatedSec: number;
  scriptCheck: {
    status: 'OK' | 'LONG' | 'TOO_LONG';
    message?: string;
    estimatedSec: number;
    targetSec: number;
  };
  lines: Array<{ sceneKey: string; original: string; spoken: string; estimatedSec: number }>;
  warnings: string[];
}

/** Display-only conversion for customer-facing ₪ amounts (internal costs stay in USD). */
export const USD_TO_ILS = Number(process.env.DISPLAY_USD_TO_ILS ?? 3.7);
