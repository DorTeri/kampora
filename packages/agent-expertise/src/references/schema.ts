import { z } from 'zod';
import { DesignMoveSchema } from '@kampora/shared';

/**
 * A professional reference: a real, published advertising design with a verified source URL and a structured
 * design deconstruction authored by Kampora. The analysis teaches principles; the image itself is never stored
 * (public visibility is not a licence), and nothing here may be reproduced as a composition or asset.
 */
const VisualAnalysisSchema = z.object({
  viewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Pages where the work was seen. */
  viewedUrls: z.array(z.string().url()).min(1),
  /** Which pieces were seen and how clearly. */
  whatWasSeen: z.string().min(5),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
  composition: z.string(),
  hierarchy: z.string(),
  typography: z.string(),
  gridAndSpacing: z.string(),
  photography: z.string(),
  colorRelationships: z.string(),
  productPlacement: z.string(),
  negativeSpace: z.string(),
  brandExpression: z.string(),
  distinctiveDecisions: z.string(),
});

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
   * What the analysis rests on. IMAGES_VIEWED: the advertising work itself was looked at (in a browser, on the
   * source page; nothing downloaded) and `visualAnalysis` records what was seen. The other two rest on published
   * text, so their visual statements are second-hand.
   */
  analysisBasis: z.enum(['IMAGES_VIEWED', 'SOURCE_TEXT_AND_IMAGE_DESCRIPTIONS', 'SOURCE_TEXT']),
  /** Present only when the work was viewed: a design reading of the actual pieces, in Kampora's own words. */
  visualAnalysis: VisualAnalysisSchema.optional(),
  /** Where looking at the work showed the earlier text-only analysis to be wrong. */
  corrections: z.array(z.object({ field: z.string(), wasClaimed: z.string(), actuallySeen: z.string() })).default([]),
  /** A visual check was attempted and could not be done (why), so the analysis stays text-only. */
  visualCheck: z.object({ attemptedAt: z.string(), outcome: z.string() }).optional(),
  rights: z.object({ status: z.literal('URL_AND_AUTHORED_ANALYSIS_ONLY'), note: z.string() }),
}).refine((r) => (r.analysisBasis === 'IMAGES_VIEWED') === Boolean(r.visualAnalysis), {
  message: 'IMAGES_VIEWED requires a visualAnalysis, and only a viewed reference may carry one',
});
export type ProfessionalReference = z.infer<typeof ProfessionalReferenceSchema>;
export type ProfessionalReferenceInput = z.input<typeof ProfessionalReferenceSchema>;
