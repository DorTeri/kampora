import { and, desc, eq } from 'drizzle-orm';
import type { PriceCatalog, PriceEntry } from '@kampora/cost-engine';
import { generatedAssets, sceneImages, type Database } from '@kampora/database';
import { imagePriceModel, type ImageSetup } from '@kampora/media-providers';
import type { AvailableAsset, MediaAsset } from '@kampora/shared';

export interface ApprovedSceneImage {
  sceneKey: string;
  imageId: string;
  assetId: string;
  available: AvailableAsset;
  media: MediaAsset;
}

/** The approved image per scene (latest decision wins), as planning and render inputs. */
export async function approvedSceneImages(
  db: Database,
  orgId: string,
  projectId: string,
): Promise<ApprovedSceneImage[]> {
  const rows = await db
    .select({ image: sceneImages, asset: generatedAssets })
    .from(sceneImages)
    .innerJoin(generatedAssets, eq(generatedAssets.id, sceneImages.assetId))
    .where(
      and(
        eq(sceneImages.orgId, orgId),
        eq(sceneImages.videoProjectId, projectId),
        eq(sceneImages.decision, 'APPROVED'),
        eq(sceneImages.status, 'SUCCEEDED'),
      ),
    )
    .orderBy(desc(sceneImages.decidedAt));
  const byScene = new Map<string, ApprovedSceneImage>();
  for (const { image, asset } of rows) {
    if (byScene.has(image.sceneKey)) continue;
    const meta = asset.metadata as { width?: number; height?: number };
    byScene.set(image.sceneKey, {
      sceneKey: image.sceneKey,
      imageId: image.id,
      assetId: asset.id,
      available: {
        id: asset.id,
        kind: 'image',
        description: `AI image for scene ${image.sceneKey}`,
        tags: [`scene:${image.sceneKey}`],
        width: meta.width,
        height: meta.height,
        commercialUse: asset.provenance.commercialUse,
      },
      media: {
        id: asset.id,
        kind: 'image',
        storageKey: asset.storageKey,
        mimeType: asset.mimeType,
        width: meta.width,
        height: meta.height,
        provenance: asset.provenance,
      },
    });
  }
  return [...byScene.values()];
}

/** Catalog price of the configured image provider; undefined when unknown (a paid provider is then unusable). */
export function imagePriceEntry(catalog: PriceCatalog, setup: ImageSetup): PriceEntry | undefined {
  if (setup.provider === 'none') return undefined;
  return catalog.find(setup.provider, imagePriceModel(setup), 'IMAGE_GENERATION');
}
