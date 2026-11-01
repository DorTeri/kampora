import type { CampaignGoal, DesignMove, ToneOfVoice } from '@kampora/shared';
import { PROFESSIONAL_REFERENCE_DATA } from './data.generated';
import { ProfessionalReferenceSchema, type ProfessionalReference } from './schema';

export * from './schema';

/** The curated library, validated on load: a malformed entry fails fast instead of reaching an agent. */
export const PROFESSIONAL_REFERENCES: readonly ProfessionalReference[] = PROFESSIONAL_REFERENCE_DATA.map((r) =>
  ProfessionalReferenceSchema.parse(r),
);
export const PROFESSIONAL_LIBRARY_VERSION = '2026-11-01';

/** Industries whose design lessons transfer (a bakery can learn from premium food; a studio from beauty). */
const RELATED: Record<string, readonly string[]> = {
  'cafe-restaurant': ['premium-product'],
  fitness: ['beauty-wellness'],
  'beauty-wellness': ['fitness', 'premium-product'],
  'local-services': ['generic'],
  ecommerce: ['premium-product'],
  'premium-product': ['ecommerce', 'beauty-wellness'],
  generic: [],
};

/** Campaign goals mapped to the reference objectives that teach them. */
const GOAL_OBJECTIVES: Record<CampaignGoal, readonly ProfessionalReference['objective'][]> = {
  OFFER: ['OFFER', 'SALES'],
  SALES: ['SALES', 'OFFER'],
  PRODUCT_PROMO: ['LAUNCH', 'SALES', 'BRAND'],
  LEADS: ['LEADS', 'LAUNCH', 'AWARENESS'],
  AWARENESS: ['AWARENESS', 'BRAND', 'LAUNCH'],
};

/** Personality words each tone of voice looks for in a reference. */
const TONE_WORDS: Record<ToneOfVoice, readonly string[]> = {
  friendly: ['friendly', 'warm', 'welcoming', 'relatable', 'approachable', 'familiar', 'accessible', 'generous'],
  premium: ['premium', 'refined', 'timeless', 'understated', 'minimal', 'stylish', 'crafted', 'iconic', 'calm'],
  energetic: ['energetic', 'bold', 'intense', 'loud', 'defiant', 'youthful', 'fresh', 'direct'],
  professional: ['confident', 'clinical', 'established', 'direct', 'transparent', 'honest', 'scientific', 'orderly'],
  warm: ['warm', 'crafted', 'honest', 'gentle', 'relaxed', 'indulgent', 'joyful', 'human'],
  playful: ['playful', 'witty', 'cheeky', 'fun', 'humorous', 'irreverent', 'clever', 'joyful'],
};

const STATIC_FORMATS = new Set(['PRINT', 'OOH', 'SOCIAL_STATIC', 'DIGITAL_BANNER']);

export interface ReferenceQuery {
  industryId: string;
  goal: CampaignGoal;
  tone: ToneOfVoice;
  /** Extra personality words (from the brief or the concept). */
  personality?: readonly string[];
  productType?: string;
  audience?: string;
  /** Moves the concept already leans towards (e.g. from its visual idea). */
  moves?: readonly DesignMove[];
  format: 'STATIC' | 'VIDEO';
  limit?: number;
}

export interface RetrievedReference {
  reference: ProfessionalReference;
  score: number;
  /** Every factor that counted, in words: retrieval is explainable, not a black box. */
  reasons: string[];
}

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z֐-׿]+/).filter((w) => w.length > 3));

/**
 * The few references relevant to one creative task, scored by explainable factors (industry, objective, brand
 * personality, product type, audience, design moves, format, and how well-grounded the analysis is), then picked
 * for diversity so the Art Director sees different design approaches rather than three versions of one idea.
 */
