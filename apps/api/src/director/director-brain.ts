import { and, count, eq, gte, inArray, sql } from 'drizzle-orm';
import { usdToMicro, type PriceCatalog } from '@kampora/cost-engine';
import { LlmDirectorBrain, RuleBasedDirectorBrain, type DirectorBrain } from '@kampora/creative-engine';
import { costLedger, recordUsage, usageEvents, type Database } from '@kampora/database';
import {
  LlmProviderError,
  OpenAiLlmProvider,
  type LlmProvider,
  type StructuredGenerationRequest,
  type StructuredGenerationResult,
} from '@kampora/media-providers';
import type { AppConfig } from '../config';

export const DIRECTOR_STEP = 'director.interpret';

/** Which brain the Director runs, and why. Only `mode`, `model` and `reason` are shown to the owner. */
export interface DirectorBrainSetup {
  mode: 'rules' | 'llm';
  model?: string;
  reason?: string;
  provider?: OpenAiLlmProvider;
  monthlyCapUsd: number;
  maxCallsPerConversationDay: number;
}

/**
 * The LLM brain runs only when every one of its own switches says so: DIRECTOR_BRAIN=llm, the Director's paid
 * switch, a positive monthly cap, an API key and a price-list entry for the model (without a price the cap cannot be
 * enforced). Anything missing → the deterministic brain, with the reason.
 *
 * It does not depend on KAMPORA_ALLOW_PAID_GENERATION: that switch covers paid creative (images, voice, video), and
 * turning it on only to let the Director read messages would also enable those providers. The two stay independent;
 * the Director's spend has its own cap, per-conversation limit and ledger entries.
 */
export function directorBrainSetup(config: AppConfig, catalog: PriceCatalog): DirectorBrainSetup {
  const caps = { monthlyCapUsd: config.DIRECTOR_LLM_MONTHLY_USD_CAP, maxCallsPerConversationDay: config.DIRECTOR_LLM_MAX_CALLS_PER_CONVERSATION_DAY };
  const rules = (reason?: string): DirectorBrainSetup => ({ mode: 'rules', reason, ...caps });
  if (config.DIRECTOR_BRAIN !== 'llm') return rules();
  const model = config.DIRECTOR_OPENAI_MODEL;
  if (!config.DIRECTOR_LLM_ALLOW_PAID) return rules('DIRECTOR_LLM_ALLOW_PAID is off');
  if (!(caps.monthlyCapUsd > 0)) return rules('DIRECTOR_LLM_MONTHLY_USD_CAP is 0');
  if (!config.OPENAI_API_KEY) return rules('OPENAI_API_KEY is not set');
  const price = catalog.find('openai', model, 'LLM_COMPLETION');
  if (!price?.tokenPricing) return rules(`No price catalog entry for "${model}"`);
  const provider = new OpenAiLlmProvider({
    apiKey: config.OPENAI_API_KEY,
    model,
    maxOutputTokens: config.DIRECTOR_LLM_MAX_OUTPUT_TOKENS,
    timeoutMs: config.DIRECTOR_LLM_TIMEOUT_MS,
    reasoningEffort: config.DIRECTOR_OPENAI_REASONING_EFFORT,
    pricing: { ...price.tokenPricing, verified: price.basis === 'VERIFIED' },
  });
  return { mode: 'llm', model, provider, ...caps };
}

/** What the guard needs from the ledger. The database implementation is below; tests use an in-memory one. */
export interface DirectorLlmLedger {
  /** USD spent by the Director brain this calendar month (UTC), across all organizations. */
  monthSpentUsd(now: Date): Promise<number>;
  /** Director brain calls of one conversation since UTC midnight. */
  callsToday(orgId: string, conversationId: string, now: Date): Promise<number>;
  record(entry: { orgId: string; conversationId: string; provider: string; model: string; costUsd: number; chargeType: 'CONFIRMED' | 'ESTIMATED' | 'SIMULATED'; success: boolean; error?: string; tokens?: Record<string, number | string | undefined> }): Promise<void>;
}

export class DirectorBudgetExceeded extends Error {}

/**
 * Wraps the paid provider for one turn: refuses the call (→ the brain falls back to rules) when the worst-case
 * estimate would cross the monthly cap or the conversation reached its daily call limit, and writes every call,
 * failed ones included, to the cost ledger.
 */
