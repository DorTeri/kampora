import { readFileSync } from 'node:fs';
import type { OperationType } from '@kampora/shared';

export type PriceUnit =
  | 'request'
  | 'image'
  | 'video_second'
  | 'character'
  | 'input_1k_tokens'
  | 'output_1k_tokens'
  | 'render_second';

export interface PriceEntry {
  provider: string;
  model: string;
  operation: OperationType;
  unit: PriceUnit;
  unitPriceUsd: number;
  /** PLANNING_ESTIMATE: our assumption. VERIFIED: checked against the provider's official pricing page. */
  basis: 'PLANNING_ESTIMATE' | 'VERIFIED';
  reviewedAt: string;
  sourceUrl?: string;
  note: string;
}

/**
 * Default catalog: PLANNING ESTIMATES ONLY. They let the planner rank strategies and enforce budgets before
 * real providers exist. Override with verified prices via KAMPORA_PRICE_CATALOG_PATH; never treat these as facts.
 */
export const DEFAULT_PRICE_CATALOG: readonly PriceEntry[] = [
  {
    provider: 'mock',
    model: 'mock-creative-v1',
    operation: 'LLM_COMPLETION',
    unit: 'request',
    unitPriceUsd: 0.01,
    basis: 'PLANNING_ESTIMATE',
    reviewedAt: '2026-10-28',
    note: 'Simulated cost of one structured LLM step',
  },
  {
    provider: 'planning',
    model: 'image-standard',
    operation: 'IMAGE_GENERATION',
    unit: 'image',
    unitPriceUsd: 0.05,
    basis: 'PLANNING_ESTIMATE',
    reviewedAt: '2026-10-28',
    note: 'Placeholder for a high-quality still image generation call',
  },
  {
    provider: 'planning',
    model: 'image-to-video-standard',
    operation: 'IMAGE_TO_VIDEO',
    unit: 'video_second',
    unitPriceUsd: 0.12,
    basis: 'PLANNING_ESTIMATE',
    reviewedAt: '2026-10-28',
    note: 'Placeholder per generated second of image-to-video',
  },
  {
    provider: 'planning',
    model: 'text-to-video-premium',
    operation: 'TEXT_TO_VIDEO',
    unit: 'video_second',
    unitPriceUsd: 0.4,
    basis: 'PLANNING_ESTIMATE',
    reviewedAt: '2026-10-28',
    note: 'Placeholder per generated second of premium text-to-video',
  },
  {
    provider: 'elevenlabs',
    model: 'eleven_v3',
    operation: 'TTS',
    unit: 'character',
    unitPriceUsd: 0.0002,
    basis: 'PLANNING_ESTIMATE',
    reviewedAt: '2026-10-28',
    note: 'ElevenLabs bills in plan credits; this is a rough USD-per-character planning figure',
  },
  {
    provider: 'local',
    model: 'remotion',
    operation: 'RENDER',
    unit: 'render_second',
    unitPriceUsd: 0.0005,
    basis: 'PLANNING_ESTIMATE',
    reviewedAt: '2026-10-28',
    note: 'Local/self-hosted compute amortization per second of output video',
  },
];

export class PriceCatalog {
  constructor(private readonly entries: readonly PriceEntry[]) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): PriceCatalog {
    const file = env.KAMPORA_PRICE_CATALOG_PATH;
    if (!file) return new PriceCatalog(DEFAULT_PRICE_CATALOG);
    const extra = JSON.parse(readFileSync(file, 'utf8')) as PriceEntry[];
    // Entries from the file override defaults with the same provider/model/operation.
    const key = (e: PriceEntry) => `${e.provider}|${e.model}|${e.operation}`;
    const merged = new Map(DEFAULT_PRICE_CATALOG.map((e) => [key(e), e]));
    for (const e of extra) merged.set(key(e), e);
    return new PriceCatalog([...merged.values()]);
  }

  find(provider: string, model: string, operation: OperationType): PriceEntry | undefined {
    return this.entries.find(
      (e) => e.provider === provider && e.model === model && e.operation === operation,
    );
  }

  /** First entry for an operation; used by the planner before a concrete provider is chosen. */
  defaultFor(operation: OperationType): PriceEntry {
    const entry = this.entries.find((e) => e.operation === operation);
    if (!entry) throw new Error(`No price catalog entry for ${operation}`);
    return entry;
  }

  estimate(entry: PriceEntry, quantity: number): number {
    return roundUsd(entry.unitPriceUsd * quantity);
  }
}

export function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function usdToMicro(usd: number): number {
  return Math.round(usd * 1_000_000);
}

export function microToUsd(micro: number): number {
  return micro / 1_000_000;
}
