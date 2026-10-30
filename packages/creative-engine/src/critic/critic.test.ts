import { beforeAll, describe, expect, it } from 'vitest';
import { industryFor } from '@kampora/agent-expertise';
import type { LlmProvider } from '@kampora/media-providers';
import {
  REELS_SAFE_AREA,
  VideoProjectSchema,
  designFor,
  type AvailableAsset,
  type CampaignBrief,
  type ConceptSet,
  type MediaAsset,
  type ProductionPlan,
  type StaticAd,
  type Storyboard,
  type TimelineScene,
} from '@kampora/shared';
import { DEFAULT_PRICE_CATALOG, PriceCatalog } from '@kampora/cost-engine';
import { buildStaticAd, planProduction } from '@kampora/production-engine';
import { DEMO_BUSINESS, DEMO_CAMPAIGN_REQUEST } from '../demo';
import { MockCreativeLlmProvider } from '../mock-provider';
import { generateCampaignBrief, generateConcepts, generateStoryboard } from '../steps';
import { critiqueConceptSet } from './concepts';
import { critiqueOpinion, withOpinions } from './opinion';
import { criteriaFor, report } from './report';
import { reviewOnce, reviewStaticAd, routeRevisions } from './revisions';
import { critiqueStaticAd } from './static-ad';
import { critiqueVideo } from './video';

const provider = new MockCreativeLlmProvider();
const industry = industryFor(DEMO_BUSINESS).profile;
const assets: AvailableAsset[] = [
  { id: 'a-hero', kind: 'image', description: 'cup', tags: ['hero', 'coffee'], commercialUse: true },
];
const media: MediaAsset[] = [
  {
    id: 'a-hero',
    kind: 'image',
    storageKey: 'demo/a-hero.jpg',
    mimeType: 'image/jpeg',
    width: 1080,
    height: 1350,
    provenance: { source: 'DEMO', license: 'Kampora demo asset', commercialUse: true },
  },
];

let brief: CampaignBrief;
let conceptSet: ConceptSet;
let storyboard: Storyboard;
let plan: ProductionPlan;

beforeAll(async () => {
  brief = await generateCampaignBrief(
    {
      business: DEMO_BUSINESS,
      request: DEMO_CAMPAIGN_REQUEST,
      defaults: { budgetUsd: 5, qualityTier: 'standard', targetDurationSec: 20 },
    },
    { provider },
  );
  ({ conceptSet } = await generateConcepts({ business: DEMO_BUSINESS, brief }, { provider }));
  const concept = conceptSet.concepts.find((c) => c.key === conceptSet.recommendedKey)!;
  ({ storyboard } = await generateStoryboard(
    { business: DEMO_BUSINESS, brief, concept, assets },
    { provider },
  ));
  plan = planProduction({
    storyboard,
    assets,
    budgetUsd: 5,
    perGenerationMaxUsd: 1,
    qualityTier: 'standard',
    catalog: new PriceCatalog(DEFAULT_PRICE_CATALOG),
  });
});

const ad = (design?: StaticAd['design']): StaticAd => ({
  ...buildStaticAd({
    id: 'ad-1',
    format: '4:5',
    business: DEMO_BUSINESS,
    brief,
    storyboard,
    plan,
    assets: media,
    ownerBackground: { assetId: 'a-hero' },
  }),
  ...(design ? { design } : {}),
});

