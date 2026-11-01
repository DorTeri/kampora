import { describe, expect, it } from 'vitest';
import { PROFESSIONAL_REFERENCES, referenceById, retrieveProfessionalReferences, type RetrievedReference } from '@kampora/agent-expertise';
import { CreativeDesignSpecSchema, type BrandColors } from '@kampora/shared';
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
