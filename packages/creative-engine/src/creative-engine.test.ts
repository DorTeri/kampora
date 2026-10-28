import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { LlmProvider, StructuredGenerationRequest } from '@kampora/media-providers';
import { checkClaims } from './claims';
import { ReasoningStepError, runReasoningStep, type StepUsageEvent } from './step-runner';

const usage = { provider: 'test', model: 't', chargeType: 'SIMULATED' as const, costUsd: 0.01 };

function scriptedProvider(outputs: unknown[]): LlmProvider & { calls: StructuredGenerationRequest[] } {
  const calls: StructuredGenerationRequest[] = [];
  return {
    id: 'test',
    model: 't',
    paid: false,
    calls,
    async generateStructured(req) {
      calls.push(req);
      const next = outputs.shift();
      if (next instanceof Error) throw next;
      return { data: next, usage };
    },
  };
}

const Out = z.object({ title: z.string().min(2) });
const In = z.object({ topic: z.string() });

describe('runReasoningStep', () => {
  it('validates output and records usage', async () => {
    const events: StepUsageEvent[] = [];
    const provider = scriptedProvider([{ title: 'שלום' }]);
    const result = await runReasoningStep({
      name: 't',
      system: 's',
      input: { topic: 'x' },
      inputSchema: In,
      outputSchema: Out,
      buildPrompt: () => 'p',
      provider,
      recorder: { record: async (e) => void events.push(e) },
    });
    expect(result.output.title).toBe('שלום');
    expect(events).toEqual([{ step: 't', attempt: 1, success: true, usage }]);
  });

  it('retries invalid output once with a repair hint', async () => {
    const provider = scriptedProvider([{ title: '' }, { title: 'תקין' }]);
    const result = await runReasoningStep({
      name: 't',
      system: 's',
      input: { topic: 'x' },
      inputSchema: In,
      outputSchema: Out,
      buildPrompt: () => 'p',
      provider,
    });
    expect(result.attempts).toBe(2);
    expect(provider.calls[1]!.repairHint).toContain('title');
  });

  it('is bounded: fails after maxAttempts and never exceeds the hard cap', async () => {
    const provider = scriptedProvider(Array.from({ length: 10 }, () => ({ bad: true })));
    await expect(
      runReasoningStep({
        name: 't',
        system: 's',
        input: { topic: 'x' },
        inputSchema: In,
        outputSchema: Out,
        buildPrompt: () => 'p',
        provider,
        maxAttempts: 99,
      }),
    ).rejects.toBeInstanceOf(ReasoningStepError);
    expect(provider.calls).toHaveLength(3);
  });

  it('rejects invalid input before calling the provider', async () => {
    const provider = scriptedProvider([]);
    await expect(
      runReasoningStep({
        name: 't',
        system: 's',
        input: { topic: 5 } as never,
        inputSchema: In,
        outputSchema: Out,
        buildPrompt: () => 'p',
        provider,
      }),
    ).rejects.toThrow();
    expect(provider.calls).toHaveLength(0);
  });
});

describe('checkClaims', () => {
  it('flags unapproved superlatives and guarantees', () => {
    const flags = checkClaims(['הקפה הכי טוב בעיר, מובטח!', 'מאפים טריים כל בוקר'], ['מאפים טריים כל בוקר']);
    expect(flags.map((f) => f.phrase)).toEqual(['הכי טוב', 'מובטח']);
  });

  it('allows superlatives the business approved', () => {
    expect(checkClaims(['הקפה הכי טרי בשכונה'], ['הקפה הכי טרי בשכונה'])).toEqual([]);
  });
});
