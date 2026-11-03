import type {
  CampaignGoal,
  CompositionMethod,
  CompositionType,
  ConceptAngle,
  DesignMove,
  DirectionApproach,
  HookTechnique,
  LayoutFamily,
} from '@kampora/shared';
import type { Playbook } from './playbook';

export const ART_DIRECTION_PLAYBOOK: Playbook = {
  id: 'art-direction',
  version: '1.1.0',
  role: 'ART_DIRECTOR',
  responsibility:
    'Decide what the viewer notices first and how the eye travels, choose the layout, type, color and picture treatment that carry this specific message, and adapt them to every format.',
  requiredContext: [
    'campaign goal and offer',
    'the chosen concept and its written copy',
    'brand colors, tone and logo',
    'available pictures with their authenticity and what they show',
    'industry visual conventions',
  ],
  methods: [
    {
      id: 'ONE_FOCAL_POINT',
      name: 'One focal point',
      when: 'Always.',
      how: 'Pick the single element the viewer must see first (price for an offer, product for a launch, people for a lifestyle message) and make it the largest or highest-contrast element.',
      avoid: 'Headline, price and logo all competing at the same size.',
    },
    {
      id: 'Z_AND_F_PATHS_RTL',
      name: 'Reading path in Hebrew',
      when: 'Placing secondary elements.',
      how: 'Hebrew readers enter top-right; put the headline at the reading edge, lead the eye down to the action at the bottom.',
    },
    {
      id: 'NEGATIVE_SPACE',
      name: 'Negative space',
      when: 'Premium positioning, or any picture busy enough to fight the text.',
      how: 'Keep calm space around the message; let the picture breathe instead of covering it with cards.',
      avoid: 'Text blocks over the product.',
    },
    {
      id: 'CONTRAST_BY_SURFACE',
      name: 'Contrast through a surface',
      when: 'Text over a photograph.',
      how: 'A scrim for calm pictures, a solid panel for busy pictures, a solid color field when type carries the ad. Check text contrast (WCAG ≥ 4.5:1).',
    },
    {
      id: 'TYPE_SCALE',
      name: 'Deliberate type scale',
      when: 'Always.',
      how: 'Two to three sizes with clear ratios; heavy weight for short punchy headlines, lighter for premium.',
      avoid: 'Every block in bold black at similar sizes.',
    },
    {
      id: 'FORMAT_ADAPTATION',
      name: 'Adapt, do not crop',
      when: 'Producing 1:1, 4:5 and 9:16.',
      how: 'Re-arrange per format: side-by-side in square, stacked in tall formats, text kept out of the Stories interface zones.',
    },
  ],
  constraints: [
    'All text is live RTL text from the copy; never baked into pictures.',
    'Only brand colors (or tints of them) for fields and accents; text must pass contrast.',
    'AI pictures are never presented as the real product or place.',
    'Layout families are deterministic, tested components; the plan chooses and parameterises them.',
  ],
  decisionRules: [
    'The concept, not the goal, decides the focal point (see CONCEPT_VISUAL_STRATEGIES): in an offer campaign only the value concept makes the price the hero; a craving or craft concept keeps the price legible but quiet.',
    'OFFER/SALES with a price and a value concept: the price is the primary focal point, or second after the product.',
    'AWARENESS: the picture (people or place) leads; text is quiet.',
    'PRODUCT_PROMO: the product leads; price, if any, is secondary.',
    'LEADS: the message and the action lead; a clear action bar.',
    'Premium tone: more negative space, lighter weight, a text-link CTA instead of a big button.',
    'No usable picture: type is the image (bold typographic) rather than a weak stock picture.',
    'Do not repeat the layout family of the business’s previous ad when another family fits almost as well.',
  ],
  outputs: ['ArtDirectionPlan with per-format designs'],
  examples: [
    {
      situation: 'Coffee + pastry offer, warm café photo with the cup on one side',
      good: 'Split layout: photo panel on the reading edge, price stamp and bar CTA in the calm column',
      weak: 'White price card centered over the coffee cup',
      why: 'The good one keeps both the product and the price visible; the weak one hides the focal product.',
    },
  ],
  failureModes: [
    'The same template for every business',
    'Three concepts of one campaign in the same layout, with only the words changed',
    'Forcing a different look on a concept when the look stops serving its message',
    'A price card covering the product',
    'Low-contrast text on a busy photograph',
    'Four elements of equal visual weight',
  ],
  evaluationCriteria: [
    'VISUAL_HIERARCHY',
    'LAYOUT_BALANCE',
    'TYPOGRAPHY',
    'READABILITY',
    'BRAND_CONSISTENCY',
    'IMAGE_RELEVANCE',
    'VISUAL_ORIGINALITY',
  ],
};