export class GuardedDirectorLlm implements LlmProvider {
  readonly id: string;
  readonly model: string;
  readonly paid: boolean;

  constructor(
    private readonly inner: LlmProvider & { estimateCallUsd(r: Pick<StructuredGenerationRequest, 'system' | 'prompt'>): number },
    private readonly ledger: DirectorLlmLedger,
    private readonly scope: { orgId: string; conversationId: string },
    private readonly limits: { monthlyCapUsd: number; maxCallsPerConversationDay: number },
    private readonly now: () => Date = () => new Date(),
  ) {
    this.id = inner.id;
    this.model = inner.model;
    this.paid = inner.paid;
  }

  async generateStructured(request: StructuredGenerationRequest): Promise<StructuredGenerationResult> {
    const now = this.now();
    const calls = await this.ledger.callsToday(this.scope.orgId, this.scope.conversationId, now);
    if (calls >= this.limits.maxCallsPerConversationDay) throw new DirectorBudgetExceeded('conversation daily call limit');
    const spent = await this.ledger.monthSpentUsd(now);
    // The context is part of the prompt (see LlmDirectorBrain.prompt), so the estimate covers it.
    const estimate = this.inner.estimateCallUsd({ system: request.system, prompt: request.prompt });
    if (spent + estimate > this.limits.monthlyCapUsd) throw new DirectorBudgetExceeded('monthly cap');
    const base = { ...this.scope, provider: this.inner.id, model: this.inner.model };
    try {
      const result = await this.inner.generateStructured(request);
      await this.ledger.record({
        ...base,
        costUsd: result.usage.costUsd,
        chargeType: result.usage.chargeType,
        success: true,
        tokens: { inputTokens: result.usage.inputTokens, cachedInputTokens: result.usage.cachedInputTokens, outputTokens: result.usage.outputTokens, requestId: result.usage.requestId },
      });
      return result;
    } catch (e) {
      // A failed paid call may still have been billed: record its reported usage, else the worst case.
      const usage = e instanceof LlmProviderError ? e.usage : undefined;
      await this.ledger.record({
        ...base,
        costUsd: usage?.costUsd ?? estimate,
        chargeType: usage?.chargeType ?? 'ESTIMATED',
        success: false,
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }
}

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
const dayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export class DbDirectorLlmLedger implements DirectorLlmLedger {
  constructor(private readonly db: Database) {}

  async monthSpentUsd(now: Date) {
    const [row] = await this.db
      .select({ micro: sql<string>`coalesce(sum(${costLedger.amountMicroUsd}), 0)` })
      .from(costLedger)
      .innerJoin(usageEvents, eq(costLedger.usageEventId, usageEvents.id))
      .where(and(eq(usageEvents.step, DIRECTOR_STEP), inArray(costLedger.chargeType, ['CONFIRMED', 'ESTIMATED']), gte(costLedger.createdAt, monthStart(now))));
    return Number(row?.micro ?? 0) / 1_000_000;
  }

  async callsToday(orgId: string, conversationId: string, now: Date) {
    const [row] = await this.db
      .select({ n: count() })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.orgId, orgId),
          eq(usageEvents.step, DIRECTOR_STEP),
          sql`${usageEvents.metadata}->>'conversationId' = ${conversationId}`,
          gte(usageEvents.createdAt, dayStart(now)),
        ),
      );
    return Number(row?.n ?? 0);
  }

  async record(entry: Parameters<DirectorLlmLedger['record']>[0]) {
    await recordUsage(this.db, {
      orgId: entry.orgId,
      operation: 'LLM_COMPLETION',
      provider: entry.provider,
      model: entry.model,
      quantity: 1,
      unit: 'request',
      step: DIRECTOR_STEP,
      chargeType: entry.chargeType,
      amountMicroUsd: usdToMicro(entry.costUsd),
      success: entry.success,
      note: entry.error?.slice(0, 500),
      metadata: { conversationId: entry.conversationId, ...(entry.tokens ?? {}) },
    });
  }
}

/** The brain for one turn: the guarded LLM brain when set up, else the deterministic one. */
export function brainFor(setup: DirectorBrainSetup, ledger: DirectorLlmLedger, scope: { orgId: string; conversationId: string }): DirectorBrain {
  if (setup.mode !== 'llm' || !setup.provider) return new RuleBasedDirectorBrain();
  return new LlmDirectorBrain(new GuardedDirectorLlm(setup.provider, ledger, scope, setup));
}
