import type { CampaignGoal, ConceptAngle, ProductionFormat, VisualStyle, VoiceStyle } from '@kampora/shared';

/**
 * The concept types Kampora writes. Each is a different idea, not a rewording: it has its own hook mechanism,
 * story structure and emotional driver. The prompt and the mock use this catalog, and the UI shows the labels.
 */
export interface ConceptType {
  /** Hebrew label for the owner. */
  label: string;
  /** How the first 2 seconds stop the scroll. */
  hookMechanism: string;
  /** Story beats, in order. */
  structure: string[];
  emotionalDriver: string;
  bestFor: CampaignGoal[];
  voiceStyle: VoiceStyle;
  visualStyle: VisualStyle;
  productionFormat: ProductionFormat;
}

export const CONCEPT_TYPES: Record<ConceptAngle, ConceptType> = {
  PROBLEM_SOLUTION: {
    label: 'בעיה ופתרון',
    hookMechanism: 'name a specific, familiar frustration of the audience as a question',
    structure: ['hook: the frustration', 'problem: why it happens', 'solution: the business', 'cta'],
    emotionalDriver: 'relief',
    bestFor: ['LEADS', 'SALES', 'PRODUCT_PROMO'],
    voiceStyle: 'natural',
    visualStyle: 'lifestyle-photo',
    productionFormat: 'image-motion',
  },
  EMOTIONAL: {
    label: 'רגשי',
    hookMechanism: 'open on a small, recognizable human moment',
    structure: ['hook: the moment', 'story: what makes it special', 'brand: where it happens', 'cta'],
    emotionalDriver: 'warmth and belonging',
    bestFor: ['AWARENESS', 'PRODUCT_PROMO'],
    voiceStyle: 'warm',
    visualStyle: 'cinematic',
    productionFormat: 'image-motion',
  },
  HUMOR: {
    label: 'הומור',
    hookMechanism: 'an exaggerated, relatable everyday situation with a light twist (never mocking anyone)',
    structure: ['hook: the funny situation', 'twist: the business fixes it', 'product', 'cta'],
    emotionalDriver: 'amusement and likability',
    bestFor: ['AWARENESS', 'PRODUCT_PROMO', 'OFFER'],
    voiceStyle: 'energetic',
    visualStyle: 'lifestyle-photo',
    productionFormat: 'image-motion',
  },
  PRODUCT_DEMO: {
    label: 'הדגמת מוצר',
    hookMechanism: 'show the product in action or its most striking detail immediately',
    structure: ['hook: the product moment', 'demo: how it works / what you get', 'benefit', 'cta'],
    emotionalDriver: 'desire and confidence',
    bestFor: ['PRODUCT_PROMO', 'SALES'],
    voiceStyle: 'social',
    visualStyle: 'photoreal-product',
    productionFormat: 'product-demo',
  },
  OFFER_DRIVEN: {
    label: 'מבצע',
    hookMechanism: 'lead with the exact offer or price from the brief',
    structure: [
      'hook: the offer',
      'product: what is included',
      'offer: price and terms',
      'cta with urgency from the brief only',
    ],
    emotionalDriver: 'value and urgency',
    bestFor: ['OFFER', 'SALES'],
    voiceStyle: 'energetic',
    visualStyle: 'photoreal-product',
    productionFormat: 'mixed',
  },
  UGC: {
    label: 'סגנון לקוח (UGC)',
    hookMechanism:
      'first-person, phone-style recommendation ("גיליתי מקום...") without inventing a real customer or review',
    structure: ['hook: personal discovery', 'what it is', 'why it is worth it', 'cta'],
    emotionalDriver: 'trust through authenticity',
    bestFor: ['SALES', 'LEADS', 'AWARENESS'],
    voiceStyle: 'social',
    visualStyle: 'ugc-handheld',
    productionFormat: 'ugc-style',
  },
  EDUCATIONAL: {
    label: 'טיפ / הסבר',
    hookMechanism: 'promise one useful tip or answer in the first line',
    structure: ['hook: the question or tip', 'tip: the useful part', 'how the business helps', 'cta'],
    emotionalDriver: 'curiosity and usefulness',
    bestFor: ['LEADS', 'AWARENESS'],
    voiceStyle: 'calm',
    visualStyle: 'photoreal-product',
    productionFormat: 'mixed',
  },
  LIFESTYLE: {
    label: 'סגנון חיים',
    hookMechanism: 'an aspirational everyday scene the audience wants to be part of',
    structure: ['hook: the scene', 'the product in that life', 'brand', 'cta'],
    emotionalDriver: 'aspiration',
    bestFor: ['AWARENESS', 'PRODUCT_PROMO'],
    voiceStyle: 'premium',
    visualStyle: 'lifestyle-photo',
    productionFormat: 'image-motion',
  },
};

/** Compact guide for the prompt: one line per type. */
export function conceptTypesGuide(): string {
  return Object.entries(CONCEPT_TYPES)
    .map(
      ([angle, t]) =>
        `- ${angle}: hook = ${t.hookMechanism}; beats = ${t.structure.join(' → ')}; emotion = ${t.emotionalDriver}; best for ${t.bestFor.join('/')}.`,
    )
    .join('\n');
}
