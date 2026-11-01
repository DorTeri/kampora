import { z } from 'zod';

export const SafeAreaSchema = z.object({
  topPx: z.number().int().nonnegative(),
  bottomPx: z.number().int().nonnegative(),
  sidePx: z.number().int().nonnegative(),
});
export type SafeArea = z.infer<typeof SafeAreaSchema>;
