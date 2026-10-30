import { describe, expect, it } from 'vitest';
import type { LlmProvider, StructuredGenerationRequest } from '@kampora/media-providers';
import { industryById } from '@kampora/agent-expertise';
import { conceptSetQa } from './copy-qa';
import { EVAL_SCENARIOS } from './evaluation/scenarios';
import type { ConceptSetLlm } from './llm-schemas';
import { MockCreativeLlmProvider } from './mock-provider';
import { buildProfessionalBrief } from './professional-brief';
import { ReasoningStepError } from './step-runner';
import { buildCampaignBrief, generateConcepts } from './steps';

const scenario = (id: string) => EVAL_SCENARIOS.find((s) => s.id === id)!;
const briefFor = (id: string) => {
  const s = scenario(id);
  return buildCampaignBrief({
    business: s.business,
    request: s.request,
    defaults: { budgetUsd: 5, qualityTier: 'standard', targetDurationSec: 20 },
  });
};

describe('professional creative brief', () => {
  it('labels every field with where it came from and never invents facts', () => {
    const s = scenario('cafe-offer');
    const pro = buildProfessionalBrief({
      business: s.business,
      brief: briefFor('cafe-offer'),
      assets: s.assets,
    });
    expect(pro.industry).toMatchObject({ id: 'cafe-restaurant', matched: true });
    expect(pro.campaign.offer).toMatchObject({
      value: 'קפה + מאפה ב-29.90 ₪ עד סוף החודש',
      provenance: 'CUSTOMER_PROVIDED',
    });
    expect(pro.campaign.duration).toMatchObject({ value: 'עד סוף החודש', provenance: 'CUSTOMER_PROVIDED' });
    expect(pro.strategy.reasonsToBelieve.provenance).toBe('VERIFIED');
    // Industry knowledge is an inference, labelled as a hypothesis.
    expect(pro.strategy.emotionalDirection.provenance).toBe('AI_INFERRED');
    expect(pro.strategy.coreInsight.value).toMatch(/^השערה/);
    // AI images are counted as AI, never as real photos.
    expect(pro.business.media).toMatchObject({ verifiedProductPhotos: 0, aiImages: 2 });
    expect(pro.expertiseVersion).toContain('copywriting@');
    expect(pro.readiness.ready).toBe(true);
  });

  it('asks only for what the business memory does not already contain', () => {
    const s = scenario('cafe-offer');
    const pro = buildProfessionalBrief({
      business: s.business,
      brief: briefFor('cafe-offer'),
      assets: s.assets,
    });
    const fields = pro.questions.map((q) => q.field);
    // Hours ("פתוח כל יום מ-7:00") and the address are already known: not asked again.
    expect(fields).not.toContain('industry.hours');
    expect(fields).not.toContain('industry.location');
    // Kosher status is not known; the real product photo is missing.
    expect(fields).toEqual(expect.arrayContaining(['industry.kosher', 'business.media']));
    for (const q of pro.questions) expect(q.question).toMatch(/[֐-׿]/);
  });

  it('blocks production when an offer campaign has no offer, and asks to confirm inferred facts', () => {
    const s = scenario('premium-product');
    const noOffer = buildProfessionalBrief({
      business: s.business,
      brief: { ...briefFor('premium-product'), goal: 'OFFER', offer: undefined },
    });
    expect(noOffer.readiness).toEqual({ ready: false, missingRequired: ['campaign.offer'] });
    const confirm = noOffer.questions.find((q) => q.field === 'business.description')!;
    expect(confirm).toMatchObject({ answer: 'CONFIRM', proposedValue: s.business.description });
    expect(noOffer.business.positioning.provenance).toBe('AI_INFERRED');
  });

  it('lists the industry claims that need approval as restrictions', () => {
    const s = scenario('fitness-leads');
    const pro = buildProfessionalBrief({ business: s.business, brief: briefFor('fitness-leads') });
    expect(pro.industry.id).toBe('fitness');
    expect(pro.strategy.restrictions.value!.join(' ')).toContain('ירידה במשקל');
  });
});

