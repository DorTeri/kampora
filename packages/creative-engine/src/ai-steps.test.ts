import { describe, expect, it } from 'vitest';
import { BudgetDeniedError } from '@kampora/cost-engine';
import {
  LlmProviderError,
  OpenAiLlmProvider,
  type LlmProvider,
  type StructuredGenerationRequest,
} from '@kampora/media-providers';
import { checkFacts } from './claims';
import { DEMO_BUSINESS, DEMO_CAMPAIGN_REQUEST } from './demo';
import { GuardedLlmProvider } from './guarded-provider';
import { ConceptSetLlmSchema, type ConceptSetLlm, type StoryboardLlm } from './llm-schemas';
import { MockCreativeLlmProvider } from './mock-provider';
import { ReasoningStepError, type StepUsageEvent } from './step-runner';
import { buildCampaignBrief, factSources, generateConcepts, generateStoryboard } from './steps';

const brief = buildCampaignBrief({
  business: DEMO_BUSINESS,
  request: DEMO_CAMPAIGN_REQUEST,
  defaults: { budgetUsd: 5, qualityTier: 'standard', targetDurationSec: 20 },
});
const usage = { provider: 'fake', model: 'm', chargeType: 'CONFIRMED' as const, costUsd: 0.002 };
const assets = [
  { id: 'a1', kind: 'image' as const, description: 'cup', tags: ['hero'], commercialUse: true },
  { id: 'a2', kind: 'image' as const, description: 'pastry', tags: ['product'], commercialUse: true },
  { id: 'a3', kind: 'image' as const, description: 'store', tags: ['store'], commercialUse: true },
];

/** A provider that returns scripted outputs in order (simulating a real LLM's structured output). */
function scripted(outputs: unknown[]): LlmProvider & { calls: StructuredGenerationRequest[] } {
  const calls: StructuredGenerationRequest[] = [];
  return {
    id: 'fake',
    model: 'm',
    paid: true,
    calls,
    async generateStructured(req) {
      calls.push(req);
      const next = outputs.shift();
      if (next instanceof Error) throw next;
      return { data: next, usage };
    },
  };
}

async function mockConceptsOutput(): Promise<ConceptSetLlm> {
  const mock = new MockCreativeLlmProvider();
  const res = await mock.generateStructured({
    task: 'creative.concepts',
    system: '',
    prompt: '',
    input: { business: DEMO_BUSINESS, brief },
    jsonSchema: {},
  });
  return res.data as ConceptSetLlm;
}

describe('deterministic brief', () => {
  it('keeps the exact offer and approved claims, no AI call', () => {
    expect(brief.offer).toBe('קפה + מאפה ב-29.90 ₪ עד סוף החודש');
    expect(brief.keyMessage).toBe(DEMO_BUSINESS.approvedClaims[0]);
  });
});

