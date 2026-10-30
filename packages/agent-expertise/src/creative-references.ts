import { z } from 'zod';
import { CampaignGoalSchema, LayoutFamilySchema, VisualStyleSchema } from '@kampora/shared';

/**
 * A creative reference: a described advertising pattern and why it works. References teach principles; they
 * never carry another brand's assets, logos or identifiable designs. Every entry records its source and rights.
 */
export const CreativeReferenceSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Industry profile ids it applies to; empty = any industry. */
  industries: z.array(z.string()),
  goals: z.array(CampaignGoalSchema).min(1),
  formats: z.array(z.enum(['STATIC', 'VIDEO'])).min(1),
  visualStyle: VisualStyleSchema,
  layoutFamily: LayoutFamilySchema.optional(),
  compositionPattern: z.string(),
  copywritingApproach: z.string(),
  typography: z.string(),
  colorDirection: z.string(),
  audience: z.string(),
  whyItWorks: z.string(),
  constraints: z.array(z.string()),
  source: z.object({
    kind: z.enum(['KAMPORA_ORIGINAL', 'LICENSED', 'CUSTOMER_APPROVED']),
    description: z.string(),
    usageRights: z.string(),
  }),
});
export type CreativeReference = z.infer<typeof CreativeReferenceSchema>;

const ORIGINAL = {
  kind: 'KAMPORA_ORIGINAL' as const,
  description:
    'Pattern written by the Kampora creative team from general professional practice; no third-party ad is reproduced.',
  usageRights: 'Owned by Kampora; principles only.',
};

