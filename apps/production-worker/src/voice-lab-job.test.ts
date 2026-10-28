import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PRICE_CATALOG, PriceCatalog, type BudgetPolicy } from '@kampora/cost-engine';
import {
  approvals,
  createDatabase,
  organizations,
  users,
  voiceLabSamples,
  type DatabaseHandle,
} from '@kampora/database';
import {
  MockTtsProvider,
  directLabScript,
  labScriptHash,
  voiceLabApprovalRef,
  voiceLabCandidates,
  type TtsProvider,
  type TtsRequest,
  type TtsSetup,
} from '@kampora/hebrew-voice';
import type { VoiceOption } from '@kampora/shared';
import { LocalDiskStorage } from '@kampora/storage';
import { labSpentUsd, processVoiceLabJob, type VoiceLabJobDeps } from './voice-lab-job';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://kampora:kampora@127.0.0.1:5433/kampora';

async function reachable(): Promise<boolean> {
  const h = createDatabase(DATABASE_URL, 1);
  try {
    await h.pool.query('select 1 from voice_lab_samples limit 1');
    return true;
  } catch {
    return false;
  } finally {
    await h.close();
  }
}
const dbAvailable = await reachable();

class FakeElevenLabs implements TtsProvider {
  readonly id = 'elevenlabs' as const;
  readonly paid = true;
  calls = 0;
  constructor(readonly model: string) {}
  async synthesize(request: TtsRequest) {
    this.calls++;
    const res = await new MockTtsProvider().synthesize({
      ...request,
      speech: { ...request.speech, provider: 'mock' },
    });
    return { ...res, provider: this.id, model: this.model, chargeType: 'ESTIMATED' as const };
  }
}

