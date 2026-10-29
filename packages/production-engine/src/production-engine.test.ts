import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICE_CATALOG, PriceCatalog } from '@kampora/cost-engine';
import type { AvailableAsset, MediaAsset, Storyboard, StoryboardScene } from '@kampora/shared';
import {
  DEMO_BUSINESS,
  DEMO_CAMPAIGN_REQUEST,
  MockCreativeLlmProvider,
  generateCampaignBrief,
  generateConcepts,
  generateStoryboard,
} from '@kampora/creative-engine';
import { routeScene, type RouterContext } from './router';
import { planProduction } from './planner';
import { buildVideoProject } from './timeline';
import { diffStoryboards } from './invalidation';

const catalog = new PriceCatalog(DEFAULT_PRICE_CATALOG);
const ctx: RouterContext = {
  qualityTier: 'standard',
  remainingBudgetUsd: 5,
  perGenerationMaxUsd: 1,
  allowTextToVideo: false,
  catalog,
};

const scene = (overrides: Partial<StoryboardScene> = {}): StoryboardScene => ({
  key: 's1',
  order: 0,
  role: 'PRODUCT',
  durationSec: 5,
  visual: 'product shot',
  visualKind: 'PHOTO',
  voiceover: 'טקסט',
  requiredAssets: [{ kind: 'image', description: 'product', tags: ['product'] }],
  motion: { preset: 'ken-burns-in' },
  quality: {
    requiresHumanMotion: false,
    requiresComplexAction: false,
    requiresProductAccuracy: false,
    brandCritical: false,
  },
  ...overrides,
});

const image: AvailableAsset = {
  id: 'img-product',
  kind: 'image',
  description: '',
  tags: ['product'],
  commercialUse: true,
};
const video: AvailableAsset = {
  id: 'vid-product',
  kind: 'video',
  description: '',
  tags: ['product'],
  commercialUse: true,
};

describe('routeScene', () => {
  it('prefers existing footage', () => {
    expect(routeScene(scene(), [image, video], ctx).strategy).toBe('EXISTING_VIDEO');
  });

  it('animates an existing image programmatically at zero generation cost', () => {
    const plan = routeScene(scene(), [image], ctx);
    expect(plan.strategy).toBe('EXISTING_IMAGE_MOTION');
    expect(plan.estimatedCostUsd).toBe(0);
    expect(plan.assetIds).toEqual(['img-product']);
  });

  it('uses layered parallax when the scene asks for depth', () => {
    expect(routeScene(scene({ motion: { preset: 'parallax' } }), [image], ctx).strategy).toBe(
      'LAYERED_PARALLAX',
    );
  });

  it('ignores assets without commercial-use rights', () => {
    const plan = routeScene(scene(), [{ ...image, commercialUse: false }], ctx);
    expect(plan.strategy).toBe('AI_IMAGE_MOTION');
  });

  it('routes graphic scenes to motion graphics', () => {
    expect(routeScene(scene({ visualKind: 'GRAPHIC', role: 'OFFER' }), [image], ctx).strategy).toBe(
      'MOTION_GRAPHICS',
    );
  });

  it('never plans generated motion while no video provider can generate', () => {
    const plan = routeScene(
      scene({ quality: { ...scene().quality, requiresHumanMotion: true } }),
      [image],
      ctx,
    );
    expect(plan.strategy).toBe('EXISTING_IMAGE_MOTION');
    expect(plan.generations).toEqual([]);
    expect(plan.warnings.join(' ')).toMatch(/DOWNGRADED/);
  });

  it('plans image-to-video for real human motion, reusing the image as reference', () => {
    const plan = routeScene(scene({ quality: { ...scene().quality, requiresHumanMotion: true } }), [image], {
      ...ctx,
      videoGenerationAvailable: true,
    });
    expect(plan.strategy).toBe('AI_IMAGE_TO_VIDEO');
    expect(plan.generations.map((g) => g.operation)).toEqual(['IMAGE_TO_VIDEO']);
    expect(plan.estimatedCostUsd).toBeCloseTo(0.6);
  });

  it('never fakes human motion: downgrades with an explicit warning when unaffordable', () => {
    const plan = routeScene(scene({ quality: { ...scene().quality, requiresHumanMotion: true } }), [image], {
      ...ctx,
      remainingBudgetUsd: 0.1,
    });
    expect(plan.strategy).toBe('EXISTING_IMAGE_MOTION');
    expect(plan.warnings.join(' ')).toContain('DOWNGRADED');
  });

  it('does not generate look-alike products without a reference', () => {
    const plan = routeScene(
      scene({ quality: { ...scene().quality, requiresProductAccuracy: true } }),
      [],
      ctx,
    );
    expect(plan.strategy).toBe('MOTION_GRAPHICS');
    expect(plan.warnings[0]).toContain('product');
  });

  it('only uses text-to-video when explicitly allowed', () => {
    // A catalog where image-to-video is unaffordable but text-to-video fits, to isolate the opt-in rule.
    const skewed = new PriceCatalog(
      DEFAULT_PRICE_CATALOG.map((e) =>
        e.operation === 'IMAGE_TO_VIDEO'
          ? { ...e, unitPriceUsd: 5 }
          : e.operation === 'TEXT_TO_VIDEO'
            ? { ...e, unitPriceUsd: 0.1 }
            : e,
      ),
    );
    const s = scene({ quality: { ...scene().quality, requiresComplexAction: true } });
    const video = { ...ctx, catalog: skewed, videoGenerationAvailable: true };
    expect(routeScene(s, [image], video).strategy).toBe('EXISTING_IMAGE_MOTION');
    expect(routeScene(s, [image], { ...video, allowTextToVideo: true }).strategy).toBe('AI_TEXT_TO_VIDEO');
  });

  it('never generates in draft tier', () => {
    expect(routeScene(scene(), [], { ...ctx, qualityTier: 'draft' }).strategy).toBe('MOTION_GRAPHICS');
  });
});