/** A provider that returns scripted outputs in order. */
function scripted(outputs: unknown[]): LlmProvider & { calls: StructuredGenerationRequest[] } {
  const calls: StructuredGenerationRequest[] = [];
  return {
    id: 'fake',
    model: 'm',
    paid: true,
    calls,
    async generateStructured(req) {
      calls.push(req);
      return {
        data: outputs.shift(),
        usage: { provider: 'fake', model: 'm', chargeType: 'CONFIRMED', costUsd: 0.001 },
      };
    },
  };
}

async function mockOutput(id: string): Promise<ConceptSetLlm> {
  const s = scenario(id);
  const res = await new MockCreativeLlmProvider().generateStructured({
    task: 'creative.concepts',
    system: '',
    prompt: '',
    input: { business: s.business, brief: briefFor(id) },
    jsonSchema: {},
  });
  return res.data as ConceptSetLlm;
}

describe('Copywriter', () => {
  it('uses the expertise and the strategy in its prompt, and returns separate written copy', async () => {
    const provider = scripted([await mockOutput('cafe-offer')]);
    const s = scenario('cafe-offer');
    const { conceptSet } = await generateConcepts(
      { business: s.business, brief: briefFor('cafe-offer'), assets: s.assets },
      { provider },
    );
    expect(provider.calls[0]!.system).toContain('copywriting@1.0.0');
    expect(provider.calls[0]!.system).toContain('industry:cafe-restaurant');
    expect(provider.calls[0]!.prompt).toContain('<strategy>');
    expect(provider.calls[0]!.prompt).toContain('industry.kosher');
    const c = conceptSet.concepts[0]!;
    expect(c.copy).toMatchObject({ hookTechnique: 'OFFER_FIRST', playbookVersion: 'copywriting@1.0.0' });
    expect(c.copy!.headline).not.toBe(c.voiceover);
    expect(new Set(conceptSet.concepts.map((x) => x.copy!.hookTechnique)).size).toBe(3);
  });

  it('produces different concept sets for different businesses and goals', async () => {
    const sets = await Promise.all(
      EVAL_SCENARIOS.map(async (s) =>
        (await mockOutput(s.id)).concepts.map((c) => `${c.angle}/${c.hookTechnique}`).join(','),
      ),
    );
    expect(new Set(sets).size).toBeGreaterThanOrEqual(3);
  });

  it('sends three rewrites of one idea back, and fails after the bounded retries', async () => {
    const good = await mockOutput('cafe-offer');
    const same = structuredClone(good);
    for (const c of same.concepts) {
      c.hook = good.concepts[0]!.hook;
      c.hookTechnique = 'OFFER_FIRST';
    }
    const provider = scripted([same, same]);
    const s = scenario('cafe-offer');
    await expect(
      generateConcepts({ business: s.business, brief: briefFor('cafe-offer') }, { provider }),
    ).rejects.toBeInstanceOf(ReasoningStepError);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]!.repairHint).toMatch(/hook technique|rewording/);
  });

  it('rejects clichés, formal register and unapproved industry claims', async () => {
    const good = await mockOutput('fitness-leads');
    const bad = structuredClone(good);
    bad.concepts[1]!.script = 'חוויה בלתי נשכחת שהינה גם ירידה במשקל מובטחת. השאירו פרטים.';
    const s = scenario('fitness-leads');
    const provider = scripted([bad, good]);
    const { conceptSet } = await generateConcepts(
      { business: s.business, brief: briefFor('fitness-leads') },
      { provider },
    );
    expect(provider.calls[1]!.repairHint).toMatch(/חוויה בלתי נשכחת/);
    expect(provider.calls[1]!.repairHint).toMatch(/הינו|הינה|כדי|הוא|היא/);
    expect(provider.calls[1]!.repairHint).toMatch(/ירידה במשקל/);
    expect(
      conceptSetQa(conceptSet, { business: s.business, industry: industryById('fitness') }).filter(
        (i) => i.severity === 'error',
      ),
    ).toEqual([]);
  });
});
