import { z } from 'zod';
import type { AssetSource } from './video-project';

/**
 * How far a picture can be trusted to show the real business. Only the business's own photos represent its real
 * products and premises; everything generated is a stand-in, however photorealistic, and is labelled as one.
 */
export const MediaAuthenticitySchema = z.enum([
  /** The business's own photo of its products. */
  'VERIFIED_PRODUCT_PHOTO',
  /** The business's own photo of its place, team or customers. */
  'VERIFIED_BUSINESS_PHOTO',
  /** Generated with the business's own product photos as references: close to the product, not a photo of it. */
  'REFERENCE_GUIDED_AI',
  /** Generated from a text description only: a generic stand-in, not the real product or place. */
  'SYNTHETIC_AI',
  /** Stock or demo photography: real photography, but not of this business. */
  'GENERIC_STOCK',
  /** A drawing or graphic (SVG, programmatic artwork), not a photograph. */
  'ILLUSTRATION',
]);
export type MediaAuthenticity = z.infer<typeof MediaAuthenticitySchema>;

/** Tags or words that mark an owner's photo as a product photo rather than a photo of the place. */
const PRODUCT_CUES = /\b(product|hero|dish|menu)\b|מוצר|מנה|תפריט/i;

export interface AuthenticityInput {
  source?: AssetSource;
  mimeType?: string;
  tags?: readonly string[];
  description?: string;
  /** AI images only: generated with the business's own photos as references. */
  referenceGuided?: boolean;
}

/** Deterministic classification from provenance and file type. Unknown provenance is never treated as verified. */
export function mediaAuthenticity(asset: AuthenticityInput): MediaAuthenticity {
  if (asset.source === 'AI_GENERATED') return asset.referenceGuided ? 'REFERENCE_GUIDED_AI' : 'SYNTHETIC_AI';
  if (asset.mimeType === 'image/svg+xml' || asset.source === 'PROGRAMMATIC') return 'ILLUSTRATION';
  if (asset.source === 'CUSTOMER_UPLOAD') {
    const words = [...(asset.tags ?? []), asset.description ?? ''].join(' ');
    return PRODUCT_CUES.test(words) ? 'VERIFIED_PRODUCT_PHOTO' : 'VERIFIED_BUSINESS_PHOTO';
  }
  return 'GENERIC_STOCK';
}

/** True only for the business's own photography: the one kind that may be presented as the real thing. */
export function representsRealBusiness(authenticity: MediaAuthenticity): boolean {
  return authenticity === 'VERIFIED_PRODUCT_PHOTO' || authenticity === 'VERIFIED_BUSINESS_PHOTO';
}
