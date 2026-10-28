import {
  ProductionPlanSchema,
  storyboardDurationSec,
  type AvailableAsset,
  type ProductionPlan,
  type QualityTier,
  type Storyboard,
} from '@kampora/shared';
import { roundUsd, type PriceCatalog } from '@kampora/cost-engine';
import { routeScene } from './router';

export interface PlanProductionInput {
  storyboard: Storyboard;
  assets: readonly AvailableAsset[];
  budgetUsd: number;
  perGenerationMaxUsd: number;
  qualityTier: QualityTier;
  allowTextToVideo?: boolean;
  catalog: PriceCatalog;
}

/** Routes every scene in order, spending the budget as it goes, and estimates render compute. */
export function planProduction(input: PlanProductionInput): ProductionPlan {
  let remaining = input.budgetUsd;
  const scenes = [...input.storyboard.scenes]
    .sort((a, b) => a.order - b.order)
    .map((scene) => {
      const plan = routeScene(scene, input.assets, {
        qualityTier: input.qualityTier,
        remainingBudgetUsd: remaining,
        perGenerationMaxUsd: input.perGenerationMaxUsd,
        allowTextToVideo: input.allowTextToVideo ?? false,
        catalog: input.catalog,
      });
      remaining -= plan.estimatedCostUsd;
      return plan;
    });

  const renderEntry = input.catalog.defaultFor('RENDER');
  const estimatedRenderCostUsd = input.catalog.estimate(renderEntry, storyboardDurationSec(input.storyboard));
  const estimatedPaidCostUsd = roundUsd(scenes.reduce((s, p) => s + p.estimatedCostUsd, 0));

  return ProductionPlanSchema.parse({
    scenes,
    estimatedPaidCostUsd,
    estimatedRenderCostUsd,
    totalEstimatedCostUsd: roundUsd(estimatedPaidCostUsd + estimatedRenderCostUsd),
    budgetUsd: input.budgetUsd,
    withinBudget: estimatedPaidCostUsd <= input.budgetUsd,
    requiresPaidApproval: scenes.some((s) => s.generations.some((g) => g.paid)),
    warnings: scenes.flatMap((s) => s.warnings.map((w) => `[${s.sceneKey}] ${w}`)),
  });
}
