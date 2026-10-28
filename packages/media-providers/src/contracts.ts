import type { ZodType } from 'zod';
import type { ChargeType } from '@kampora/shared';

/**
 * Provider contracts. Concrete adapters live behind these interfaces so the pipeline never depends on a
 * specific vendor. Capabilities differ per vendor, so they are declared explicitly rather than assumed.
 */

export interface ProviderUsage {
  provider: string;
  model: string;
  /**
   * SIMULATED: mock. ESTIMATED: price is a planning estimate. CONFIRMED: provider-reported usage priced with a
   * verified price-list entry.
   */
  chargeType: ChargeType;
  costUsd: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  requestId?: string;
}

// ── LLM ───────────────────────────────────────────────────────────────

export interface StructuredGenerationRequest {
  /** Stable task id, e.g. "creative.concepts". Lets mock providers and logs identify the step. */
  task: string;
  system: string;
  prompt: string;
  /** Structured input. Real providers receive it serialized inside `prompt` as quoted data. */
  input: unknown;
  /** JSON Schema of the expected output (from z.toJSONSchema). */
  jsonSchema: Record<string, unknown>;
  /** The Zod schema itself, for providers with native structured outputs (strict JSON schema). */
  schema?: ZodType;
  schemaName?: string;
  /** Feedback from a previous invalid attempt, so the model can correct itself. */
  repairHint?: string;
}

export interface StructuredGenerationResult {
  /** Unvalidated output: callers MUST validate with Zod. */
  data: unknown;
  usage: ProviderUsage;
}

/** Thrown by providers; `retryable` tells the step runner whether another attempt makes sense. */
export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly retryable: boolean,
    readonly usage?: ProviderUsage,
  ) {
    super(message);
  }
}

export interface LlmProvider {
  readonly id: string;
  readonly model: string;
  readonly paid: boolean;
  generateStructured(request: StructuredGenerationRequest): Promise<StructuredGenerationResult>;
}

// ── Images ────────────────────────────────────────────────────────────

export interface ImageGenerationCapabilities {
  referenceImages: boolean;
  maxReferenceImages: number;
  aspectRatios: string[];
}

export interface ReferenceImage {
  data: Buffer;
  mimeType: string;
  name: string;
}

export interface ImageGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  aspectRatio: '9:16' | '4:5' | '1:1' | '16:9';
  /** Customer photos (product accuracy). Providers without reference support must reject, not ignore, them. */
  referenceImages?: ReferenceImage[];
  seed?: number;
}

export interface GeneratedMedia {
  data: Buffer;
  mimeType: string;
  width?: number;
  height?: number;
  durationSec?: number;
  usage: ProviderUsage;
}

export interface ImageGenerationProvider {
  readonly id: string;
  readonly model: string;
  readonly paid: boolean;
  readonly capabilities: ImageGenerationCapabilities;
  generate(request: ImageGenerationRequest): Promise<GeneratedMedia>;
}

// ── Video ─────────────────────────────────────────────────────────────

export interface VideoGenerationCapabilities {
  imageToVideo: boolean;
  textToVideo: boolean;
  maxDurationSec: number;
  aspectRatios: string[];
}

export interface VideoGenerationRequest {
  mode: 'image-to-video' | 'text-to-video';
  prompt: string;
  sourceImageUrl?: string;
  durationSec: number;
  aspectRatio: '9:16';
}

/** Video generation is asynchronous at every major vendor: submit, then poll. */
export interface VideoGenerationProvider {
  readonly id: string;
  readonly model: string;
  readonly paid: boolean;
  readonly capabilities: VideoGenerationCapabilities;
  submit(request: VideoGenerationRequest): Promise<{ externalJobId: string }>;
  poll(
    externalJobId: string,
  ): Promise<{ status: 'pending' | 'succeeded' | 'failed'; media?: GeneratedMedia; error?: string }>;
}

export class ProviderNotConfiguredError extends Error {
  constructor(kind: string) {
    super(`No ${kind} provider is configured. Set the provider env vars to enable it.`);
  }
}
