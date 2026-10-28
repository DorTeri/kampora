import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PRICE_CATALOG, PriceCatalog, type BudgetPolicy } from '@kampora/cost-engine';
import {
  DEMO_BUSINESS,
  DEMO_CAMPAIGN_REQUEST,
  MockCreativeLlmProvider,
  buildCampaignBrief,
  generateConcepts,
  generateStoryboard,
} from '@kampora/creative-engine';
import {
  approvals,
  businesses,
  campaignBriefs,
  costLedger,
  createDatabase,
  creativeConcepts,
  generatedAssets,
  organizations,
  pronunciationEntries,
  storyboards,
  users,
  videoProjects,
  type DatabaseHandle,
} from '@kampora/database';
import {
  MockTtsProvider,
  TtsProviderError,
  type TtsProvider,
  type TtsRequest,
  type TtsSetup,
} from '@kampora/hebrew-voice';
import type { NarrationState, VoiceOption } from '@kampora/shared';
import { LocalDiskStorage } from '@kampora/storage';
import { processNarrationJob, type NarrationJobDeps } from './narration-job';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://kampora:kampora@127.0.0.1:5433/kampora';

async function reachable(): Promise<boolean> {
  const h = createDatabase(DATABASE_URL, 1);
  try {
    await h.pool.query('select 1 from video_projects limit 1');
    return true;
  } catch {
    return false;
  } finally {
    await h.close();
  }
}
const dbAvailable = await reachable();

/** Paid-provider stand-in: same contract as ElevenLabs (paid, ESTIMATED charge) without network or cost. */
class FakePaidTts implements TtsProvider {
  readonly id = 'elevenlabs' as const;
  readonly model = 'eleven_v3';
  readonly paid = true;
  calls = 0;
  constructor(private readonly failures: Array<TtsProviderError> = []) {}
  async synthesize(request: TtsRequest) {
    this.calls++;
    const failure = this.failures.shift();
    if (failure) throw failure;
    const res = await new MockTtsProvider().synthesize({
      ...request,
      speech: { ...request.speech, provider: 'mock' },
    });
    return { ...res, provider: this.id, model: this.model, chargeType: 'ESTIMATED' as const };
  }
}

