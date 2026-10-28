import { and, eq, inArray } from 'drizzle-orm';
import type { Logger } from 'pino';
import {
  evaluateGenerationRequest,
  generationIdempotencyKey,
  usdToMicro,
  type BudgetPolicy,
} from '@kampora/cost-engine';
import {
  approvals,
  brandAssets,
  generatedAssets,
  recordUsage,
  sceneImages,
  spentUsdFor,
  videoProjects,
  type Database,
} from '@kampora/database';
import type { GeneratedMedia, ImageGenerationProvider, ReferenceImage } from '@kampora/media-providers';
import type { SceneImageJobPayload } from '@kampora/shared';
import type { StorageDriver } from '@kampora/storage';

export interface SceneImageJobDeps {
  db: Database;
  storage: StorageDriver;
  policy: BudgetPolicy;
  logger: Logger;
  /** The configured provider, or null when images are disabled/misconfigured. */
  provider: ImageGenerationProvider | null;
}

class ImageDeniedError extends Error {}

/**
 * Generates one scene image version. The row (plan, fingerprint, estimate) was written by the API at request
 * time; the worker re-checks every gate before a paid call: kill switch, an approval for this exact version at
 * least as high as the estimate, and the project budget. Identical requests (same fingerprint) reuse the
 * existing image and are never paid twice.
 */
export async function processSceneImageJob(
  deps: SceneImageJobDeps,
  payload: SceneImageJobPayload,
): Promise<void> {
  const log = deps.logger.child({ sceneImageId: payload.sceneImageId });
  const [row] = await deps.db
    .select()
    .from(sceneImages)
    .where(and(eq(sceneImages.id, payload.sceneImageId), eq(sceneImages.orgId, payload.orgId)));
  if (!row || row.status !== 'QUEUED') return;
  const update = (patch: Partial<typeof sceneImages.$inferInsert>) =>
    deps.db.update(sceneImages).set(patch).where(eq(sceneImages.id, row.id));

  try {
    await update({ status: 'RUNNING' });
    const provider = deps.provider;
    if (!provider) throw new ImageDeniedError('Image generation is not configured');
    if (provider.id !== row.provider || provider.model !== row.model)
      throw new ImageDeniedError('The image provider changed since the quote');

    const key = generationIdempotencyKey(provider.id, provider.model, 'IMAGE_GENERATION', {
      fingerprint: row.fingerprint,
    });
    const [cached] = await deps.db
      .select({ id: generatedAssets.id })
      .from(generatedAssets)
      .where(and(eq(generatedAssets.orgId, payload.orgId), eq(generatedAssets.idempotencyKey, key)));
    if (cached) {
      await update({
        status: 'SUCCEEDED',
        assetId: cached.id,
        cached: true,
        chargeType: provider.paid ? 'ESTIMATED' : 'SIMULATED',
      });
      log.info('scene image reused (same fingerprint)');
      return;
    }

    const estimateUsd = row.estimatedMicroUsd / 1e6;
    if (provider.paid) await assertImageSpendAllowed(deps, row, estimateUsd);

    const references = await loadReferences(deps, payload.orgId, row.plan.referenceAssetIds);
    const step = `scene-image.${row.sceneKey}`;
    let media: GeneratedMedia;
    try {
      media = await provider.generate({
        prompt: row.plan.prompt,
        negativePrompt: row.plan.avoid.join('; '),
        aspectRatio: row.plan.aspect,
        referenceImages: references,
      });
    } catch (error) {
      await recordUsage(deps.db, {
        orgId: payload.orgId,
        videoProjectId: row.videoProjectId,
        operation: 'IMAGE_GENERATION',
        provider: provider.id,
        model: provider.model,
        quantity: 0,
        unit: 'image',
        step,
        // A failed call may still be billed by some vendors; we record the attempt at zero and keep the note.
        chargeType: provider.paid ? 'ESTIMATED' : 'SIMULATED',
        amountMicroUsd: 0,
        success: false,
        note: (error instanceof Error ? error.message : String(error)).slice(0, 300),
      });
      throw error;
    }
    await recordUsage(deps.db, {
      orgId: payload.orgId,
      videoProjectId: row.videoProjectId,
      operation: 'IMAGE_GENERATION',
      provider: provider.id,
      model: provider.model,
      quantity: 1,
      unit: 'image',
      step,
      chargeType: media.usage.chargeType,
      amountMicroUsd: usdToMicro(media.usage.costUsd),
      success: true,
      metadata: {
        sceneImageId: row.id,
        inputTokens: media.usage.inputTokens,
        outputTokens: media.usage.outputTokens,
      },
    });

    const ext = media.mimeType === 'image/png' ? 'png' : 'jpg';
    const storageKey = `orgs/${payload.orgId}/projects/${row.videoProjectId}/images/${row.id}.${ext}`;
    await deps.storage.put(storageKey, media.data, media.mimeType);
    const mock = provider.id === 'mock';
    const [asset] = await deps.db
      .insert(generatedAssets)
      .values({
        orgId: payload.orgId,
        videoProjectId: row.videoProjectId,
        kind: 'image',
        storageKey,
        mimeType: media.mimeType,
        provider: provider.id,
        model: provider.model,
        idempotencyKey: key,
        provenance: {
          source: mock ? 'PROGRAMMATIC' : 'AI_GENERATED',
          license: mock
            ? 'Kampora mock placeholder image'
            : `Generated with ${provider.id} ${provider.model}`,
          commercialUse: true,
          provider: provider.id,
          notes: `Scene ${row.sceneKey}, version ${row.version}`,
        },
        metadata: {
          width: media.width,
          height: media.height,
          sceneKey: row.sceneKey,
          fingerprint: row.fingerprint,
          style: row.plan.style,
          referenceAssetIds: row.plan.referenceAssetIds,
        },
      })
      .returning({ id: generatedAssets.id });
    await update({
      status: 'SUCCEEDED',
      assetId: asset!.id,
      cached: false,
      chargeType: media.usage.chargeType,
    });
    log.info({ sceneKey: row.sceneKey, version: row.version }, 'scene image ready');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn({ err: message }, 'scene image failed');
    await update({ status: 'FAILED', error: message.slice(0, 500) });
  }
}

