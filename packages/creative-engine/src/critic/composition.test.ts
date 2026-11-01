import { describe, expect, it } from 'vitest';
import { retrieveProfessionalReferences } from '@kampora/agent-expertise';
import { composeDesign, derivePalette } from '@kampora/production-engine';
import type { BrandColors, CompositionMethod, CreativeDesignSpec } from '@kampora/shared';
import { composeDirectionSpecs, directCreative, type DirectionInput } from '../art-director-v2';
import { creativeAnalysis, creativeReview, reviewDirection, reviewDirectionSet, technicalChecks } from './composition';

const LUZ: BrandColors = { primary: '#2B1B12', secondary: '#C8743A', accent: '#F2C14E', background: '#FBF5EC', text: '#1C140F' };
// The real Q6 pilot copy: the subheadline repeats the price that the design also sets.
const input: DirectionInput = {
  conceptKey: 'offer',
  goal: 'OFFER',
  tone: 'warm',
  industryId: 'cafe-restaurant',
  brand: { name: 'Luz', colors: LUZ },
  concept: { title: 'הקומבו של הבוקר', angle: 'OFFER_DRIVEN', hookTechnique: 'OFFER_FIRST' },
  copy: {
    eyebrow: 'Luz · פלורנטין',
    headline: 'קפה ומאפה בדרך לבוקר',
    subheadline: 'קפה + מאפה ב-29.90 ₪ עד סוף החודש',
    price: { price: '29.90 ₪', label: 'עד סוף החודש' },
    cta: 'בואו לנצל את המבצע',
    ctaSub: 'פלורנטין 12, תל אביב',
    brandName: 'Luz',
  },
  picture: { assetId: 'pic', focal: { x: 0.5, y: 0.5 }, authenticity: 'SYNTHETIC_AI' },
  references: retrieveProfessionalReferences({ industryId: 'cafe-restaurant', goal: 'OFFER', tone: 'warm', format: 'STATIC' }),
};
const set = directCreative(input);
// MINIMAL_COPY leaves out a subheadline that only repeats the price. The duplicate-price checks need it on the page,
// so they review the bold direction composed without that move.
const C = set.directions[2]!;
const cMoves = C.moves.filter((m) => m !== 'MINIMAL_COPY');
const verboseC = { ...C, moves: cMoves, specs: composeDirectionSpecs(input, C.approach, C.method, cMoves, C.typeSystem, ['4:5', '9:16'], C.emphasis) };
const spec = (key = 'C', format = '4:5') => (key === 'C' ? verboseC : set.directions.find((d) => d.key === key)!).specs[format]!;
const clone = (s: CreativeDesignSpec): CreativeDesignSpec => JSON.parse(JSON.stringify(s));

describe('Critic 2.0: technical QA', () => {
  it('finds the price said twice and sends it to the Copywriter', () => {
    const r = technicalChecks(spec()).find((x) => x.criterion === 'OFFER_COMMUNICATION')!;
    expect(r.severity).toBe('MAJOR');
    expect(r.component).toBe('COPYWRITER');
  });

  it('with MINIMAL_COPY the repeated price line is left out, so nothing is said twice', () => {
    if (!C.moves.includes('MINIMAL_COPY')) return;
    const roles = C.specs['4:5']!.layers.flatMap((l) => (l.kind === 'text' ? [l.role] : []));
    expect(roles).not.toContain('SUBHEADLINE');
    expect(technicalChecks(C.specs['4:5']!).find((x) => x.criterion === 'OFFER_COMMUNICATION')!.severity).toBe('OK');
  });

  it('finds colliding text and text on an unprotected photo', () => {
    const s = clone(spec('C'));
    const t = s.layers.filter((l) => l.kind === 'text');
    t[1]!.rect = { ...t[0]!.rect };
    expect(technicalChecks(s).find((x) => x.criterion === 'LAYOUT_BALANCE')!.severity).toBe('MAJOR');

    const onPhoto = clone(spec('A'));
    const img = onPhoto.layers.find((l) => l.kind === 'image')!;
    const headline = onPhoto.layers.find((l) => l.kind === 'text' && l.role === 'HEADLINE')!;
    if (img.kind !== 'image' || headline.kind !== 'text') throw new Error('fixture');
    delete img.overlay;
    img.treatment = 'NATURAL';
    delete headline.box;
    // Put the headline inside the photo, above it in the layer order.
    headline.rect = { x: img.rect.x + 20, y: img.rect.y + 20, w: Math.min(headline.rect.w, img.rect.w - 40), h: headline.rect.h };
    onPhoto.layers = [...onPhoto.layers.filter((l) => l !== headline), headline];
    expect(technicalChecks(onPhoto).find((x) => x.criterion === 'READABILITY')!.severity).toBe('MAJOR');
  });

  it('flags unapproved claims as critical', () => {
    const s = clone(spec());
    const h = s.layers.find((l) => l.kind === 'text' && l.role === 'HEADLINE');
    if (h && h.kind === 'text') h.text = 'הקפה הכי טוב בתל אביב';
    const r = technicalChecks(s, { approvedClaims: ['קולים את הפולים בעצמנו'] }).find((x) => x.criterion === 'FACTUAL_ACCURACY')!;
    expect(r.severity).toBe('CRITICAL');
  });
});

