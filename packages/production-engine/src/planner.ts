import {
  ProductionPlanSchema,
  mediaAuthenticity,
  representsRealBusiness,
  storyboardDurationSec,
  type AvailableAsset,
  type ProductionPlan,
  type QualityTier,
  type ScenePlan,
  type ShotRequest,
  type Storyboard,
} from '@kampora/shared';
import { roundUsd, type PriceCatalog, type PriceEntry } from '@kampora/cost-engine';
import { routeScene } from './router';

export interface PlanProductionInput {
  storyboard: Storyboard;
  assets: readonly AvailableAsset[];
  budgetUsd: number;
  perGenerationMaxUsd: number;
  qualityTier: QualityTier;
  allowTextToVideo?: boolean;
  catalog: PriceCatalog;
  /** sceneKey → approved AI image asset id (the asset must be in `assets`). */
  approvedImages?: Readonly<Record<string, string>>;
  imagePrice?: PriceEntry;
  videoGenerationAvailable?: boolean;
}

/**
 * The shots still missing from the business's own media: every photographic scene that is generated, graphic or
 * filled by a demo, stock or AI picture. Graphic scenes (offer cards, type) need no footage.
 */
export function missingShots(
  storyboard: Storyboard,
  scenes: readonly ScenePlan[],
  assets: readonly AvailableAsset[],
): ShotRequest[] {
  const planByKey = new Map(scenes.map((p) => [p.sceneKey, p]));
  return [...storyboard.scenes]
    .sort((a, b) => a.order - b.order)
    .flatMap((scene): ShotRequest[] => {
      const plan = planByKey.get(scene.key);
      if (!plan || scene.visualKind === 'GRAPHIC') return [];
      const used = assets.filter((a) => plan.assetIds.includes(a.id));
      const real = used.some((a) => representsRealBusiness(mediaAuthenticity(a)));
      if (real) return [];
      const request = {
        sceneKey: scene.key,
        need: scene.visual,
        capture: scene.direction?.capture,
        footage: scene.visualKind === 'FOOTAGE',
      };
      return [{ ...request, reason: used.length ? 'STAND_IN' : 'NO_MEDIA' }];
    });
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
        approvedImageId: input.approvedImages?.[scene.key],
        imagePrice: input.imagePrice,
        videoGenerationAvailable: input.videoGenerationAvailable,
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
    shotList: missingShots(input.storyboard, scenes, input.assets),
  });
}