export function retrieveProfessionalReferences(query: ReferenceQuery): RetrievedReference[] {
  const toneWords = new Set([...TONE_WORDS[query.tone], ...(query.personality ?? []).map((p) => p.toLowerCase())]);
  const product = words(query.productType ?? '');
  const audience = words(query.audience ?? '');
  const scored = PROFESSIONAL_REFERENCES.map((r) => {
    const reasons: string[] = [];
    let score = 0;
    if (r.industry === query.industryId) {
      score += 4;
      reasons.push(`same industry (${r.industry})`);
    } else if (RELATED[query.industryId]?.includes(r.industry)) {
      score += 1.5;
      reasons.push(`related industry (${r.industry})`);
    }
    if (GOAL_OBJECTIVES[query.goal].includes(r.objective)) {
      score += r.objective === GOAL_OBJECTIVES[query.goal][0] ? 2.5 : 1.5;
      reasons.push(`objective ${r.objective} serves ${query.goal}`);
    }
    const shared = r.brandPersonality.filter((p) => toneWords.has(p.toLowerCase()));
    if (shared.length) {
      score += Math.min(3, shared.length * 1.1);
      reasons.push(`shares personality: ${shared.join(', ')}`);
    }
    const productHits = [...words(r.productType)].filter((w) => product.has(w));
    if (productHits.length) {
      score += 1.5;
      reasons.push(`similar product (${productHits.join(', ')})`);
    }
    const audienceHits = [...words(r.audience)].filter((w) => audience.has(w));
    if (audienceHits.length) {
      score += Math.min(1, audienceHits.length * 0.5);
      reasons.push(`similar audience (${audienceHits.slice(0, 3).join(', ')})`);
    }
    const moveHits = r.designMoves.filter((m) => query.moves?.includes(m));
    if (moveHits.length) {
      score += Math.min(2, moveHits.length * 0.6);
      reasons.push(`uses the intended moves ${moveHits.join(', ')}`);
    }
    const formatFit = query.format === 'STATIC' ? r.formats.some((f) => STATIC_FORMATS.has(f)) : r.formats.includes('VIDEO');
    if (formatFit) score += 0.5;
    else reasons.push(`format differs (${r.formats.join('/')})`);
    // Analyses resting on the written description alone are less certain about visual detail.
    if (r.analysisBasis === 'SOURCE_TEXT') {
      score *= 0.85;
      reasons.push('analysis from source text only');
    }
    return { reference: r, score: Math.round(score * 100) / 100, reasons };
  }).filter((x) => x.score >= 3);

  // Diversity: each next pick is penalised for repeating the moves of references already picked.
  const picked: RetrievedReference[] = [];
  const pool = [...scored].sort((a, b) => b.score - a.score || a.reference.id.localeCompare(b.reference.id));
  const limit = query.limit ?? 5;
  while (picked.length < limit && pool.length) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    pool.forEach((c, i) => {
      const overlap = Math.max(0, ...picked.map((p) => jaccard(p.reference.designMoves, c.reference.designMoves)));
      const value = c.score - overlap * 3;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    });
    const [chosen] = pool.splice(bestIndex, 1);
    if (picked.length && jaccard(picked[0]!.reference.designMoves, chosen!.reference.designMoves) > 0.6)
      chosen!.reasons.push('kept despite similar moves (few alternatives)');
    picked.push(chosen!);
  }
  // The objective's craft must be represented: an offer brief needs at least one reference that sells an offer,
  // even when it comes from another industry.
  const objectives = GOAL_OBJECTIVES[query.goal];
  if (picked.length && !picked.some((p) => objectives.includes(p.reference.objective))) {
    const best = PROFESSIONAL_REFERENCES.filter((r) => objectives.includes(r.objective) && !picked.some((p) => p.reference.id === r.id))
      .map((r) => ({ r, s: (r.objective === objectives[0] ? 2 : 1) + r.brandPersonality.filter((p) => toneWords.has(p.toLowerCase())).length + (r.analysisBasis === 'SOURCE_TEXT' ? 0 : 0.5) }))
      .sort((a, b) => b.s - a.s || a.r.id.localeCompare(b.r.id))[0];
    if (best) {
      const entry = { reference: best.r, score: Math.round(best.s * 100) / 100, reasons: [`brings the craft of a ${best.r.objective} campaign (cross-industry: ${best.r.industry})`] };
      if (picked.length >= limit) picked[picked.length - 1] = entry;
      else picked.push(entry);
    }
  }
  return picked;
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const A = new Set(a);
  const inter = b.filter((x) => A.has(x)).length;
  return inter / (A.size + b.length - inter || 1);
}

export function referenceById(id: string): ProfessionalReference | undefined {
  return PROFESSIONAL_REFERENCES.find((r) => r.id === id);
}
