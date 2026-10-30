import { z } from 'zod';
import { VisualStyleSchema } from './campaign';
import { CompositionTypeSchema } from './storyboard';
import { LayoutFamilySchema, StaticAdDesignSchema } from './static-ad';

/** Things a viewer can notice in an ad, ordered by the Art Director into a visual hierarchy. */
export const DesignElementSchema = z.enum([
  'PRODUCT',
  'PEOPLE',
  'PLACE',
  'HEADLINE',
  'SUBHEADLINE',
  'PRICE',
  'CTA',
  'LOGO',
  'ADDRESS',
]);
export type DesignElement = z.infer<typeof DesignElementSchema>;

/** One deliberate decision and the reason for it (shown to the owner and read by the Critic). */
export const DesignDecisionSchema = z.object({
  /** What was decided, e.g. "layout", "focal point", "price treatment". */
  topic: z.string(),
  decision: z.string(),
  because: z.string(),
});
export type DesignDecision = z.infer<typeof DesignDecisionSchema>;

/**
 * The Art Director's plan for one ad: what the viewer notices first, how the eye travels, which layout family
 * carries it in each format, and how the picture should be made. Provider-independent; it drives the static-ad
 * renderer (via `formats`), the visual prompt planner (photography and negative space) and the video overlays.
 */
export const ArtDirectionPlanSchema = z.object({
  version: z.literal(1),
  playbookVersion: z.string(),
  /** One sentence: the visual idea. */
  visualConcept: z.string(),
  decisions: z.array(DesignDecisionSchema),
  layoutFamily: LayoutFamilySchema,
  /** Every family considered, with its score and reasons (explainable choice). */
  alternatives: z
    .array(z.object({ layoutFamily: LayoutFamilySchema, score: z.number(), reasons: z.array(z.string()) }))
    .max(8),
  /** Ordered: the first element is what the viewer must notice first; the order is the intended eye path. */
  hierarchy: z.array(DesignElementSchema).min(3),
  primaryFocal: DesignElementSchema,
  composition: z.object({
    /** HERO: the picture carries the ad. SUPPORTING: it supports the type. NONE: type only. */
    imageRole: z.enum(['HERO', 'SUPPORTING', 'NONE']),
    subject: CompositionTypeSchema,
    /** Where calm space is kept in the picture for the text. */
    negativeSpace: z.enum(['TOP', 'BOTTOM', 'START', 'END', 'NONE']),
  }),
  typography: z.object({
    headlineScale: z.number(),
    weight: z.number().int(),
    treatment: z.enum(['HEAVY', 'CLEAN', 'ELEGANT']),
    alignment: z.enum(['START', 'CENTER']),
    maxHeadlineWords: z.number().int().positive(),
  }),
  contrastStrategy: z.enum(['SCRIM', 'PANEL', 'FIELD']),
  photography: z.object({
    style: VisualStyleSchema,
    /** Instruction for the image prompt (English, provider-facing). */
    direction: z.string(),
    avoid: z.array(z.string()),
  }),
  priceTreatment: z.enum(['NONE', 'CARD', 'BADGE', 'STAMP', 'INLINE', 'HERO']),
  ctaTreatment: z.enum(['PILL', 'BAR', 'TEXT']),
  motion: z.object({
    pacing: z.enum(['CALM', 'BALANCED', 'FAST']),
    headlinePosition: z.enum(['top', 'center']),
    transition: z.enum(['none', 'fade', 'slide-up', 'zoom']),
  }),
  brandConstraints: z.array(z.string()),
  layoutConstraints: z.array(z.string()),
  referenceIds: z.array(z.string()),
  formats: z.object({
    '1:1': StaticAdDesignSchema,
    '4:5': StaticAdDesignSchema,
    '9:16': StaticAdDesignSchema,
  }),
});
export type ArtDirectionPlan = z.infer<typeof ArtDirectionPlanSchema>;
