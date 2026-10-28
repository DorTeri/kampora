import type {
  AvailableAsset,
  PlannedGeneration,
  ProductionStrategy,
  QualityTier,
  ScenePlan,
  StoryboardScene,
} from '@kampora/shared';
import type { PriceCatalog, PriceEntry } from '@kampora/cost-engine';

export interface RouterContext {
  qualityTier: QualityTier;
  /** Budget still available for paid generations in this project. */
  remainingBudgetUsd: number;
  perGenerationMaxUsd: number;
  /** Premium text-to-video is opt-in only. */
  allowTextToVideo: boolean;
  catalog: PriceCatalog;
  /** AI image the owner approved for this scene (must be in `assets`). Takes precedence over tag matching. */
  approvedImageId?: string;
  /** Price of the configured image provider (else the catalog's planning default). A free provider is not paid. */
  imagePrice?: PriceEntry;
}

export interface MatchedAssets {
  image?: AvailableAsset;
  video?: AvailableAsset;
}

/** Picks the best commercially usable existing assets for a scene (preferred ID, then tag overlap). */
export function matchAssets(scene: StoryboardScene, assets: readonly AvailableAsset[]): MatchedAssets {
  const usable = assets.filter((a) => a.commercialUse);
  const pick = (kinds: AvailableAsset['kind'][]): AvailableAsset | undefined => {
    // Footage can satisfy an image requirement (and vice versa) when tags match; logos are separate.
    const requirements = scene.requiredAssets.filter((r) => r.kind !== 'logo');
    for (const req of requirements) {
      if (req.preferredAssetId) {
        const preferred = usable.find((a) => a.id === req.preferredAssetId && kinds.includes(a.kind));
        if (preferred) return preferred;
      }
    }
    let best: { asset: AvailableAsset; score: number } | undefined;
    for (const req of requirements) {
      for (const asset of usable) {
        if (!kinds.includes(asset.kind)) continue;
        const score = req.tags.filter((t) => asset.tags.includes(t)).length;
        if (score > 0 && (!best || score > best.score)) best = { asset, score };
      }
    }
    return best?.asset;
  };
  return { image: pick(['image']), video: pick(['video']) };
}

function generation(
  ctx: RouterContext,
  operation: PlannedGeneration['operation'],
  quantity: number,
  purpose: string,
): PlannedGeneration {
  const entry =
    operation === 'IMAGE_GENERATION' && ctx.imagePrice ? ctx.imagePrice : ctx.catalog.defaultFor(operation);
  return {
    operation,
    provider: entry.provider,
    model: entry.model,
    quantity,
    unit: entry.unit,
    estimatedCostUsd: ctx.catalog.estimate(entry, quantity),
    paid: entry.unitPriceUsd > 0,
    purpose,
  };
}

function affordable(ctx: RouterContext, generations: PlannedGeneration[]): boolean {
  const total = generations.reduce((s, g) => s + g.estimatedCostUsd, 0);
  return (
    generations.every((g) => g.estimatedCostUsd <= ctx.perGenerationMaxUsd) && total <= ctx.remainingBudgetUsd
  );
}

/**
 * Deterministic, rule-based production routing for one scene.
 * Principle: reuse > programmatic motion > generated stills > generated motion. Never fake real motion.
 */