describe('Creative Critic: completeness and honesty', () => {
  it('reports every rubric criterion for each kind of work, each with an owner and a method', () => {
    const concepts = critiqueConceptSet(conceptSet, { business: DEMO_BUSINESS, brief, industry });
    const still = critiqueStaticAd(ad(designFor('OFFER_RETAIL', '4:5', DEMO_BUSINESS.brandColors, true)));
    const video = critiqueVideo(project(scenes(['ken-burns-in', 'pan-left', 'cinematic-zoom'])));
    for (const [results, kind] of [
      [concepts, 'CONCEPT_SET'],
      [still, 'STATIC_AD'],
      [video, 'VIDEO'],
    ] as const) {
      expect(new Set(results.map((r) => r.criterion))).toEqual(new Set(criteriaFor(kind)));
      for (const r of results) {
        expect(r.component).toBeTruthy();
        if (r.score === null) expect(r.severity).toBe('OK');
        if (r.severity !== 'OK') expect(r.explanation.length).toBeGreaterThan(0);
      }
    }
    // Subjective criteria are never scored by code.
    expect(concepts.find((r) => r.criterion === 'AUDIENCE_RELEVANCE')).toMatchObject({
      score: null,
      method: 'LLM_OPINION',
    });
    expect(still.find((r) => r.criterion === 'PROFESSIONAL_POLISH')).toMatchObject({
      score: null,
      method: 'LLM_OPINION',
    });
  });

  it('a PASS never claims quality: it only means no serious problem was measured', () => {
    const rep = report(
      { type: 'CONCEPT_SET', ref: 'x' },
      0,
      critiqueConceptSet(conceptSet, { business: DEMO_BUSINESS, brief, industry }),
    );
    expect(rep.verdict).toBe('PASS');
    expect(rep.rubricVersion).toMatch(/^creative-rubric@/);
    expect(Object.keys(rep.summary).sort()).toEqual(['MARKETING', 'PRODUCTION', 'VISUAL']);
    expect(rep).not.toHaveProperty('overallScore');
  });
});

describe('Creative Critic: concepts', () => {
  it('routes copy problems to the Copywriter as a paid revision that waits for approval', () => {
    const [a, b] = conceptSet.concepts;
    const weak: ConceptSet = {
      ...conceptSet,
      concepts: [
        { ...a!, hook: 'החוויה הכי טובה בעיר שמחכה רק לכם כאן אצלנו בשכונה כל יום ובכל שעה' },
        {
          ...b!,
          hook: a!.hook,
          copy: a!.copy ? { ...b!.copy!, hookTechnique: a!.copy.hookTechnique } : b!.copy,
        },
        ...conceptSet.concepts.slice(2),
      ],
    };
    const results = critiqueConceptSet(weak, { business: DEMO_BUSINESS, brief, industry });
    expect(results.find((r) => r.criterion === 'HOOK_STRENGTH')!.severity).toBe('MAJOR');
    expect(results.find((r) => r.criterion === 'DIFFERENTIATION')!.severity).toBe('MAJOR');
    const history = reviewOnce({ type: 'CONCEPT_SET', ref: 'weak' }, results);
    expect(history.stoppedBecause).toBe('NO_AUTOMATIC_FIX');
    const copy = history.rounds[0]!.revisions.find((r) => r.component === 'COPYWRITER')!;
    expect(copy).toMatchObject({ cost: 'PAID', status: 'PENDING_APPROVAL' });
    expect(copy.criteria).toEqual(expect.arrayContaining(['HOOK_STRENGTH', 'DIFFERENTIATION']));
  });

  it('sends a fact only the owner can confirm back to the owner', () => {
    const results = critiqueConceptSet(conceptSet, {
      business: DEMO_BUSINESS,
      brief,
      industry,
      claimFlags: [{ phrase: 'הקפה הכי טוב בעיר' }],
    });
    const rep = report({ type: 'CONCEPT_SET', ref: 'x' }, 0, results);
    expect(rep.verdict).toBe('HUMAN_REVIEW');
    expect(routeRevisions(rep)).toEqual([
      expect.objectContaining({ component: 'OWNER', status: 'NEEDS_OWNER' }),
    ]);
  });
});

