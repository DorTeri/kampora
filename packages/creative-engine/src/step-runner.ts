import { z } from 'zod';
import type { LlmProvider, ProviderUsage } from '@kampora/media-providers';

export interface StepUsageEvent {
  step: string;
  attempt: number;
  success: boolean;
  usage?: ProviderUsage;
  error?: string;
}

/** Persists usage + cost for each attempt (DB-backed in the API, in-memory in tests). */
export interface UsageRecorder {
  record(event: StepUsageEvent): Promise<void>;
}

export class ReasoningStepError extends Error {
  constructor(
    readonly step: string,
    readonly attempts: number,
    readonly lastError: string,
  ) {
    super(`Reasoning step "${step}" failed after ${attempts} attempt(s): ${lastError}`);
  }
}

export interface ReasoningStepOptions<I, O> {
  name: string;
  system: string;
  input: I;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  buildPrompt: (input: I) => string;
  provider: LlmProvider;
  /** Bounded: defaults to 2, hard-capped at 3. */
  maxAttempts?: number;
  recorder?: UsageRecorder;
}

const HARD_MAX_ATTEMPTS = 3;

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function summarizeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 8)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

/**
 * One bounded AI reasoning step: typed input → provider → Zod-validated output.
 * No tools, no side effects, bounded retries (with the validation error fed back), usage recorded per attempt.
 */
export async function runReasoningStep<I, O>(
  options: ReasoningStepOptions<I, O>,
): Promise<{ output: O; attempts: number; usage: ProviderUsage[] }> {
  const input = options.inputSchema.parse(options.input);
  const maxAttempts = Math.min(options.maxAttempts ?? 2, HARD_MAX_ATTEMPTS);
  const jsonSchema = toJsonSchema(options.outputSchema);
  const prompt = options.buildPrompt(input);
  const usage: ProviderUsage[] = [];
  let repairHint: string | undefined;
  let lastError = 'unknown error';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await options.provider.generateStructured({
        task: options.name,
        system: options.system,
        prompt,
        input,
        jsonSchema,
        repairHint,
      });
      usage.push(result.usage);
      const parsed = options.outputSchema.safeParse(result.data);
      if (parsed.success) {
        await options.recorder?.record({ step: options.name, attempt, success: true, usage: result.usage });
        return { output: parsed.data, attempts: attempt, usage };
      }
      lastError = `invalid output: ${summarizeIssues(parsed.error)}`;
      repairHint = `Your previous output failed validation: ${summarizeIssues(parsed.error)}. Return corrected JSON only.`;
      await options.recorder?.record({
        step: options.name,
        attempt,
        success: false,
        usage: result.usage,
        error: lastError,
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await options.recorder?.record({ step: options.name, attempt, success: false, error: lastError });
    }
  }
  throw new ReasoningStepError(options.name, maxAttempts, lastError);
}