describe.skipIf(!dbAvailable)('narration job (integration: Postgres + ffprobe + local storage)', () => {
  let handle: DatabaseHandle;
  let storageRoot: string;
  const orgId = randomUUID();
  const userId = randomUUID();
  const businessId = randomUUID();
  const projectId = randomUUID();
  let briefId: string;
  const logger = pino({ level: 'silent' });
  const policy: BudgetPolicy = {
    projectMaxUsd: 5,
    perGenerationMaxUsd: 1,
    maxAttemptsPerAsset: 2,
    maxConcurrentPaidGenerations: 2,
    requireApprovalForPaid: true,
    paidGenerationEnabled: true,
  };
  const mockVoice: VoiceOption = { id: 'mock-he', label: 'mock', provider: 'mock', modelId: 'mock-voice-v1' };
  const paidVoice = (id: string): VoiceOption => ({
    id,
    label: id,
    provider: 'elevenlabs',
    modelId: 'eleven_v3',
  });

  const deps = (
    overrides: Partial<NarrationJobDeps> & { voices: VoiceOption[]; provider: TtsProvider },
  ): NarrationJobDeps => ({
    db: handle.db,
    storage: new LocalDiskStorage({
      root: storageRoot,
      signingSecret: 'test-secret-123456',
      publicBaseUrl: 'http://x',
    }),
    catalog: new PriceCatalog(DEFAULT_PRICE_CATALOG),
    policy,
    logger,
    setup: {
      provider: 'elevenlabs',
      ready: true,
      paid: true,
      voices: overrides.voices,
      audioTags: false,
      selectiveNiqqud: false,
    } as TtsSetup,
    createProvider: () => overrides.provider,
    sleep: async () => undefined,
    ...overrides,
  });

  const requestNarration = async (voice: VoiceOption, extra: Partial<NarrationState> = {}) => {
    // Without extra fields this is a stored Phase 2 request (no mode/style): legacy per-scene behaviour.
    const state = {
      status: 'QUEUED',
      provider: voice.provider,
      voiceId: voice.id,
      voiceLabel: voice.label,
      modelId: voice.modelId,
      scriptHash: '',
      segments: [],
      totalSec: 0,
      estimate: { characters: 0, usd: 0 },
      warnings: [],
      updatedAt: new Date().toISOString(),
      ...extra,
    } as NarrationState;
    await handle.db.update(videoProjects).set({ narration: state }).where(eq(videoProjects.id, projectId));
  };
  const narration = async () =>
    (await handle.db.select().from(videoProjects).where(eq(videoProjects.id, projectId)))[0]!.narration!;
  const approve = (voice: VoiceOption, usd: number) =>
    handle.db.insert(approvals).values({
      orgId,
      videoProjectId: projectId,
      subject: 'NARRATION',
      subjectRef: `${voice.id}:${voice.modelId}`,
      decision: 'APPROVED',
      approvedEstimateMicroUsd: Math.round(usd * 1e6),
      decidedBy: userId,
    });

  beforeAll(async () => {
    handle = createDatabase(DATABASE_URL, 2);
    storageRoot = await mkdtemp(path.join(os.tmpdir(), 'kampora-narration-'));
    const db = handle.db;
    await db.insert(organizations).values({ id: orgId, name: 'narration-test' });
    await db.insert(users).values({ id: userId, email: `t-${userId}@test.local`, displayName: 't' });
    await db.insert(businesses).values({
      id: businessId,
      orgId,
      name: 'Luz',
      category: 'x',
      description: 'x',
      products: [],
      targetAudience: 'x',
    });
    await db.insert(pronunciationEntries).values({ orgId, businessId, term: 'Luz', spoken: 'לוּז' });
    const provider = new MockCreativeLlmProvider();
    const brief = buildCampaignBrief({
      business: DEMO_BUSINESS,
      request: DEMO_CAMPAIGN_REQUEST,
      defaults: { budgetUsd: 5, qualityTier: 'standard', targetDurationSec: 20 },
    });
    const { conceptSet } = await generateConcepts({ business: DEMO_BUSINESS, brief }, { provider });
    const concept = conceptSet.concepts[0]!;
    const { storyboard } = await generateStoryboard(
      { business: DEMO_BUSINESS, brief, concept, assets: [] },
      { provider },
    );
    const [b] = await db.insert(campaignBriefs).values({ orgId, businessId, brief }).returning();
    briefId = b!.id;
    const [c] = await db
      .insert(creativeConcepts)
      .values({ orgId, briefId, key: concept.key, concept })
      .returning();
    const [sb] = await db
      .insert(storyboards)
      .values({ orgId, briefId, conceptId: c!.id, storyboard })
      .returning();
    await db.insert(videoProjects).values({
      id: projectId,
      orgId,
      businessId,
      briefId,
      storyboardId: sb!.id,
      title: 't',
      status: 'PLAN_READY',
      budgetMicroUsd: 5_000_000,
      scriptApprovedAt: new Date(),
    });
  });

  afterAll(async () => {
    await handle.db.delete(organizations).where(eq(organizations.id, orgId));
    await handle.close();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it('records every line, measures it with ffprobe and times subtitles from the alignment', async () => {
    await requestNarration(mockVoice);
    await processNarrationJob(deps({ voices: [mockVoice], provider: new MockTtsProvider() }), {
      projectId,
      orgId,
    });
    const n = await narration();
    expect(n.error).toBeUndefined();
    expect(n.status).toBe('READY');
    expect(n.segments.map((s) => s.sceneKey)).toEqual(['hook', 'product', 'offer', 'cta']);
    for (const s of n.segments) {
      expect(s.durationSec).toBeGreaterThan(0.8);
      expect(s.timing).toBe('provider');
      expect(s.cues.at(-1)!.endSec).toBeLessThanOrEqual(s.durationSec + 0.31);
      expect(s.cached).toBe(false);
    }
    // Spoken text is normalized: the price is read out, the brand uses the pronunciation dictionary.
    expect(n.segments[2]!.spokenText).toContain('עשרים ותשעה שקלים');
    expect(n.segments[0]!.spokenText).toContain('לוּז');
    expect(n.totalSec).toBeCloseTo(
      n.segments.reduce((a, s) => a + s.durationSec, 0),
      1,
    );
  });

  it('reuses cached audio for identical text/voice/model/settings (no new generation)', async () => {
    const before = await handle.db.select().from(generatedAssets).where(eq(generatedAssets.orgId, orgId));
    await requestNarration(mockVoice);
    await processNarrationJob(deps({ voices: [mockVoice], provider: new MockTtsProvider() }), {
      projectId,
      orgId,
    });
    const n = await narration();
    expect(n.segments.every((s) => s.cached)).toBe(true);
    const after = await handle.db.select().from(generatedAssets).where(eq(generatedAssets.orgId, orgId));
    expect(after).toHaveLength(before.length);
    const reuse = await handle.db
      .select()
      .from(costLedger)
      .where(and(eq(costLedger.orgId, orgId), eq(costLedger.reused, true)));
    expect(reuse.length).toBeGreaterThanOrEqual(4);
  });

  it('refuses paid narration when paid generation is disabled (provider never called)', async () => {
    const voice = paidVoice('paid-disabled');
    const provider = new FakePaidTts();
    await requestNarration(voice);
    await processNarrationJob(
      deps({ voices: [voice], provider, policy: { ...policy, paidGenerationEnabled: false } }),
      {
        projectId,
        orgId,
      },
    );
    expect((await narration()).status).toBe('FAILED');
    expect((await narration()).error).toMatch(/disabled/);
    expect(provider.calls).toBe(0);
  });

  it('refuses paid narration without an approval record', async () => {
    const voice = paidVoice('paid-unapproved');
    const provider = new FakePaidTts();
    await requestNarration(voice);
    await processNarrationJob(deps({ voices: [voice], provider }), { projectId, orgId });
    expect((await narration()).error).toMatch(/not approved/);
    expect(provider.calls).toBe(0);
  });

  it('refuses paid narration that exceeds the project budget', async () => {
    const voice = paidVoice('paid-overbudget');
    const provider = new FakePaidTts();
    await approve(voice, 1);
    await requestNarration(voice);
    await processNarrationJob(
      deps({ voices: [voice], provider, policy: { ...policy, projectMaxUsd: 0.001 } }),
      {
        projectId,
        orgId,
      },
    );
    expect((await narration()).error).toMatch(/Budget denied/);
    expect(provider.calls).toBe(0);
  });

  it('fails cleanly on a non-retryable provider error (e.g. bad key) without retrying', async () => {
    const voice = paidVoice('paid-auth-error');
    const provider = new FakePaidTts([
      new TtsProviderError('ElevenLabs auth error 401', 'elevenlabs', false, 'auth', 401),
    ]);
    await approve(voice, 1);
    await requestNarration(voice);
    await processNarrationJob(deps({ voices: [voice], provider }), { projectId, orgId });
    expect((await narration()).status).toBe('FAILED');
    expect(provider.calls).toBe(1);
  });

  it('retries a transient provider error within the attempt limit and records every attempt', async () => {
    const voice = paidVoice('paid-retry');
    const provider = new FakePaidTts([
      new TtsProviderError('ElevenLabs rate limited (429)', 'elevenlabs', true, 'rate_limit', 429),
    ]);
    await approve(voice, 1);
    await requestNarration(voice);
    await processNarrationJob(deps({ voices: [voice], provider }), { projectId, orgId });
    const n = await narration();
    expect(n.status).toBe('READY');
    expect(provider.calls).toBe(5); // 4 lines + 1 retry
    const lines = await handle.db
      .select()
      .from(costLedger)
      .where(and(eq(costLedger.orgId, orgId), eq(costLedger.provider, 'elevenlabs')));
    // One failed attempt for the 429 (the 401 line belongs to the previous test).
    expect(lines.filter((l) => !l.success && l.note?.includes('429'))).toHaveLength(1);
    expect(
      lines.filter((l) => l.success).every((l) => l.chargeType === 'ESTIMATED' && l.amountMicroUsd > 0),
    ).toBe(true);
  });

  describe('continuous narration', () => {
    it('records the whole script once and cuts it into frame-exact scene slices', async () => {
      const provider = new CountingMockTts();
      await requestNarration(mockVoice, { mode: 'continuous', style: 'natural' });
      await processNarrationJob(deps({ voices: [mockVoice], provider }), { projectId, orgId });
      const n = await narration();
      expect(n.error).toBeUndefined();
      expect(n.status).toBe('READY');
      expect(provider.calls).toBe(1);
      expect(n.master?.boundaries).toBe('provider');
      expect(n.segments.map((s) => s.sceneKey)).toEqual(['hook', 'product', 'offer', 'cta']);
      for (const s of n.segments) {
        expect(s.source).toBe('slice');
        expect(s.durationSec * 30).toBeCloseTo(Math.round(s.durationSec * 30), 6);
        expect(s.cues.at(-1)!.endSec).toBeLessThanOrEqual(s.durationSec);
      }
      // The slices add up to the recording (padded to a whole frame at the very end).
      const total = n.segments.reduce((a, s) => a + s.durationSec, 0);
      expect(total).toBeGreaterThanOrEqual(n.master!.durationSec - 0.001);
      expect(total - n.master!.durationSec).toBeLessThan(1 / 30 + 0.001);
      // Conversational style reads the price colloquially.
      expect(n.segments[2]!.spokenText).toContain('עשרים ותשע');
      expect(n.segments[2]!.spokenText).not.toContain('אגורות');
    });

    it('reuses the cached recording and slices on a repeat request (no new generation)', async () => {
      const before = await handle.db.select().from(generatedAssets).where(eq(generatedAssets.orgId, orgId));
      const provider = new CountingMockTts();
      await requestNarration(mockVoice, { mode: 'continuous', style: 'natural' });
      await processNarrationJob(deps({ voices: [mockVoice], provider }), { projectId, orgId });
      const n = await narration();
      expect(provider.calls).toBe(0);
      expect(n.segments.every((s) => s.cached && s.source === 'slice')).toBe(true);
      const after = await handle.db.select().from(generatedAssets).where(eq(generatedAssets.orgId, orgId));
      expect(after).toHaveLength(before.length);
    });

    it('re-records only the replaced line and keeps every other slice', async () => {
      const previous = await narration();
      const provider = new CountingMockTts();
      // The API keeps the recorded narration and marks it QUEUED while one line is re-recorded.
      await handle.db
        .update(videoProjects)
        .set({ narration: { ...previous, status: 'QUEUED' } })
        .where(eq(videoProjects.id, projectId));
      await processNarrationJob(deps({ voices: [mockVoice], provider }), {
        projectId,
        orgId,
        replaceSceneKey: 'offer',
      });
      const n = await narration();
      expect(n.status).toBe('READY');
      expect(provider.calls).toBe(1);
      expect(n.master).toEqual(previous.master);
      for (const [i, s] of n.segments.entries()) {
        if (s.sceneKey === 'offer') {
          expect(s.source).toBe('separate');
        } else {
          expect(s.assetId).toBe(previous.segments[i]!.assetId);
          expect(s.source).toBe('slice');
        }
      }
    });

    it('calls a paid voice once for the whole script, after the approval check', async () => {
      const voice = paidVoice('paid-continuous');
      const provider = new FakePaidTts();
      await approve(voice, 1);
      await requestNarration(voice, { mode: 'continuous', style: 'warm' });
      await processNarrationJob(deps({ voices: [voice], provider }), { projectId, orgId });
      const n = await narration();
      expect(n.status).toBe('READY');
      expect(provider.calls).toBe(1);
      expect(n.segments.every((s) => s.source === 'slice')).toBe(true);
    });
  });
});

class CountingMockTts extends MockTtsProvider {
  calls = 0;
  override async synthesize(request: TtsRequest) {
    this.calls++;
    return super.synthesize(request);
  }
}
