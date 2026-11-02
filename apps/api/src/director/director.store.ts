import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { claimOf, claimsFromMemory, memoryOf, MODEL_LABELS, usable, usableText } from '@kampora/creative-engine';
import {
  auditLog,
  brandProfiles,
  businesses,
  businessFacts,
  directorApprovals,
  directorConversations,
  directorMessages,
  directorTasks,
  type Database,
} from '@kampora/database';
import {
  BusinessFactSchema,
  emptyDirectorState,
  ToneOfVoiceSchema,
  type BusinessFact,
  type BusinessModel,
  type DirectorApprovalSummary,
  type DirectorConversationState,
  type DirectorTask,
} from '@kampora/shared';
import type { AuthContext } from '../common/auth';
import { ApiError, notFound } from '../common/errors';
import { DATABASE } from '../infra/tokens';

export type ConversationRow = typeof directorConversations.$inferSelect;
type FactRow = typeof businessFacts.$inferSelect;
type TaskRow = typeof directorTasks.$inferSelect;
type ApprovalRow = typeof directorApprovals.$inferSelect;

/** Neutral palette for businesses the Director creates; the owner can change it in the Studio. */
const DEFAULT_COLORS = { primary: '#1F2937', secondary: '#F59E0B', accent: '#DC2626', background: '#FFFBF5', text: '#111827' };
const PLACEHOLDER_NAME = 'העסק שלי';

/** One line about the business from what the owner confirmed (no inference). */
function describeBusiness(memory: ReturnType<typeof memoryOf>, now: Date): string {
  const text = (key: Parameters<typeof usableText>[1]) => usableText(memory, key, now);
  const model = usable(memory, 'business.model', now) as BusinessModel | undefined;
  const city = text('location.city');
  return [text('offering.main'), model && MODEL_LABELS[model], city && `ב${city}`, text('differentiator')].filter(Boolean).join(' · ');
}

export const toFact = (r: FactRow): BusinessFact =>
  BusinessFactSchema.parse({
    key: r.key,
    value: r.value,
    source: r.source,
    status: r.status,
    ...(r.evidence ? { evidence: r.evidence } : {}),
    updatedAt: r.updatedAt.toISOString(),
    confirmedAt: r.confirmedAt?.toISOString() ?? null,
  });

export const toTask = (r: TaskRow): DirectorTask => ({
  id: r.id,
  kind: r.kind as DirectorTask['kind'],
  status: r.status as DirectorTask['status'],
  params: r.params as DirectorTask['params'],
  missing: r.missing as DirectorTask['missing'],
  refs: r.refs,
  error: r.error,
});

export const toApproval = (r: ApprovalRow): DirectorApprovalSummary => ({
  id: r.id,
  taskId: r.taskId,
  kind: r.kind,
  title: r.title,
  details: r.details,
  status: r.status,
  payload: r.payload,
  estimatedUsd: r.estimatedMicroUsd / 1_000_000,
  createdAt: r.createdAt.toISOString(),
});

/**
 * Persistence of the Campaign Director: conversations, messages, tasks, approvals and the business memory.
 * Every query filters on ctx.orgId; ids coming from the client are always checked against the org.
 */
@Injectable()
export class DirectorStore {
  constructor(@Inject(DATABASE) readonly db: Database) {}

  // ── Conversations ────────────────────────────────────────────────────

  async conversation(ctx: AuthContext, id: string): Promise<ConversationRow> {
    const [row] = await this.db
      .select()
      .from(directorConversations)
      .where(and(eq(directorConversations.id, id), eq(directorConversations.orgId, ctx.orgId)));
    if (!row) throw notFound('Conversation');
    return row;
  }

  async listConversations(ctx: AuthContext) {
    return this.db
      .select({
        id: directorConversations.id,
        title: directorConversations.title,
        businessId: directorConversations.businessId,
        businessName: businesses.name,
        updatedAt: directorConversations.updatedAt,
      })
      .from(directorConversations)
      .leftJoin(businesses, eq(businesses.id, directorConversations.businessId))
      .where(eq(directorConversations.orgId, ctx.orgId))
      .orderBy(desc(directorConversations.updatedAt))
      .limit(30);
  }

