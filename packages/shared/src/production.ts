import { z } from 'zod';
import { ProductionStrategySchema } from './storyboard';

export const OperationTypeSchema = z.enum([
  'LLM_COMPLETION',
  'IMAGE_GENERATION',
  'IMAGE_TO_VIDEO',
  'TEXT_TO_VIDEO',
  'TTS',
  'RENDER',
  'STORAGE',
]);
export type OperationType = z.infer<typeof OperationTypeSchema>;

/** SIMULATED: mock/local compute. ESTIMATED: pre-execution. CONFIRMED: real provider charge. */
export const ChargeTypeSchema = z.enum(['SIMULATED', 'ESTIMATED', 'CONFIRMED']);
export type ChargeType = z.infer<typeof ChargeTypeSchema>;

export const PlannedGenerationSchema = z.object({
  operation: OperationTypeSchema,
  provider: z.string(),
  model: z.string(),
  quantity: z.number().positive(),
  unit: z.string(),
  estimatedCostUsd: z.number().nonnegative(),
  paid: z.boolean(),
  purpose: z.string(),
});
export type PlannedGeneration = z.infer<typeof PlannedGenerationSchema>;

export const ScenePlanSchema = z.object({
  sceneKey: z.string(),
  strategy: ProductionStrategySchema,
  /** Existing assets reused by this scene. */
  assetIds: z.array(z.string()),
  generations: z.array(PlannedGenerationSchema),
  estimatedCostUsd: z.number().nonnegative(),
  reasons: z.array(z.string()),
  warnings: z.array(z.string()),
});
export type ScenePlan = z.infer<typeof ScenePlanSchema>;

export const ProductionPlanSchema = z.object({
  scenes: z.array(ScenePlanSchema),
  estimatedPaidCostUsd: z.number().nonnegative(),
  estimatedRenderCostUsd: z.number().nonnegative(),
  totalEstimatedCostUsd: z.number().nonnegative(),
  budgetUsd: z.number().nonnegative(),
  withinBudget: z.boolean(),
  /** True when any planned generation is paid. Paid work needs an explicit approval record. */
  requiresPaidApproval: z.boolean(),
  warnings: z.array(z.string()),
});
export type ProductionPlan = z.infer<typeof ProductionPlanSchema>;
