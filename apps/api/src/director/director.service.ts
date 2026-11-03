import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { BudgetPolicy, PriceCatalog } from '@kampora/cost-engine';
import {
  DirectorEngine,
  DirectorToolError,
  FACT_SPECS,
  decideFacts,
  displayFact,
  factState,
  memoryOf,
  recommendNext,
  type DirectorContext,
  type TurnResult,
} from '@kampora/creative-engine';
import { directorApprovals, directorMessages, type Database } from '@kampora/database';
import type { DirectorApprovalDecision, DirectorMessageRequest, FactDecisionRequest } from '@kampora/shared';
import type { AuthContext } from '../common/auth';
import { ApiError } from '../common/errors';
import type { AppConfig } from '../config';
import { BUDGET_POLICY, CONFIG, DATABASE, PRICE_CATALOG } from '../infra/tokens';
import { PaidOperationsService } from '../studio/paid.service';
import { StaticAdsService } from '../studio/static-ads.service';
import { StudioService } from '../studio/studio.service';
import { brainFor, DbDirectorLlmLedger, directorBrainSetup, type DirectorBrainSetup } from './director-brain';
import { ApiDirectorExecutor } from './director.executor';
import { DirectorStore, type ConversationRow } from './director.store';

type MessageRow = typeof directorMessages.$inferSelect;

const toMessage = (m: MessageRow) => ({
  id: m.id,
  role: m.role,
  text: m.text,
  cards: m.cards,
  tools: m.tools,
  createdAt: m.createdAt.toISOString(),
});

/**
 * The Campaign Director over HTTP. A turn: load the compact state + memory → the engine decides (rule-based brain;
 * every tool call is authorized by the policy) → the executor runs the Studio services → the reply, tasks and
 * state are stored. Turns of one conversation run one at a time; a resent message returns the stored reply.
 */