/**
 * What a concept's idea asks of the picture and the page. The Copywriter's hook technique and angle say which idea a
 * concept argues; this decides the direction that carries it, the arrangement, the moves the layout engine applies,
 * which element is the focal point and which pictures serve it. Weights add to the reference votes (a reference at
 * full relevance votes 1.5), so the concept leads and the references refine.
 */
export type ConceptVisualIdea = 'VALUE' | 'APPETITE' | 'CRAFT' | 'MOMENT' | 'STATEMENT';

export interface ConceptVisualStrategy {
  id: ConceptVisualIdea;
  name: string;
  /** The art-direction principle, in one line (recorded in the rationale). */
  principle: string;
  /** The visual idea for the owner (Hebrew). */
  ideaHe: string;
  /** The direction that carries this idea; the other two stay as alternatives. */
  approach: DirectionApproach;
  /** Arrangements that carry the idea, best first. */
  methods: readonly CompositionMethod[];
  moves: Partial<Record<DesignMove, number>>;
  /** Moves that work against the idea in any direction of this concept (a price sticker on a craving ad). */
  avoid: readonly DesignMove[];
  focal: 'PRICE' | 'IMAGE' | 'HEADLINE';
  /** HERO: the price is the news. QUIET: legible, never louder than the idea. */
  price: 'HERO' | 'QUIET';
  /** Picture compositions that show this idea, best first (only measured or recorded metadata is compared). */
  pictures: readonly CompositionType[];
  /** The idea rests on a picture; without one it falls back to type. */
  needsPicture: boolean;
}

