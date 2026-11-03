import { describe, expect, it } from 'vitest';
import { PROFESSIONAL_REFERENCES, referenceById, retrieveProfessionalReferences, type RetrievedReference } from '@kampora/agent-expertise';
import { CreativeDesignSpecSchema, type BrandColors, type CreativeDirection } from '@kampora/shared';
import { directCreative, type DirectionInput } from './art-director-v2';

const LUZ: BrandColors = { primary: '#2B1B12', secondary: '#C8743A', accent: '#F2C14E', background: '#FBF5EC', text: '#1C140F' };
const PILATES: BrandColors = { primary: '#1F2A2E', secondary: '#B9A58C', accent: '#D8C3A5', background: '#F4EFE9', text: '#1A1A1A' };

const luzInput = (references: readonly RetrievedReference[], extra: Partial<DirectionInput> = {}): DirectionInput => ({
  conceptKey: 'A',
  goal: 'OFFER',
  tone: 'warm',
  industryId: 'cafe-restaurant',
  brand: { name: 'לוז קפה', colors: LUZ },
  concept: { title: 'הקומבו של הבוקר', angle: 'OFFER_DRIVEN', hookTechnique: 'OFFER_FIRST' },
  copy: {
    eyebrow: 'לוז קפה · פלורנטין',
    headline: 'הקומבו של הבוקר',
    subheadline: 'קפה ומאפה טרי מהתנור',
    price: { price: '29.90 ₪', label: 'עד סוף החודש' },
    cta: 'בואו לבוקר טוב',
    brandName: 'לוז קפה',
  },
  picture: { assetId: 'pic', focal: { x: 0.5, y: 0.5 }, composition: 'SINGLE_HERO', authenticity: 'VERIFIED_PRODUCT_PHOTO' },
  references,
  ...extra,
});

const pilatesInput = (references: readonly RetrievedReference[]): DirectionInput => ({
  conceptKey: 'B',
  goal: 'LEADS',
  tone: 'premium',
  industryId: 'fitness',
  brand: { name: 'סטודיו נוֹעַ', colors: PILATES },
  concept: { title: 'רגע לעצמך', angle: 'EMOTIONAL', hookTechnique: 'QUESTION' },
  copy: {
    eyebrow: 'פילאטיס מכשירים · רמת גן',
    headline: 'רוצה להתחיל פילאטיס ולא יודעת מאיפה?',
    subheadline: 'קבוצות קטנות, מדריכה צמודה',
    price: { price: '49 ₪', label: 'שיעור ניסיון' },
    cta: 'קבעי שיעור ניסיון',
    brandName: 'סטודיו נוֹעַ',
  },
  picture: { assetId: 'pic', focal: { x: 0.5, y: 0.4 }, composition: 'LIFESTYLE', authenticity: 'VERIFIED_BUSINESS_PHOTO' },
  references,
});

const retrieve = (industryId: string, goal: DirectionInput['goal'], tone: DirectionInput['tone']) =>
  retrieveProfessionalReferences({ industryId, goal, tone, format: 'STATIC' });

/** A synthetic retrieval result built from chosen library entries, to isolate the effect of references. */
const pick = (...ids: string[]): RetrievedReference[] =>
  ids.map((id, i) => ({ reference: referenceById(id)!, score: 8 - i, reasons: ['test'] }));