describe('Creative Critic: static ads and the revision loop', () => {
  it('flags a price-led plan set with a quiet inline price, and the Art Director fixes it for free', () => {
    const editorial = {
      ...designFor('EDITORIAL_PRODUCT', '4:5', DEMO_BUSINESS.brandColors, true),
      chosenBy: 'ART_DIRECTOR' as const,
    };
    const start = ad(editorial);
    const ctx = {
      plan: {
        primaryFocal: 'PRICE' as const,
        composition: {
          imageRole: 'HERO' as const,
          subject: 'SINGLE_HERO' as const,
          negativeSpace: 'TOP' as const,
        },
      },
      alternatives: ['EDITORIAL_PRODUCT', 'PREMIUM_MINIMAL', 'OFFER_RETAIL', 'SPLIT'] as const,
    };
    const first = critiqueStaticAd(start, ctx);
    expect(first.find((r) => r.criterion === 'VISUAL_HIERARCHY')).toMatchObject({
      severity: 'MAJOR',
      component: 'ART_DIRECTOR',
    });

    const { ad: fixed, history } = reviewStaticAd(start, ctx);
    expect(fixed.design!.layoutFamily).toBe('OFFER_RETAIL');
    expect(history.stoppedBecause).toBe('PASSED');
    expect(history.rounds).toHaveLength(2);
    const applied = history.rounds[0]!.revisions.find((r) => r.component === 'ART_DIRECTOR')!;
    expect(applied).toMatchObject({ cost: 'FREE', status: 'APPLIED' });
    expect(applied.change).toMatch(/EDITORIAL_PRODUCT to OFFER_RETAIL/);
    expect(start.design!.layoutFamily).toBe('EDITORIAL_PRODUCT'); // the input is not mutated
  });

  it('never replaces a layout the owner chose', () => {
    const owners = {
      ...designFor('EDITORIAL_PRODUCT', '4:5', DEMO_BUSINESS.brandColors, true),
      chosenBy: 'OWNER' as const,
    };
    const { ad: kept, history } = reviewStaticAd(ad(owners), {
      plan: {
        primaryFocal: 'PRICE',
        composition: { imageRole: 'HERO', subject: 'SINGLE_HERO', negativeSpace: 'TOP' },
      },
    });
    expect(kept.design).toEqual(owners);
    expect(history.stoppedBecause).toBe('NO_AUTOMATIC_FIX');
    expect(history.rounds[0]!.revisions[0]!.change).toMatch(/owner chose/);
  });

  it('stops after the policy’s maximum number of rounds', () => {
    const editorial = designFor('EDITORIAL_PRODUCT', '4:5', DEMO_BUSINESS.brandColors, true);
    const { ad: same, history } = reviewStaticAd(ad(editorial), {
      plan: {
        primaryFocal: 'PRICE',
        composition: { imageRole: 'HERO', subject: 'SINGLE_HERO', negativeSpace: 'TOP' },
      },
      maxRounds: 0,
    });
    expect(history.stoppedBecause).toBe('MAX_ROUNDS');
    expect(history.rounds).toHaveLength(1);
    expect(same.design).toEqual(editorial);
  });

  it('repairs an unreadable palette by re-deriving it from the brand colors', () => {
    const offer = designFor('OFFER_RETAIL', '4:5', DEMO_BUSINESS.brandColors, true);
    const broken = { ...offer, palette: { ...offer.palette, text: offer.palette.field } };
    const before = critiqueStaticAd(ad(broken));
    expect(before.find((r) => r.criterion === 'READABILITY')!.severity).toBe('CRITICAL');
    const { ad: fixed, history } = reviewStaticAd(ad(broken));
    expect(fixed.design!.layoutFamily).toBe('OFFER_RETAIL');
    expect(fixed.design!.palette).toEqual(offer.palette);
    expect(history.rounds[0]!.revisions[0]!.change).toMatch(/Rebuilt the OFFER_RETAIL/);
  });

  it('never lets an AI picture pass as the real product, and leaves that to the owner', () => {
    const showcase = designFor('PRODUCT_SHOWCASE', '4:5', DEMO_BUSINESS.brandColors, true);
    const synthetic: StaticAd = {
      ...ad(showcase),
      background: {
        ...ad(showcase).background,
        selection: { chosenBy: 'AUTO', authenticity: 'SYNTHETIC_AI', reasons: [] },
      },
    };
    const auth = critiqueStaticAd(synthetic).find((r) => r.criterion === 'PRODUCT_AUTHENTICITY')!;
    expect(auth).toMatchObject({ severity: 'MAJOR', component: 'OWNER' });
  });
});

