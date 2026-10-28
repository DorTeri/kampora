import type {
  LlmProvider,
  ProviderUsage,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from '@kampora/media-providers';

export interface PaidCallAuthorizer {
  /** Throws (e.g. BudgetDeniedError) when the call must not run. */
  authorize(estimateUsd: number, attempt: number): Promise<void> | void;
  /** Called once per authorized call with what it actually cost (0 if it failed before usage). */
  settle(estimateUsd: number, usage: ProviderUsage | undefined): void;
}

export interface CallEstimate {
  step: string;
  estimateUsd: number;
  attempt: number;
}

/**
 * Decorates a paid LlmProvider with the budget guard: every single call (including retries) is estimated,
 * authorized before it is sent and settled afterwards. Estimates are reported so they can be written to the
 * ledger as ESTIMATED lines, separate from the CONFIRMED usage the provider reports.
 */
export class GuardedLlmProvider implements LlmProvider {
  readonly id: string;
  readonly model: string;
  readonly paid: boolean;
  private readonly attempts = new Map<string, number>();

  constructor(
    private readonly inner: LlmProvider,
    private readonly estimate: (request: StructuredGenerationRequest) => number,
    private readonly authorizer: PaidCallAuthorizer,
    private readonly onEstimate?: (estimate: CallEstimate) => void,
  ) {
    this.id = inner.id;
    this.model = inner.model;
    this.paid = inner.paid;
  }

  async generateStructured(request: StructuredGenerationRequest): Promise<StructuredGenerationResult> {
    const attempt = (this.attempts.get(request.task) ?? 0) + 1;
    this.attempts.set(request.task, attempt);
    const estimateUsd = this.estimate(request);
    await this.authorizer.authorize(estimateUsd, attempt);
    this.onEstimate?.({ step: request.task, estimateUsd, attempt });
    try {
      const result = await this.inner.generateStructured(request);
      this.authorizer.settle(estimateUsd, result.usage);
      return result;
    } catch (error) {
      this.authorizer.settle(estimateUsd, (error as { usage?: ProviderUsage }).usage);
      throw error;
    }
  }
}
