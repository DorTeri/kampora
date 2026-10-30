import type {
  BusinessProfile,
  CampaignBrief,
  CampaignStatus,
  CreativeConcept,
  NarrationState,
  ProfessionalCreativeBrief,
  ProductionPlan,
  ProjectStatus,
  StaticAdFormat,
  StaticAdText,
  Storyboard,
  VoiceOption,
  VoiceStyle,
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
  /** What is known (and how), and the questions still open. */
  professionalBrief: ProfessionalCreativeBrief;
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
  /** Approved scene images, as part of the timeline approval key. */
  imagesKey?: string;
  versions: Array<{ id: string; version: number; reason: string; createdAt: string }>;
  renders: RenderDto[];
}

export interface NarrationDto extends Omit<NarrationState, 'segments'> {
  stale: boolean;
  /** The single continuous recording (continuous mode only). */
  masterUrl?: string | null;
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
  /** Delivery styles (Hebrew labels; no provider names). */
  styles: Array<{ id: VoiceStyle; label: string; description: string }>;
}

export interface NarrationQuote {
  mode: 'continuous' | 'per-scene';
  style: VoiceStyle;
  sceneKey?: string;
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

export interface VoiceLabQuote {
  candidateId: string;
  style: VoiceStyle;
  spoken: string;
  characters: number;
  estimatedUsd: number;
  estimatedSec: number;
  paid: boolean;
}

export interface VoiceLabSample {
  id: string;
  candidateId: string;
  provider: string;
  model: string;
  voiceId: string;
  style: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  error: string | null;
  durationSec: number | null;
  characters: number;
  estimatedUsd: number;
  chargeType: string | null;
  cached: boolean;
  current: boolean;
  ratings: Record<string, number>;
  notes: string | null;
  ratedAt: string | null;
  createdAt: string;
  url: string | null;
}

export interface SceneImageQuoteDto {
  sceneKey: string;
  eligible: boolean;
  estimatedUsd: number;
  paid: boolean;
  referenceCount: number;
  nextVersion: number;
  /** Quote for real subject motion (image-to-video); generation is not available yet. */
  motion: { durationSec: number; estimatedUsd: number; available: boolean } | null;
  /** What the next version must contain, and contradictions the planner resolved. */
  composition: { type: string; subjects: Array<{ name: string; quantity?: number }> } | null;
  conflicts: Array<{ code: string; detail: string; resolution: string }>;
}

export interface SceneImageDto {
  id: string;
  sceneKey: string;
  version: number;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  error: string | null;
  decision: 'PENDING' | 'APPROVED' | 'REJECTED';
  style: string;
  /** REFERENCE_GUIDED_AI or SYNTHETIC_AI: an AI image is never a photo of the real business. */
  authenticity: string;
  estimatedUsd: number;
  chargeType: 'SIMULATED' | 'ESTIMATED' | 'CONFIRMED' | null;
  cached: boolean;
  createdAt: string;
  url: string | null;
}

export interface SceneImagesResponse {
  provider: 'mock' | 'openai' | 'none';
  ready: boolean;
  paid: boolean;
  paidEnabled: boolean;
  maxVersions: number;
  scenes: SceneImageQuoteDto[];
  images: SceneImageDto[];
}

/** Internal voice comparison page (shows providers and models on purpose). */
export interface VoiceLabOverview {
  provider: string;
  ready: boolean;
  paidEnabled: boolean;
  labMaxUsd: number;
  spentUsd: number;
  script: string[];
  criteria: ReadonlyArray<{ id: string; label: string }>;
  styles: Array<{ id: VoiceStyle; label: string }>;
  candidates: Array<{
    id: string;
    group: 'A' | 'B' | 'C';
    title: string;
    provider: string;
    model: string;
    voiceId: string;
    gender: string | null;
    quote: VoiceLabQuote;
  }>;
  samples: VoiceLabSample[];
}

export interface StaticAdDto {
  id: string;
  format: StaticAdFormat;
  version: number;
  versions: number;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  error: string | null;
  width: number;
  height: number;
  text: StaticAdText;
  backgroundAssetId: string | null;
  /** Why the background is what it is (absent on ads built before backgrounds were ranked). */
  backgroundSelection: {
    chosenBy: 'AUTO' | 'OWNER';
    authenticity?: string;
    score?: number;
    reasons: Array<{ code: string; points: number; detail: string; subjects?: string[] }>;
  } | null;
  qa: Array<{ code: string; severity: 'error' | 'warning'; detail: string }>;
  pngUrl: string | null;
  jpegUrl: string | null;
  pngDownloadUrl: string | null;
  jpegDownloadUrl: string | null;
  pngBytes: number | null;
  jpegBytes: number | null;
  createdAt: string;
}

export interface StaticAdsResponse {
  scriptApproved: boolean;
  maxVersions: number;
  ads: StaticAdDto[];
  /** Pictures the owner may put behind the text: their own photos and approved AI images. */
  pictures: Array<{ assetId: string; source: 'AI' | 'BUSINESS'; authenticity: string; url: string }>;
}