describe('Creative Critic: video', () => {
  it('flags three identical camera moves and a slow hook, without claiming subject motion', () => {
    const results = critiqueVideo(project(scenes(['ken-burns-in', 'ken-burns-in', 'ken-burns-in'], 150)));
    expect(results.find((r) => r.criterion === 'MOTION_APPROPRIATENESS')!.severity).toBe('MAJOR');
    expect(results.find((r) => r.criterion === 'PACING')!.severity).toBe('MAJOR');
    const rep = report({ type: 'VIDEO', ref: 'p' }, 0, results);
    expect(routeRevisions(rep)).toEqual(
      expect.arrayContaining([expect.objectContaining({ component: 'VIDEO_PLANNER', cost: 'FREE' })]),
    );
    const calm = critiqueVideo(project(scenes(['ken-burns-in', 'pan-left', 'cinematic-zoom'])));
    expect(calm.find((r) => r.criterion === 'MOTION_APPROPRIATENESS')!.explanation).toMatch(
      /no subject motion/,
    );
  });
});

describe('Creative Critic: opinion pass', () => {
  it('the mock labels its output as a simulation and gives no score', async () => {
    const results = critiqueConceptSet(conceptSet, { business: DEMO_BUSINESS, brief, industry });
    const opinions = await critiqueOpinion(
      {
        kind: 'CONCEPT_SET',
        criteria: ['AUDIENCE_RELEVANCE'],
        work: { hooks: conceptSet.concepts.map((c) => c.hook) },
      },
      { provider },
    );
    expect(opinions).toEqual([
      expect.objectContaining({
        criterion: 'AUDIENCE_RELEVANCE',
        method: 'LLM_OPINION',
        score: null,
        severity: 'OK',
      }),
    ]);
    expect(opinions[0]!.explanation).toMatch(/Simulation/);
    const merged = withOpinions(results, opinions);
    expect(merged.find((r) => r.criterion === 'AUDIENCE_RELEVANCE')!.explanation).toMatch(/Simulation/);
  });

  it('does not call a paid provider without approval', async () => {
    let called = false;
    const paid = {
      id: 'paid',
      model: 'm',
      paid: true,
      generateStructured: async () => {
        called = true;
        throw new Error('should not be called');
      },
    } as unknown as LlmProvider;
    const out = await critiqueOpinion(
      { kind: 'STATIC_AD', criteria: ['PROFESSIONAL_POLISH'], work: {} },
      { provider: paid },
    );
    expect(out).toEqual([]);
    expect(called).toBe(false);
  });
});

function scenes(presets: string[], hookFrames = 90): TimelineScene[] {
  return presets.map((preset, i) => ({
    id: `s${i}`,
    sourceSceneKey: `s${i}`,
    durationInFrames: i === 0 ? hookFrames : 120,
    visual: {
      type: 'image-motion',
      assetId: i % 2 ? 'img2' : 'img',
      motion: { preset: preset as never, intensity: 0.5, focalPoint: { x: 0.5, y: 0.5 } },
    },
    overlays: i === presets.length - 1 ? [{ type: 'cta', text: 'בואו לטעום' }] : [],
    transition: { type: 'fade', durationInFrames: 8 },
  }));
}

function project(timeline: TimelineScene[]) {
  const img = (id: string): MediaAsset => ({
    id,
    kind: 'image',
    storageKey: `a/${id}.png`,
    mimeType: 'image/png',
    provenance: { source: 'DEMO', license: 'x', commercialUse: true },
  });
  return VideoProjectSchema.parse({
    schemaVersion: 1,
    id: 'p',
    title: 't',
    locale: 'he-IL',
    direction: 'rtl',
    output: { width: 1080, height: 1920, fps: 30, codec: 'h264', crf: 20 },
    safeArea: REELS_SAFE_AREA,
    branding: { businessName: 'Luz', colors: DEMO_BUSINESS.brandColors, fontFamily: 'Heebo' },
    assets: [img('img'), img('img2')],
    scenes: timeline,
    audio: {},
    captions: { enabled: true, maxWordsPerChunk: 4 },
  });
}
