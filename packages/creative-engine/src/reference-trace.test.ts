import { describe, expect, it } from 'vitest';
import { retrieveProfessionalReferences } from '@kampora/agent-expertise';
import { directCreative, type DirectionInput } from './art-director-v2';
import { traceReferenceInfluence } from './reference-trace';

const luz: DirectionInput = {
  conceptKey: 'offer',
  goal: 'OFFER',
  tone: 'warm',
  industryId: 'cafe-restaurant',
  brand: { name: 'Luz', colors: { primary: '#2B1B12', secondary: '#C8743A', accent: '#F2C14E', background: '#FBF5EC', text: '#1C140F' } },
  concept: { title: 'הקומבו של הבוקר', angle: 'OFFER_DRIVEN', hookTechnique: 'OFFER_FIRST' },
  copy: {
    eyebrow: 'Luz · פלורנטין',
    headline: 'קפה ומאפה בדרך לעבודה',
    subheadline: 'קולים את הפולים בעצמנו. מאפים טריים כל בוקר.',
    price: { price: '29.90 ₪', label: 'קפה + מאפה · עד סוף החודש' },
    cta: 'קפצו לפני העבודה',
    ctaSub: 'פלורנטין 12 · כל יום מ-7:00',
    brandName: 'Luz',
  },
  picture: { assetId: 'pic', focal: { x: 0.5, y: 0.5 }, authenticity: 'SYNTHETIC_AI' },
  references: retrieveProfessionalReferences({ industryId: 'cafe-restaurant', goal: 'OFFER', tone: 'warm', format: 'STATIC' }),
};

describe('reference influence trace', () => {
  const set = directCreative(luz);
  const trace = traceReferenceInfluence(luz, set);

  it('every direction names the references behind its moves', () => {
    expect(trace).toHaveLength(3);
    for (const t of trace) {
      expect(t.effects.length).toBeGreaterThan(0);
      for (const m of t.moves) expect(t.moveSources[m]!.length).toBeGreaterThan(0);
    }
  });

  it('removing a reference changes what is drawn (counterfactual on the real layout engine)', () => {
    const drawn = trace.filter((t) => Object.values(t.withoutReferenceMoves).flat().length > 0);
    expect(drawn.length).toBeGreaterThan(0);
    // And directing without any reference produces different directions than with the moodboard.
    expect(trace.some((t) => t.withoutAnyReference.changed.length > 0)).toBe(true);
  });

  it('directions are syntheses, not copies of one reference', () => {
    for (const t of trace) {
      expect(t.originality.maxOverlap).toBeLessThan(0.75);
      expect(t.originality.ownAssetsOnly).toBe(true);
    }
    expect(trace.some((t) => t.originality.referencesCombined >= 2)).toBe(true);
  });
});
