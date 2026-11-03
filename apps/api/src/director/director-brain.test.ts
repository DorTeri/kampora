import { describe, expect, it, vi } from 'vitest';
import { budgetPolicyFromEnv, PriceCatalog } from '@kampora/cost-engine';
import { LlmProviderError, type LlmProvider } from '@kampora/media-providers';
import { loadConfig } from '../config';
import { DirectorBudgetExceeded, directorBrainSetup, GuardedDirectorLlm, type DirectorLlmLedger } from './director-brain';

const env = { DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://x' };
const llmEnv = {
  ...env,
  DIRECTOR_BRAIN: 'llm',
  DIRECTOR_LLM_ALLOW_PAID: 'true',
  DIRECTOR_LLM_MONTHLY_USD_CAP: '5',
  OPENAI_API_KEY: 'sk-test-not-a-real-key',
};

describe('director brain setup', () => {
  const catalog = PriceCatalog.fromEnv({});
  const setup = (e: Record<string, string>) => directorBrainSetup(loadConfig(e as NodeJS.ProcessEnv), catalog);

  it('runs the rules brain by default', () => {
    expect(setup(env)).toMatchObject({ mode: 'rules' });
  });

  it('needs every one of its own switches before the paid model is used', () => {
    expect(setup({ ...llmEnv, DIRECTOR_LLM_ALLOW_PAID: 'false' })).toMatchObject({ mode: 'rules', reason: 'DIRECTOR_LLM_ALLOW_PAID is off' });
    expect(setup({ ...llmEnv, DIRECTOR_LLM_MONTHLY_USD_CAP: '0' })).toMatchObject({ mode: 'rules' });
    expect(setup({ ...llmEnv, OPENAI_API_KEY: '' })).toMatchObject({ mode: 'rules', reason: 'OPENAI_API_KEY is not set' });
    expect(setup({ ...llmEnv, DIRECTOR_OPENAI_MODEL: 'unknown-model' }).mode).toBe('rules');
    expect(setup(llmEnv)).toMatchObject({ mode: 'llm', model: 'gpt-6-luna', monthlyCapUsd: 5 });
  });

  it('runs the Director LLM while paid creative generation stays off', () => {
    // The creative kill switch is off: images, voice and video stay disabled...
    const env = { ...llmEnv, KAMPORA_ALLOW_PAID_GENERATION: 'false' };
    expect(budgetPolicyFromEnv(env).paidGenerationEnabled).toBe(false);
    // ...and the Director still reads messages with its own capped model.
    expect(setup(env)).toMatchObject({ mode: 'llm', monthlyCapUsd: 5, maxCallsPerConversationDay: expect.any(Number) });
  });
});

describe('guarded director LLM', () => {
  const request = { task: 'director.interpret', system: 's', prompt: 'p', input: {}, jsonSchema: {} };
  const usage = { provider: 'openai', model: 'm', chargeType: 'CONFIRMED' as const, costUsd: 0.0004, inputTokens: 2000, outputTokens: 300 };

  function ledger(spent = 0, calls = 0) {
    const records: Parameters<DirectorLlmLedger['record']>[0][] = [];
    const l: DirectorLlmLedger = { monthSpentUsd: async () => spent, callsToday: async () => calls, record: async (e) => void records.push(e) };
    return { l, records };
  }
  const inner = (impl: LlmProvider['generateStructured']) => ({ id: 'openai', model: 'm', paid: true, generateStructured: vi.fn(impl), estimateCallUsd: () => 0.001 });
  const scope = { orgId: 'o', conversationId: 'c' };
  const limits = { monthlyCapUsd: 5, maxCallsPerConversationDay: 60 };

  it('records a successful call in the ledger', async () => {
    const { l, records } = ledger();
    const p = inner(async () => ({ data: {}, usage }));
    await new GuardedDirectorLlm(p, l, scope, limits).generateStructured(request);
    expect(records).toEqual([expect.objectContaining({ conversationId: 'c', costUsd: 0.0004, chargeType: 'CONFIRMED', success: true })]);
  });

  it('refuses the call before spending when the cap or the daily limit would be crossed', async () => {
    const p = inner(async () => ({ data: {}, usage }));
    await expect(new GuardedDirectorLlm(p, ledger(4.9995).l, scope, limits).generateStructured(request)).rejects.toBeInstanceOf(DirectorBudgetExceeded);
    await expect(new GuardedDirectorLlm(p, ledger(0, 60).l, scope, limits).generateStructured(request)).rejects.toBeInstanceOf(DirectorBudgetExceeded);
    expect(p.generateStructured).not.toHaveBeenCalled();
  });

  it('records a failed call conservatively', async () => {
    const { l, records } = ledger();
    const failing = inner(async () => {
      throw new Error('timeout');
    });
    await expect(new GuardedDirectorLlm(failing, l, scope, limits).generateStructured(request)).rejects.toThrow('timeout');
    expect(records[0]).toMatchObject({ success: false, chargeType: 'ESTIMATED', costUsd: 0.001 });
    const billed = inner(async () => {
      throw new LlmProviderError('bad json', 'openai', true, usage);
    });
    await expect(new GuardedDirectorLlm(billed, l, scope, limits).generateStructured(request)).rejects.toThrow('bad json');
    expect(records[1]).toMatchObject({ success: false, chargeType: 'CONFIRMED', costUsd: 0.0004 });
  });
});
