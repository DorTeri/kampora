import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import {
  LlmProviderError,
  type LlmProvider,
  type ProviderUsage,
  type StructuredGenerationRequest,
  type StructuredGenerationResult,
} from './contracts';

/** USD per 1M tokens, taken from the official pricing page (see the price catalog for source + review date). */
export interface TokenPricing {
  inputPer1M: number;
  cachedInputPer1M: number;
  outputPer1M: number;
  /** VERIFIED prices make provider-reported usage a CONFIRMED charge; otherwise it stays ESTIMATED. */
  verified: boolean;
}

export interface OpenAiConfig {
  apiKey: string;
  model: string;
  pricing: TokenPricing;
  /** Hard cap per call: bounds both cost and runaway generations. */
  maxOutputTokens: number;
  timeoutMs?: number;
  /** Only sent when configured (not every model accepts it). */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  baseURL?: string;
  /** Injected for tests. */
  client?: Pick<OpenAI, 'responses'>;
}

/** Rough pre-call token estimate for Hebrew/English JSON prompts (conservative: ~2.5 chars per token). */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 2.5);
}

export function tokenCostUsd(
  pricing: TokenPricing,
  input: number,
  cachedInput: number,
  output: number,
): number {
  const uncached = Math.max(0, input - cachedInput);
  return (
    (uncached * pricing.inputPer1M + cachedInput * pricing.cachedInputPer1M + output * pricing.outputPer1M) /
    1_000_000
  );
}

/**
 * OpenAI Responses API with Structured Outputs (strict JSON schema generated from Zod by the official helper).
 * The SDK's own retries are disabled: the step runner owns bounded retries so every attempt is accounted for.
 * `store: false` keeps prompts (business data) out of OpenAI's stored responses.
 */
export class OpenAiLlmProvider implements LlmProvider {
  readonly id = 'openai';
  readonly paid = true;
  readonly model: string;
  private readonly client: Pick<OpenAI, 'responses'>;

  constructor(private readonly config: OpenAiConfig) {
    if (!config.apiKey && !config.client)
      throw new Error('OPENAI_API_KEY is required for the OpenAI provider');
    this.model = config.model;
    this.client =
      config.client ??
      new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        timeout: config.timeoutMs ?? 90_000,
        maxRetries: 0,
      });
  }

  /** Worst-case cost of one call: estimated prompt tokens + the full output token cap. */
  estimateCallUsd(request: Pick<StructuredGenerationRequest, 'system' | 'prompt'>): number {
    const input = estimateTokens(request.system.length + request.prompt.length + 2_000 /* schema */);
    return tokenCostUsd(this.config.pricing, input, 0, this.config.maxOutputTokens);
  }

  async generateStructured(request: StructuredGenerationRequest): Promise<StructuredGenerationResult> {
    if (!request.schema) throw new LlmProviderError('OpenAI provider requires a Zod schema', this.id, false);
    const userContent = request.repairHint ? `${request.prompt}\n\n${request.repairHint}` : request.prompt;

    let response;
    try {
      response = await this.client.responses.parse({
        model: this.model,
        input: [
          { role: 'system', content: request.system },
          { role: 'user', content: userContent },
        ],
        text: { format: zodTextFormat(request.schema, request.schemaName ?? 'output') },
        max_output_tokens: this.config.maxOutputTokens,
        store: false,
        ...(this.config.reasoningEffort ? { reasoning: { effort: this.config.reasoningEffort } } : {}),
      });
    } catch (error) {
      throw toProviderError(error, this.id);
    }

    const usage = this.usageFrom(response);
    if (response.status === 'incomplete') {
      throw new LlmProviderError(
        `OpenAI response incomplete: ${response.incomplete_details?.reason ?? 'unknown'}`,
        this.id,
        true,
        usage,
      );
    }
    for (const item of response.output) {
      if (item.type !== 'message') continue;
      for (const content of item.content) {
        if (content.type === 'refusal') {
          throw new LlmProviderError(`OpenAI refused: ${content.refusal}`, this.id, false, usage);
        }
      }
    }
    return { data: response.output_parsed, usage };
  }

  private usageFrom(response: {
    id?: string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      input_tokens_details?: { cached_tokens: number };
    } | null;
  }): ProviderUsage {
    const input = response.usage?.input_tokens ?? 0;
    const cached = response.usage?.input_tokens_details?.cached_tokens ?? 0;
    const output = response.usage?.output_tokens ?? 0;
    return {
      provider: this.id,
      model: this.model,
      chargeType: this.config.pricing.verified ? 'CONFIRMED' : 'ESTIMATED',
      costUsd: tokenCostUsd(this.config.pricing, input, cached, output),
      inputTokens: input,
      cachedInputTokens: cached,
      outputTokens: output,
      requestId: response.id,
    };
  }
}

function toProviderError(error: unknown, provider: string): LlmProviderError {
  if (error instanceof OpenAI.APIError) {
    const status = error.status ?? 0;
    const retryable = status === 429 || status >= 500 || status === 0;
    // Never include headers or request bodies (they may carry the key or business data).
    return new LlmProviderError(
      `OpenAI API error ${status}: ${error.message.slice(0, 300)}`,
      provider,
      retryable,
    );
  }
  if (error instanceof Error && /timeout|timed out|ECONNRESET|fetch failed/i.test(error.message)) {
    return new LlmProviderError(`OpenAI network error: ${error.message.slice(0, 200)}`, provider, true);
  }
  return new LlmProviderError(
    error instanceof Error ? error.message.slice(0, 300) : String(error),
    provider,
    false,
  );
}
