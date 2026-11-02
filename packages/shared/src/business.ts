import { z } from 'zod';
import { BrandColorsSchema, FieldSourceSchema, MoneySchema, PronunciationEntrySchema } from './common';
import { AssetSourceSchema } from './video-project';

export const ToneOfVoiceSchema = z.enum([
  'friendly',
  'premium',
  'energetic',
  'professional',
  'warm',
  'playful',
]);
export type ToneOfVoice = z.infer<typeof ToneOfVoiceSchema>;

export const ProductSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  price: MoneySchema.optional(),
});
export type Product = z.infer<typeof ProductSchema>;

export const BusinessProfileSchema = z.object({
  name: z.string().min(1),
  website: z.string().url().optional(),
  category: z.string().min(1),
  city: z.string().optional(),
  address: z.string().optional(),
  description: z.string(),
  products: z.array(ProductSchema).min(1),
  targetAudience: z.string(),
  tone: ToneOfVoiceSchema,
  brandColors: BrandColorsSchema,
  logoAssetId: z.string().optional(),
  /** Claims the business has explicitly approved for use in ads. Nothing else may be asserted as fact. */
  approvedClaims: z.array(z.string()),
  guidelines: z.array(z.string()),
  pronunciation: z.array(PronunciationEntrySchema),
  /** Provenance per top-level field, e.g. { description: 'INFERRED_UNCONFIRMED' }. */
  fieldSources: z.record(z.string(), FieldSourceSchema).default({}),
});
export type BusinessProfile = z.infer<typeof BusinessProfileSchema>;

const UnitSchema = z.number().min(0).max(1);

/**
 * Picture layout metadata: what the layout engine needs to keep text off the subject and to crop a picture for a
 * frame. Boxes are fractions of the source picture (0–1). Never guessed: it comes from a person who looked at the
 * picture (MANUAL) or an image analysis (ANALYSIS); without it the engine flags text over a picture for review.
 */
export const PictureLayoutSchema = z.object({
  /** The box that holds the people or the product: text must not cover it. */
  subject: z.object({ x: UnitSchema, y: UnitSchema, w: UnitSchema.positive(), h: UnitSchema.positive() }),
  /** Where the picture has calm space for type. */
  calm: z.enum(['TOP', 'BOTTOM', 'START', 'END', 'NONE']),
  focal: z.object({ x: UnitSchema, y: UnitSchema }).optional(),
  composition: z.enum(['SINGLE_HERO', 'ASSORTMENT', 'LIFESTYLE', 'DETAIL', 'ENVIRONMENT', 'DEMONSTRATION']).optional(),
  /** One person, a few, or a group: a group needs a large frame to be read. */
  people: z.enum(['NONE', 'ONE', 'FEW', 'GROUP']).optional(),
  source: z.enum(['MANUAL', 'ANALYSIS']),
});
export type PictureLayout = z.infer<typeof PictureLayoutSchema>;

/** A media asset the business owns or licensed, as seen by planning code (no storage details). */
export const AvailableAssetSchema = z.object({
  id: z.string(),
  kind: z.enum(['image', 'video', 'audio', 'logo']),
  description: z.string(),
  tags: z.array(z.string()),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  durationSec: z.number().positive().optional(),
  /** File type, when known; decides whether an image can be sent to an image provider as a reference. */
  mimeType: z.string().optional(),
  /** Where the file came from; decides whether it may stand for the real product (see mediaAuthenticity). */
  source: AssetSourceSchema.optional(),
  commercialUse: z.boolean(),
  /** Where the subject and the calm space are in a picture, when someone (or an analysis) recorded it. */
  layout: PictureLayoutSchema.optional(),
});
export type AvailableAsset = z.infer<typeof AvailableAssetSchema>;

/** Photo formats image providers accept as references (OpenAI: JPEG, PNG, WebP). SVG illustrations are not. */
export const REFERENCE_IMAGE_MIME_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];
