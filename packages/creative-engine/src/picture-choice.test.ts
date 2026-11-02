import { describe, expect, it } from 'vitest';
import { retrieveProfessionalReferences } from '@kampora/agent-expertise';
import { measurePictureUse } from '@kampora/production-engine';
import { allPictures, directCreative, inputForDirection, type DirectionInput, type DirectionPicture } from './art-director-v2';
import { traceReferenceInfluence } from './reference-trace';

// The Q7 Pilates pictures with the layout recorded by hand after viewing them (subject boxes are fractions of the source).
const GROUP: DirectionPicture = { assetId: 'group', focal: { x: 0.5, y: 0.5 }, aspect: 2 / 3, composition: 'LIFESTYLE', negativeSpace: 'TOP', people: 'GROUP', subject: { x: 0.03, y: 0.25, w: 0.97, h: 0.6 }, authenticity: 'SYNTHETIC_AI', relevance: 1 };
const HERO: DirectionPicture = { assetId: 'hero', focal: { x: 0.5, y: 0.5 }, aspect: 2 / 3, composition: 'LIFESTYLE', negativeSpace: 'TOP', people: 'ONE', subject: { x: 0.02, y: 0.39, w: 0.98, h: 0.45 }, authenticity: 'SYNTHETIC_AI', relevance: 1 };
const DETAIL: DirectionPicture = { assetId: 'detail', focal: { x: 0.5, y: 0.5 }, aspect: 2 / 3, composition: 'DETAIL', negativeSpace: 'TOP', people: 'NONE', subject: { x: 0, y: 0.44, w: 0.96, h: 0.56 }, authenticity: 'SYNTHETIC_AI', relevance: 0.26 };

const pilates = (extra: Partial<DirectionInput> = {}): DirectionInput => ({
  conceptKey: 'A',
  goal: 'LEADS',
  tone: 'premium',
  industryId: 'fitness',
  brand: { name: 'נשימה', colors: { primary: '#1F2A2E', secondary: '#B9A58C', accent: '#F2B45C', background: '#F4EFE9', text: '#1A1A1A' } },
  concept: { title: 'פילאטיס בקצב שלך', angle: 'EMOTIONAL', hookTechnique: 'BENEFIT_FIRST' },
  copy: {
    eyebrow: 'נשימה · פילאטיס מכשירים',
    headline: 'פילאטיס בקצב שלך',
    subheadline: 'קבוצות של עד 6 מתאמנות, עם מדריכות מוסמכות.',
    price: { price: '49 ₪', label: 'שיעור ניסיון' },
    cta: 'שריינו שיעור ניסיון',
    ctaSub: 'מוריה 40, חיפה',
    brandName: 'נשימה',
  },
  picture: GROUP,
  pictures: [HERO, DETAIL],
  references: retrieveProfessionalReferences({ industryId: 'fitness', goal: 'LEADS', tone: 'premium', format: 'STATIC' }),
  ...extra,
});

describe('picture choice per direction', () => {
  it('each direction weighs every approved picture and explains its choice', () => {
    const input = pilates();
    const set = directCreative(input);
    const ids = new Set(allPictures(input).map((p) => p.assetId));
    for (const d of set.directions) {
      expect(d.picture, d.key).toBeDefined();
      expect(ids.has(d.picture!.assetId)).toBe(true);
      expect(d.picture!.because.length).toBeGreaterThan(0);
      // Whatever it chose, the text stays off the subject in every format.
      const own = inputForDirection(input, d);
      for (const spec of Object.values(d.specs)) for (const u of measurePictureUse(spec, allPictures(own))) expect(u.covered, d.key).toBeLessThan(0.03);
    }
    // Two equally relevant pictures: the ranking alone does not put the same one in every direction.
    expect(new Set(set.directions.map((d) => d.picture!.assetId)).size).toBeGreaterThanOrEqual(2);
  });

  it('a picture that shows little of the offer is not chosen over relevant ones', () => {
    const set = directCreative(pilates());
    expect(set.directions.every((d) => d.picture!.assetId !== 'detail' || d.method === 'IMAGE_FIRST')).toBe(true);
  });

  it("the owner's picture is kept by every direction", () => {
    const set = directCreative(pilates({ picture: HERO, pictures: [GROUP, DETAIL], pictureLocked: true }));
    for (const d of set.directions) {
      expect(d.picture!.assetId, d.key).toBe('hero');
      expect(d.picture!.because).toMatch(/owner/i);
    }
  });

  it('with no alternatives the one picture is used, as before', () => {
    const set = directCreative(pilates({ pictures: [] }));
    for (const d of set.directions) expect(d.picture?.assetId ?? 'group').toBe('group');
  });
});

describe('reference influence reaches the page', () => {
  it('references change what is drawn, and a plan change that leaves the page the same is said plainly', () => {
    const input = pilates();
    const trace = traceReferenceInfluence(input, directCreative(input));
    const drawn = trace.filter((t) => Object.values(t.withoutAnyReference.layers).flat().length > 0);
    expect(drawn.length).toBeGreaterThanOrEqual(2);
    for (const t of trace) {
      const layers = Object.values(t.withoutAnyReference.layers).flat();
      if (t.withoutAnyReference.changed.length && !layers.length) expect(t.withoutAnyReference.samePage, t.key).toMatch(/not the page/);
      if (layers.length) expect(t.withoutAnyReference.samePage, t.key).toBeUndefined();
    }
  });

  it('moves that only references chose are drawn on the page (counterfactual on the real layout engine)', () => {
    const input = pilates();
    const trace = traceReferenceInfluence(input, directCreative(input));
    for (const t of trace)
      if (t.referenceOnlyMoves.length) expect(Object.values(t.withoutReferenceMoves).flat().length, `${t.key}: ${t.referenceOnlyMoves.join(', ')}`).toBeGreaterThan(0);
  });
});