  async createConversation(ctx: AuthContext, businessId?: string) {
    let title = 'שיחה חדשה';
    if (businessId) {
      const [b] = await this.db
        .select({ name: businesses.name })
        .from(businesses)
        .where(and(eq(businesses.id, businessId), eq(businesses.orgId, ctx.orgId)));
      if (!b) throw notFound('Business');
      title = b.name;
    }
    const [row] = await this.db
      .insert(directorConversations)
      .values({ orgId: ctx.orgId, businessId: businessId ?? null, title, state: emptyDirectorState(), createdBy: ctx.userId })
      .returning();
    return row!;
  }

  async messages(ctx: AuthContext, conversationId: string, limit = 200) {
    const rows = await this.db
      .select()
      .from(directorMessages)
      .where(and(eq(directorMessages.conversationId, conversationId), eq(directorMessages.orgId, ctx.orgId)))
      .orderBy(desc(directorMessages.createdAt), desc(directorMessages.role))
      .limit(limit);
    return rows.reverse();
  }

  // ── Memory ───────────────────────────────────────────────────────────

  async facts(ctx: AuthContext, businessId: string | null): Promise<BusinessFact[]> {
    if (!businessId) return [];
    const rows = await this.db
      .select()
      .from(businessFacts)
      .where(and(eq(businessFacts.businessId, businessId), eq(businessFacts.orgId, ctx.orgId)));
    return rows.map(toFact);
  }

  /** The conversation's business, created (with a placeholder profile) the first time a fact is saved. */
  async ensureBusiness(ctx: AuthContext, conversation: ConversationRow): Promise<string> {
    if (conversation.businessId) return conversation.businessId;
    const businessId = await this.db.transaction(async (tx) => {
      const [b] = await tx
        .insert(businesses)
        .values({
          orgId: ctx.orgId,
          name: PLACEHOLDER_NAME,
          category: 'עסק מקומי',
          description: '',
          products: [{ name: 'המוצר המרכזי', description: '' }],
          targetAudience: '',
        })
        .returning({ id: businesses.id });
      await tx.insert(brandProfiles).values({ orgId: ctx.orgId, businessId: b!.id, tone: 'friendly', colors: DEFAULT_COLORS });
      await tx
        .update(directorConversations)
        .set({ businessId: b!.id })
        .where(and(eq(directorConversations.id, conversation.id), eq(directorConversations.orgId, ctx.orgId)));
      await tx
        .update(directorTasks)
        .set({ businessId: b!.id })
        .where(and(eq(directorTasks.conversationId, conversation.id), eq(directorTasks.orgId, ctx.orgId)));
      return b!.id;
    });
    conversation.businessId = businessId;
    await this.audit(ctx, 'business.created_by_director', 'business', businessId, { conversationId: conversation.id });
    return businessId;
  }

  /** Writes facts (upsert by key) and projects the usable ones onto the business profile the Studio reads. */
  async saveFacts(ctx: AuthContext, conversation: ConversationRow, facts: readonly BusinessFact[]) {
    if (!facts.length) return;
    const businessId = await this.ensureBusiness(ctx, conversation);
    const before = await this.facts(ctx, businessId);
    await this.db.transaction(async (tx) => {
      for (const f of facts) {
        const values = {
          value: f.value,
          source: f.source,
          status: f.status,
          evidence: f.evidence ?? null,
          confirmedAt: f.confirmedAt ? new Date(f.confirmedAt) : null,
          updatedBy: ctx.userId,
          updatedAt: new Date(f.updatedAt),
        };
        await tx
          .insert(businessFacts)
          .values({ orgId: ctx.orgId, businessId, key: f.key, ...values })
          .onConflictDoUpdate({ target: [businessFacts.businessId, businessFacts.key], set: values, where: eq(businessFacts.orgId, ctx.orgId) });
      }
    });
    await this.project(ctx, businessId, before);
    await this.audit(ctx, 'business_facts.saved', 'business', businessId, {
      facts: facts.map((f) => ({ key: f.key, source: f.source, status: f.status })),
    });
  }