describe('Critic 2.0: creative analysis is advisory', () => {
  it('never reports more than MINOR and is labelled HEURISTIC or not measured', () => {
    for (const d of set.directions)
      for (const s of Object.values(d.specs))
        for (const r of creativeAnalysis(s)) {
          expect(['OK', 'MINOR']).toContain(r.severity);
          expect(r.score === null || r.method === 'HEURISTIC').toBe(true);
        }
  });

  it('a technical PASS is not an approval: the human decision stays pending', () => {
    const rev = creativeReview(spec('A'), { subjectRef: 'x' });
    expect(rev.human.status).toBe('PENDING');
    expect(rev.creative.advisory).toBe(true);
    expect(rev.creative.results.find((r) => r.criterion === 'PROFESSIONAL_POLISH')!.score).toBeNull();
  });
});

describe('Critic 2.0: targeted, bounded revisions', () => {
  it('without approved replacement copy, the duplicated price waits for the Copywriter (paid, not applied)', () => {
    const { history, copy } = reviewDirection(input, verboseC);
    expect(copy).toEqual(input.copy);
    const req = history.rounds[0]!.revisions.find((r) => r.component === 'COPYWRITER')!;
    expect(req.cost).toBe('PAID');
    expect(req.status).toBe('PENDING_APPROVAL');
    expect(history.stoppedBecause).toBe('NO_AUTOMATIC_FIX');
  });

  it('with the brief key message, the subheadline is replaced, recorded, and the ad passes', () => {
    const { history, copy, direction } = reviewDirection(input, verboseC, { approvedSubheadline: 'קולים את הפולים בעצמנו' });
    expect(copy.subheadline).toBe('קולים את הפולים בעצמנו');
    expect(copy.price).toEqual(input.copy.price);
    const applied = history.rounds[0]!.revisions.find((r) => r.component === 'COPYWRITER')!;
    expect(applied.status).toBe('APPLIED');
    expect(applied.change).toMatch(/no new words/);
    expect(history.stoppedBecause).toBe('PASSED');
    expect(direction.rationale.some((r) => r.topic === 'revision')).toBe(true);
  });

  it('stays within the round limit', () => {
    const { set: revised, reviews } = reviewDirectionSet(input, set, { maxRounds: 1, approvedSubheadline: 'קולים את הפולים בעצמנו' });
    expect(revised.directions).toHaveLength(3);
    for (const byFormat of Object.values(reviews))
      for (const r of Object.values(byFormat)) expect(r.history!.rounds.length).toBeLessThanOrEqual(2);
  });
});

describe('Critic 2.0: the layout engine composes readable, collision-free text everywhere', () => {
  const NESIMA: BrandColors = { primary: '#1F3A3D', secondary: '#7FB7A4', accent: '#F4B860', background: '#F6F3EE', text: '#14211F' };
  const methods: CompositionMethod[] = ['IMAGE_FIRST', 'LIFESTYLE', 'LAYERED', 'PRODUCT_LED', 'SPLIT', 'EDITORIAL', 'ASYMMETRIC', 'BOLD_TYPE', 'PROMO_PRICE', 'LOCAL_MODERN'];
  it.each([
    ['Luz', LUZ],
    ['Nesima', NESIMA],
  ])('%s: every method × format × picture/no picture × emphasis', (_n, colors) => {
    for (const method of methods)
      for (const format of ['4:5', '9:16'] as const)
        for (const picture of [true, false])
          for (const emphasis of ['HEADLINE', 'PRICE'] as const) {
            const s = composeDesign({
              format,
              method,
              moves: emphasis === 'PRICE' ? ['PRICE_AS_GRAPHIC'] : [],
              typeSystem: 'MODERN_SANS',
              palette: derivePalette(colors, []),
              copy: { ...input.copy, subheadline: 'קולים את הפולים בעצמנו' },
              ...(picture ? { picture: { assetId: 'pic', focal: { x: 0.5, y: 0.5 } } } : {}),
              emphasis,
            });
            if (s.fit.status === 'UNRESOLVED') continue;
            for (const criterion of ['READABILITY', 'LAYOUT_BALANCE']) {
              const r = technicalChecks(s).find((x) => x.criterion === criterion)!;
              expect(r.severity, `${method} ${format} picture=${picture} ${emphasis}: ${r.explanation}`).not.toBe('MAJOR');
            }
          }
  });
});
