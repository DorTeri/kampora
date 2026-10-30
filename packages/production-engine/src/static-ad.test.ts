import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PRICE_CATALOG, PriceCatalog } from '@kampora/cost-engine';
import {
  STATIC_AD_FORMATS,
  StaticAdSchema,
  designFor,
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
import {
  StaticAdEditError,
  applyStaticAdEdit,
  buildStaticAd,
  chooseStaticAdBackground,
  staticAdQa,
} from './static-ad';
import { offerSubjects, rankBackgrounds } from './static-ad-background';

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

  it('ranks the approved AI images and the planned photos, and records why the winner won', () => {
    const ad = build();
    const used = plan.scenes.flatMap((s) => s.assetIds);
    expect(used).toContain(ad.background.assetId);
    expect(ad.background.selection?.chosenBy).toBe('AUTO');
    expect(ad.background.selection?.reasons.length).toBeGreaterThan(0);
    expect(ad.background.selection?.score).toBe(
      ad.background.selection?.reasons.reduce((s, r) => s + r.points, 0),
    );
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

describe('background ranking', () => {
  const photo = (
    id: string,
    width = 1024,
    height = 1536,
    source: MediaAsset['provenance']['source'] = 'AI_GENERATED',
  ) => media(id, { width, height, provenance: { source, license: 'x', commercialUse: true } });
  // The V1 situation: a coffee + pastry offer; one image shows both, one shows a pastry only, one the storefront.
  const v1 = [
    {
      asset: photo('hook'),
      content: 'קלוז-אפ קולנועי על קפה ומאפה, אור בוקר חם',
      authenticity: 'SYNTHETIC_AI' as const,
      campaignImage: true,
    },
    {
      asset: photo('babka'),
      content: 'פריסת מוצרים טריים על הדלפק · באבקה',
      authenticity: 'SYNTHETIC_AI' as const,
      campaignImage: true,
    },
    {
      asset: photo('store'),
      content: 'חזית/פנים העסק עם לוגו וכתובת',
      authenticity: 'SYNTHETIC_AI' as const,
      campaignImage: true,
    },
  ];
  const offer = {
    goal: 'OFFER' as const,
    offer: 'קפה + מאפה ב-29.90 ₪ עד סוף החודש',
    productName: 'קפה ומאפה',
  };
  const products = [{ name: 'קפה' }, { name: 'מאפים' }];

  it('the products on offer come from the brief, matched to the business products', () => {
    expect(offerSubjects(offer, products)).toEqual(['קפה', 'מאפים']);
    expect(offerSubjects({ productName: 'זר ורדים + אגרטל' }, [])).toEqual(['זר ורדים', 'אגרטל']);
  });

  it('a coffee + pastry offer prefers the picture that shows both, in every format (regression: V1)', () => {
    for (const format of ['1:1', '4:5', '9:16'] as const) {
      const ranked = rankBackgrounds({ format, brief: offer, business: { products }, candidates: v1 });
      expect(ranked.map((r) => r.assetId)).toEqual(['hook', 'babka', 'store']);
      const reasons = ranked[0]!.reasons.map((r) => r.code);
      expect(reasons).toContain('OFFER_SUBJECTS');
      expect(ranked[0]!.reasons.find((r) => r.code === 'OFFER_SUBJECTS')!.subjects).toEqual(['קפה', 'מאפים']);
      expect(ranked[2]!.reasons.map((r) => r.code)).toContain('SYNTHETIC_PLACE');
    }
    const ad = build({
      candidates: v1,
      assets: v1.map((c) => c.asset),
      business: { ...DEMO_BUSINESS, products },
    });
    expect(ad.background.assetId).toBe('hook');
  });

  it('the same rules hold for any business (a florist)', () => {
    const ranked = rankBackgrounds({
      format: '4:5',
      brief: { goal: 'OFFER', offer: 'זר ורדים ואגרטל ב-99 ₪', productName: 'זר ורדים ואגרטל' },
      business: { products: [{ name: 'זר ורדים' }, { name: 'אגרטל' }, { name: 'עציצים' }] },
      candidates: [
        {
          asset: photo('pots'),
          content: 'מבחר עציצים בחלון',
          authenticity: 'SYNTHETIC_AI',
          campaignImage: true,
        },
        {
          asset: photo('both'),
          content: 'זר ורדים באגרטל זכוכית',
          authenticity: 'SYNTHETIC_AI',
          campaignImage: true,
        },
      ],
    });
    expect(ranked[0]!.assetId).toBe('both');
  });

  it('the business own product photo beats a generated picture of the same products', () => {
    const own = {
      asset: photo('own', 1080, 1350, 'CUSTOMER_UPLOAD'),
      content: 'קפה ומאפה על הדלפק',
      authenticity: 'VERIFIED_PRODUCT_PHOTO' as const,
    };
    const ranked = rankBackgrounds({
      format: '4:5',
      brief: offer,
      business: { products },
      candidates: [v1[0]!, own],
    });
    expect(ranked[0]!.assetId).toBe('own');
    expect(ranked[0]!.reasons.map((r) => r.code)).toContain('REAL_PRODUCT');
  });

  it('a landscape picture loses points in a vertical format', () => {
    const wide = { ...v1[0]!, asset: photo('wide', 1536, 1024) };
    const tall = rankBackgrounds({
      format: '9:16',
      brief: offer,
      business: { products },
      candidates: [wide],
    })[0]!;
    const square = rankBackgrounds({
      format: '1:1',
      brief: offer,
      business: { products },
      candidates: [wide],
    })[0]!;
    expect(tall.score).toBeLessThan(square.score);
  });

  it('an awareness campaign prefers the place over a product close-up', () => {
    const own = [
      {
        asset: photo('place', 1080, 1350, 'CUSTOMER_UPLOAD'),
        content: 'interior',
        authenticity: 'VERIFIED_BUSINESS_PHOTO' as const,
      },
      {
        asset: photo('hero', 1080, 1350, 'CUSTOMER_UPLOAD'),
        content: 'cup',
        authenticity: 'VERIFIED_PRODUCT_PHOTO' as const,
      },
    ];
    const ranked = rankBackgrounds({
      format: '4:5',
      brief: { goal: 'AWARENESS', productName: 'בית קפה' },
      business: { products },
      candidates: own,
    });
    expect(ranked[0]!.assetId).toBe('place');
  });

  it('keeps the owner choice on rebuild, including brand color, while the picture is usable', () => {
    const base = { candidates: v1, assets: v1.map((c) => c.asset), business: { ...DEMO_BUSINESS, products } };
    const owner = build({ ...base, ownerBackground: { assetId: 'store' } });
    expect(owner.background.assetId).toBe('store');
    expect(owner.background.selection?.chosenBy).toBe('OWNER');
    expect(owner.background.selection?.authenticity).toBe('SYNTHETIC_AI');
    expect(build({ ...base, ownerBackground: {} }).background.assetId).toBeUndefined();
    // A picture that is no longer usable (e.g. the approval was withdrawn) falls back to the ranking.
    const gone = build({ ...base, ownerBackground: { assetId: 'deleted' } });
    expect(gone.background.assetId).toBe('hook');
    expect(gone.background.selection?.chosenBy).toBe('AUTO');
  });

  it('an AI background is flagged so it is never mistaken for the real business', () => {
    const base = { candidates: v1, assets: v1.map((c) => c.asset), business: { ...DEMO_BUSINESS, products } };
    expect(staticAdQa(build(base)).map((i) => i.code)).toContain('SYNTHETIC_PICTURE');
    const guided = build({
      ...base,
      candidates: v1.map((c) => ({ ...c, authenticity: 'REFERENCE_GUIDED_AI' as const })),
    });
    expect(staticAdQa(guided).map((i) => i.code)).toContain('REFERENCE_GUIDED_PICTURE');
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
    // The owner's pick is recorded as theirs, so rebuilding the ad keeps it.
    expect(swapped.background.selection).toMatchObject({ chosenBy: 'OWNER', authenticity: 'GENERIC_STOCK' });
    expect(swapped.background.selection?.reasons.map((r) => r.code)).toEqual(['OWNER_CHOICE']);
    // A text-only edit keeps how the background was chosen.
    expect(applyStaticAdEdit(ad, { headline: 'חדש' }, mediaAssets).background.selection).toEqual(
      ad.background.selection,
    );
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

describe('art-directed static ads', () => {
  const design = designFor('SPLIT', '4:5', DEMO_BUSINESS.brandColors, true);

  it('uses the Copywriter’s written headline and the Art Director’s design', () => {
    const ad = build({ copy: { headline: 'קפה ומאפה, במחיר מבצע' }, design });
    expect(ad.text.headline).toBe('קפה ומאפה, במחיר מבצע');
    expect(ad.design?.layoutFamily).toBe('SPLIT');
    expect(StaticAdSchema.safeParse(ad).success).toBe(true);
  });

  it('falls back to the family’s no-picture version when the format has no usable picture', () => {
    const noRights = mediaAssets.map((a) => ({
      ...a,
      provenance: { ...a.provenance, commercialUse: false },
    }));
    const ad = build({ assets: noRights, design });
    expect(ad.background.assetId).toBeUndefined();
    expect(ad.design?.layoutFamily).toBe('SPLIT');
    expect(ad.design?.image.mode).toBe('NONE');
  });

  it('lets the owner switch the layout family and keeps it marked as the owner’s', () => {
    const ad = build({ design });
    const edited = applyStaticAdEdit(ad, { layoutFamily: 'PREMIUM_MINIMAL' }, mediaAssets);
    expect(edited.design?.layoutFamily).toBe('PREMIUM_MINIMAL');
    expect(edited.design?.chosenBy).toBe('OWNER');
    // A later text edit keeps the owner's family.
    expect(applyStaticAdEdit(edited, { headline: 'כותרת אחרת' }, mediaAssets).design).toEqual(edited.design);
  });

  it('exposes the background it would choose, with what is known about it', () => {
    const chosen = chooseStaticAdBackground({
      id: 'x',
      format: '4:5',
      business: DEMO_BUSINESS,
      brief,
      storyboard,
      plan,
      assets: mediaAssets,
    });
    expect(chosen.asset?.id).toBe(build().background.assetId);
    expect(chosen.candidate?.composition).toBeDefined();
  });
});
