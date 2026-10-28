import { describe, expect, it } from 'vitest';
import type { LlmProvider, StructuredGenerationRequest } from '@kampora/media-providers';
import type { CampaignGoal, CreativeConcept, Storyboard } from '@kampora/shared';
import { CONCEPT_TYPES, conceptTypesGuide } from './concept-types';
import { conceptQa, storyboardQa } from './creative-qa';
import { DEMO_BUSINESS, DEMO_CAMPAIGN_REQUEST } from './demo';
import type { ConceptSetLlm } from './llm-schemas';
import { MockCreativeLlmProvider } from './mock-provider';
import { buildCampaignBrief, generateConcepts, generateStoryboard } from './steps';

const briefFor = (goal: CampaignGoal) =>
  buildCampaignBrief({
    business: DEMO_BUSINESS,
    request: { ...DEMO_CAMPAIGN_REQUEST, goal },
    defaults: { budgetUsd: 5, qualityTier: 'standard', targetDurationSec: 20 },
  });
const provider = new MockCreativeLlmProvider();
const assets = [
  { id: 'a1', kind: 'image' as const, description: 'cup', tags: ['hero'], commercialUse: true },
  { id: 'a2', kind: 'image' as const, description: 'pastry', tags: ['product'], commercialUse: true },
  { id: 'a3', kind: 'image' as const, description: 'store', tags: ['store'], commercialUse: true },
];