export const CONCEPT_VISUAL_STRATEGIES: Record<ConceptVisualIdea, ConceptVisualStrategy> = {
  VALUE: {
    id: 'VALUE',
    name: 'Value',
    principle:
      'The deal is read in one glance: what you get, one price, one action. The product stays beside the number so the price stands for something; no starburst, no sale sticker.',
    ideaHe: 'מה שמקבלים ובכמה, במבט אחד: המחיר גדול ליד המוצר, ופעולה אחת ברורה.',
    approach: 'BOLD_GRAPHIC',
    methods: ['PROMO_PRICE'],
    moves: { PRICE_AS_GRAPHIC: 1.6, CTA_BUTTON: 0.8, SINGLE_FOCAL_POINT: 0.5, RULE_LINES: 0.4 },
    avoid: ['BADGE_STAMP', 'PRICE_UNDERSTATED'],
    focal: 'PRICE',
    price: 'HERO',
    pictures: ['SINGLE_HERO', 'ASSORTMENT'],
    needsPicture: false,
  },
  APPETITE: {
    id: 'APPETITE',
    name: 'Appetite',
    principle:
      'The food is the headline: the product fills the frame, close enough to see texture; few words on its calm edge, the price quiet, the action a line.',
    ideaHe: 'האוכל הוא הכותרת: המוצר ממלא את הפריים מקרוב, מעט מילים בקצה השקט, והמחיר בשקט.',
    approach: 'IMAGE_LED',
    methods: ['IMAGE_FIRST', 'LAYERED'],
    moves: {
      FULL_BLEED_IMAGE: 1.4,
      DETAIL_MACRO_CROP: 1.2,
      MINIMAL_COPY: 1,
      PRICE_UNDERSTATED: 1.4,
      CTA_AS_TEXT_LINE: 0.9,
      DARK_MOODY: 0.5,
    },
    avoid: ['PRICE_AS_GRAPHIC', 'BADGE_STAMP', 'TYPE_AS_IMAGE', 'STACKED_HEADLINE'],
    focal: 'IMAGE',
    price: 'QUIET',
    pictures: ['DETAIL', 'SINGLE_HERO'],
    needsPicture: true,
  },
  CRAFT: {
    id: 'CRAFT',
    name: 'Craft',
    principle:
      'Proof reads like a page, not a poster: the true detail of the making as a calm serif statement, the picture framed as evidence, thin rules; the price is a footnote.',
    ideaHe: 'הוכחה ולא צעקה: משפט האמת על ההכנה בסריף רגוע, התמונה ממוסגרת כעדות, והמחיר כהערת שוליים.',
    approach: 'EDITORIAL_TYPE',
    methods: ['EDITORIAL', 'SPLIT'],
    moves: {
      SERIF_EDITORIAL: 1.3,
      IMAGE_INSET_FRAME: 1.3,
      RULE_LINES: 0.9,
      PRICE_UNDERSTATED: 1.4,
      CTA_AS_TEXT_LINE: 0.9,
      GENEROUS_NEGATIVE_SPACE: 0.6,
      MUTED_NATURAL_PALETTE: 0.6,
    },
    avoid: ['PRICE_AS_GRAPHIC', 'BADGE_STAMP', 'BRAND_COLOR_FLOOD', 'STACKED_HEADLINE', 'TYPE_AS_IMAGE'],
    focal: 'HEADLINE',
    price: 'QUIET',
    pictures: ['DEMONSTRATION', 'DETAIL', 'SINGLE_HERO'],
    needsPicture: false,
  },
  MOMENT: {
    id: 'MOMENT',
    name: 'Moment',
    principle:
      'A real moment carries it: people when such a picture exists, otherwise the place or the product in its setting, never an invented person; the type leans on the calm edge.',
    ideaHe: 'רגע אמיתי מוביל, אנשים כשיש תמונה כזו; הטקסט נשען על הקצה השקט של התמונה.',
    approach: 'IMAGE_LED',
    methods: ['LIFESTYLE', 'LAYERED', 'IMAGE_FIRST'],
    moves: {
      FULL_BLEED_IMAGE: 1.2,
      PEOPLE_AS_HERO: 1,
      LAYERED_TYPE_OVER_IMAGE: 0.6,
      CTA_AS_TEXT_LINE: 0.6,
      PRICE_UNDERSTATED: 1,
    },
    avoid: ['PRICE_AS_GRAPHIC', 'BADGE_STAMP'],
    focal: 'IMAGE',
    price: 'QUIET',
    pictures: ['LIFESTYLE', 'ENVIRONMENT'],
    needsPicture: true,
  },
  STATEMENT: {
    id: 'STATEMENT',
    name: 'Statement',
    principle: 'One sentence is the image: type at poster scale on a brand field, nothing competing with it.',
    ideaHe: 'משפט אחד הוא התמונה: טיפוגרפיה בגודל שלט על צבע המותג.',
    approach: 'BOLD_GRAPHIC',
    methods: ['BOLD_TYPE'],
    moves: { OVERSIZED_HEADLINE: 1, TYPE_AS_IMAGE: 0.8, BRAND_COLOR_FLOOD: 0.8, MINIMAL_COPY: 0.6 },
    avoid: ['PRICE_AS_GRAPHIC', 'BADGE_STAMP'],
    focal: 'HEADLINE',
    price: 'QUIET',
    pictures: [],
    needsPicture: false,
  },
};

const IDEA_BY_HOOK: Partial<Record<HookTechnique, ConceptVisualIdea>> = {
  OFFER_FIRST: 'VALUE',
  SENSORY_DETAIL: 'APPETITE',
  FIRST_PERSON: 'CRAFT',
  HOW_TO: 'CRAFT',
  PATTERN_INTERRUPT: 'MOMENT',
  BOLD_STATEMENT: 'STATEMENT',
  // QUESTION and CONTRAST say how the words work, not what the picture shows: the angle decides.
};
const IDEA_BY_ANGLE: Record<ConceptAngle, ConceptVisualIdea> = {
  OFFER_DRIVEN: 'VALUE',
  PRODUCT_DEMO: 'APPETITE',
  UGC: 'CRAFT',
  EDUCATIONAL: 'CRAFT',
  LIFESTYLE: 'MOMENT',
  EMOTIONAL: 'MOMENT',
  PROBLEM_SOLUTION: 'STATEMENT',
  HUMOR: 'STATEMENT',
};

