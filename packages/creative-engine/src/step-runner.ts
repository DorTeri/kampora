import { z } from 'zod';
import { LlmProviderError, type LlmProvider, type ProviderUsage } from '@kampora/media-providers';

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

/** Thrown by a transform when the model output is well-formed JSON but violates domain rules. */
export class StepValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('; '));
  }
}

export interface ReasoningStepOptions<I, O, T = O> {
  name: string;
  system: string;
  input: I;
  inputSchema: z.ZodType<I>;
  /** Provider-facing schema (strict-structured-output compatible). */
  outputSchema: z.ZodType<O>;
  schemaName?: string;
  buildPrompt: (input: I) => string;
  /** Maps provider output to the domain shape (may throw ZodError / StepValidationError → retry). */
  transform?: (output: O, input: I) => T;
  /** Domain checks (facts, durations). Non-empty problems → retry with the problems as a repair hint. */
  postValidate?: (value: T, input: I) => string[];
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
 * One bounded AI reasoning step: typed input → provider → schema → domain transform → domain checks.
 * No tools, no side effects, bounded retries (validation problems are fed back), usage recorded per attempt,
 * and non-retryable provider errors (auth, refusal, bad request) stop immediately.
 */
export async function runReasoningStep<I, O, T = O>(
  options: ReasoningStepOptions<I, O, T>,
): Promise<{ output: T; attempts: number; usage: ProviderUsage[] }> {
  const input = options.inputSchema.parse(options.input);
  const maxAttempts = Math.min(options.maxAttempts ?? 2, HARD_MAX_ATTEMPTS);
  const jsonSchema = toJsonSchema(options.outputSchema);
  const prompt = options.buildPrompt(input);
  const usage: ProviderUsage[] = [];
  let repairHint: string | undefined;
  let lastError = 'unknown error';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let attemptUsage: ProviderUsage | undefined;
    try {
      const result = await options.provider.generateStructured({
        task: options.name,
        system: options.system,
        prompt,
        input,
        jsonSchema,
        schema: options.outputSchema,
        schemaName: options.schemaName,
        repairHint,
      });
      attemptUsage = result.usage;
      usage.push(result.usage);

      const parsed = options.outputSchema.safeParse(result.data);
      let problems: string[];
      let value: T | undefined;
      if (!parsed.success) {
        problems = [summarizeIssues(parsed.error)];
      } else {
        try {
          value = options.transform ? options.transform(parsed.data, input) : (parsed.data as unknown as T);
          problems = options.postValidate?.(value, input) ?? [];
        } catch (error) {
          if (error instanceof z.ZodError) problems = [summarizeIssues(error)];
          else if (error instanceof StepValidationError) problems = error.problems;
          else throw error;
        }
      }

      if (!problems.length) {
        await options.recorder?.record({ step: options.name, attempt, success: true, usage: result.usage });
        return { output: value as T, attempts: attempt, usage };
      }
      lastError = `invalid output: ${problems.join('; ')}`;
      repairHint = `Your previous answer was rejected: ${problems.join('; ')}. Fix these problems and return the full JSON again.`;
      await options.recorder?.record({
        step: options.name,
        attempt,
        success: false,
        usage: result.usage,
        error: lastError,
      });
    } catch (error) {
      // Budget/approval denials and similar are final: never retry them.
      if ((error as { fatal?: boolean }).fatal) throw error;
      lastError = error instanceof Error ? error.message : String(error);
      const providerUsage = error instanceof LlmProviderError ? error.usage : attemptUsage;
      if (providerUsage && !attemptUsage) usage.push(providerUsage);
      await options.recorder?.record({
        step: options.name,
        attempt,
        success: false,
        usage: providerUsage,
        error: lastError,
      });
      if (error instanceof LlmProviderError && !error.retryable) break;
    }
  }
  throw new ReasoningStepError(options.name, maxAttempts, lastError);
}
