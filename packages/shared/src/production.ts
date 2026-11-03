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

/** An authentic shot the ad needs but the business's media does not have yet (Video Director). */
export const ShotRequestSchema = z.object({
  sceneKey: z.string(),
  /** NO_MEDIA: nothing matches, the scene is generated or graphic. STAND_IN: a demo, stock or AI picture fills it. */
  reason: z.enum(['NO_MEDIA', 'STAND_IN']),
  /** What the shot must show (the storyboard visual). */
  need: z.string(),
  /** How to film it on a phone (Hebrew), when the storyboard has an instruction. */
  capture: z.string().optional(),
  /** The scene asks for moving footage, not a still. */
  footage: z.boolean(),
});
export type ShotRequest = z.infer<typeof ShotRequestSchema>;

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
  /** Authentic shots to film so stand-ins can be replaced. Older plans have none. */
  shotList: z.array(ShotRequestSchema).optional(),
});
export type ProductionPlan = z.infer<typeof ProductionPlanSchema>;
