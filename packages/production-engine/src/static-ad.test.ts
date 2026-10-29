import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PRICE_CATALOG, PriceCatalog } from '@kampora/cost-engine';
import {
  STATIC_AD_FORMATS,
  StaticAdSchema,
  type AvailableAsset,
  type CampaignBrief,
  type MediaAsset,
  type ProductionPlan,
  type Storyboard,
} from '@kampora/shared';
import {
  DEMO_BUSINESS,
  DEMO_CAMPAIGN_REQUEST,
  MockCreativeLlmProvider,
  generateCampaignBrief,
  generateConcepts,
  generateStoryboard,
} from '@kampora/creative-engine';
import { planProduction } from './planner';
import { StaticAdEditError, applyStaticAdEdit, buildStaticAd, staticAdQa } from './static-ad';

const catalog = new PriceCatalog(DEFAULT_PRICE_CATALOG);
const demoAssets: AvailableAsset[] = [
  { id: 'a-hero', kind: 'image', description: 'cup', tags: ['hero', 'coffee'], commercialUse: true },
  { id: 'a-product', kind: 'image', description: 'pastries', tags: ['product'], commercialUse: true },
  { id: 'a-store', kind: 'image', description: 'interior', tags: ['store'], commercialUse: true },
];
const media = (id: string, extra: Partial<MediaAsset> = {}): MediaAsset => ({
  id,
  kind: 'image',
  storageKey: `demo/${id}.jpg`,
  mimeType: 'image/jpeg',
  width: 1080,
  height: 1350,
  provenance: { source: 'DEMO', license: 'Kampora demo asset', commercialUse: true },
  ...extra,
});
const mediaAssets = [...demoAssets.map((a) => media(a.id)), media('ai-1', { width: 1024, height: 1536 })];

let brief: CampaignBrief;
let storyboard: Storyboard;
let plan: ProductionPlan;

beforeAll(async () => {
  const provider = new MockCreativeLlmProvider();
  brief = await generateCampaignBrief(
    {
      business: DEMO_BUSINESS,
      request: DEMO_CAMPAIGN_REQUEST,
      defaults: { budgetUsd: 5, qualityTier: 'standard', targetDurationSec: 20 },
    },
    { provider },
  );
  const { conceptSet } = await generateConcepts({ business: DEMO_BUSINESS, brief }, { provider });
  const concept = conceptSet.concepts.find((c) => c.key === conceptSet.recommendedKey)!;
  ({ storyboard } = await generateStoryboard(
    { business: DEMO_BUSINESS, brief, concept, assets: demoAssets },
    { provider },
  ));
  plan = planProduction({
    storyboard,
    assets: demoAssets,
    budgetUsd: 5,
    perGenerationMaxUsd: 1,
    qualityTier: 'standard',
    catalog,
  });
});

const build = (overrides: Partial<Parameters<typeof buildStaticAd>[0]> = {}) =>
  buildStaticAd({
    id: 'ad-1',
    format: '4:5',
    business: DEMO_BUSINESS,
    brief,
    storyboard,
    plan,
    assets: mediaAssets,
    ...overrides,
  });

