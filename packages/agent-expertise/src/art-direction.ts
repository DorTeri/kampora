import type { CampaignGoal, CompositionType, LayoutFamily } from '@kampora/shared';
import type { Playbook } from './playbook';

export const ART_DIRECTION_PLAYBOOK: Playbook = {
  id: 'art-direction',
  version: '1.0.0',
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
    'OFFER/SALES with a price: the price is the primary focal point, or second after the product.',
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