async function loadReferences(
  deps: SceneImageJobDeps,
  orgId: string,
  ids: readonly string[],
): Promise<ReferenceImage[]> {
  if (!ids.length) return [];
  const rows = await deps.db
    .select()
    .from(brandAssets)
    .where(and(eq(brandAssets.orgId, orgId), inArray(brandAssets.id, [...ids])));
  if (rows.length !== ids.length) throw new ImageDeniedError('A reference photo is no longer available');
  return Promise.all(
    rows.map(async (r) => ({
      data: await deps.storage.getBuffer(r.storageKey),
      mimeType: r.mimeType,
      name: r.storageKey.split('/').pop() ?? `${r.id}.jpg`,
    })),
  );
}

async function assertImageSpendAllowed(
  deps: SceneImageJobDeps,
  row: typeof sceneImages.$inferSelect,
  estimateUsd: number,
) {
  if (!deps.policy.paidGenerationEnabled) throw new ImageDeniedError('Paid generation is disabled');
  const rows = await deps.db
    .select({ amount: approvals.approvedEstimateMicroUsd })
    .from(approvals)
    .where(
      and(
        eq(approvals.orgId, row.orgId),
        eq(approvals.videoProjectId, row.videoProjectId),
        eq(approvals.subject, 'SCENE_IMAGE'),
        eq(approvals.subjectRef, row.id),
        eq(approvals.decision, 'APPROVED'),
      ),
    );
  const approved = rows.reduce((m, r) => Math.max(m, r.amount), 0) / 1e6;
  if (approved + 0.0005 < estimateUsd) throw new ImageDeniedError('Image cost not approved');

  const [project] = await deps.db
    .select({ briefId: videoProjects.briefId, budget: videoProjects.budgetMicroUsd })
    .from(videoProjects)
    .where(eq(videoProjects.id, row.videoProjectId));
  const spent = await spentUsdFor(deps.db, row.orgId, {
    projectIds: [row.videoProjectId],
    briefIds: project ? [project.briefId] : [],
  });
  const decision = evaluateGenerationRequest(
    {
      ...deps.policy,
      projectMaxUsd: Math.min(deps.policy.projectMaxUsd, (project?.budget ?? 0) / 1e6),
      maxConcurrentPaidGenerations: Number.POSITIVE_INFINITY,
    },
    { confirmedSpendUsd: spent, reservedUsd: 0, activePaidGenerations: 0 },
    { estimatedUsd: estimateUsd, attempt: 1, paid: true, approved: true },
  );
  if (!decision.allowed) throw new ImageDeniedError(`Budget denied: ${decision.reasons.join(', ')}`);
}
