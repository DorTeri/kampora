import { describe, expect, it } from 'vitest';
import type { StoryboardScene } from '@kampora/shared';
import { mentions, sceneComposition, subjectsIn } from './composition';
import { planSceneVisual, type PlanSceneVisualInput } from './visual-planner';

const scene = (overrides: Partial<StoryboardScene> = {}): StoryboardScene => ({
  key: 'product',
  order: 1,
  role: 'PRODUCT',
  durationSec: 4,
  visual: 'זר פרחים על השולחן',
  visualKind: 'PHOTO',
  voiceover: 'פרחים טריים כל יום',
  requiredAssets: [],
  motion: { preset: 'pan-left' },
  quality: {
    requiresHumanMotion: false,
    requiresComplexAction: false,
    requiresProductAccuracy: false,
    brandCritical: false,
  },
  ...overrides,
});

const bakery = [{ name: 'קפה' }, { name: 'מאפים' }];
const florist = [{ name: 'ורדים' }, { name: 'זרי כלה' }, { name: 'עציצים' }];

const input = (overrides: Partial<PlanSceneVisualInput> = {}): PlanSceneVisualInput => ({
  scene: scene(),
  business: {
    name: 'Flora',
    category: 'חנות פרחים',
    tone: 'friendly',
    brandColors: {
      primary: '#7c3aed',
      secondary: '#f59e0b',
      accent: '#10b981',
      background: '#ffffff',
      text: '#111111',
    },
    products: florist,
  },
  references: [],
  lookSeed: 'project-1',
  aspect: '9:16',
  variant: 0,
  provider: { id: 'openai', model: 'gpt-image-2', quality: 'medium' },
  ...overrides,
});

describe('Hebrew subject matching', () => {
  it('matches across prefixes and singular/plural', () => {
    expect(mentions('קלוז-אפ על קפה ומאפה', 'מאפים')).toBe(true);
    expect(mentions('קלוז-אפ על קפה ומאפה', 'קפה')).toBe(true);
    expect(mentions('שלושה קרואסונים', 'croissant')).toBe(false);
    expect(mentions('fresh croissants on a tray', 'croissant')).toBe(true);
    expect(mentions('הורדים בחלון', 'ורדים')).toBe(true);
    expect(mentions('כוס תה', 'קפה')).toBe(false);
  });

  it('finds the business products a visual names, in the order of the visual', () => {
    expect(subjectsIn('קלוז-אפ קולנועי על קפה ומאפה, אור בוקר חם', bakery)).toEqual(['קפה', 'מאפים']);
    expect(subjectsIn('פריסת מוצרים טריים על הדלפק', bakery)).toEqual([]);
  });
});

describe('sceneComposition', () => {
  it('uses the storyboard composition when it has one', () => {
    const c = sceneComposition(
      scene({
        direction: {
          purpose: 'x',
          shot: 'detail',
          composition: { type: 'ASSORTMENT', subjects: [{ name: 'ורדים', quantity: 5 }] },
        },
      }),
      florist,
    );
    expect(c).toEqual({
      type: 'ASSORTMENT',
      subjects: [{ name: 'ורדים', quantity: 5 }],
      source: 'STORYBOARD',
    });
  });

  it('infers it from the visual for older storyboards', () => {
    expect(sceneComposition(scene({ visual: 'פריסת מוצרים טריים על הדלפק' }), bakery)).toMatchObject({
      type: 'ASSORTMENT',
      source: 'INFERRED',
      subjects: [{ name: 'קפה' }, { name: 'מאפים' }],
    });
    expect(sceneComposition(scene({ visual: 'מבחר זרים בחלון הראווה' }), florist).type).toBe('ASSORTMENT');
    expect(sceneComposition(scene({ visual: 'a variety of bouquets' }), florist).type).toBe('ASSORTMENT');
    expect(
      sceneComposition(scene({ role: 'CTA', visual: 'חזית/פנים העסק עם לוגו וכתובת' }), bakery).type,
    ).toBe('ENVIRONMENT');
    expect(sceneComposition(scene({ visual: 'לקוחות נהנים מזר בחנות' }), florist).type).toBe('LIFESTYLE');
    expect(sceneComposition(scene({ visual: 'הכנת זר כלה על השולחן' }), florist).type).toBe('DEMONSTRATION');
    expect(sceneComposition(scene({ visual: 'מרקם עלי הכותרת' }), florist).type).toBe('DETAIL');
  });

  it('a hero naming two products keeps both, one of each', () => {
    expect(sceneComposition(scene({ role: 'HOOK', visual: 'קלוז-אפ על קפה ומאפה' }), bakery)).toEqual({
      type: 'SINGLE_HERO',
      subjects: [
        { name: 'קפה', quantity: 1 },
        { name: 'מאפים', quantity: 1 },
      ],
      source: 'INFERRED',
    });
  });
});