describe('professional reference library', () => {
  it('holds 30 validated references, each with a source URL, deconstruction and principles', () => {
    expect(PROFESSIONAL_REFERENCES).toHaveLength(30);
    for (const r of PROFESSIONAL_REFERENCES) {
      expect(r.sourceUrl).toMatch(/^https?:\/\//);
      expect(r.principles.length).toBeGreaterThan(0);
      expect(r.designMoves.length).toBeGreaterThan(0);
      expect(r.rights.status).toBe('URL_AND_AUTHORED_ANALYSIS_ONLY');
    }
    expect(new Set(PROFESSIONAL_REFERENCES.map((r) => r.id)).size).toBe(30);
  });

  it('retrieval is explainable, relevant and diverse', () => {
    const cafe = retrieve('cafe-restaurant', 'OFFER', 'warm');
    expect(cafe.length).toBeGreaterThanOrEqual(3);
    expect(cafe.every((r) => r.reasons.length > 0)).toBe(true);
    expect(cafe.filter((r) => r.reference.industry === 'cafe-restaurant').length).toBeGreaterThanOrEqual(2);
    // The offer craft is represented even if it has to come from another industry.
    expect(cafe.some((r) => ['OFFER', 'SALES'].includes(r.reference.objective))).toBe(true);
    const fitness = retrieve('fitness', 'LEADS', 'premium');
    expect(fitness[0]!.reference.industry).toBe('fitness');
    expect(fitness.map((r) => r.reference.id)).not.toEqual(cafe.map((r) => r.reference.id));
  });
});

describe('Art Director 2.0', () => {
  it('explores three genuinely different directions, each with valid composed specs', () => {
    const set = directCreative(luzInput(retrieve('cafe-restaurant', 'OFFER', 'warm')));
    expect(set.directions.map((d) => d.approach)).toEqual(['IMAGE_LED', 'EDITORIAL_TYPE', 'BOLD_GRAPHIC']);
    expect(new Set(set.directions.map((d) => d.method)).size).toBe(3);
    expect(new Set(set.directions.map((d) => d.typeSystem)).size).toBe(3);
    for (const d of set.directions) {
      expect(Object.keys(d.specs).sort()).toEqual(['4:5', '9:16']);
      for (const spec of Object.values(d.specs)) {
        expect(() => CreativeDesignSpecSchema.parse(spec)).not.toThrow();
        // Approved copy is never dropped.
        const roles = spec.layers.flatMap((l) => (l.kind === 'text' ? [l.role] : []));
        for (const role of ['HEADLINE', 'PRICE', 'CTA'] as const) expect(roles).toContain(role);
      }
    }
    // An offer with a price: the recommended direction makes the price the hero.
    expect(set.directions.find((d) => d.key === set.recommended)!.emphasis).toBe('PRICE');
  });

  it('records which reference shaped which decision', () => {
    const set = directCreative(luzInput(retrieve('cafe-restaurant', 'OFFER', 'warm')));
    const ids = new Set(set.moodboard.map((m) => m.referenceId));
    for (const d of set.directions) {
      for (const r of d.references) {
        expect(ids.has(r.referenceId)).toBe(true);
        expect(r.moves.every((m) => d.moves.includes(m))).toBe(true);
      }
    }
    expect(set.directions.some((d) => d.references.length > 0)).toBe(true);
  });

  it('changing the reference context changes the art direction decisions', () => {
    // Same brief, two different moodboards: quiet references (negative space, understated price, text-line CTA)
    // vs loud ones (colour flood, oversized type, vibrant palette).
    const quiet = ['GENEROUS_NEGATIVE_SPACE', 'PRICE_UNDERSTATED', 'CTA_AS_TEXT_LINE', 'MONOCHROME_PALETTE'];
    const loud = ['BRAND_COLOR_FLOOD', 'OVERSIZED_HEADLINE', 'VIBRANT_COMPLEMENTARY', 'TYPE_AS_IMAGE'];
    const has = (r: (typeof PROFESSIONAL_REFERENCES)[number], ms: string[]) => r.designMoves.filter((m) => ms.includes(m)).length;
    const editorialRefs = PROFESSIONAL_REFERENCES.filter((r) => has(r, quiet) > 0 && has(r, loud) === 0).slice(0, 4);
    const boldRefs = PROFESSIONAL_REFERENCES.filter((r) => has(r, loud) > 0 && has(r, quiet) === 0).slice(0, 4);
    expect(editorialRefs.length).toBeGreaterThan(0);
    expect(boldRefs.length).toBeGreaterThan(0);
    const a = directCreative(luzInput(pick(...editorialRefs.map((r) => r.id))));
    const b = directCreative(luzInput(pick(...boldRefs.map((r) => r.id))));
    const signature = (s: typeof a) => s.directions.map((d) => `${d.method}|${d.typeSystem}|${[...d.moves].sort().join(',')}`).join(' / ');
    expect(signature(a)).not.toEqual(signature(b));
    // The influences point at the references that were supplied, not at a fixed list.
    const cited = (s: typeof a) => new Set(s.directions.flatMap((d) => d.references.map((r) => r.referenceId)));
    expect([...cited(a)].every((id) => editorialRefs.some((r) => r.id === id))).toBe(true);
    expect([...cited(b)].every((id) => boldRefs.some((r) => r.id === id))).toBe(true);
  });

  it('a retrieval for a different business produces different directions', () => {
    const cafe = directCreative(luzInput(retrieve('cafe-restaurant', 'OFFER', 'warm')));
    const studio = directCreative(pilatesInput(retrieve('fitness', 'LEADS', 'premium')));
    expect(studio.directions.map((d) => d.typeSystem)).not.toEqual(cafe.directions.map((d) => d.typeSystem));
    // Premium leads: the calm editorial direction is preferred over the loud one.
    expect(studio.directions.find((d) => d.key === studio.recommended)!.approach).not.toBe('BOLD_GRAPHIC');
  });

  it('without a picture, no image-dependent method is chosen and the reason is recorded', () => {
    const set = directCreative(luzInput(retrieve('cafe-restaurant', 'OFFER', 'warm'), { picture: undefined }));
    for (const d of set.directions) {
      expect(['IMAGE_FIRST', 'LIFESTYLE', 'LAYERED', 'PRODUCT_LED']).not.toContain(d.method);
      for (const spec of Object.values(d.specs)) expect(spec.layers.some((l) => l.kind === 'image')).toBe(false);
    }
    expect(set.directions[0]!.rationale.some((r) => r.topic === 'picture')).toBe(true);
  });

  it('an AI stand-in picture is not framed as the product', () => {
    const set = directCreative(
      luzInput(pick(PROFESSIONAL_REFERENCES.find((r) => r.designMoves.includes('PRODUCT_AS_HERO'))!.id), {
        picture: { assetId: 'pic', focal: { x: 0.5, y: 0.5 }, composition: 'SINGLE_HERO', authenticity: 'SYNTHETIC_AI' },
      }),
    );
    expect(set.directions[0]!.method).not.toBe('PRODUCT_LED');
  });

  it('is deterministic', () => {
    const refs = retrieve('cafe-restaurant', 'OFFER', 'warm');
    expect(JSON.stringify(directCreative(luzInput(refs)))).toEqual(JSON.stringify(directCreative(luzInput(refs))));
  });
});

describe('Art Director 2.0: the concept drives the composition', () => {
  const BURGER: BrandColors = { primary: '#1F1A17', secondary: '#E0482B', accent: '#F4B63F', background: '#FFF7EC', text: '#1F1A17' };
  // One offer campaign, three concepts (Phase 1 burger sample): same price, same picture, same references.
  const concepts = {
    value: { title: 'המחיר הוא החדשות', angle: 'OFFER_DRIVEN', hookTechnique: 'OFFER_FIRST', headline: 'דאבל סמאש, צ׳יפס ושתייה, במחיר אחד' },
    craving: { title: 'רגע החשק', angle: 'PRODUCT_DEMO', hookTechnique: 'SENSORY_DETAIL', headline: 'שתי קציצות דקות, צ׳דר ובצל מקורמל' },
    craft: { title: 'מה שקורה במטבח', angle: 'UGC', hookTechnique: 'FIRST_PERSON', headline: 'טוחנים את הבשר במקום כל יום' },
  } as const;
  const refs = retrieve('cafe-restaurant', 'OFFER', 'friendly');
  const burger = (c: (typeof concepts)[keyof typeof concepts], extra: Partial<DirectionInput> = {}): DirectionInput => ({
    conceptKey: c.angle,
    goal: 'OFFER',
    tone: 'friendly',
    industryId: 'cafe-restaurant',
    brand: { name: 'בורגר האוס', colors: BURGER },
    concept: { title: c.title, angle: c.angle, hookTechnique: c.hookTechnique },
    copy: { headline: c.headline, price: { price: '59 ₪', label: 'דאבל סמאש + צ׳יפס + שתייה' }, cta: 'הזמינו עכשיו', brandName: 'בורגר האוס' },
    picture: { assetId: 'pic', focal: { x: 0.5, y: 0.5 }, subject: { x: 0.25, y: 0.3, w: 0.5, h: 0.4 }, composition: 'SINGLE_HERO', people: 'NONE', authenticity: 'VERIFIED_PRODUCT_PHOTO' },
    references: refs,
    formats: ['4:5'],
    ...extra,
  });
  const chosen = (input: DirectionInput) => {
    const set = directCreative(input);
    return { set, d: set.directions.find((x) => x.key === set.recommended)! };
  };
  const size = (d: CreativeDirection, role: 'PRICE' | 'HEADLINE') => {
    const l = d.specs['4:5']!.layers.find((x) => x.kind === 'text' && x.role === role);
    return l?.kind === 'text' ? l.font.size : NaN;
  };

  it('recommends a different arrangement, focal point and price treatment for each concept', () => {
    const value = chosen(burger(concepts.value)).d;
    const craving = chosen(burger(concepts.craving)).d;
    const craft = chosen(burger(concepts.craft)).d;
    expect([value.method, value.emphasis]).toEqual(['PROMO_PRICE', 'PRICE']);
    expect([craving.method, craving.emphasis]).toEqual(['IMAGE_FIRST', 'IMAGE']);
    expect([craft.method, craft.emphasis]).toEqual(['EDITORIAL', 'HEADLINE']);
    expect(value.moves).toContain('PRICE_AS_GRAPHIC');
    expect(craving.moves).toEqual(expect.arrayContaining(['DETAIL_MACRO_CROP', 'PRICE_UNDERSTATED']));
    expect(craft.moves).toEqual(expect.arrayContaining(['SERIF_EDITORIAL', 'IMAGE_INSET_FRAME', 'PRICE_UNDERSTATED']));
    // The layout engine applies it: the price outsizes the headline only where the concept is about the price.
    expect(size(value, 'PRICE') / size(value, 'HEADLINE')).toBeGreaterThan(1);
    expect(size(craving, 'PRICE') / size(craving, 'HEADLINE')).toBeLessThan(0.6);
    expect(size(craft, 'PRICE') / size(craft, 'HEADLINE')).toBeLessThan(0.6);
  });

  it('an offer goal alone does not make the price the hero of a craving or craft concept', () => {
    for (const c of [concepts.craving, concepts.craft])
      for (const d of directCreative(burger(c)).directions) {
        expect(d.emphasis).not.toBe('PRICE');
        expect(d.moves).not.toContain('PRICE_AS_GRAPHIC');
      }
  });

  it('records the concept decision and keeps references as influences', () => {
    const { set, d } = chosen(burger(concepts.craving));
    expect(d.rationale[0]).toMatchObject({ topic: 'concept', decision: 'APPETITE: this direction carries the concept' });
    expect(set.recommendedBecause).toMatch(/appetite/);
    expect(set.directions.filter((x) => x.rationale[0]!.decision.includes('alternative'))).toHaveLength(2);
    expect(d.references.length).toBeGreaterThan(0);
  });

  it('no people in the picture: no people-led layout, even for a first-person concept', () => {
    for (const d of directCreative(burger(concepts.craft)).directions) expect(d.moves).not.toContain('PEOPLE_AS_HERO');
  });

  it('without a picture, a craving concept is not given a shape-led stand-in for the food', () => {
    expect(chosen(burger(concepts.craving, { picture: undefined })).d.approach).not.toBe('IMAGE_LED');
  });
});