/** The visual idea a concept argues: its hook technique decides, its angle when the hook says nothing about it. */
export function conceptVisualStrategy(concept: {
  angle: ConceptAngle;
  hookTechnique?: HookTechnique;
}): ConceptVisualStrategy {
  const id = (concept.hookTechnique && IDEA_BY_HOOK[concept.hookTechnique]) ?? IDEA_BY_ANGLE[concept.angle];
  return CONCEPT_VISUAL_STRATEGIES[id];
}

/** When each layout family is the right tool (the Art Director scores families against these). */
export interface LayoutFamilyProfile {
  family: LayoutFamily;
  label: string;
  /** Goals it serves well. */
  goals: readonly CampaignGoal[];
  /** Picture compositions it shows off well. */
  compositions: readonly CompositionType[];
  needsPicture: boolean;
  /** Tone affinity. */
  tones: readonly string[];
  /** Works with an offer price as a strong element. */
  carriesPrice: boolean;
}

export const LAYOUT_FAMILY_PROFILES: Record<LayoutFamily, LayoutFamilyProfile> = {
  EDITORIAL_PRODUCT: {
    family: 'EDITORIAL_PRODUCT',
    label: 'מוצר בסגנון מגזיני',
    goals: ['PRODUCT_PROMO', 'SALES', 'AWARENESS'],
    compositions: ['SINGLE_HERO', 'DETAIL', 'ASSORTMENT'],
    needsPicture: true,
    tones: ['premium', 'warm', 'professional'],
    carriesPrice: false,
  },
  PREMIUM_MINIMAL: {
    family: 'PREMIUM_MINIMAL',
    label: 'מינימליסטי יוקרתי',
    goals: ['AWARENESS', 'PRODUCT_PROMO'],
    compositions: ['SINGLE_HERO', 'DETAIL'],
    needsPicture: true,
    tones: ['premium', 'professional'],
    carriesPrice: false,
  },
  OFFER_RETAIL: {
    family: 'OFFER_RETAIL',
    label: 'מבצע במרכז',
    goals: ['OFFER', 'SALES'],
    compositions: ['SINGLE_HERO', 'ASSORTMENT'],
    needsPicture: false,
    tones: ['energetic', 'friendly', 'playful'],
    carriesPrice: true,
  },
  LIFESTYLE_PHOTO: {
    family: 'LIFESTYLE_PHOTO',
    label: 'צילום אווירה',
    goals: ['AWARENESS', 'PRODUCT_PROMO', 'LEADS'],
    compositions: ['LIFESTYLE', 'ENVIRONMENT'],
    needsPicture: true,
    tones: ['warm', 'friendly', 'premium'],
    carriesPrice: false,
  },
  BOLD_TYPOGRAPHIC: {
    family: 'BOLD_TYPOGRAPHIC',
    label: 'טיפוגרפיה נועזת',
    goals: ['LEADS', 'OFFER', 'AWARENESS'],
    compositions: [],
    needsPicture: false,
    tones: ['energetic', 'playful', 'professional'],
    carriesPrice: true,
  },
  PRODUCT_SHOWCASE: {
    family: 'PRODUCT_SHOWCASE',
    label: 'תצוגת מוצר',
    goals: ['PRODUCT_PROMO', 'SALES', 'OFFER'],
    compositions: ['SINGLE_HERO', 'DETAIL'],
    needsPicture: true,
    tones: ['professional', 'friendly', 'premium'],
    carriesPrice: true,
  },
  SPLIT: {
    family: 'SPLIT',
    label: 'מפוצל: תמונה ומסר',
    goals: ['OFFER', 'SALES', 'LEADS', 'PRODUCT_PROMO'],
    compositions: ['SINGLE_HERO', 'ASSORTMENT', 'DEMONSTRATION', 'LIFESTYLE'],
    needsPicture: true,
    tones: ['friendly', 'warm', 'professional', 'energetic'],
    carriesPrice: true,
  },
  LOCAL_PROMO: {
    family: 'LOCAL_PROMO',
    label: 'עסק שכונתי',
    goals: ['OFFER', 'LEADS', 'AWARENESS'],
    compositions: ['ENVIRONMENT', 'ASSORTMENT', 'SINGLE_HERO'],
    needsPicture: true,
    tones: ['friendly', 'warm', 'energetic'],
    carriesPrice: true,
  },
};