describe('buildStaticAd', () => {
  it('builds a valid RTL ad for every format from the approved storyboard', () => {
    for (const format of ['1:1', '4:5', '9:16'] as const) {
      const ad = build({ format });
      expect(StaticAdSchema.safeParse(ad).success).toBe(true);
      expect([ad.width, ad.height]).toEqual([
        STATIC_AD_FORMATS[format].width,
        STATIC_AD_FORMATS[format].height,
      ]);
      expect(ad.direction).toBe('rtl');
    }
    const ad = build();
    const hook = storyboard.scenes.find((s) => s.role === 'HOOK')!;
    expect(ad.text.headline).toBe(hook.onScreenText);
    expect(ad.text.price).toEqual({ price: '29.90 ₪', label: 'קפה + מאפה' });
    expect(ad.text.ctaSubtext).toBe(DEMO_BUSINESS.address);
    expect(ad.text.cta.length).toBeGreaterThan(0);
  });

  it('is deterministic and only carries the assets it uses', () => {
    expect(build()).toEqual(build());
    const ad = build();
    expect(ad.assets.map((a) => a.id)).toEqual([ad.background.assetId]);
  });

  it('prefers an approved AI image, then the photo the plan uses', () => {
    const product = storyboard.scenes.find((s) => s.role === 'PRODUCT')!;
    expect(build({ approvedImages: { [product.key]: 'ai-1' } }).background.assetId).toBe('ai-1');
    const planned = plan.scenes.find((s) => s.sceneKey === product.key)!.assetIds[0];
    expect(build().background.assetId).toBe(planned);
  });

  it('never uses a picture without commercial rights; falls back to brand color', () => {
    const noRights = mediaAssets.map((a) => ({
      ...a,
      provenance: { ...a.provenance, commercialUse: false },
    }));
    const ad = build({ assets: noRights });
    expect(ad.background.assetId).toBeUndefined();
    expect(ad.assets).toEqual([]);
    expect(staticAdQa(ad).map((i) => i.code)).toContain('NO_PHOTO');
  });

  it('cuts over-long text at a word boundary', () => {
    const long = 'מילה '.repeat(30).trim();
    const ad = build({
      storyboard: {
        ...storyboard,
        scenes: storyboard.scenes.map((s) => (s.role === 'HOOK' ? { ...s, onScreenText: long } : s)),
      },
    });
    expect(ad.text.headline.length).toBeLessThanOrEqual(70);
    expect(ad.text.headline.endsWith('מילה')).toBe(true);
  });
});

describe('applyStaticAdEdit', () => {
  it('edits words, removes optional layers with empty strings and keeps the result valid', () => {
    const ad = build();
    const edited = applyStaticAdEdit(
      ad,
      { headline: 'בוקר טוב מ-Luz', subheadline: '', price: '', cta: 'הזמינו עכשיו' },
      mediaAssets,
    );
    expect(edited.text).toMatchObject({ headline: 'בוקר טוב מ-Luz', cta: 'הזמינו עכשיו' });
    expect(edited.text.subheadline).toBeUndefined();
    expect(edited.text.price).toBeUndefined();
    expect(edited.text.ctaSubtext).toBe(ad.text.ctaSubtext);
  });

  it('swaps the background only to an allowed picture, or to brand color', () => {
    const ad = build();
    const swapped = applyStaticAdEdit(ad, { backgroundAssetId: 'a-store' }, mediaAssets);
    expect(swapped.background.assetId).toBe('a-store');
    expect(swapped.assets.map((a) => a.id)).toEqual(['a-store']);
    expect(() => applyStaticAdEdit(ad, { backgroundAssetId: 'someone-else' }, mediaAssets)).toThrow(
      StaticAdEditError,
    );
    expect(
      applyStaticAdEdit(ad, { backgroundAssetId: null }, mediaAssets).background.assetId,
    ).toBeUndefined();
  });
});

describe('staticAdQa', () => {
  it('flags long and crowded text, soft pictures and repetition', () => {
    const ad = build({ format: '1:1' });
    const crowded = applyStaticAdEdit(
      ad,
      {
        headline: 'אחת שתיים שלוש ארבע חמש שש שבע שמונה',
        subheadline: 'אחת שתיים שלוש ארבע חמש שש שבע שמונה',
        price: '10 ₪',
        ctaSubtext: 'פלורנטין 12',
      },
      mediaAssets,
    );
    const codes = staticAdQa(crowded).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['LONG_HEADLINE', 'CROWDED', 'REPEATED_TEXT']));
    const small = applyStaticAdEdit(ad, { backgroundAssetId: 'tiny' }, [
      media('tiny', { width: 540, height: 540 }),
    ]);
    expect(staticAdQa(small).map((i) => i.code)).toContain('LOW_RESOLUTION_PHOTO');
    expect(staticAdQa(build()).filter((i) => i.severity === 'error')).toEqual([]);
  });
});