describe('concept types', () => {
  it('covers all eight types, each with its own hook mechanism and at least three beats', () => {
    const types = Object.values(CONCEPT_TYPES);
    expect(Object.keys(CONCEPT_TYPES).sort()).toEqual(
      [
        'EDUCATIONAL',
        'EMOTIONAL',
        'HUMOR',
        'LIFESTYLE',
        'OFFER_DRIVEN',
        'PRODUCT_DEMO',
        'PROBLEM_SOLUTION',
        'UGC',
      ].sort(),
    );
    expect(new Set(types.map((t) => t.hookMechanism)).size).toBe(types.length);
    for (const t of types) expect(t.structure.length).toBeGreaterThanOrEqual(3);
    expect(conceptTypesGuide().split('\n')).toHaveLength(8);
  });

  it('gives every generated concept a full strategy, and picks the third idea by goal', async () => {
    const thirdAngle = async (goal: CampaignGoal) => {
      const { conceptSet } = await generateConcepts(
        { business: DEMO_BUSINESS, brief: briefFor(goal) },
        { provider },
      );
      for (const c of conceptSet.concepts) {
        expect(c.strategy?.storyStructure.length).toBeGreaterThanOrEqual(3);
        expect(c.strategy?.hypothesis).toBeTruthy();
        expect(conceptQa(c).filter((i) => i.severity === 'error')).toEqual([]);
      }
      return conceptSet.concepts[2]!.angle;
    };
    expect(await thirdAngle('OFFER')).toBe('EMOTIONAL');
    expect(await thirdAngle('PRODUCT_PROMO')).toBe('PRODUCT_DEMO');
    expect(await thirdAngle('AWARENESS')).toBe('LIFESTYLE');
  });

  it('gives every storyboard scene a purpose and framing an editor can act on, with visual variety', async () => {
    const brief = briefFor('OFFER');
    const { conceptSet } = await generateConcepts({ business: DEMO_BUSINESS, brief }, { provider });
    const { storyboard } = await generateStoryboard(
      { business: DEMO_BUSINESS, brief, concept: conceptSet.concepts[0]!, assets },
      { provider },
    );
    for (const s of storyboard.scenes) {
      expect(s.direction?.purpose).toBeTruthy();
      expect(s.direction?.shot).toBeTruthy();
    }
    expect(storyboardQa(storyboard).filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('creative QA', () => {
  const concept: CreativeConcept = {
    key: 'x',
    title: 'x',
    angle: 'OFFER_DRIVEN',
    audience: 'a',
    hook: 'רגע, ראיתם את המבצע?',
    mainMessage: 'm',
    visualDirection: 'v',
    voiceover: 'קפה ב-29.90 ₪.',
    cta: 'בואו',
    rationale: 'r',
    complexity: 'LOW',
    estimatedDurationSec: 20,
  };

  it('flags a slow hook, labels and two messages in one ad', () => {
    const codes = (c: CreativeConcept) => conceptQa(c).map((i) => i.code);
    expect(
      codes({ ...concept, hook: 'זה משפט פתיחה ארוך מדי שלא יגיע לנקודה בשתי שניות הראשונות של המודעה' }),
    ).toContain('HOOK_TOO_LONG');
    expect(codes({ ...concept, hook: 'דיבור: רגע' })).toContain('LABEL_IN_COPY');
    expect(codes({ ...concept, voiceover: 'קפה ב-29.90 ₪, ועוגה ב-15 ₪.' })).toContain('MULTIPLE_MESSAGES');
    // Stored concepts from before Phase 3 have no strategy: only a warning.
    expect(conceptQa(concept).every((i) => i.severity === 'warning')).toBe(true);
  });

  it('flags repeated framing+motion, two offers and long on-screen text', () => {
    const scene = (key: string, order: number, extra: object) => ({
      key,
      order,
      role: 'PRODUCT' as const,
      durationSec: 4,
      visual: 'v',
      visualKind: 'PHOTO' as const,
      voiceover: 'x',
      requiredAssets: [],
      motion: { preset: 'pan-left' as const },
      quality: {
        requiresHumanMotion: false,
        requiresComplexAction: false,
        requiresProductAccuracy: false,
        brandCritical: false,
      },
      direction: { purpose: 'p', shot: 'close-up' as const },
      ...extra,
    });
    const sb = {
      conceptKey: 'x',
      aspectRatio: '9:16',
      scenes: [
        scene('hook', 0, { role: 'HOOK' }),
        scene('product', 1, {}),
        scene('offer', 2, { role: 'OFFER', onScreenText: 'קפה ומאפה במחיר מיוחד רק השבוע אצלנו בסניף' }),
        scene('offer-2', 3, { role: 'OFFER', motion: { preset: 'static' } }),
        scene('cta', 4, {
          role: 'CTA',
          motion: { preset: 'parallax' },
          direction: { purpose: 'p', shot: 'wide' },
        }),
      ],
    } as Storyboard;
    const codes = storyboardQa(sb).map((i) => i.code);
    expect(codes).toContain('NO_VISUAL_VARIETY');
    expect(codes).toContain('MULTIPLE_OFFERS');
    expect(codes).toContain('TEXT_TOO_LONG');
    expect(codes).toContain('CTA_WITHOUT_TEXT');
  });

  it('makes the model try again when a hook is too slow (and accepts the fixed answer)', async () => {
    const good = (
      await provider.generateStructured({
        task: 'creative.concepts',
        system: '',
        prompt: '',
        input: { business: DEMO_BUSINESS, brief: briefFor('OFFER') },
        jsonSchema: {},
      })
    ).data as ConceptSetLlm;
    const bad: ConceptSetLlm = {
      ...good,
      concepts: good.concepts.map((c, i) =>
        i === 1 ? { ...c, hook: 'נמאס לכם כל בוקר מחדש לשתות קפה סתמי ולא טעים בדרך לעבודה המשעממת' } : c,
      ),
    };
    const outputs: unknown[] = [bad, good];
    const calls: StructuredGenerationRequest[] = [];
    const scripted: LlmProvider = {
      id: 'fake',
      model: 'm',
      paid: false,
      async generateStructured(req) {
        calls.push(req);
        return {
          data: outputs.shift(),
          usage: { provider: 'fake', model: 'm', chargeType: 'SIMULATED', costUsd: 0 },
        };
      },
    };
    const { conceptSet } = await generateConcepts(
      { business: DEMO_BUSINESS, brief: briefFor('OFFER') },
      { provider: scripted },
    );
    expect(calls).toHaveLength(2);
    expect(conceptSet.concepts[1]!.hook).toBe(good.concepts[1]!.hook);
  });
});