export function routeScene(
  scene: StoryboardScene,
  assets: readonly AvailableAsset[],
  ctx: RouterContext,
): ScenePlan {
  const approved = ctx.approvedImageId
    ? assets.find((a) => a.id === ctx.approvedImageId && a.kind === 'image')
    : undefined;
  const matched = { ...matchAssets(scene, assets), ...(approved ? { image: approved } : {}) };
  const reasons: string[] = [];
  const warnings: string[] = [];
  const needsRealMotion = scene.quality.requiresHumanMotion || scene.quality.requiresComplexAction;
  const canGenerate = ctx.qualityTier !== 'draft';

  const result = (
    strategy: ProductionStrategy,
    assetIds: string[],
    generations: PlannedGeneration[] = [],
  ): ScenePlan => ({
    sceneKey: scene.key,
    strategy,
    assetIds,
    generations,
    estimatedCostUsd: generations.reduce((s, g) => s + g.estimatedCostUsd, 0),
    reasons,
    warnings,
  });

  if (matched.video) {
    reasons.push(`Existing footage "${matched.video.id}" covers the scene; no generation needed.`);
    return result('EXISTING_VIDEO', [matched.video.id]);
  }

  if (needsRealMotion) {
    reasons.push('Scene requires real subject motion, which programmatic animation cannot produce.');
    const i2v = [
      ...(matched.image ? [] : [generation(ctx, 'IMAGE_GENERATION', 1, 'Source frame for image-to-video')]),
      generation(ctx, 'IMAGE_TO_VIDEO', Math.ceil(scene.durationSec), 'Animate the subject'),
    ];
    if (canGenerate && affordable(ctx, i2v)) {
      if (scene.quality.requiresProductAccuracy && !matched.image) {
        warnings.push('No product reference image: generated frames may not match the real product.');
      }
      reasons.push(
        'Image-to-video fits the budget' +
          (matched.image ? ` using "${matched.image.id}" as reference.` : '.'),
      );
      return result('AI_IMAGE_TO_VIDEO', matched.image ? [matched.image.id] : [], i2v);
    }
    const t2v = [generation(ctx, 'TEXT_TO_VIDEO', Math.ceil(scene.durationSec), 'Premium generated footage')];
    if (canGenerate && ctx.allowTextToVideo && affordable(ctx, t2v)) {
      reasons.push('Text-to-video explicitly allowed and within budget.');
      return result('AI_TEXT_TO_VIDEO', [], t2v);
    }
    warnings.push(
      'DOWNGRADED: real motion was requested but no footage exists and generation is not affordable/allowed. ' +
        'The scene will use programmatic motion; supply footage or approve budget for image-to-video.',
    );
  }

  if (scene.visualKind === 'GRAPHIC') {
    reasons.push('Text/offer-led scene: motion graphics are clearer and free to produce.');
    return result('MOTION_GRAPHICS', matched.image ? [matched.image.id] : []);
  }

  if (approved) {
    reasons.push(`Approved AI image "${approved.id}" animated programmatically (${scene.motion.preset}).`);
    if (scene.quality.requiresProductAccuracy)
      reasons.push('The owner approved this generated image as a stand-in for a product photo.');
    return result(scene.motion.preset === 'parallax' ? 'LAYERED_PARALLAX' : 'AI_IMAGE_MOTION', [approved.id]);
  }

  if (matched.image) {
    if (scene.motion.preset === 'parallax') {
      reasons.push(`Layered parallax from existing image "${matched.image.id}".`);
      return result('LAYERED_PARALLAX', [matched.image.id]);
    }
    reasons.push(`Existing image "${matched.image.id}" animated programmatically (${scene.motion.preset}).`);
    return result('EXISTING_IMAGE_MOTION', [matched.image.id]);
  }

  if (scene.quality.requiresProductAccuracy) {
    warnings.push(
      'The real product must appear but no product photo exists. Upload one; using motion graphics meanwhile.',
    );
    return result('MOTION_GRAPHICS', []);
  }

  const imageGen = [generation(ctx, 'IMAGE_GENERATION', 1, 'Generate scene still for programmatic motion')];
  if (canGenerate && affordable(ctx, imageGen)) {
    reasons.push(
      'No suitable existing image; a generated still is the cheapest path to a photographic scene.',
    );
    return result('AI_IMAGE_MOTION', [], imageGen);
  }

  warnings.push('No image available and generation not affordable/allowed: falling back to motion graphics.');
  return result('MOTION_GRAPHICS', []);
}
