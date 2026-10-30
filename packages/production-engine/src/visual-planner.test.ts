import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICE_CATALOG, PriceCatalog } from '@kampora/cost-engine';
import type { AvailableAsset, StoryboardScene } from '@kampora/shared';
import { routeScene, type RouterContext } from './router';
import {
  IMAGE_ALWAYS_AVOID,
  pickReferenceImages,
  regenerationVariant,
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

  it('follows the Art Director: photography direction and calm space for the text', () => {
    const plain = planSceneVisual(input());
    const art = {
      photography: {
        style: 'lifestyle-photo' as const,
        direction: 'a real everyday moment, natural light',
        avoid: ['text or letters in the picture', 'staged smiles'],
      },
      composition: {
        imageRole: 'HERO' as const,
        subject: 'LIFESTYLE' as const,
        negativeSpace: 'BOTTOM' as const,
      },
    };
    const directed = planSceneVisual(input({ artDirection: art }));
    expect(directed.prompt).toContain('Art direction: a real everyday moment, natural light.');
    expect(directed.prompt).toMatch(/bottom third of the frame carries the ad's text/);
    expect(directed.avoid).toContain('staged smiles');
    expect(directed.fingerprint).not.toBe(plain.fingerprint);
    // Without art direction the plan (and its cached image) is unchanged.
    expect(plain.prompt).not.toContain('Art direction');
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

  it('a new version after a rejection asks for a different take, keeping the ad look', () => {
    const v0 = planSceneVisual(input());
    const v1 = planSceneVisual(input({ variant: 1 }));
    const v2 = planSceneVisual(input({ variant: 2 }));
    expect(v1.prompt).not.toBe(v0.prompt);
    expect(v2.prompt).not.toBe(v1.prompt);
    expect(v1.prompt).toMatch(/different/i);
    expect(v1.look).toBe(v0.look);
    expect(v1.prompt).toContain(v0.look);
    expect(v0.prompt).not.toMatch(/different camera/i);
  });

  it('tells the model to keep the referenced product exact', () => {
    const plan = planSceneVisual(input({ references: [{ id: 'photo-1', description: 'bag' }] }));
    expect(plan.referenceAssetIds).toEqual(['photo-1']);
    expect(plan.prompt).toMatch(/real product/);
  });
});

describe('regenerationVariant', () => {
  it('counts only earlier takes that produced a picture', () => {
    expect(regenerationVariant([])).toBe(0);
    // The provider refused v1 (no picture): v2 is still the first take, not an "alternative".
    expect(regenerationVariant([{ status: 'FAILED' }])).toBe(0);
    expect(
      regenerationVariant([{ status: 'SUCCEEDED' }, { status: 'FAILED' }, { status: 'SUCCEEDED' }]),
    ).toBe(2);
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

  it('only sends photo formats the image providers accept (an SVG illustration is not a product photo)', () => {
    const picked = pickReferenceImages(scene(), [
      asset('svg', ['coffee'], { mimeType: 'image/svg+xml' }),
      asset('gif', ['coffee'], { mimeType: 'image/gif' }),
      asset('jpg', ['coffee'], { mimeType: 'image/jpeg' }),
      asset('webp', ['coffee'], { mimeType: 'image/webp' }),
    ]);
    expect(picked.map((a) => a.id)).toEqual(['jpg', 'webp']);
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

  it('when the real product must appear, the business own product photo wins over an approved AI image', () => {
    const photo: AvailableAsset = {
      id: 'photo-1',
      kind: 'image',
      description: 'coffee',
      tags: ['coffee'],
      mimeType: 'image/jpeg',
      source: 'CUSTOMER_UPLOAD',
      commercialUse: true,
    };
    const accurate = scene({ quality: { ...scene().quality, requiresProductAccuracy: true } });
    const plan = routeScene(accurate, [photo, approved], { ...ctx, approvedImageId: 'ai-1' });
    expect(plan.strategy).toBe('EXISTING_IMAGE_MOTION');
    expect(plan.assetIds).toEqual(['photo-1']);
    expect(plan.reasons.join(' ')).toMatch(/real product/);
    // Where fidelity does not matter the owner's choice of the AI image stands.
    expect(routeScene(scene(), [photo, approved], { ...ctx, approvedImageId: 'ai-1' }).assetIds).toEqual([
      'ai-1',
    ]);
    // An illustration is not a product photo, so it never displaces the approved image.
    const svg = { ...photo, id: 'svg', mimeType: 'image/svg+xml' };
    expect(routeScene(accurate, [svg, approved], { ...ctx, approvedImageId: 'ai-1' }).assetIds).toEqual([
      'ai-1',
    ]);
  });

  it('parallax scenes keep layered parallax with the approved image', () => {
    const plan = routeScene(scene({ motion: { preset: 'parallax' } }), [approved], {
      ...ctx,
      approvedImageId: 'ai-1',
    });
    expect(plan.strategy).toBe('LAYERED_PARALLAX');
  });
});
