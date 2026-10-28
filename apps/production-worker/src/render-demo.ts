import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_PRICE_CATALOG,
  PriceCatalog,
  summarizeLedger,
  usdToMicro,
  type LedgerEntry,
} from '@kampora/cost-engine';
import {
  DEMO_BUSINESS,
  DEMO_CAMPAIGN_REQUEST,
  MockCreativeLlmProvider,
  generateCampaignBrief,
  generateConcepts,
  generateStoryboard,
} from '@kampora/creative-engine';
import {
  DEMO_ASSET_DEFINITIONS,
  demoAvailableAssets,
  demoMediaAssets,
  loadDemoAssetBytes,
} from '@kampora/database';
import { normalizeHebrewForSpeech } from '@kampora/hebrew-voice';
import { buildVideoProject, planProduction } from '@kampora/production-engine';
import type { RenderQuality } from '@kampora/shared';
import { renderVideoProject } from '@kampora/video-renderer';
import { prepareAssets } from './assets';

/**
 * Standalone end-to-end demo (no database, Redis or API needed):
 * demo business → brief → concepts → storyboard → production plan → VideoProject → MP4.
 * Usage: npm run render:demo [-- preview|final]
 */
async function main() {
  const quality: RenderQuality = process.argv[2] === 'preview' ? 'preview' : 'final';
  const outDir = path.resolve(__dirname, '../../../out');
  await mkdir(outDir, { recursive: true });

  const provider = new MockCreativeLlmProvider();
  const ledger: LedgerEntry[] = [];
  const recorder = {
    record: async (e: { step: string; attempt: number; success: boolean; usage?: { costUsd: number } }) => {
      ledger.push({
        operation: 'LLM_COMPLETION',
        provider: provider.id,
        model: provider.model,
        chargeType: 'SIMULATED',
        amountMicroUsd: usdToMicro(e.usage?.costUsd ?? 0),
        attempt: e.attempt,
        success: e.success,
      });
    },
  };

  const brief = await generateCampaignBrief(
    {
      business: DEMO_BUSINESS,
      request: DEMO_CAMPAIGN_REQUEST,
      defaults: { budgetUsd: 5, qualityTier: 'standard', targetDurationSec: 20 },
    },
    { provider, recorder },
  );
  const { conceptSet } = await generateConcepts({ business: DEMO_BUSINESS, brief }, { provider, recorder });
  const concept = conceptSet.concepts.find((c) => c.key === conceptSet.recommendedKey)!;
  const available = demoAvailableAssets((key) => key);
  const { storyboard } = await generateStoryboard(
    { business: DEMO_BUSINESS, brief, concept, assets: available },
    { provider, recorder },
  );

  const catalog = new PriceCatalog(DEFAULT_PRICE_CATALOG);
  const plan = planProduction({
    storyboard,
    assets: available,
    budgetUsd: 5,
    perGenerationMaxUsd: 1,
    qualityTier: 'standard',
    catalog,
  });
  const mediaAssets = demoMediaAssets(
    (key) => key,
    (def) => def.key,
  );
  const project = buildVideoProject({
    projectId: 'demo',
    title: `${DEMO_BUSINESS.name} — ${concept.title}`,
    business: DEMO_BUSINESS,
    brief,
    storyboard,
    plan,
    assets: mediaAssets,
    musicAssetId: 'music-bed',
  });

  console.log(`\nConcept: ${concept.title} (${concept.angle})`);
  for (const scene of storyboard.scenes) {
    const p = plan.scenes.find((s) => s.sceneKey === scene.key)!;
    const speech = normalizeHebrewForSpeech(scene.voiceover, { pronunciation: DEMO_BUSINESS.pronunciation });
    console.log(
      `  [${scene.key}] ${p.strategy.padEnd(22)} $${p.estimatedCostUsd.toFixed(2)}  ${scene.durationSec}s`,
    );
    console.log(`      subtitle: ${scene.voiceover}`);
    console.log(`      speech:   ${speech.spoken}`);
  }
  console.log(
    `Estimated paid generation: $${plan.estimatedPaidCostUsd.toFixed(2)} · render (simulated): $${plan.estimatedRenderCostUsd.toFixed(4)}`,
  );

  const tmp = await mkdtemp(path.join(os.tmpdir(), 'kampora-demo-'));
  const prepared = await prepareAssets(
    project,
    tmp,
    async (asset) => loadDemoAssetBytes(DEMO_ASSET_DEFINITIONS.find((d) => d.key === asset.id)!),
    100 * 1024 * 1024,
  );
  const outputPath = path.join(outDir, `kampora-demo-${quality}.mp4`);
  const started = Date.now();
  try {
    let last = -1;
    const result = await renderVideoProject({
      input: { project, assetUrls: prepared.assetUrls, scale: 1 },
      outputPath,
      quality,
      onBundleProgress: (p) => p === 100 && console.log('Bundled compositions'),
      onProgress: (p) => {
        const pct = Math.floor(p * 10) * 10;
        if (pct !== last) {
          last = pct;
          process.stdout.write(`\rRendering… ${pct}%   `);
        }
      },
    });
    const size = (await stat(outputPath)).size;
    ledger.push({
      operation: 'RENDER',
      provider: 'local',
      model: 'remotion',
      chargeType: 'SIMULATED',
      amountMicroUsd: usdToMicro(catalog.estimate(catalog.defaultFor('RENDER'), result.durationSec)),
      attempt: 1,
      success: true,
      accepted: true,
    });
    const summary = summarizeLedger(ledger);
    console.log(
      `\n✓ ${outputPath}\n  ${result.width}×${result.height}, ${result.durationSec.toFixed(1)}s, ${(size / 1e6).toFixed(2)} MB, ` +
        `${((Date.now() - started) / 1000).toFixed(0)}s wall clock`,
    );
    console.log(
      `  Ledger: simulated $${summary.byChargeTypeUsd.SIMULATED.toFixed(4)}, confirmed $${summary.byChargeTypeUsd.CONFIRMED.toFixed(2)}`,
    );
  } finally {
    await prepared.close();
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