describe('structured output: concepts', () => {
  it('maps a valid structured response to three distinct domain concepts', async () => {
    const provider = scripted([await mockConceptsOutput()]);
    const { conceptSet } = await generateConcepts({ business: DEMO_BUSINESS, brief }, { provider });
    expect(conceptSet.concepts.map((c) => c.angle)).toEqual([
      'OFFER_DRIVEN',
      'PROBLEM_SOLUTION',
      'EMOTIONAL',
    ]);
    expect(conceptSet.recommendedKey).toBe('offer-driven');
    expect(conceptSet.concepts[0]!.estimatedDurationSec).toBe(18);
    // The provider receives the strict schema so it can use native structured outputs.
    expect(provider.calls[0]!.schema).toBe(ConceptSetLlmSchema);
    expect(provider.calls[0]!.schemaName).toBe('concept_set');
  });

  it('retries an incomplete response with a repair hint, then succeeds', async () => {
    const good = await mockConceptsOutput();
    const incomplete = { concepts: good.concepts.slice(0, 2), recommendedIndex: 0 };
    const provider = scripted([incomplete, good]);
    const { conceptSet } = await generateConcepts({ business: DEMO_BUSINESS, brief }, { provider });
    expect(conceptSet.concepts).toHaveLength(3);
    expect(provider.calls[1]!.repairHint).toMatch(/rejected/);
  });

  it('rejects three rewrites of the same angle', async () => {
    const good = await mockConceptsOutput();
    const same = { ...good, concepts: good.concepts.map((c) => ({ ...c, angle: 'UGC' as const })) };
    const provider = scripted([same, same]);
    await expect(generateConcepts({ business: DEMO_BUSINESS, brief }, { provider })).rejects.toBeInstanceOf(
      ReasoningStepError,
    );
    expect(provider.calls).toHaveLength(2);
  });

  it('rejects invented prices and testimonials and tells the model why', async () => {
    const good = await mockConceptsOutput();
    const invented = structuredClone(good);
    invented.concepts[0]!.script = 'רק 19.90 ₪ במקום 39 ₪! "הקפה הכי טוב" – דנה';
    const provider = scripted([invented, good]);
    await generateConcepts({ business: DEMO_BUSINESS, brief }, { provider });
    expect(provider.calls[1]!.repairHint).toContain('"19.90" does not appear');
    expect(provider.calls[1]!.repairHint).toContain('Testimonials');
  });

  it('stops immediately on a non-retryable provider error and records the attempt', async () => {
    const events: StepUsageEvent[] = [];
    const provider = scripted([new LlmProviderError('OpenAI refused: policy', 'fake', false, usage)]);
    await expect(
      generateConcepts(
        { business: DEMO_BUSINESS, brief },
        { provider, recorder: { record: async (e) => void events.push(e) } },
      ),
    ).rejects.toBeInstanceOf(ReasoningStepError);
    expect(provider.calls).toHaveLength(1);
    expect(events[0]).toMatchObject({ success: false, usage });
  });
});

describe('structured output: storyboard', () => {
  it('maps scenes to router-compatible storyboard scenes (keys, tags from available media)', async () => {
    const mock = new MockCreativeLlmProvider();
    const concept = (await generateConcepts({ business: DEMO_BUSINESS, brief }, { provider: mock }))
      .conceptSet.concepts[0]!;
    const raw = (
      await mock.generateStructured({
        task: 'creative.storyboard',
        system: '',
        prompt: '',
        input: { business: DEMO_BUSINESS, brief, concept, assets },
        jsonSchema: {},
      })
    ).data as StoryboardLlm;
    raw.scenes[0]!.assetTags = ['hero', 'invented-tag'];
    const provider = scripted([raw]);
    const { storyboard } = await generateStoryboard(
      { business: DEMO_BUSINESS, brief, concept, assets },
      { provider },
    );
    expect(storyboard.scenes.map((s) => s.key)).toEqual(['hook', 'product', 'offer', 'cta']);
    expect(storyboard.scenes[0]!.requiredAssets[0]!.tags).toEqual(['hero']);
    expect(storyboard.scenes[2]!.visualKind).toBe('GRAPHIC');
  });

  it('requires HOOK first and CTA last', async () => {
    const mock = new MockCreativeLlmProvider();
    const concept = (await generateConcepts({ business: DEMO_BUSINESS, brief }, { provider: mock }))
      .conceptSet.concepts[0]!;
    const raw = (
      await mock.generateStructured({
        task: 'creative.storyboard',
        system: '',
        prompt: '',
        input: { business: DEMO_BUSINESS, brief, concept, assets },
        jsonSchema: {},
      })
    ).data as StoryboardLlm;
    const reversed = { scenes: [...raw.scenes].reverse() };
    const provider = scripted([reversed, reversed]);
    await expect(
      generateStoryboard({ business: DEMO_BUSINESS, brief, concept, assets }, { provider }),
    ).rejects.toThrow(/HOOK/);
  });
});

describe('fact grounding', () => {
  const sources = factSources(DEMO_BUSINESS, brief);
  it('allows numbers that come from the business data', () => {
    expect(checkFacts(['קפה + מאפה ב-29.90 ₪, פלורנטין 12, פתוח מ-7:00'], sources)).toEqual([]);
  });
  it('flags invented discounts and free items', () => {
    const problems = checkFacts(['20% הנחה ומאפה בחינם'], sources);
    expect(problems.join(' ')).toMatch(/"20"/);
    expect(problems.join(' ')).toMatch(/הנחה/);
    expect(problems.join(' ')).toMatch(/חינם/);
  });
});

