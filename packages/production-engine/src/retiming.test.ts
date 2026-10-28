import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICE_CATALOG, PriceCatalog } from '@kampora/cost-engine';
import {
  DEMO_BUSINESS,
  DEMO_CAMPAIGN_REQUEST,
  MockCreativeLlmProvider,
  buildCampaignBrief,
  generateConcepts,
  generateStoryboard,
} from '@kampora/creative-engine';
import type { AvailableAsset, MediaAsset } from '@kampora/shared';
import { planProduction } from './planner';
import { buildVideoProject, computeSceneTiming } from './timeline';

describe('computeSceneTiming', () => {
  const fps = 30;
  it('keeps the storyboard duration when there is no narration', () => {
    expect(computeSceneTiming(4, undefined, { fps, isFirst: true, isLast: false })).toEqual({
      durationInFrames: 120,
      voiceStartFrames: 0,
      extended: false,
    });
  });

  it('extends a scene to lead-in + full speech + tail (never cuts or speeds up speech)', () => {
    const t = computeSceneTiming(4, 5, { fps, isFirst: false, isLast: false });
    expect(t.voiceStartFrames).toBe(6); // 0.2s
    expect(t.durationInFrames).toBe(Math.ceil((0.2 + 5 + 0.4) * fps));
    expect(t.extended).toBe(true);
  });

  it('keeps longer planned visuals as a natural pause instead of stretching footage', () => {
    const t = computeSceneTiming(6, 2, { fps, isFirst: false, isLast: false });
    expect(t.durationInFrames).toBe(180);
    expect(t.extended).toBe(false);
  });

  it('holds the last scene longer after the final words (CTA breathing room)', () => {
    const last = computeSceneTiming(3, 3, { fps, isFirst: false, isLast: true });
    expect(last.durationInFrames).toBe(Math.ceil((0.2 + 3 + 1.0) * fps));
  });
});

describe('narration-synced VideoProject', () => {
  const assets: AvailableAsset[] = [
    { id: 'a-hero', kind: 'image', description: '', tags: ['hero'], commercialUse: true },
    { id: 'a-product', kind: 'image', description: '', tags: ['product'], commercialUse: true },
    { id: 'a-store', kind: 'image', description: '', tags: ['store'], commercialUse: true },
  ];
  const media: MediaAsset[] = [
    ...assets.map((a) => ({
      id: a.id,
      kind: 'image' as const,
      storageKey: `k/${a.id}.svg`,
      mimeType: 'image/svg+xml',
      provenance: { source: 'DEMO' as const, license: 'demo', commercialUse: true },
    })),
    ...['hook', 'product', 'offer', 'cta'].map((k) => ({
      id: `vo-${k}`,
      kind: 'audio' as const,
      storageKey: `k/vo-${k}.mp3`,
      mimeType: 'audio/mpeg',
      provenance: { source: 'AI_GENERATED' as const, license: 'tts', commercialUse: true },
    })),
    {
      id: 'music',
      kind: 'audio',
      storageKey: 'k/m.wav',
      mimeType: 'audio/wav',
      provenance: { source: 'PROGRAMMATIC', license: 'demo', commercialUse: true },
    },
  ];

  it('places narration after the lead-in, shifts subtitle cues with it and enables ducking', async () => {
    const provider = new MockCreativeLlmProvider();
    const brief = buildCampaignBrief({
      business: DEMO_BUSINESS,
      request: DEMO_CAMPAIGN_REQUEST,
      defaults: { budgetUsd: 5, qualityTier: 'standard', targetDurationSec: 20 },
    });
    const { conceptSet } = await generateConcepts({ business: DEMO_BUSINESS, brief }, { provider });
    const { storyboard } = await generateStoryboard(
      { business: DEMO_BUSINESS, brief, concept: conceptSet.concepts[0]!, assets },
      { provider },
    );
    const plan = planProduction({
      storyboard,
      assets,
      budgetUsd: 5,
      perGenerationMaxUsd: 1,
      qualityTier: 'standard',
      catalog: new PriceCatalog(DEFAULT_PRICE_CATALOG),
    });
    const voiceovers = {
      hook: {
        assetId: 'vo-hook',
        durationSec: 2.5,
        cues: [
          { text: 'רגע, ראיתם', startSec: 0, endSec: 1.2 },
          { text: 'את המבצע ב-Luz?', startSec: 1.2, endSec: 2.8 },
        ],
      },
      product: {
        assetId: 'vo-product',
        durationSec: 7.2,
        cues: [{ text: 'ב-Luz קולים', startSec: 0.1, endSec: 7.5 }],
      },
      offer: { assetId: 'vo-offer', durationSec: 4.4, cues: [{ text: 'עכשיו', startSec: 0, endSec: 4.7 }] },
      cta: { assetId: 'vo-cta', durationSec: 3.0, cues: [{ text: 'בואו', startSec: 0, endSec: 3.3 }] },
    };
    const project = buildVideoProject({
      projectId: 'p',
      title: 't',
      business: DEMO_BUSINESS,
      brief,
      storyboard,
      plan,
      assets: media,
      voiceovers,
      musicAssetId: 'music',
    });

    const [hook, product] = project.scenes;
    expect(hook!.voiceover).toEqual({
      assetId: 'vo-hook',
      volume: 1,
      startOffsetFrames: 9,
      durationInFrames: 75,
    });
    // Cue times are relative to the scene: offset by the 0.3s lead-in.
    expect(hook!.caption!.cues![0]).toEqual({ text: 'רגע, ראיתם', startFrame: 9, endFrame: 45 });
    // Product scene grew to fit 7.2s of speech (planned 5.5s).
    expect(product!.durationInFrames).toBe(Math.ceil((0.2 + 7.2 + 0.4) * 30));
    expect(product!.caption!.cues![0]!.endFrame).toBeLessThanOrEqual(product!.durationInFrames);
    expect(project.audio.music).toMatchObject({ volume: 0.35, duckedVolume: 0.1 });
    expect(project.assets.map((a) => a.id)).toEqual(expect.arrayContaining(['vo-hook', 'vo-cta', 'music']));
  });
});