describe('planSceneVisual framing priority', () => {
  it('an assortment asked for as a detail shot stays an assortment (regression: V1 product scene)', () => {
    const plan = planSceneVisual(
      input({
        scene: scene({
          visual: 'פריסת מוצרים טריים על הדלפק',
          direction: { purpose: 'להראות מה מקבלים בפועל', shot: 'detail' },
        }),
        business: { ...input().business, products: bakery },
      }),
    );
    expect(plan.composition?.type).toBe('ASSORTMENT');
    expect(plan.prompt).not.toContain('macro detail shot of one meaningful element');
    expect(plan.prompt).toMatch(/at least 3 distinct items/);
    expect(plan.conflicts?.map((c) => c.code)).toContain('SHOT_TOO_TIGHT');
    // The requirement comes before any framing guidance and says it wins.
    const required = plan.prompt.indexOf('Required in frame');
    expect(required).toBeGreaterThan(-1);
    expect(required).toBeLessThan(plan.prompt.indexOf('Framing:'));
    expect(plan.prompt).toMatch(/override any framing/i);
  });

  it('is not specific to one business: a florist assortment behaves the same', () => {
    const plan = planSceneVisual(
      input({
        scene: scene({
          visual: 'מבחר זרים בחלון הראווה',
          direction: { purpose: 'x', shot: 'extreme-close-up' },
        }),
      }),
    );
    expect(plan.composition?.type).toBe('ASSORTMENT');
    expect(plan.conflicts?.map((c) => c.code)).toContain('SHOT_TOO_TIGHT');
    expect(plan.prompt).not.toContain('texture and detail fill the frame');
  });

  it('explicit subjects and quantities reach the prompt', () => {
    const plan = planSceneVisual(
      input({
        scene: scene({
          direction: {
            purpose: 'x',
            shot: 'close-up',
            composition: {
              type: 'SINGLE_HERO',
              subjects: [
                { name: 'זר ורדים', quantity: 1 },
                { name: 'כרטיס ברכה', quantity: 1 },
              ],
            },
          },
        }),
      }),
    );
    expect(plan.prompt).toContain('זר ורדים (1)');
    expect(plan.prompt).toContain('כרטיס ברכה (1)');
    expect(plan.conflicts).toEqual([]);
  });

  it('an extreme close-up cannot hold two required subjects: it is widened and the conflict recorded', () => {
    const plan = planSceneVisual(
      input({
        scene: scene({
          role: 'HOOK',
          visual: 'קלוז-אפ על קפה ומאפה',
          direction: { purpose: 'x', shot: 'extreme-close-up' },
        }),
        business: { ...input().business, products: bakery },
      }),
    );
    expect(plan.conflicts?.map((c) => c.code)).toContain('SHOT_TOO_TIGHT');
    expect(plan.prompt).toMatch(/all 2 required subjects/);
  });

  it('a wide place shot drops a macro lens look and never invents signage', () => {
    // lookSeed chosen so the project look is the macro one.
    const seed = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].find((s) =>
      planSceneVisual(input({ lookSeed: s })).look.includes('macro'),
    )!;
    const plan = planSceneVisual(
      input({
        lookSeed: seed,
        scene: scene({
          role: 'CTA',
          visual: 'חזית/פנים העסק עם לוגו וכתובת',
          direction: { purpose: 'x', shot: 'wide' },
        }),
      }),
    );
    expect(plan.composition?.type).toBe('ENVIRONMENT');
    expect(plan.prompt).not.toMatch(/macro lens/);
    const codes = plan.conflicts?.map((c) => c.code);
    expect(codes).toContain('LENS_CONTRADICTS_FRAMING');
    expect(codes).toContain('TEXT_IN_PICTURE');
    expect(plan.prompt).toMatch(/generic stand-in/i);
    expect(plan.authenticity).toBe('SYNTHETIC_AI');
  });

  it('a product-accurate scene without a product photo is planned as a labelled generic stand-in', () => {
    const plan = planSceneVisual(
      input({
        scene: scene({
          quality: { ...scene().quality, requiresProductAccuracy: true },
        }),
      }),
    );
    expect(plan.authenticity).toBe('SYNTHETIC_AI');
    expect(plan.conflicts?.map((c) => c.code)).toContain('PRODUCT_ACCURACY_WITHOUT_REFERENCE');
    expect(plan.prompt).toMatch(/generic, unbranded/);
  });

  it('with the real product photo attached the plan is reference-guided and has no stand-in warning', () => {
    const plan = planSceneVisual(
      input({
        scene: scene({ quality: { ...scene().quality, requiresProductAccuracy: true } }),
        references: [{ id: 'photo-1', description: 'ורדים' }],
      }),
    );
    expect(plan.authenticity).toBe('REFERENCE_GUIDED_AI');
    expect(plan.conflicts).toEqual([]);
    expect(plan.prompt).toMatch(/real product/);
    // The verified constraint is stated before the scene and its framing.
    expect(plan.prompt.indexOf('real product')).toBeLessThan(plan.prompt.indexOf('Scene (described'));
  });
});