describe.skipIf(!dbAvailable)('voice lab job (integration)', () => {
  let handle: DatabaseHandle;
  let storageRoot: string;
  const orgId = randomUUID();
  const userId = randomUUID();
  const logger = pino({ level: 'silent' });
  const policy: BudgetPolicy = {
    projectMaxUsd: 5,
    perGenerationMaxUsd: 1,
    maxAttemptsPerAsset: 2,
    maxConcurrentPaidGenerations: 1,
    requireApprovalForPaid: true,
    paidGenerationEnabled: true,
  };
  const paidVoice: VoiceOption = {
    id: 'voiceAAAAAAAA',
    label: 'test',
    provider: 'elevenlabs',
    modelId: 'eleven_v3',
    gender: 'male',
  };
  const setup = (voices: VoiceOption[]): TtsSetup => ({
    provider: voices[0]!.provider === 'mock' ? 'mock' : 'elevenlabs',
    ready: true,
    paid: voices[0]!.provider !== 'mock',
    voices,
    audioTags: false,
    selectiveNiqqud: false,
  });
  const mockVoice: VoiceOption = { id: 'mock-he', label: 'mock', provider: 'mock', modelId: 'mock-voice-v1' };

  const deps = (
    overrides: Partial<VoiceLabJobDeps> & { setup: TtsSetup; provider: TtsProvider },
  ): VoiceLabJobDeps => ({
    db: handle.db,
    storage: new LocalDiskStorage({
      root: storageRoot,
      signingSecret: 'test-secret-123456',
      publicBaseUrl: 'http://x',
    }),
    catalog: new PriceCatalog(DEFAULT_PRICE_CATALOG),
    policy,
    logger,
    createProvider: () => overrides.provider,
    extraVoices: [],
    labMaxUsd: 1,
    ...overrides,
  });

  const queueSample = async (s: TtsSetup, candidateId: string, style: 'natural' | 'warm' = 'natural') => {
    const candidate = voiceLabCandidates(s).find((c) => c.id === candidateId)!;
    const script = directLabScript(candidate, style);
    const [row] = await handle.db
      .insert(voiceLabSamples)
      .values({
        orgId,
        candidateId,
        provider: candidate.voice.provider,
        model: candidate.voice.modelId,
        voiceId: candidate.voice.id,
        style,
        scriptHash: labScriptHash(),
        spokenText: script.payload,
        characters: script.characters,
        estimatedMicroUsd: 50_000,
      })
      .returning();
    return row!;
  };
  const sample = async (id: string) =>
    (await handle.db.select().from(voiceLabSamples).where(eq(voiceLabSamples.id, id)))[0]!;

  beforeAll(async () => {
    handle = createDatabase(DATABASE_URL, 2);
    storageRoot = await mkdtemp(path.join(os.tmpdir(), 'kampora-voice-lab-'));
    await handle.db.insert(organizations).values({ id: orgId, name: 'voice-lab-test' });
    await handle.db.insert(users).values({ id: userId, email: `t-${userId}@test.local`, displayName: 't' });
  });

  afterAll(async () => {
    await handle.db.delete(organizations).where(eq(organizations.id, orgId));
    await handle.close();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it('offers A (current), B (same voice on Eleven v4) and C (lab voices) on the same script', () => {
    const extra: VoiceOption = { ...paidVoice, id: 'voiceCCCCCCCC', modelId: 'eleven_v4', gender: 'female' };
    const candidates = voiceLabCandidates(setup([paidVoice]), [extra]);
    expect(candidates.map((c) => c.id)).toEqual([
      'A:voiceAAAAAAAA:eleven_v3',
      'B:voiceAAAAAAAA:eleven_v4',
      'C:voiceCCCCCCCC:eleven_v4',
    ]);
    const texts = candidates.map((c) => directLabScript(c, 'natural').payload);
    expect(new Set(texts).size).toBe(1);
    expect(texts[0]).toContain('החמישה עשר בנובמבר');
    expect(texts[0]).toContain('עשרים אחוז');
  });

  it('records a mock reading, then reuses it for the same candidate + style', async () => {
    const s = setup([mockVoice]);
    const provider = new MockTtsProvider();
    const first = await queueSample(s, 'A:mock-he:mock-voice-v1');
    await processVoiceLabJob(deps({ setup: s, provider }), { orgId, sampleId: first.id });
    const done = await sample(first.id);
    expect(done.status).toBe('SUCCEEDED');
    expect(done.durationSec).toBeGreaterThan(1);
    expect(done.cached).toBe(false);
    expect(done.chargeType).toBe('SIMULATED');

    const second = await queueSample(s, 'A:mock-he:mock-voice-v1');
    await processVoiceLabJob(deps({ setup: s, provider }), { orgId, sampleId: second.id });
    const again = await sample(second.id);
    expect(again.cached).toBe(true);
    expect(again.assetId).toBe(done.assetId);
  });

  it('never calls a paid voice when paid generation is disabled or the cost is not approved', async () => {
    const s = setup([paidVoice]);
    const provider = new FakeElevenLabs('eleven_v4');
    const off = await queueSample(s, 'B:voiceAAAAAAAA:eleven_v4');
    await processVoiceLabJob(
      deps({ setup: s, provider, policy: { ...policy, paidGenerationEnabled: false } }),
      {
        orgId,
        sampleId: off.id,
      },
    );
    expect((await sample(off.id)).error).toMatch(/disabled/);

    const unapproved = await queueSample(s, 'B:voiceAAAAAAAA:eleven_v4');
    await processVoiceLabJob(deps({ setup: s, provider }), { orgId, sampleId: unapproved.id });
    expect((await sample(unapproved.id)).error).toMatch(/not approved/);
    expect(provider.calls).toBe(0);
  });

  it('records an approved paid reading and stops at the lab cap', async () => {
    const s = setup([paidVoice]);
    const candidate = voiceLabCandidates(s).find((c) => c.id === 'B:voiceAAAAAAAA:eleven_v4')!;
    await handle.db.insert(approvals).values({
      orgId,
      subject: 'VOICE_TEST',
      subjectRef: voiceLabApprovalRef(candidate, 'warm'),
      decision: 'APPROVED',
      approvedEstimateMicroUsd: 1_000_000,
      decidedBy: userId,
    });
    const provider = new FakeElevenLabs('eleven_v4');
    const capped = await queueSample(s, candidate.id, 'warm');
    await processVoiceLabJob(deps({ setup: s, provider, labMaxUsd: 0.001 }), { orgId, sampleId: capped.id });
    expect((await sample(capped.id)).error).toMatch(/cap/);
    expect(provider.calls).toBe(0);

    const ok = await queueSample(s, candidate.id, 'warm');
    await processVoiceLabJob(deps({ setup: s, provider }), { orgId, sampleId: ok.id });
    const done = await sample(ok.id);
    expect(done.status).toBe('SUCCEEDED');
    expect(done.chargeType).toBe('ESTIMATED');
    expect(provider.calls).toBe(1);
    expect(await labSpentUsd(handle.db, orgId)).toBeCloseTo(0.05, 6);
  });
});