describe('creative → plan → timeline pipeline (mock provider)', () => {
  const demoAssets: AvailableAsset[] = [
    { id: 'a-hero', kind: 'image', description: 'cup', tags: ['hero', 'coffee'], commercialUse: true },
    { id: 'a-product', kind: 'image', description: 'pastries', tags: ['product'], commercialUse: true },
    { id: 'a-store', kind: 'image', description: 'interior', tags: ['store'], commercialUse: true },
  ];
  const mediaAssets: MediaAsset[] = [
    ...demoAssets.map((a) => ({
      id: a.id,
      kind: 'image' as const,
      storageKey: `demo/${a.id}.svg`,
      mimeType: 'image/svg+xml',
      provenance: { source: 'DEMO' as const, license: 'Kampora demo asset', commercialUse: true },
    })),
    {
      id: 'a-music',
      kind: 'audio',
      storageKey: 'demo/music.wav',
      mimeType: 'audio/wav',
      provenance: { source: 'PROGRAMMATIC', license: 'Generated by Kampora', commercialUse: true },
    },
  ];

  it('produces a valid 15–30s RTL VideoProject with no paid generation', async () => {
    const provider = new MockCreativeLlmProvider();
    const brief = await generateCampaignBrief(
      {
        business: DEMO_BUSINESS,
        request: DEMO_CAMPAIGN_REQUEST,
        defaults: { budgetUsd: 5, qualityTier: 'standard', targetDurationSec: 20 },
      },
      { provider },
    );
    const { conceptSet, claimFlags } = await generateConcepts(
      { business: DEMO_BUSINESS, brief },
      { provider },
    );
    expect(claimFlags).toEqual([]);
    const concept = conceptSet.concepts.find((c) => c.key === conceptSet.recommendedKey)!;
    const { storyboard } = await generateStoryboard(
      { business: DEMO_BUSINESS, brief, concept, assets: demoAssets },
      { provider },
    );
    const plan = planProduction({
      storyboard,
      assets: demoAssets,
      budgetUsd: 5,
      perGenerationMaxUsd: 1,
      qualityTier: 'standard',
      catalog,
    });

    expect(plan.scenes.map((s) => s.strategy)).toEqual([
      'EXISTING_IMAGE_MOTION',
      'EXISTING_IMAGE_MOTION',
      'MOTION_GRAPHICS',
      'LAYERED_PARALLAX',
    ]);
    expect(plan.requiresPaidApproval).toBe(false);
    expect(plan.estimatedPaidCostUsd).toBe(0);

    const project = buildVideoProject({
      projectId: 'p1',
      title: 'demo',
      business: DEMO_BUSINESS,
      brief,
      storyboard,
      plan,
      assets: mediaAssets,
      musicAssetId: 'a-music',
    });
    const seconds = project.scenes.reduce((s, x) => s + x.durationInFrames, 0) / project.output.fps;
    expect(seconds).toBeGreaterThanOrEqual(15);
    expect(seconds).toBeLessThanOrEqual(30);
    expect(project.direction).toBe('rtl');
    const offer = project.scenes[2]!;
    expect(offer.overlays).toContainEqual({ type: 'price-tag', price: '29.90 ₪', label: 'קפה + מאפה' });
    expect(project.scenes[3]!.overlays.some((o) => o.type === 'cta')).toBe(true);
  });

  it('drops the CTA caption only when the card already shows what is said', async () => {
    const provider = new MockCreativeLlmProvider();
    const brief = await generateCampaignBrief(
      {
        business: DEMO_BUSINESS,
        request: DEMO_CAMPAIGN_REQUEST,
        defaults: { budgetUsd: 5, qualityTier: 'standard', targetDurationSec: 20 },
      },
      { provider },
    );
    const { conceptSet } = await generateConcepts({ business: DEMO_BUSINESS, brief }, { provider });
    const concept = conceptSet.concepts.find((c) => c.key === conceptSet.recommendedKey)!;
    const { storyboard } = await generateStoryboard(
      { business: DEMO_BUSINESS, brief, concept, assets: demoAssets },
      { provider },
    );
    const plan = planProduction({
      storyboard,
      assets: demoAssets,
      budgetUsd: 5,
      perGenerationMaxUsd: 1,
      qualityTier: 'standard',
      catalog,
    });
    const build = (ctaVoiceover: string) =>
      buildVideoProject({
        projectId: 'p1',
        title: 'demo',
        business: DEMO_BUSINESS,
        brief,
        storyboard: {
          ...storyboard,
          scenes: storyboard.scenes.map((s) => (s.role === 'CTA' ? { ...s, voiceover: ctaVoiceover } : s)),
        },
        plan,
        assets: mediaAssets,
      });

    const cta = build(`${brief.cta} – ${DEMO_BUSINESS.address}.`).scenes.at(-1)!;
    expect(cta.overlays.some((o) => o.type === 'cta')).toBe(true);
    expect(cta.caption).toBeUndefined();

    const extra = build('קפצו אלינו היום, הקרואסונים יוצאים מהתנור בשמונה').scenes.at(-1)!;
    expect(extra.caption?.text).toMatch(/קרואסונים/);
    // Other scenes keep their captions.
    expect(build('x').scenes[0]!.caption).toBeDefined();
  });

  it('stretches a scene to fit its voiceover', async () => {
    const provider = new MockCreativeLlmProvider();
    const brief = await generateCampaignBrief(
      {
        business: DEMO_BUSINESS,
        request: DEMO_CAMPAIGN_REQUEST,
        defaults: { budgetUsd: 5, qualityTier: 'standard', targetDurationSec: 20 },
      },
      { provider },
    );
    const { conceptSet } = await generateConcepts({ business: DEMO_BUSINESS, brief }, { provider });
    const { storyboard } = await generateStoryboard(
      { business: DEMO_BUSINESS, brief, concept: conceptSet.concepts[0]!, assets: demoAssets },
      { provider },
    );
    const plan = planProduction({
      storyboard,
      assets: demoAssets,
      budgetUsd: 5,
      perGenerationMaxUsd: 1,
      qualityTier: 'standard',
      catalog,
    });
    const withVoice = buildVideoProject({
      projectId: 'p1',
      title: 'demo',
      business: DEMO_BUSINESS,
      brief,
      storyboard,
      plan,
      assets: [
        ...mediaAssets,
        {
          id: 'vo-hook',
          kind: 'audio',
          storageKey: 'vo/hook.mp3',
          mimeType: 'audio/mpeg',
          provenance: { source: 'CUSTOMER_UPLOAD', license: 'owned', commercialUse: true },
        },
      ],
      voiceovers: { hook: { assetId: 'vo-hook', durationSec: 6 } },
    });
    // First scene: 0.3s lead-in + 6s measured speech + 0.4s tail, never cut or sped up.
    expect(withVoice.scenes[0]!.durationInFrames).toBe(Math.ceil(6.7 * 30));
    expect(withVoice.scenes[0]!.voiceover).toMatchObject({ startOffsetFrames: 9, durationInFrames: 180 });
    expect(withVoice.assets.some((a) => a.id === 'vo-hook')).toBe(true);
  });
});

describe('diffStoryboards', () => {
  const base: Storyboard = {
    conceptKey: 'c',
    aspectRatio: '9:16',
    scenes: [scene({ key: 'a' }), scene({ key: 'b', order: 1 }), scene({ key: 'c', order: 2 })],
  };

  it('only invalidates the layers that changed', () => {
    const next: Storyboard = {
      ...base,
      scenes: [
        scene({ key: 'a', voiceover: 'טקסט חדש' }),
        scene({ key: 'b', order: 1, motion: { preset: 'pan-left' } }),
        scene({ key: 'd', order: 2 }),
      ],
    };
    const diff = diffStoryboards(base, next);
    expect(diff.changed).toEqual([
      { key: 'a', layers: ['voice'] },
      { key: 'b', layers: ['visual'] },
    ]);
    expect(diff.added).toEqual(['d']);
    expect(diff.removed).toEqual(['c']);
  });
});
