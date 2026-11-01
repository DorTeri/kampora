import { z } from 'zod';
import { DesignMoveSchema } from '@kampora/shared';

/**
 * A professional reference: a real, published advertising design with a verified source URL and a structured
 * design deconstruction authored by Kampora. The analysis teaches principles; the image itself is never stored
 * (public visibility is not a licence), and nothing here may be reproduced as a composition or asset.
 */
export const ProfessionalReferenceSchema = z.object({
  id: z.string().regex(/^ref-[a-z0-9-]+$/),
  title: z.string().min(3),
  brand: z.string().min(1),
  campaign: z.string().nullable(),
  creator: z.string().nullable(),
  year: z.number().int().min(1950).max(2100).nullable(),
  sourceUrl: z.string().url(),
  additionalSourceUrls: z.array(z.string().url()),
  sourceType: z.enum(['AGENCY_PORTFOLIO', 'BEHANCE', 'AD_ARCHIVE', 'AWARD', 'PRESS', 'BRAND_CASE_STUDY']),
  /** The title of the page as it was fetched when the source was verified. */
  pageTitleSeen: z.string().min(1),
  fetchedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  industry: z.enum(['cafe-restaurant', 'fitness', 'beauty-wellness', 'local-services', 'ecommerce', 'premium-product', 'generic']),
  productType: z.string(),
  objective: z.enum(['AWARENESS', 'OFFER', 'LEADS', 'LAUNCH', 'SALES', 'BRAND']),
  formats: z.array(z.enum(['PRINT', 'OOH', 'SOCIAL_STATIC', 'DIGITAL_BANNER', 'VIDEO', 'PACKAGING_SHOWCASE'])).min(1),
  audience: z.string(),
  brandPersonality: z.array(z.string()).min(1),
  visualStyle: z.string(),
  composition: z.string(),
  typography: z.string(),
  colorSystem: z.string(),
  hierarchy: z.string(),
  imageTreatment: z.string(),
  productPositioning: z.string(),
  cta: z.string().nullable(),
  /** Design deconstruction. */
  attention: z.string(),
  distinction: z.string(),
  balance: z.string(),
  messageSpeed: z.string(),
  brandElements: z.string(),
  /** How a small business can adapt the approach without copying the composition or assets. */
  adaptation: z.string(),
  whyItWorks: z.string(),
  principles: z.array(z.object({ text: z.string().min(10), when: z.string() })).min(1),
  suitableFor: z.array(z.string()),
  avoidWhen: z.array(z.string()),
  designMoves: z.array(DesignMoveSchema).min(1),
  /**
   * What the analysis rests on. Only SOURCE_TEXT_AND_IMAGE_DESCRIPTIONS and SOURCE_TEXT occur today: the
   * research tools could not view the images themselves, so visual statements come from published text.
   */
  analysisBasis: z.enum(['IMAGES_VIEWED', 'SOURCE_TEXT_AND_IMAGE_DESCRIPTIONS', 'SOURCE_TEXT']),
  rights: z.object({ status: z.literal('URL_AND_AUTHORED_ANALYSIS_ONLY'), note: z.string() }),
});
export type ProfessionalReference = z.infer<typeof ProfessionalReferenceSchema>;
export type ProfessionalReferenceInput = z.input<typeof ProfessionalReferenceSchema>;
