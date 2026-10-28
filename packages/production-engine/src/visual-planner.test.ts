import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICE_CATALOG, PriceCatalog } from '@kampora/cost-engine';
import type { AvailableAsset, StoryboardScene } from '@kampora/shared';
import { routeScene, type RouterContext } from './router';
import {
  IMAGE_ALWAYS_AVOID,
  pickReferenceImages,
  planSceneVisual,
  type PlanSceneVisualInput,
} from './visual-planner';

const catalog = new PriceCatalog(DEFAULT_PRICE_CATALOG);

const scene = (overrides: Partial<StoryboardScene> = {}): StoryboardScene => ({
  key: 'hook',
  order: 0,
  role: 'HOOK',
  durationSec: 3,
  visual: 'כוס קפה מהבילה על שולחן עץ בבוקר',
  visualKind: 'PHOTO',
  voiceover: 'בוקר טוב',
  requiredAssets: [{ kind: 'image', description: 'coffee', tags: ['coffee'] }],
  motion: { preset: 'ken-burns-in' },
  quality: {
    requiresHumanMotion: false,
    requiresComplexAction: false,
    requiresProductAccuracy: false,
    brandCritical: false,
  },
  ...overrides,
});

const input = (overrides: Partial<PlanSceneVisualInput> = {}): PlanSceneVisualInput => ({
  scene: scene(),
  business: {
    name: 'Luz',
    category: 'בית קפה',
    tone: 'warm',
    brandColors: {
      primary: '#7c3aed',
      secondary: '#f59e0b',
      accent: '#10b981',
      background: '#ffffff',
      text: '#111111',
    },
  },
  references: [],
  lookSeed: 'project-1',
  aspect: '9:16',
  variant: 0,
  provider: { id: 'openai', model: 'gpt-image-2', quality: 'medium' },
  ...overrides,
});

describe('planSceneVisual', () => {
  it('is deterministic and always forbids text, letters and logos', () => {
    const a = planSceneVisual(input());
    const b = planSceneVisual(input());
    expect(a).toEqual(b);
    for (const rule of IMAGE_ALWAYS_AVOID) expect(a.avoid).toContain(rule);
    expect(a.prompt).toMatch(/no text of any kind/i);
    expect(a.prompt).toContain('כוס קפה מהבילה');
    expect(a.prompt).toContain('#7c3aed');
  });

  it('defaults to photography, never illustration', () => {
    expect(planSceneVisual(input()).style).toBe('lifestyle-photo');
    expect(planSceneVisual(input({ scene: scene({ role: 'PRODUCT' }) })).style).toBe('photoreal-product');
    expect(
      planSceneVisual(input({ strategy: { visualStyle: 'cinematic', emotionalDirection: 'calm' } })).style,
    ).toBe('cinematic');
  });

  it('shares one look across the scenes of an ad', () => {
    const hook = planSceneVisual(input());
    const cta = planSceneVisual(input({ scene: scene({ key: 'cta', role: 'CTA', order: 3 }) }));
    expect(hook.look).toBe(cta.look);
    expect(hook.shot).not.toBe(cta.shot);
  });

  it('fingerprint changes with variant, references and model but not with nothing', () => {
    const base = planSceneVisual(input()).fingerprint;
    expect(planSceneVisual(input({ variant: 1 })).fingerprint).not.toBe(base);
    expect(planSceneVisual(input({ references: [{ id: 'photo-1', description: '' }] })).fingerprint).not.toBe(
      base,
    );
    expect(
      planSceneVisual(input({ provider: { id: 'openai', model: 'gpt-image-2', quality: 'high' } }))
        .fingerprint,
    ).not.toBe(base);
  });

  it('tells the model to keep the referenced product exact', () => {
    const plan = planSceneVisual(input({ references: [{ id: 'photo-1', description: 'bag' }] }));
    expect(plan.referenceAssetIds).toEqual(['photo-1']);
    expect(plan.prompt).toMatch(/real product/);
  });
});

describe('pickReferenceImages', () => {
  const asset = (id: string, tags: string[], extra: Partial<AvailableAsset> = {}): AvailableAsset => ({
    id,
    kind: 'image',
    description: '',
    tags,
    commercialUse: true,
    ...extra,
  });
  it('picks commercially usable matching photos, best first, bounded', () => {
    const picked = pickReferenceImages(scene(), [
      asset('a', ['coffee']),
      asset('b', ['coffee'], { commercialUse: false }),
      asset('c', ['tea']),
      asset('d', ['coffee'], { kind: 'video' }),
    ]);
    expect(picked.map((a) => a.id)).toEqual(['a']);
  });
});

describe('routeScene with an approved AI image', () => {
  const ctx: RouterContext = {
    qualityTier: 'standard',
    remainingBudgetUsd: 5,
    perGenerationMaxUsd: 1,
    allowTextToVideo: false,
    catalog,
  };
  const approved: AvailableAsset = {
    id: 'ai-1',
    kind: 'image',
    description: '',
    tags: ['scene:hook'],
    commercialUse: true,
  };

  it('plans a paid generation without an image, and none once one is approved', () => {
    const before = routeScene(scene(), [], ctx);
    expect(before.strategy).toBe('AI_IMAGE_MOTION');
    expect(before.generations).toHaveLength(1);
    const after = routeScene(scene(), [approved], { ...ctx, approvedImageId: 'ai-1' });
    expect(after.strategy).toBe('AI_IMAGE_MOTION');
    expect(after.assetIds).toEqual(['ai-1']);
    expect(after.generations).toEqual([]);
    expect(after.estimatedCostUsd).toBe(0);
  });

  it('a free image provider plans an unpaid generation', () => {
    const plan = routeScene(scene(), [], {
      ...ctx,
      imagePrice: catalog.find('mock', 'mock-image-v1', 'IMAGE_GENERATION'),
    });
    expect(plan.generations[0]!.paid).toBe(false);
  });

  it('parallax scenes keep layered parallax with the approved image', () => {
    const plan = routeScene(scene({ motion: { preset: 'parallax' } }), [approved], {
      ...ctx,
      approvedImageId: 'ai-1',
    });
    expect(plan.strategy).toBe('LAYERED_PARALLAX');
  });
});