describe('budget guard around paid LLM calls', () => {
  it('never sends a call the authorizer refuses, and the denial is not retried', async () => {
    const inner = scripted([]);
    const guarded = new GuardedLlmProvider(inner, () => 0.05, {
      authorize: () => {
        throw new BudgetDeniedError(['APPROVAL_REQUIRED']);
      },
      settle: () => undefined,
    });
    await expect(
      generateConcepts({ business: DEMO_BUSINESS, brief }, { provider: guarded }),
    ).rejects.toBeInstanceOf(BudgetDeniedError);
    expect(inner.calls).toHaveLength(0);
  });

  it('settles actual usage and reports the pre-call estimate', async () => {
    const inner = scripted([await mockConceptsOutput()]);
    const settled: number[] = [];
    const estimates: number[] = [];
    const guarded = new GuardedLlmProvider(
      inner,
      () => 0.05,
      { authorize: () => undefined, settle: (_e, u) => void settled.push(u?.costUsd ?? -1) },
      (e) => estimates.push(e.estimateUsd),
    );
    await generateConcepts({ business: DEMO_BUSINESS, brief }, { provider: guarded });
    expect(estimates).toEqual([0.05]);
    expect(settled).toEqual([0.002]);
  });
});

describe('OpenAI provider', () => {
  const pricing = { inputPer1M: 1, cachedInputPer1M: 0.05, outputPer1M: 5, verified: true };
  const fakeClient = (response: unknown) =>
    ({ responses: { parse: async () => response } }) as unknown as ConstructorParameters<
      typeof OpenAiLlmProvider
    >[0]['client'];
  const request = {
    task: 't',
    system: 's',
    prompt: 'p',
    input: {},
    jsonSchema: {},
    schema: ConceptSetLlmSchema,
  };

  it('returns parsed output with CONFIRMED usage priced from the verified catalog entry', async () => {
    const provider = new OpenAiLlmProvider({
      apiKey: '',
      model: 'gpt-6.1-terra',
      pricing,
      maxOutputTokens: 1000,
      client: fakeClient({
        id: 'resp_1',
        status: 'completed',
        output: [],
        output_parsed: { ok: true },
        usage: { input_tokens: 2000, output_tokens: 1000, input_tokens_details: { cached_tokens: 1000 } },
      }),
    });
    const res = await provider.generateStructured(request);
    expect(res.data).toEqual({ ok: true });
    // 1000 uncached × $1/M + 1000 cached × $0.05/M + 1000 out × $5/M
    expect(res.usage.costUsd).toBeCloseTo(0.00605, 8);
    expect(res.usage).toMatchObject({ chargeType: 'CONFIRMED', inputTokens: 2000, requestId: 'resp_1' });
  });

  it('treats a truncated (incomplete) response as retryable and keeps its usage', async () => {
    const provider = new OpenAiLlmProvider({
      apiKey: '',
      model: 'm',
      pricing,
      maxOutputTokens: 1000,
      client: fakeClient({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [],
        output_parsed: null,
        usage: { input_tokens: 10, output_tokens: 1000 },
      }),
    });
    const error = await provider.generateStructured(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as LlmProviderError).retryable).toBe(true);
    expect((error as LlmProviderError).usage?.outputTokens).toBe(1000);
  });

  it('treats a refusal as final', async () => {
    const provider = new OpenAiLlmProvider({
      apiKey: '',
      model: 'm',
      pricing,
      maxOutputTokens: 1000,
      client: fakeClient({
        status: 'completed',
        output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }],
        output_parsed: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    });
    const error = (await provider.generateStructured(request).catch((e: unknown) => e)) as LlmProviderError;
    expect(error.retryable).toBe(false);
  });

  it('estimates a worst-case cost before the call (output cap included)', () => {
    const provider = new OpenAiLlmProvider({ apiKey: 'x', model: 'm', pricing, maxOutputTokens: 6000 });
    expect(provider.estimateCallUsd({ system: '', prompt: 'x'.repeat(5000) })).toBeCloseTo(
      (2800 * 1 + 6000 * 5) / 1e6,
      6,
    );
  });
});