@Injectable()
export class DirectorService {
  private readonly logger = new Logger('DirectorService');
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly brainSetup: DirectorBrainSetup;
  private readonly llmLedger: DbDirectorLlmLedger;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BUDGET_POLICY) private readonly policy: BudgetPolicy,
    @Inject(CONFIG) config: AppConfig,
    @Inject(PRICE_CATALOG) catalog: PriceCatalog,
    private readonly store: DirectorStore,
    private readonly studio: StudioService,
    private readonly staticAds: StaticAdsService,
    private readonly paid: PaidOperationsService,
  ) {
    this.brainSetup = directorBrainSetup(config, catalog);
    this.llmLedger = new DbDirectorLlmLedger(db);
    this.logger.log(`director brain: ${this.brainSetup.mode}${this.brainSetup.model ? ` (${this.brainSetup.model})` : ''}${this.brainSetup.reason ? ` — ${this.brainSetup.reason}` : ''}`);
  }

  /** One turn at a time per conversation (single API instance; the unique client id guards resends anyway). */
  private async exclusive<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(work);
    this.locks.set(key, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === run) this.locks.delete(key);
    }
  }

  private engine(ctx: AuthContext, conversation: ConversationRow) {
    const executor = ApiDirectorExecutor.create({
      ctx,
      conversation,
      store: this.store,
      studio: this.studio,
      staticAds: this.staticAds,
    });
    const brain = brainFor(this.brainSetup, this.llmLedger, { orgId: ctx.orgId, conversationId: conversation.id });
    return { executor, engine: new DirectorEngine({ brain, tools: executor, actions: executor, newId: () => crypto.randomUUID() }) };
  }

  private cost() {
    const quote = this.paid.creativeQuote();
    return { creativeUsd: quote.paid ? quote.maxUsd : 0, providerPaid: quote.paid, paidEnabled: this.policy.paidGenerationEnabled };
  }

  private async context(ctx: AuthContext, conversation: ConversationRow): Promise<DirectorContext> {
    const base: DirectorContext = {
      now: new Date(),
      state: conversation.state,
      facts: await this.store.facts(ctx, conversation.businessId),
      tasks: await this.store.tasks(ctx, conversation),
      approvals: await this.store.approvals(ctx, conversation),
      cost: this.cost(),
    };
    if (this.brainSetup.mode !== 'llm') return base;
    // Only the model reads these: the last exchanges (the current message excluded) and the latest work titles.
    const { executor } = this.engine(ctx, conversation);
    const messages = await this.store.messages(ctx, conversation.id, 8);
    const history = await executor.GetCampaignHistory({ limit: 5 });
    return {
      ...base,
      transcript: messages.slice(-7, -1).map((m) => ({ role: m.role, text: m.text })),
      recentWork: history.map((h) => h.title),
    };
  }

  /** Stores what a turn produced. Facts were already saved by the memory tool during the turn. */
  private async persist(ctx: AuthContext, conversation: ConversationRow, result: TurnResult, replyTo: string | null) {
    return this.db.transaction(async (tx) => {
      await this.store.saveTasks(ctx, conversation, result.tasks, tx);
      await this.store.saveState(ctx, conversation.id, result.state, tx);
      if (result.superseded.length)
        await tx
          .update(directorApprovals)
          .set({ status: 'REJECTED', error: 'SUPERSEDED', decidedAt: new Date() })
          .where(and(eq(directorApprovals.orgId, ctx.orgId), inArray(directorApprovals.id, result.superseded), eq(directorApprovals.status, 'PENDING')));
      const [reply] = await tx
        .insert(directorMessages)
        .values({ orgId: ctx.orgId, conversationId: conversation.id, role: 'DIRECTOR', text: result.text, cards: result.cards, tools: result.tools, replyTo })
        .returning();
      return reply!;
    });
  }

  // ── Conversations ────────────────────────────────────────────────────

  listConversations(ctx: AuthContext) {
    return this.store.listConversations(ctx);
  }

  async createConversation(ctx: AuthContext, businessId?: string) {
    const row = await this.store.createConversation(ctx, businessId);
    return this.workspace(ctx, row.id);
  }

  /** Everything the workspace shows: the conversation and the side panel (memory, approvals, status, work, ideas). */
  async workspace(ctx: AuthContext, conversationId: string) {
    const conversation = await this.store.conversation(ctx, conversationId);
    const now = new Date();
    const { executor } = this.engine(ctx, conversation);
    const facts = await this.store.facts(ctx, conversation.businessId);
    const approvals = await this.store.approvals(ctx, conversation);
    const history = await executor.GetCampaignHistory({ limit: 12 });
    const status = await executor.GetProductionStatus({});
    const memory = memoryOf(facts);
    return {
      id: conversation.id,
      title: conversation.title,
      businessId: conversation.businessId,
      messages: (await this.store.messages(ctx, conversation.id)).map(toMessage),
      memory: facts.map((f) => ({
        key: f.key,
        label: FACT_SPECS[f.key].label,
        value: displayFact(f.key, f.value),
        source: f.source,
        status: f.status,
        state: factState(f, now),
        updatedAt: f.updatedAt,
      })),
      pending: approvals.filter((a) => a.status === 'PENDING').map(({ payload: _payload, ...a }) => a),
      decided: approvals.filter((a) => a.status !== 'PENDING').slice(0, 10).map(({ payload: _payload, ...a }) => a),
      status,
      work: history,
      previews: await this.previews(ctx, history.flatMap((h) => (h.projectId ? [h.projectId] : [])).slice(0, 4)),
      recommendations: recommendNext({ memory, now, history, approvals, cost: this.cost() }),
      paidGenerationEnabled: this.policy.paidGenerationEnabled,
      brain: this.brainSetup.mode,
    };
  }

  /** Latest feed ad (4:5) and preview video per project, as short-lived URLs. */
  private async previews(ctx: AuthContext, projectIds: string[]) {
    const out: { projectId: string; imageUrl: string | null; videoUrl: string | null }[] = [];
    for (const projectId of projectIds) {
      try {
        const ads = await this.staticAds.list(ctx, projectId);
        const feed = ads.ads.find((a) => a.format === '4:5') ?? ads.ads[0];
        const renders = await this.studio.listRenders(ctx, projectId);
        const video = renders.find((r) => r.streamUrl);
        const imageUrl = feed?.pngUrl ?? null;
        const videoUrl = video?.streamUrl ?? null;
        if (imageUrl || videoUrl) out.push({ projectId, imageUrl, videoUrl });
      } catch (error) {
        this.logger.warn(`preview for ${projectId} unavailable: ${String(error)}`);
      }
    }
    return out;
  }

  // ── Turns ────────────────────────────────────────────────────────────

  async send(ctx: AuthContext, conversationId: string, body: DirectorMessageRequest) {
    return this.exclusive(conversationId, async () => {
      const conversation = await this.store.conversation(ctx, conversationId);
      const [owner] = await this.db
        .insert(directorMessages)
        .values({ orgId: ctx.orgId, conversationId, role: 'OWNER', text: body.text, clientMessageId: body.clientMessageId })
        .onConflictDoNothing()
        .returning();
      if (!owner) return this.replayed(ctx, conversationId, body.clientMessageId);

      const { engine } = this.engine(ctx, conversation);
      let result: TurnResult;
      try {
        result = await engine.turn(body.text, await this.context(ctx, conversation));
      } catch (error) {
        // Unexpected failure: the owner gets an honest answer and the conversation stays where it was.
        this.logger.error(`director turn failed: ${error instanceof Error ? error.stack : String(error)}`);
        const message = error instanceof DirectorToolError ? error.userMessage : 'תקלה פנימית';
        result = { text: `משהו השתבש (${message}). לא בוצע שום שינוי ושום דבר לא חויב. אפשר לנסות שוב.`, cards: [], tools: [], state: conversation.state, tasks: [], facts: [], superseded: [] };
      }
      const reply = await this.persist(ctx, conversation, result, owner.id);
      return { owner: toMessage(owner), reply: toMessage(reply), replayed: false };
    });
  }

  private async replayed(ctx: AuthContext, conversationId: string, clientMessageId: string) {
    const [owner] = await this.db
      .select()
      .from(directorMessages)
      .where(and(eq(directorMessages.conversationId, conversationId), eq(directorMessages.orgId, ctx.orgId), eq(directorMessages.clientMessageId, clientMessageId)));
    const [reply] = owner
      ? await this.db
          .select()
          .from(directorMessages)
          .where(and(eq(directorMessages.replyTo, owner.id), eq(directorMessages.orgId, ctx.orgId)))
          .orderBy(desc(directorMessages.createdAt))
          .limit(1)
      : [];
    if (!owner || !reply) throw new ApiError(HttpStatus.CONFLICT, 'MESSAGE_IN_PROGRESS', 'This message is still being answered');
    return { owner: toMessage(owner), reply: toMessage(reply), replayed: true };
  }

  /**
   * The owner's explicit decision on an approval card: the only path that authorizes approval-gated actions.
   * The row is claimed atomically (PENDING → APPROVED) so a double click cannot run the action twice.
   */
  async decide(ctx: AuthContext, approvalId: string, body: DirectorApprovalDecision) {
    const row = await this.store.approval(ctx, approvalId);
    const conversationId = await this.conversationFor(ctx, row.taskId, row.businessId);
    return this.exclusive(conversationId, async () => {
      const conversation = await this.store.conversation(ctx, conversationId);
      const context = await this.context(ctx, conversation);
      const [claimed] = await this.db
        .update(directorApprovals)
        .set({ status: body.decision, decidedBy: ctx.userId, decidedAt: new Date() })
        .where(and(eq(directorApprovals.id, approvalId), eq(directorApprovals.orgId, ctx.orgId), eq(directorApprovals.status, 'PENDING')))
        .returning({ id: directorApprovals.id });
      if (!claimed) {
        const current = await this.store.approval(ctx, approvalId);
        return { approvalId, status: current.status, replayed: true, reply: null, conversationId };
      }
      const { engine } = this.engine(ctx, conversation);
      const [owner] = await this.db
        .insert(directorMessages)
        .values({
          orgId: ctx.orgId,
          conversationId,
          role: 'OWNER',
          text: `${body.decision === 'APPROVED' ? '✓ אישרתי' : '✗ לא אישרתי'}: ${row.title}${body.note ? ` (${body.note})` : ''}`,
        })
        .returning();
      let result;
      try {
        result = await engine.decideApproval(approvalId, body.decision, context);
      } catch (error) {
        this.logger.error(`approval ${approvalId} failed: ${error instanceof Error ? error.stack : String(error)}`);
        const message = error instanceof DirectorToolError ? error.userMessage : 'תקלה פנימית';
        result = { text: `האישור נרשם, אבל הפעולה לא הושלמה (${message}). שום דבר לא חויב.`, cards: [], tools: [], state: conversation.state, tasks: [], facts: [], superseded: [], approvalStatus: 'FAILED' as const, approvalError: message };
      }
      await this.db
        .update(directorApprovals)
        .set({ status: result.approvalStatus, error: result.approvalError })
        .where(and(eq(directorApprovals.id, approvalId), eq(directorApprovals.orgId, ctx.orgId)));
      const reply = await this.persist(ctx, conversation, result, owner!.id);
      await this.store.audit(ctx, 'director.approval_decided', 'director_approval', approvalId, {
        kind: row.kind,
        decision: body.decision,
        outcome: result.approvalStatus,
        error: result.approvalError,
      });
      return { approvalId, status: result.approvalStatus, replayed: false, reply: toMessage(reply), conversationId };
    });
  }

  /** The conversation an approval belongs to: its task's, else the business's latest. */
  private async conversationFor(ctx: AuthContext, taskId: string, businessId: string | null) {
    const tasks = await this.store.taskConversation(ctx, taskId);
    if (tasks) return tasks;
    const list = await this.store.listConversations(ctx);
    const hit = list.find((c) => c.businessId === businessId);
    if (!hit) throw new ApiError(HttpStatus.CONFLICT, 'NO_CONVERSATION', 'No conversation for this approval');
    return hit.id;
  }

  // ── Memory ───────────────────────────────────────────────────────────

  /** The owner confirms or rejects a fact the Director inferred (from the memory panel). */
  async decideFact(ctx: AuthContext, conversationId: string, body: FactDecisionRequest) {
    return this.exclusive(conversationId, async () => {
      const conversation = await this.store.conversation(ctx, conversationId);
      const memory = memoryOf(await this.store.facts(ctx, conversation.businessId));
      if (!memory[body.key]) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Fact not found');
      const { changed } = decideFacts(memory, [body.key], body.decision, new Date());
      await this.store.saveFacts(ctx, conversation, changed);
      return this.workspace(ctx, conversationId);
    });
  }
}
