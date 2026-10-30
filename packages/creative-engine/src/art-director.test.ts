import { describe, expect, it } from 'vitest';
import { LAYOUT_FAMILY_PROFILES, industryFor } from '@kampora/agent-expertise';
import {
  ArtDirectionPlanSchema,
  LayoutFamilySchema,
  contrastRatio,
  designFor,
  type BrandColors,
} from '@kampora/shared';
import { directArt, scoreLayoutFamilies, type ArtDirectionInput } from './art-director';
import { EVAL_SCENARIOS } from './evaluation/scenarios';

const LUZ: BrandColors = {
  primary: '#2B1B12',
  secondary: '#C8743A',
  accent: '#F2C14E',
  background: '#FBF5EC',
  text: '#1C140F',
};

const base: ArtDirectionInput = {
  goal: 'OFFER',
  tone: 'friendly',
  industryId: 'cafe-restaurant',
  hasPrice: true,
  hasOffer: true,
  concept: { angle: 'OFFER_DRIVEN', hookTechnique: 'OFFER_FIRST' },
  brandColors: LUZ,
  picture: { composition: 'SINGLE_HERO', authenticity: 'SYNTHETIC_AI' },
};

describe('Art Director', () => {
  it('makes the price the focal point of an offer and picks a family that carries it', () => {
    const plan = directArt(base);
    expect(ArtDirectionPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.primaryFocal).toBe('PRICE');
    expect(LAYOUT_FAMILY_PROFILES[plan.layoutFamily].carriesPrice).toBe(true);
    expect(plan.priceTreatment).not.toBe('NONE');
    expect(plan.alternatives).toHaveLength(LayoutFamilySchema.options.length);
    expect(plan.decisions.map((d) => d.topic)).toEqual(
      expect.arrayContaining(['layout', 'focal point', 'contrast', 'price', 'call to action']),
    );
    expect(directArt(base)).toEqual(plan);
  });

  it('lets people lead an awareness ad with a lifestyle picture', () => {
    const plan = directArt({
      ...base,
      goal: 'AWARENESS',
      hasPrice: false,
      hasOffer: false,
      concept: { angle: 'LIFESTYLE', hookTechnique: 'PATTERN_INTERRUPT' },
      picture: { composition: 'LIFESTYLE', authenticity: 'VERIFIED_BUSINESS_PHOTO' },
    });
    expect(plan.layoutFamily).toBe('LIFESTYLE_PHOTO');
    expect(plan.primaryFocal).toBe('PEOPLE');
    expect(plan.priceTreatment).toBe('NONE');
    expect(plan.composition.negativeSpace).toBe('BOTTOM');
  });

  it('lets type be the image when there is no usable picture', () => {
    const plan = directArt({ ...base, goal: 'LEADS', hasPrice: false, hasOffer: false, picture: undefined });
    expect(LAYOUT_FAMILY_PROFILES[plan.layoutFamily].needsPicture).toBe(false);
    expect(plan.primaryFocal).toBe('HEADLINE');
    expect(plan.composition.imageRole).toBe('NONE');
    for (const f of ['1:1', '4:5', '9:16'] as const) expect(plan.formats[f].image.mode).toBe('NONE');
  });

  it('keeps a premium brand calm: elegant type, quiet action, slow transitions', () => {
    const plan = directArt({
      ...base,
      goal: 'PRODUCT_PROMO',
      tone: 'premium',
      hasPrice: false,
      hasOffer: false,
      industryId: 'ecommerce',
      concept: { angle: 'PRODUCT_DEMO', hookTechnique: 'SENSORY_DETAIL' },
      picture: { composition: 'DETAIL', authenticity: 'VERIFIED_PRODUCT_PHOTO' },
    });
    expect(['PREMIUM_MINIMAL', 'EDITORIAL_PRODUCT']).toContain(plan.layoutFamily);
    expect(plan.typography.treatment).toBe('ELEGANT');
    expect(plan.motion.pacing).toBe('CALM');
    expect(plan.ctaTreatment).toBe('TEXT');
  });

  it('never presents an AI picture as the real product', () => {
    const plan = directArt({ ...base, goal: 'PRODUCT_PROMO', hasPrice: false });
    expect(plan.decisions.some((d) => d.topic === 'picture')).toBe(true);
    expect(plan.brandConstraints.join(' ')).toMatch(/AI pictures/);
    const showcase = scoreLayoutFamilies({ ...base, goal: 'PRODUCT_PROMO', hasPrice: false }).find(
      (a) => a.layoutFamily === 'PRODUCT_SHOWCASE',
    )!;
    expect(showcase.reasons.join(' ')).toMatch(/AI picture as the real product/);
    // The Critic's list too: an awareness ad with an AI picture is not an editorial product hero.
    const awareness = directArt({ ...base, goal: 'AWARENESS', hasPrice: false, hasOffer: false });
    expect(['PRODUCT_SHOWCASE', 'PREMIUM_MINIMAL', 'EDITORIAL_PRODUCT']).not.toContain(
      awareness.layoutFamily,
    );
  });

  it('prefers another family than the previous ad when one fits almost as well', () => {
    const first = directArt(base);
    const next = directArt({ ...base, previousLayout: first.layoutFamily });
    const firstScores = scoreLayoutFamilies(base);
    if (firstScores[0]!.score - firstScores[1]!.score < 1)
      expect(next.layoutFamily).not.toBe(first.layoutFamily);
    expect(
      scoreLayoutFamilies({ ...base, previousLayout: first.layoutFamily })
        .find((a) => a.layoutFamily === first.layoutFamily)!
        .reasons.join(' '),
    ).toMatch(/previous ad/);
  });

  it('keeps the owner’s layout choice', () => {
    const plan = directArt({ ...base, layoutOverride: 'PREMIUM_MINIMAL' });
    expect(plan.layoutFamily).toBe('PREMIUM_MINIMAL');
    for (const f of ['1:1', '4:5', '9:16'] as const) expect(plan.formats[f].chosenBy).toBe('OWNER');
    expect(directArt(base).formats['4:5'].chosenBy).toBe('ART_DIRECTOR');
  });

  it('feeds the visual planner: photography direction, calm space and references', () => {
    const plan = directArt(base);
    expect(plan.photography.direction.length).toBeGreaterThan(20);
    expect(plan.photography.avoid).toContain('text or letters in the picture');
    expect(plan.referenceIds.length).toBeGreaterThan(0);
  });

  it('chooses different compositions for different businesses and goals (evaluation set)', () => {
    const families = EVAL_SCENARIOS.map((s) => {
      const industry = industryFor(s.business).profile;
      const plan = directArt({
        goal: s.request.goal,
        tone: s.business.tone,
        industryId: industry.id,
        hasPrice: Boolean(s.request.offer && /\d/.test(s.request.offer)),
        hasOffer: Boolean(s.request.offer),
        brandColors: s.business.brandColors,
        picture: s.assets.length
          ? {
              composition: 'SINGLE_HERO',
              authenticity:
                s.assets[0]!.source === 'CUSTOMER_UPLOAD' ? 'VERIFIED_PRODUCT_PHOTO' : 'SYNTHETIC_AI',
            }
          : undefined,
      });
      expect(industry.id).toBe(s.expect.industryId);
      expect(s.expect.focal).toContain(plan.primaryFocal);
      return plan.layoutFamily;
    });
    expect(new Set(families).size).toBeGreaterThanOrEqual(3);
  });
});

describe('layout family palettes', () => {
  const brands = [LUZ, ...EVAL_SCENARIOS.map((s) => s.business.brandColors)];
  it('keeps text readable on its surface for every family, format and brand', () => {
    for (const colors of brands)
      for (const family of LayoutFamilySchema.options)
        for (const format of ['1:1', '4:5', '9:16'] as const)
          for (const picture of [true, false]) {
            const d = designFor(family, format, colors, picture);
            if (d.surface !== 'SCRIM')
              expect(
                contrastRatio(d.palette.text, d.palette.field),
                `${family} ${format} text`,
              ).toBeGreaterThanOrEqual(4.5);
            expect(
              contrastRatio(d.palette.accentText, d.palette.accent),
              `${family} accent`,
            ).toBeGreaterThanOrEqual(3);
          }
  });
});
