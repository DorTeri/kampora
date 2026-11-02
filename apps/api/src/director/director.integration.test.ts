import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BudgetPolicy } from '@kampora/cost-engine';
import {
  brandProfiles,
  businesses,
  businessFacts,
  createDatabase,
  directorMessages,
  organizations,
  users,
  type DatabaseHandle,
} from '@kampora/database';
import type { BusinessFact } from '@kampora/shared';
import type { AuthContext } from '../common/auth';
import type { PaidOperationsService } from '../studio/paid.service';
import type { StaticAdsService } from '../studio/static-ads.service';
import type { StudioService } from '../studio/studio.service';
import { DirectorService } from './director.service';
import { DirectorStore } from './director.store';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://kampora:kampora@127.0.0.1:5433/kampora';

async function reachable(): Promise<boolean> {
  const h = createDatabase(DATABASE_URL, 1);
  try {
    await h.pool.query('select 1 from director_conversations limit 1');
    return true;
  } catch {
    return false;
  } finally {
    await h.close();
  }
}
const dbAvailable = await reachable();

describe.skipIf(!dbAvailable)('Campaign Director API (integration)', () => {
  let handle: DatabaseHandle;
  const a: AuthContext = { orgId: randomUUID(), userId: randomUUID(), role: 'OWNER' };
  const b: AuthContext = { orgId: randomUUID(), userId: randomUUID(), role: 'OWNER' };
  const policy = { paidGenerationEnabled: false } as BudgetPolicy;
  const paid = { creativeQuote: () => ({ provider: 'mock', paid: false, ready: true, expectedUsd: 0, maxUsd: 0 }) } as unknown as PaidOperationsService;
  // Onboarding turns never reach the Studio; if one did, the test should fail loudly.
  const studio = new Proxy({}, { get: () => () => Promise.reject(new Error('studio not expected')) }) as StudioService;
  const staticAds = studio as unknown as StaticAdsService;
  const service = () => {
    const store = new DirectorStore(handle.db);
    return { store, director: new DirectorService(handle.db, policy, store, studio, staticAds, paid) };
  };

  beforeAll(async () => {
    handle = createDatabase(DATABASE_URL, 2);
    for (const ctx of [a, b]) {
      await handle.db.insert(organizations).values({ id: ctx.orgId, name: `director-test-${ctx.orgId.slice(0, 6)}` });
      await handle.db.insert(users).values({ id: ctx.userId, email: `d-${ctx.userId}@test.local`, displayName: 't' });
    }
  });

  afterAll(async () => {
    await handle.db.delete(organizations).where(inArray(organizations.id, [a.orgId, b.orgId]));
    await handle.db.delete(users).where(inArray(users.id, [a.userId, b.userId]));
    await handle.close();
  });

  let conversationId = '';
  let businessId = '';

  it('creates the business from the conversation and projects only what the owner said', async () => {
    const { director } = service();
    const ws = await director.createConversation(a);
    conversationId = ws.id;
    const r = await director.send(a, conversationId, { text: 'יש לי עגלת קפה בתל אביב בשם קפה בדיקה', clientMessageId: 'msg-00000001' });
    expect(r.reply.text).toContain('קפה בדיקה');
    const after = await director.workspace(a, conversationId);
    businessId = after.businessId!;
    expect(businessId).toBeTruthy();
    const [biz] = await handle.db.select().from(businesses).where(eq(businesses.id, businessId));
    expect(biz).toMatchObject({ orgId: a.orgId, name: 'קפה בדיקה', city: 'תל אביב' });
    // No audience was stated: the projected one is geography only, marked as not confirmed by the owner.
    const [brand] = await handle.db.select().from(brandProfiles).where(eq(brandProfiles.businessId, businessId));
    expect(brand!.fieldSources.targetAudience).toBe('INFERRED_UNCONFIRMED');
    expect(brand!.fieldSources.name).toBe('USER');
    const facts = await handle.db.select().from(businessFacts).where(eq(businessFacts.businessId, businessId));
    expect(facts.every((f) => f.orgId === a.orgId && f.source === 'OWNER_STATED' && f.status === 'CONFIRMED')).toBe(true);
  });

  it('returns the stored reply for a resent message instead of running the turn again', async () => {
    const { director } = service();
    const first = await director.send(a, conversationId, { text: 'מה הסטטוס?', clientMessageId: 'msg-00000002' });
    const again = await director.send(a, conversationId, { text: 'מה הסטטוס?', clientMessageId: 'msg-00000002' });
    expect(again.replayed).toBe(true);
    expect(again.reply.id).toBe(first.reply.id);
    const owners = await handle.db
      .select()
      .from(directorMessages)
      .where(and(eq(directorMessages.conversationId, conversationId), eq(directorMessages.clientMessageId, 'msg-00000002')));
    expect(owners).toHaveLength(1);
  });

  it('continues after a restart from the stored state and does not ask again', async () => {
    const first = service();
    await first.director.send(a, conversationId, { text: 'בוא נכין קמפיין', clientMessageId: 'msg-00000003' });
    const asked = (await first.director.workspace(a, conversationId)).messages.at(-1)!;
    expect(asked.cards.some((c) => c.kind === 'QUESTION')).toBe(true);
    // A new service instance (as after an API restart) reads the same conversation from the database.
    const restarted = service();
    const ws = await restarted.director.workspace(a, conversationId);
    expect(ws.messages.length).toBeGreaterThanOrEqual(6);
    expect(ws.memory.map((m) => m.key)).toEqual(expect.arrayContaining(['business.name', 'business.model', 'location.city']));
    const r = await restarted.director.send(a, conversationId, { text: 'מה נשאר לאישור?', clientMessageId: 'msg-00000004' });
    expect(r.reply.text).not.toContain('איך קוראים לעסק');
  });

  it('keeps organizations apart', async () => {
    const { director, store } = service();
    await expect(director.workspace(b, conversationId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(director.send(b, conversationId, { text: 'היי', clientMessageId: 'msg-b-000001' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(director.createConversation(b, businessId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const conversation = await store.conversation(a, conversationId);
    const approval = await store.insertApproval(a, conversation, {
      taskId: randomUUID(),
      kind: 'PRODUCTION',
      title: 'בדיקה',
      details: [],
      payload: { projectId: randomUUID() },
      estimatedUsd: 0,
    });
    await expect(director.decide(b, approval.id, { decision: 'APPROVED' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await director.listConversations(b)).length).toBe(0);
    // A double click on the owner's own card is recorded once.
    const results = await Promise.all([
      director.decide(a, approval.id, { decision: 'REJECTED' }),
      director.decide(a, approval.id, { decision: 'REJECTED' }),
    ]);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect((await store.approval(a, approval.id)).status).toBe('REJECTED');
  });

  it('removes an offer from the approved claims once it expires', async () => {
    const { store } = service();
    const conversation = await store.conversation(a, conversationId);
    const now = new Date();
    const offer = (validUntil: string): BusinessFact => ({
      key: 'offer.current',
      value: { text: 'קפה ומאפה', price: '25 ₪', validUntil },
      source: 'OWNER_STATED',
      status: 'CONFIRMED',
      updatedAt: now.toISOString(),
      confirmedAt: now.toISOString(),
    });
    const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    await store.saveFacts(a, conversation, [offer(day(10))]);
    let [brand] = await handle.db.select().from(brandProfiles).where(eq(brandProfiles.businessId, businessId));
    expect(brand!.approvedClaims.some((c) => c.includes('קפה ומאפה'))).toBe(true);
    await store.saveFacts(a, conversation, [offer(day(-2))]);
    [brand] = await handle.db.select().from(brandProfiles).where(eq(brandProfiles.businessId, businessId));
    expect(brand!.approvedClaims.some((c) => c.includes('קפה ומאפה'))).toBe(false);
  });
});
