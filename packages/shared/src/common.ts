import { z } from 'zod';

export const LocaleSchema = z.enum(['he-IL']);
export type Locale = z.infer<typeof LocaleSchema>;

export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #RRGGBB color');

export const CurrencySchema = z.enum(['ILS', 'USD']);
export const MoneySchema = z.object({
  amount: z.number().nonnegative(),
  currency: CurrencySchema,
});
export type Money = z.infer<typeof MoneySchema>;

export const BrandColorsSchema = z.object({
  primary: HexColorSchema,
  secondary: HexColorSchema,
  accent: HexColorSchema,
  background: HexColorSchema,
  text: HexColorSchema,
});
export type BrandColors = z.infer<typeof BrandColorsSchema>;

/** How a term should be spoken. `spoken` may contain selective niqqud; subtitles never use it. */
export const PronunciationEntrySchema = z.object({
  term: z.string().min(1),
  spoken: z.string().min(1),
  caseSensitive: z.boolean().default(false),
  note: z.string().optional(),
});
export type PronunciationEntry = z.infer<typeof PronunciationEntrySchema>;

export const QualityTierSchema = z.enum(['draft', 'standard', 'premium']);
export type QualityTier = z.infer<typeof QualityTierSchema>;

/** Where a piece of business information came from. Inferred facts require confirmation. */
export const FieldSourceSchema = z.enum(['USER', 'INFERRED_UNCONFIRMED', 'INFERRED_CONFIRMED', 'DEMO_SEED']);
export type FieldSource = z.infer<typeof FieldSourceSchema>;