/** Small curated starter library (principles, not copies). */
export const REFERENCE_LIBRARY_VERSION = '1.0.0';
export const CREATIVE_REFERENCES: readonly CreativeReference[] = [
  {
    id: 'ref-combo-split',
    title: 'Combo offer in a split layout',
    industries: ['cafe-restaurant'],
    goals: ['OFFER', 'SALES'],
    formats: ['STATIC'],
    visualStyle: 'photoreal-product',
    layoutFamily: 'SPLIT',
    compositionPattern:
      'Both items of the combo in one frame on the picture side; the calm column carries headline, price and action.',
    copywritingApproach: 'What you get, then the exact price, then one action.',
    typography: 'Heavy short headline; price as the largest number on the page.',
    colorDirection: 'Brand dark field for the column, brand accent only on price and action.',
    audience: 'Commuters and locals deciding on a regular purchase.',
    whyItWorks: 'Nothing covers the product; the eye goes picture → price → action in one sweep.',
    constraints: ['Both offered items must be in the picture.'],
    source: ORIGINAL,
  },
  {
    id: 'ref-price-stamp',
    title: 'Price stamp retail',
    industries: [],
    goals: ['OFFER'],
    formats: ['STATIC'],
    visualStyle: 'photoreal-product',
    layoutFamily: 'OFFER_RETAIL',
    compositionPattern: 'Product full-bleed with a calm area; a round price stamp near the headline.',
    copywritingApproach: 'Offer-first headline of 3–5 words.',
    typography: 'Very heavy headline; stamp with label and price.',
    colorDirection: 'Accent stamp on a darkened picture.',
    audience: 'Value-driven buyers scrolling fast.',
    whyItWorks: 'The value is legible at thumbnail size.',
    constraints: ['Exactly one price.'],
    source: ORIGINAL,
  },
  {
    id: 'ref-quiet-premium',
    title: 'Quiet premium inset',
    industries: ['beauty-wellness', 'ecommerce', 'cafe-restaurant'],
    goals: ['AWARENESS', 'PRODUCT_PROMO'],
    formats: ['STATIC', 'VIDEO'],
    visualStyle: 'photoreal-product',
    layoutFamily: 'PREMIUM_MINIMAL',
    compositionPattern: 'Framed inset picture with generous negative space on a soft brand field.',
    copywritingApproach: 'One understated line; the brand name carries trust.',
    typography: 'Lighter weight, more letter space, small text-link action.',
    colorDirection: 'Light brand background tone, dark text.',
    audience: 'Customers who choose on quality and care.',
    whyItWorks: 'Restraint signals quality; the product reads as precious.',
    constraints: ['Needs a calm, high-quality picture.'],
    source: ORIGINAL,
  },
  {
    id: 'ref-moment-lifestyle',
    title: 'A moment in the audience’s week',
    industries: ['cafe-restaurant', 'fitness', 'beauty-wellness'],
    goals: ['AWARENESS', 'PRODUCT_PROMO'],
    formats: ['STATIC', 'VIDEO'],
    visualStyle: 'lifestyle-photo',
    layoutFamily: 'LIFESTYLE_PHOTO',
    compositionPattern: 'Full-bleed photograph of a real moment; text low, on a soft scrim.',
    copywritingApproach: 'Name the moment ("ראשון, 7:40") instead of describing the business.',
    typography: 'Medium weight, start-aligned, small.',
    colorDirection: 'Natural photo colors; brand accent only on the action.',
    audience: 'Locals who could make this part of their routine.',
    whyItWorks: 'People recognise themselves before they recognise an ad.',
    constraints: ['Real people need consent; AI people are never presented as customers.'],
    source: ORIGINAL,
  },
  {
    id: 'ref-type-first-leads',
    title: 'Type-first lead ad',
    industries: ['fitness', 'local-services'],
    goals: ['LEADS'],
    formats: ['STATIC'],
    visualStyle: 'flat-graphic',
    layoutFamily: 'BOLD_TYPOGRAPHIC',
    compositionPattern: 'A large question or promise fills the field; the picture, if any, supports it.',
    copywritingApproach: 'The audience’s own question, then one reassuring fact, then the action.',
    typography: 'Very large heavy headline, two lines max.',
    colorDirection: 'Solid brand color field, accent action bar.',
    audience: 'People with a specific need or hesitation.',
    whyItWorks: 'Works without a strong photo and reads instantly.',
    constraints: ['Headline must be short to stay large.'],
    source: ORIGINAL,
  },
  {
    id: 'ref-neighbourhood',
    title: 'Neighbourhood business',
    industries: ['local-services', 'cafe-restaurant'],
    goals: ['OFFER', 'LEADS', 'AWARENESS'],
    formats: ['STATIC'],
    visualStyle: 'lifestyle-photo',
    layoutFamily: 'LOCAL_PROMO',
    compositionPattern:
      'Brand banner with the business name; the picture panel below; the address next to the action.',
    copywritingApproach: 'Local and concrete: the street, the area, the person.',
    typography: 'Wordmark-sized business name, clear address line.',
    colorDirection: 'Brand primary banner, accent action.',
    audience: 'People nearby.',
    whyItWorks: 'Proximity is a reason to act; the name and place are remembered.',
    constraints: ['The address must be verified.'],
    source: ORIGINAL,
  },
  {
    id: 'ref-product-card',
    title: 'Product on a clean field',
    industries: ['ecommerce', 'beauty-wellness'],
    goals: ['PRODUCT_PROMO', 'SALES'],
    formats: ['STATIC'],
    visualStyle: 'photoreal-product',
    layoutFamily: 'PRODUCT_SHOWCASE',
    compositionPattern: 'The product framed on a plain brand-tinted field; a small price badge.',
    copywritingApproach: 'Benefit headline, not a feature list.',
    typography: 'Clean, medium-heavy headline.',
    colorDirection: 'Light field from the brand background color.',
    audience: 'Shoppers comparing products.',
    whyItWorks: 'The product is the hero and reads true to life.',
    constraints: ['Use the real product photo when the real product must be shown.'],
    source: ORIGINAL,
  },
  {
    id: 'ref-editorial-detail',
    title: 'Editorial detail',
    industries: ['cafe-restaurant', 'ecommerce'],
    goals: ['PRODUCT_PROMO', 'AWARENESS'],
    formats: ['STATIC', 'VIDEO'],
    visualStyle: 'cinematic',
    layoutFamily: 'EDITORIAL_PRODUCT',
    compositionPattern:
      'Large picture panel, headline aligned to the reading edge below it, small price inline.',
    copywritingApproach: 'A sensory or craft detail in the headline.',
    typography: 'Clean weight, start-aligned like a magazine.',
    colorDirection: 'Brand background tone, dark text.',
    audience: 'Customers who care about craft.',
    whyItWorks: 'Feels like content rather than a flyer, so it earns a second look.',
    constraints: ['Needs a strong picture.'],
    source: ORIGINAL,
  },
];

/**
 * The few references relevant to this brief (never the whole library): scored by industry, goal, format and
 * layout. Returns at most `limit`.
 */
export function retrieveReferences(query: {
  industryId: string;
  goal: string;
  format: 'STATIC' | 'VIDEO';
  layoutFamily?: string;
  limit?: number;
}): CreativeReference[] {
  return CREATIVE_REFERENCES.map((r) => ({
    r,
    score:
      (r.industries.includes(query.industryId) ? 3 : r.industries.length === 0 ? 1 : 0) +
      (r.goals.includes(query.goal as never) ? 3 : 0) +
      (r.formats.includes(query.format) ? 1 : 0) +
      (query.layoutFamily && r.layoutFamily === query.layoutFamily ? 2 : 0),
  }))
    .filter((x) => x.score >= 4)
    .sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id))
    .slice(0, query.limit ?? 2)
    .map((x) => x.r);
}
