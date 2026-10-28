import type { PriceCatalog } from '@kampora/cost-engine';
import { MockCreativeLlmProvider } from '@kampora/creative-engine';
import {
  OpenAiLlmProvider,
  type LlmProvider,
  type StructuredGenerationRequest,
} from '@kampora/media-providers';
import type { AppConfig } from '../config';

/** The configured creative LLM and whether it can be used. Secrets stay here; the UI only sees ready/reason. */
export interface CreativeProviderInfo {
  id: 'mock' | 'openai';
  model: string;
  paid: boolean;
  ready: boolean;
  reason?: string;
  provider: LlmProvider | null;
  /** Worst-case USD for one call (0 for the mock). */
  estimateCallUsd(request: Pick<StructuredGenerationRequest, 'system' | 'prompt'>): number;
}

export function createCreativeProvider(config: AppConfig, catalog: PriceCatalog): CreativeProviderInfo {
  if (config.CREATIVE_PROVIDER !== 'openai') {
    const mock = new MockCreativeLlmProvider();
    return {
      id: 'mock',
      model: mock.model,
      paid: false,
      ready: true,
      provider: mock,
      estimateCallUsd: () => 0,
    };
  }

  const model = config.OPENAI_MODEL;
  const price = catalog.find('openai', model, 'LLM_COMPLETION');
  const unavailable = (reason: string): CreativeProviderInfo => ({
    id: 'openai',
    model,
    paid: true,
    ready: false,
    reason,
    provider: null,
    estimateCallUsd: () => 0,
  });
  if (!config.OPENAI_API_KEY) return unavailable('OPENAI_API_KEY is not set');
  // Without a price entry the budget guard cannot bound spend, so the provider is not used at all.
  if (!price?.tokenPricing) return unavailable(`No price catalog entry for OpenAI model "${model}"`);

  const provider = new OpenAiLlmProvider({
    apiKey: config.OPENAI_API_KEY,
    model,
    maxOutputTokens: config.OPENAI_MAX_OUTPUT_TOKENS,
    timeoutMs: config.OPENAI_TIMEOUT_MS,
    reasoningEffort: config.OPENAI_REASONING_EFFORT,
    pricing: { ...price.tokenPricing, verified: price.basis === 'VERIFIED' },
  });
  return {
    id: 'openai',
    model,
    paid: true,
    ready: true,
    provider,
    estimateCallUsd: (request) => provider.estimateCallUsd(request),
  };
}