  /**
   * Copies what the owner confirmed into `businesses` / `brand_profiles`. Only usable facts (owner source,
   * confirmed, fresh) are projected; fields without a usable fact keep their current value. Claims derived from
   * facts are replaced, never accumulated, so an expired or changed offer leaves the approved claims.
   */
  async project(ctx: AuthContext, businessId: string, previous: readonly BusinessFact[] = []) {
    const now = new Date();
    const memory = memoryOf(await this.facts(ctx, businessId));
    const [business] = await this.db
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, businessId), eq(businesses.orgId, ctx.orgId)));
    const [brand] = await this.db
      .select()
      .from(brandProfiles)
      .where(and(eq(brandProfiles.businessId, businessId), eq(brandProfiles.orgId, ctx.orgId)));
    if (!business || !brand) throw notFound('Business');

    const text = (key: Parameters<typeof usableText>[1]) => usableText(memory, key, now);
    const model = usable(memory, 'business.model', now) as BusinessModel | undefined;
    const website = text('channel.website');
    const validUrl = website && /^https?:\/\//.test(website) && URL.canParse(website) ? website : undefined;
    const listed = usable(memory, 'offering.products', now);
    const productNames = [...(Array.isArray(listed) ? listed : typeof listed === 'string' ? [listed] : []), text('offering.main')].filter(
      (p): p is string => typeof p === 'string' && p.length > 0,
    );
    const unique = [...new Set(productNames)];
    const products = unique.length
      ? unique.map((name) => business.products.find((p) => p.name === name) ?? { name, description: '' })
      : business.products;
    const city = text('location.city');
    const description = describeBusiness(memory, now);

    const stale = new Set([...previous, ...Object.values(memory)].map((f) => claimOf(f)).filter(Boolean));
    const claims = [...brand.approvedClaims.filter((c) => !stale.has(c)), ...claimsFromMemory(memory, now)];
    const tone = ToneOfVoiceSchema.safeParse(text('brand.tone'));
    const sources: Record<string, string> = { ...brand.fieldSources };
    const touched: string[] = [];

    const patch: Partial<typeof businesses.$inferInsert> = {};
    const set = <K extends keyof typeof patch>(field: K, value: (typeof patch)[K] | undefined) => {
      if (value === undefined) return;
      patch[field] = value;
      sources[field as string] = 'USER';
      touched.push(field as string);
    };
    set('name', text('business.name'));
    set('category', text('business.category') ?? (model ? MODEL_LABELS[model] : undefined));
    set('city', city);
    set('address', text('location.address'));
    set('website', validUrl);
    set('targetAudience', text('audience'));
    // The brief needs an audience. Without the owner's words it is only the geography, marked as not confirmed.
    if (!patch.targetAudience && (!business.targetAudience || brand.fieldSources.targetAudience === 'INFERRED_UNCONFIRMED')) {
      const area = text('location.city') ?? text('location.serviceArea');
      patch.targetAudience = model === 'ECOMMERCE' ? 'קונים אונליין בישראל' : area ? `לקוחות ב${area} והסביבה` : 'לקוחות באזור';
      sources.targetAudience = 'INFERRED_UNCONFIRMED';
    }
    if (unique.length) set('products', products);
    // A description the Director composed is kept current; one the owner wrote in the Studio is left alone.
    if (description && (!business.description || business.description === describeBusiness(memoryOf(previous), now)))
      set('description', description);

    await this.db.transaction(async (tx) => {
      if (Object.keys(patch).length)
        await tx.update(businesses).set(patch).where(and(eq(businesses.id, businessId), eq(businesses.orgId, ctx.orgId)));
      await tx
        .update(brandProfiles)
        .set({ approvedClaims: [...new Set(claims)], fieldSources: sources, ...(tone.success ? { tone: tone.data } : {}) })
        .where(and(eq(brandProfiles.businessId, businessId), eq(brandProfiles.orgId, ctx.orgId)));
      const name = patch.name;
      if (name)
        await tx
          .update(directorConversations)
          .set({ title: name })
          .where(and(eq(directorConversations.businessId, businessId), eq(directorConversations.orgId, ctx.orgId)));
    });
    return touched;
  }

  // ── Tasks & approvals ────────────────────────────────────────────────

  /** This conversation's tasks plus the business's recent ones (approvals from earlier conversations stay actionable). */
  async tasks(ctx: AuthContext, conversation: ConversationRow): Promise<DirectorTask[]> {
    const scope = conversation.businessId
      ? or(eq(directorTasks.conversationId, conversation.id), eq(directorTasks.businessId, conversation.businessId))
      : eq(directorTasks.conversationId, conversation.id);
    const rows = await this.db
      .select()
      .from(directorTasks)
      .where(and(eq(directorTasks.orgId, ctx.orgId), scope))
      .orderBy(desc(directorTasks.updatedAt))
      .limit(60);
    return rows.map(toTask);
  }

  async approvals(ctx: AuthContext, conversation: ConversationRow): Promise<DirectorApprovalSummary[]> {
    const scope = conversation.businessId
      ? eq(directorApprovals.businessId, conversation.businessId)
      : inArray(
          directorApprovals.taskId,
          this.db.select({ id: directorTasks.id }).from(directorTasks).where(eq(directorTasks.conversationId, conversation.id)),
        );
    const rows = await this.db
      .select()
      .from(directorApprovals)
      .where(and(eq(directorApprovals.orgId, ctx.orgId), scope))
      .orderBy(desc(directorApprovals.createdAt))
      .limit(60);
    return rows.map(toApproval);
  }

  async approval(ctx: AuthContext, id: string) {
    const [row] = await this.db
      .select()
      .from(directorApprovals)
      .where(and(eq(directorApprovals.id, id), eq(directorApprovals.orgId, ctx.orgId)));
    if (!row) throw notFound('Approval');
    return row;
  }

  async taskConversation(ctx: AuthContext, taskId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ conversationId: directorTasks.conversationId })
      .from(directorTasks)
      .where(and(eq(directorTasks.id, taskId), eq(directorTasks.orgId, ctx.orgId)));
    return row?.conversationId ?? null;
  }

  /** Makes sure the task row exists before an approval references it (the full task is saved at the end of the turn). */
  async touchTask(ctx: AuthContext, conversation: ConversationRow, taskId: string) {
    await this.db
      .insert(directorTasks)
      .values({ id: taskId, orgId: ctx.orgId, businessId: conversation.businessId, conversationId: conversation.id, kind: 'CAMPAIGN', status: 'RUNNING' })
      .onConflictDoNothing();
    const [row] = await this.db
      .select({ orgId: directorTasks.orgId })
      .from(directorTasks)
      .where(eq(directorTasks.id, taskId));
    if (row?.orgId !== ctx.orgId) throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Task belongs to another organization');
  }

  async insertApproval(ctx: AuthContext, conversation: ConversationRow, a: Omit<DirectorApprovalSummary, 'id' | 'status' | 'createdAt'>) {
    await this.touchTask(ctx, conversation, a.taskId);
    const [row] = await this.db
      .insert(directorApprovals)
      .values({
        orgId: ctx.orgId,
        businessId: conversation.businessId,
        taskId: a.taskId,
        kind: a.kind,
        title: a.title,
        details: a.details,
        payload: a.payload,
        estimatedMicroUsd: Math.round(a.estimatedUsd * 1_000_000),
      })
      .returning();
    return toApproval(row!);
  }

  /** Saves the tasks a turn created or changed (upsert, org-checked). */
  async saveTasks(ctx: AuthContext, conversation: ConversationRow, tasks: readonly DirectorTask[], tx: Pick<Database, 'insert' | 'update'> = this.db) {
    for (const t of tasks) {
      const values = {
        kind: t.kind,
        status: t.status,
        params: t.params as Record<string, unknown>,
        missing: t.missing,
        refs: t.refs,
        error: t.error ?? null,
        updatedAt: new Date(),
      };
      await tx
        .insert(directorTasks)
        .values({ id: t.id, orgId: ctx.orgId, businessId: conversation.businessId, conversationId: conversation.id, ...values })
        .onConflictDoUpdate({ target: directorTasks.id, set: { ...values, businessId: sql`coalesce(${directorTasks.businessId}, ${conversation.businessId})` }, where: eq(directorTasks.orgId, ctx.orgId) });
    }
  }

  async saveState(ctx: AuthContext, conversationId: string, state: DirectorConversationState, tx: Pick<Database, 'update'> = this.db) {
    await tx
      .update(directorConversations)
      .set({ state, updatedAt: new Date() })
      .where(and(eq(directorConversations.id, conversationId), eq(directorConversations.orgId, ctx.orgId)));
  }

  async audit(ctx: AuthContext, action: string, subjectType: string, subjectId: string, metadata: Record<string, unknown> = {}) {
    await this.db.insert(auditLog).values({ orgId: ctx.orgId, actorUserId: ctx.userId, action, subjectType, subjectId, metadata });
  }
}
