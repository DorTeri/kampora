import type {
  BusinessFact,
  BusinessModel,
  DirectorApprovalKind,
  DirectorApprovalSummary,
  DirectorCampaignSummary,
  DirectorCard,
  DirectorConversationState,
  DirectorTask,
  DirectorTaskKind,
  DirectorToolName,
  FactKey,
  FactProposal,
  OfferFact,
  ToolCallRecord,
} from '@kampora/shared';
import type { DirectorBrain } from './brain';
import { FACT_SPECS, decideFacts, factState, formatDay, isOffer, mergeFacts, memoryOf, usable, usableText, type Memory } from './facts';
import { parseProductAnswer, type Understanding } from './hebrew';
import { campaignLabel, resolveReference } from './references';
import { nextQuestion, requirementsFor, taskObjective, taskProduct } from './requirements';
import { GROWTH_MEANING, marketingRecommendation } from './playbooks';
import { ACTION_LABELS, OBJECTIVE_LABELS, displayFact, proposeCampaign, recommend, type CostContext } from './strategy';
import {
  authorizeTool,
  DirectorToolError,
  TOOL_SPECS,
  type DirectorApprovalActions,
  type DirectorToolExecutor,
  type ToolAuthContext,
} from './tools';

/**
 * The Campaign Director's workflow. Each owner message is one turn: understand → remember → continue the open task
 * (asking only for what is missing) → run validated tools → reply. Approvals are decided only through
 * `decideApproval`, which the API calls from the explicit approvals endpoint.
 */

export interface DirectorContext {
  now: Date;
  state: DirectorConversationState;
  facts: BusinessFact[];
  /** This conversation's tasks (at least the open ones). */
  tasks: DirectorTask[];
  approvals: DirectorApprovalSummary[];
  cost: CostContext & { paidEnabled: boolean };
  /** Titles of recent campaigns (newest first), so a brain can follow references. */
  recentWork?: string[];
  /** The last few messages of this conversation (newest last). */
  transcript?: { role: 'OWNER' | 'DIRECTOR'; text: string }[];
}

/** Facts a passing remark must not overwrite silently: the owner confirms the change first. */
const CONFLICT_KEYS: FactKey[] = [
  'business.name',
  'location.city',
  'location.address',
  'contact.phone',
  'contact.whatsapp',
  'channel.website',
  'conversion.orderUrl',
  'conversion.bookingUrl',
  'offering.main',
];

/** Lookups a brain may ask for; they run through the same policy and only read. */
const LOOKUPS: DirectorToolName[] = ['ReadBusinessProfile', 'GetCampaignHistory', 'GetAvailableAssets', 'GetProductionStatus'];

export interface DirectorPorts {
  brain: DirectorBrain;
  tools: DirectorToolExecutor;
  actions: DirectorApprovalActions;
  newId(): string;
}

export interface TurnResult {
  text: string;
  cards: DirectorCard[];
  tools: ToolCallRecord[];
  state: DirectorConversationState;
  /** Tasks created or changed in this turn (to persist). */
  tasks: DirectorTask[];
  facts: BusinessFact[];
  /** Pending approvals replaced by a newer version in this turn (recorded as rejected). */
  superseded: string[];
}

export interface DecisionResult extends TurnResult {
  approvalStatus: DirectorApprovalSummary['status'];
  approvalError: string | null;
}

/** A tool that failed or was refused: stops the step, the reply explains it, nothing is retried silently. */
class StepStop extends Error {
  constructor(
    readonly tool: DirectorToolName,
    readonly userMessage: string,
    readonly refused: boolean,
  ) {
    super(userMessage);
  }
}

const NEW_TASK_INTENTS = ['CAMPAIGN', 'PROMOTION', 'LAUNCH', 'MODIFY'];
const ONBOARDING_KEYS: FactKey[] = ['business.name', 'business.model', 'location.city', 'offering.main'];

function offerLine(offer: OfferFact): string {
  return [offer.text, offer.price ? `ב-${offer.price}` : '', offer.validUntil ? `(עד ${formatDay(offer.validUntil)})` : ''].filter(Boolean).join(' ').slice(0, 200);
}

class Turn {
  readonly parts: string[] = [];
  readonly cards: DirectorCard[] = [];
  readonly records: ToolCallRecord[] = [];
  readonly changedFacts: BusinessFact[] = [];
  readonly superseded: string[] = [];
  private readonly tasks = new Map<string, DirectorTask>();
  private readonly dirty = new Set<string>();
  memory: Memory;
  state: DirectorConversationState;
  approvals: DirectorApprovalSummary[];
  private history?: DirectorCampaignSummary[];

  constructor(
    readonly ctx: DirectorContext,
    readonly ports: DirectorPorts,
  ) {
    this.memory = memoryOf(ctx.facts);
    this.state = structuredClone(ctx.state);
    this.approvals = [...ctx.approvals];
    for (const t of ctx.tasks) this.tasks.set(t.id, structuredClone(t));
  }

  get now() {
    return this.ctx.now;
  }

  say(text: string) {
    if (text) this.parts.push(text);
  }

  note(text: string) {
    this.state.notes = [...this.state.notes, text].slice(-8);
  }

  task(id: string | undefined) {
    return id ? this.tasks.get(id) : undefined;
  }

  activeTask() {
    const t = this.task(this.state.activeTaskId);
    return t && !['DONE', 'CANCELLED'].includes(t.status) ? t : undefined;
  }

  save(task: DirectorTask) {
    this.tasks.set(task.id, task);
    this.dirty.add(task.id);
  }

  newTask(kind: DirectorTaskKind, params: DirectorTask['params']): DirectorTask {
    const active = this.activeTask();
    if (active && ['COLLECTING', 'FAILED'].includes(active.status)) this.save({ ...active, status: 'CANCELLED' });
    const task: DirectorTask = { id: this.ports.newId(), kind, status: 'COLLECTING', params, missing: [], refs: {} };
    this.save(task);
    this.state.activeTaskId = task.id;
    this.state.awaiting = undefined;
    return task;
  }

  private auth(extra?: Partial<ToolAuthContext>): ToolAuthContext {
    return { source: 'WORKFLOW', paidProvider: this.ctx.cost.providerPaid, paidEnabled: this.ctx.cost.paidEnabled, ...extra };
  }

  /** Runs one tool through the policy and records it in the activity. */
  async call<T extends keyof DirectorToolExecutor>(
    name: T,
    args: unknown,
    summary: (result: Awaited<ReturnType<DirectorToolExecutor[T]>>) => string,
    extra?: Partial<ToolAuthContext>,
  ): Promise<Awaited<ReturnType<DirectorToolExecutor[T]>>> {
    const a = authorizeTool(name, args, this.auth(extra));
    if (!a.ok) {
      this.records.push({ tool: name, status: 'REFUSED', summary: TOOL_SPECS[name].label, error: a.reason });
      throw new StepStop(name, a.reason, true);
    }
    try {
      const run = this.ports.tools[name] as (args: unknown) => Promise<Awaited<ReturnType<DirectorToolExecutor[T]>>>;
      const result = await run.call(this.ports.tools, a.args);
      this.records.push({ tool: name, status: 'DONE', summary: summary(result).slice(0, 400) });
      return result;
    } catch (error) {
      const message = error instanceof DirectorToolError ? error.userMessage : 'תקלה פנימית';
      this.records.push({ tool: name, status: 'FAILED', summary: TOOL_SPECS[name].label, error: message.slice(0, 400) });
      throw new StepStop(name, message, false);
    }
  }

  /** A decision the engine makes itself (no service call), recorded so the owner sees it. */
  recordDecision(name: DirectorToolName, summary: string) {
    this.records.push({ tool: name, status: 'DONE', summary: summary.slice(0, 400) });
  }

  async loadHistory(): Promise<DirectorCampaignSummary[]> {
    this.history ??= await this.call('GetCampaignHistory', { limit: 20 }, (r) => `${r.length} קמפיינים`);
    return this.history;
  }

  // ── Memory ──

  async remember(proposals: FactProposal[]) {
    if (!proposals.length) return;
    // A different value for a confirmed essential ("בעצם אנחנו באשדוד") is held until the owner confirms it,
    // unless it answers the question the Director just asked.
    const awaited = this.state.awaiting?.kind === 'FACTS' ? this.state.awaiting.keys : [];
    const accepted: FactProposal[] = [];
    for (const p of proposals) {
      const existing = this.memory[p.key];
      const conflicting =
        CONFLICT_KEYS.includes(p.key) &&
        p.source === 'OWNER_STATED' &&
        !awaited.includes(p.key) &&
        existing?.status === 'CONFIRMED' &&
        factState(existing, this.now) === 'USABLE' &&
        typeof p.value === 'string' &&
        typeof existing.value === 'string' &&
        p.value.trim() !== existing.value.trim();
      if (conflicting && !this.state.conflict) {
        this.state.conflict = { key: p.key, value: p.value, evidence: (p.evidence ?? '').slice(0, 300) };
        continue;
      }
      if (conflicting) continue;
      accepted.push(p);
    }
    if (!accepted.length) return;
    const r = mergeFacts(this.memory, accepted, this.now);
    await this.persist(r.changed, r.memory);
    const confirmed = r.changed.filter((f) => f.status === 'CONFIRMED' && f.value !== false);
    const shown = confirmed.filter((f) => !(f.key === 'business.model' && confirmed.some((c) => c.key === 'business.category')));
    if (shown.length) this.say(`רשמתי: ${shown.map((f) => `${FACT_SPECS[f.key].label} – ${displayFact(f.key, f.value)}`).join(', ')}.`);
    const proposed = r.changed.filter((f) => f.status === 'PROPOSED');
    if (proposed.length)
      this.cards.push({
        kind: 'FACTS',
        facts: proposed.map((f) => ({ key: f.key, label: FACT_SPECS[f.key].label, value: displayFact(f.key, f.value), status: f.status })),
      });
  }

  async decide(keys: FactKey[], decision: 'CONFIRM' | 'REJECT') {
    const r = decideFacts(this.memory, keys, decision, this.now);
    await this.persist(r.changed, r.memory);
    if (decision === 'CONFIRM' && r.changed.length) this.say(`מעולה, אישרת: ${r.changed.map((f) => displayFact(f.key, f.value)).join(', ')}.`);
  }

  private async persist(changed: BusinessFact[], memory: Memory) {
    if (!changed.length) return;
    await this.call('ProposeBusinessProfileUpdate', { facts: changed }, (r) => `נשמרו ${r.saved} פרטים בזיכרון העסק`);
    this.memory = memory;
    this.changedFacts.push(...changed);
  }

  /** The offer the owner described, completed with the current offer when they only add a price or a date. */
  offerProposal(patch: Partial<OfferFact>, evidence: string): FactProposal | undefined {
    const existing = this.memory['offer.current'];
    const s = factState(existing, this.now);
    const base = existing && isOffer(existing.value) && !['EXPIRED', 'REJECTED'].includes(s) && !patch.text ? existing.value : undefined;
    const text = patch.text ?? base?.text;
    if (!text) return undefined;
    const value: OfferFact = { ...(base ?? {}), ...patch, text };
    if (patch.validUntil) delete value.ongoing;
    if (patch.ongoing) delete value.validUntil;
    return { key: 'offer.current', value, source: 'OWNER_STATED', evidence };
  }

  // ── Cards ──

  pendingFor(taskId?: string) {
    return this.approvals.filter((a) => a.status === 'PENDING' && (!taskId || a.taskId === taskId));
  }

  approvalCard(a: Pick<DirectorApprovalSummary, 'id' | 'kind' | 'title' | 'details' | 'estimatedUsd'>): DirectorCard {
    return { kind: 'APPROVAL', approvalId: a.id, approvalKind: a.kind, title: a.title, details: a.details.slice(0, 12), estimatedCostUsd: a.estimatedUsd };
  }

  async requestApproval(task: DirectorTask, kind: DirectorApprovalKind, title: string, details: string[], payload: Record<string, unknown>, estimatedUsd = 0) {
    const { approvalId } = await this.call(
      'PresentCreativeForApproval',
      { taskId: task.id, kind, title, details, payload, estimatedUsd },
      () => `בקשת אישור: ${title}`,
    );
    const summary: DirectorApprovalSummary = {
      id: approvalId,
      taskId: task.id,
      kind,
      title,
      details,
      status: 'PENDING',
      payload,
      estimatedUsd,
      createdAt: this.now.toISOString(),
    };
    this.approvals.push(summary);
    this.cards.push(this.approvalCard(summary));
    return summary;
  }

  result(): TurnResult {
    return {
      text: this.parts.join('\n\n').slice(0, 4000),
      cards: this.cards.slice(0, 8),
      tools: this.records.slice(-12),
      state: this.state,
      tasks: [...this.dirty].map((id) => this.tasks.get(id)!),
      facts: this.changedFacts,
      superseded: this.superseded,
    };
  }
}

export class DirectorEngine {
  constructor(private readonly ports: DirectorPorts) {}

  /** One owner message. */
  async turn(text: string, ctx: DirectorContext): Promise<TurnResult> {
    const t = new Turn(ctx, this.ports);
    const active = t.activeTask();
    const awaiting = ctx.state.awaiting;
    const u = await this.ports.brain.interpret({
      text,
      now: ctx.now,
      state: ctx.state,
      knownFacts: ctx.facts.map((f) => f.key),
      recentWork: ctx.recentWork ?? [],
      memory: ctx.facts.map((f) => ({ key: f.key, label: FACT_SPECS[f.key].label, value: displayFact(f.key, f.value), state: factState(f, ctx.now) })),
      awaitingQuestion:
        awaiting?.kind === 'FACTS'
          ? awaiting.keys.map((k) => FACT_SPECS[k].question).join(' ')
          : awaiting?.kind === 'CONCEPT'
            ? 'איזה רעיון לבחור?'
            : awaiting?.kind === 'CLARIFY'
              ? 'לאיזה מהם התכוונת?'
              : awaiting?.kind === 'INSTRUCTION'
                ? 'מה לשנות?'
                : ctx.state.conflict
                  ? `לעדכן ${FACT_SPECS[ctx.state.conflict.key].label}?`
                  : undefined,
      ...(active ? { activeTask: { kind: active.kind, status: active.status, objective: active.params.objective, product: active.params.product } } : {}),
      pendingApprovals: ctx.approvals.filter((a) => a.status === 'PENDING').map((a) => a.title),
      transcript: ctx.transcript ?? [],
    });
    t.state.turns += 1;
    const hadConflict = Boolean(ctx.state.conflict);
    try {
      await this.handle(t, u, text);
    } catch (error) {
      if (!(error instanceof StepStop)) throw error;
      this.stopped(t, error);
    }
    if (t.state.conflict && !hadConflict) this.askConflict(t);
    // The model's own words lead the reply only when the turn was not a refusal.
    if (u.reply && u.intent !== 'FORBIDDEN') t.parts.unshift(u.reply);
    return t.result();
  }

  private askConflict(t: Turn) {
    const c = t.state.conflict!;
    const old = t.memory[c.key];
    t.say(`רגע, עד עכשיו רשום אצלי ${FACT_SPECS[c.key].label}: ${old ? displayFact(c.key, old.value) : '—'}. לעדכן ל"${displayFact(c.key, c.value)}"?`);
    t.cards.push({ kind: 'QUESTION', keys: [c.key], skippable: false, suggestions: ['כן, לעדכן', 'לא, להשאיר'] });
  }

  /** The owner's answer to a held contradiction. Returns true when this message was that answer. */
  private async resolveConflict(t: Turn, u: Understanding): Promise<boolean> {
    const c = t.state.conflict;
    if (!c) return false;
    const restated = u.facts.find((f) => f.key === c.key && f.source === 'OWNER_STATED');
    const label = FACT_SPECS[c.key].label;
    if ((u.yes && !u.no) || (restated && restated.value === c.value)) {
      t.state.conflict = undefined;
      await t.remember([{ key: c.key, value: c.value, source: 'OWNER_CONFIRMED', evidence: c.evidence }]);
      return true;
    }
    if (u.no) {
      t.state.conflict = undefined;
      const old = t.memory[c.key];
      t.say(`בסדר, נשאר ${label}: ${old ? displayFact(c.key, old.value) : '—'}.`);
      return true;
    }
    return false;
  }

  private stopped(t: Turn, error: StepStop) {
    const label = TOOL_SPECS[error.tool].label;
    const task = t.activeTask();
    if (error.refused) {
      t.say(`לא ביצעתי את "${label}": ${error.userMessage}.`);
      return;
    }
    if (task) t.save({ ...task, status: 'FAILED', error: error.userMessage, params: { ...task.params, failedStep: error.tool } });
    t.say(`לא הצלחתי להשלים את "${label}": ${error.userMessage}. שום דבר לא חויב ולא פורסם. כתוב "נסה שוב" כדי לנסות שוב.`);
  }

  private async handle(t: Turn, u: Understanding, text: string) {
    // Tools a model asked for go through the same policy: lookups run, anything else is refused and recorded.
    const lookups = new Set<DirectorToolName>();
    for (const r of u.toolRequests.slice(0, 3)) {
      const a = authorizeTool(r.tool, r.args, { source: 'BRAIN', paidProvider: t.ctx.cost.providerPaid, paidEnabled: t.ctx.cost.paidEnabled });
      const known = (TOOL_SPECS as Record<string, unknown>)[r.tool] ? (r.tool as DirectorToolName) : 'ReadBusinessProfile';
      if (!a.ok || !LOOKUPS.includes(known)) {
        t.records.push({ tool: known, status: 'REFUSED', summary: `בקשה של המודל: ${r.tool}`.slice(0, 400), error: a.ok ? 'רק בדיקות קריאה מותרות למודל' : a.reason });
        continue;
      }
      lookups.add(known);
    }
    if (u.intent === 'FORBIDDEN') return this.refuse(t, u.forbidden!);
    if (await this.resolveConflict(t, u)) return this.continueOrFallback(t, { ...u, yes: false, no: false });
    if (['UNKNOWN', 'PROVIDE_INFO'].includes(u.intent) && !u.facts.length && !t.state.awaiting) {
      if (lookups.has('GetProductionStatus')) return this.status(t);
      if (lookups.has('GetCampaignHistory')) return this.historyReply(t);
    }
    for (const tool of lookups) if (tool === 'ReadBusinessProfile' || tool === 'GetAvailableAssets') await t.call(tool, {}, () => TOOL_SPECS[tool].label);

    const awaiting = t.state.awaiting;
    const proposals = [...u.facts];
    if (u.offerPatch) {
      const offer = t.offerProposal(u.offerPatch, text.slice(0, 300));
      if (offer) proposals.push(offer);
    }

    // A launch's product question: the answer names the product (kept with the task, added to the product list).
    if (awaiting?.kind === 'FACTS' && awaiting.keys.includes('offering.products') && !NEW_TASK_INTENTS.includes(u.intent) && !u.skip) {
      const task = t.task(awaiting.taskId);
      const answer = parseProductAnswer(text);
      if (task && answer) {
        const products = (usable(t.memory, 'offering.products', t.now) as string[] | undefined) ?? [];
        proposals.push({ key: 'offering.products', value: [...products.filter((p) => p !== answer.name), answer.name].slice(-30), source: 'OWNER_STATED', evidence: text.slice(0, 300) });
        t.save({ ...task, params: { ...task.params, product: answer.name, ...(answer.detail ? { productDetail: answer.detail } : {}) } });
      }
    }

    if (awaiting?.kind === 'FACTS') {
      const proposedAwaited = awaiting.keys.filter((k) => t.memory[k]?.status === 'PROPOSED');
      const answered = proposals.some((p) => awaiting.keys.includes(p.key) && p.source === 'OWNER_STATED');
      if (proposedAwaited.length && !answered && u.yes) await t.decide(proposedAwaited, 'CONFIRM');
      else if (proposedAwaited.length && !answered && u.no) {
        await t.decide(proposedAwaited, 'REJECT');
        t.say('תודה על התיקון.');
      } else if ((u.skip || u.choice === 'RECOMMENDED') && !answered) {
        // Without a task this is onboarding: its questions are the essentials of any campaign.
        const task = t.task(awaiting.taskId) ?? { id: '', kind: 'CAMPAIGN' as const, status: 'COLLECTING' as const, params: {}, missing: [], refs: {} };
        const essential = requirementsFor(task, t.memory, t.now).filter((r) => r.essential && awaiting.keys.includes(r.key));
        if (essential.length) t.say(`את זה אני חייב לשאול: ${essential[0]!.why}`);
        else t.state.skipped = [...new Set([...t.state.skipped, ...awaiting.keys])];
      } else if (!answered && !proposals.length && !NEW_TASK_INTENTS.includes(u.intent) && !['STATUS', 'HISTORY', 'RECOMMEND', 'FORBIDDEN', 'RETRY'].includes(u.intent)) {
        // An answer to an optional question that was not understood: move on instead of asking it again.
        const task = t.task(awaiting.taskId) ?? { id: '', kind: 'CAMPAIGN' as const, status: 'COLLECTING' as const, params: {}, missing: [], refs: {} };
        const asked = requirementsFor(task, t.memory, t.now).filter((r) => awaiting.keys.includes(r.key));
        if (asked.length && asked.every((r) => !r.essential)) {
          t.state.skipped = [...new Set([...t.state.skipped, ...awaiting.keys])];
          t.say('לא הייתי בטוח מה התשובה, אז נמשיך בלי זה כרגע. אפשר לחזור לזה בכל רגע.');
        } else if (asked[0]) t.say(`לא הבנתי את התשובה. ${asked[0].why}`);
      }
    }

    await t.remember(proposals);

    if (awaiting?.kind === 'CONCEPT' && u.choice !== undefined && !NEW_TASK_INTENTS.includes(u.intent)) return this.chooseConcept(t, awaiting, u.choice);
    if (awaiting?.kind === 'CLARIFY' && !NEW_TASK_INTENTS.includes(u.intent)) {
      const picked = this.clarified(t, awaiting, u, text);
      if (picked) return picked;
    }
    // "תפתח ב..." while the opening is being asked answers that question; it does not start another revision.
    const answersOpening = awaiting?.kind === 'INSTRUCTION' && u.intent === 'MODIFY' && u.modify?.target === 'VIDEO_OPENING' && u.modify.reference === 'NONE';
    if (awaiting?.kind === 'INSTRUCTION' && (answersOpening || !NEW_TASK_INTENTS.includes(u.intent)) && !['STATUS', 'HISTORY', 'RECOMMEND', 'GREETING'].includes(u.intent)) {
      const task = t.task(awaiting.taskId);
      if (text.trim().split(/\s+/).length < 2 && !/"/.test(text)) {
        t.say('אפשר לפרט קצת יותר? למשל: "לפתוח בתקריב של המוצר", או משפט פתיחה במירכאות.');
        return;
      }
      t.state.awaiting = undefined;
      if (task) {
        const next = { ...task, params: { ...task.params, instruction: text.trim().slice(0, 500) } };
        t.save(next);
        return this.advance(t, next);
      }
    }

    switch (u.intent) {
      case 'STATUS':
        return this.status(t);
      case 'HISTORY':
        return this.historyReply(t);
      case 'RECOMMEND':
        return this.recommendReply(t);
      case 'APPROVE_TEXT':
        return this.approveByText(t);
      case 'RETRY':
        return this.retry(t);
      case 'CAMPAIGN':
      case 'PROMOTION':
      case 'LAUNCH':
        return this.startCampaign(t, u.intent, u);
      case 'MODIFY':
        return this.startModify(t, u, text);
      case 'GREETING':
        return this.greet(t);
      default:
        return this.continueOrFallback(t, u);
    }
  }

  private refuse(t: Turn, kind: NonNullable<Understanding['forbidden']>) {
    const can = 'מה שאני כן יכול: להכין רעיונות, תסריט ועיצובים, ולהכין טיוטת הגדרות קמפיין שתאשר בעצמך.';
    const text: Record<typeof kind, string> = {
      PUBLISH: 'אני לא מפרסם מודעות ולא מפעיל קמפיינים. בגרסה הזו שום דבר לא עולה למטא; הגדרות הקמפיין נשמרות כטיוטה בלבד.',
      MESSAGE: 'אני לא שולח הודעות וואטסאפ, SMS או מיילים בשם העסק.',
      APPROVE: 'אני לא מאשר בשמך. כל אישור נרשם רק כשאתה לוחץ "אישור" בכרטיס.',
      SPEND: 'אני לא מוציא כסף ולא מתחייב לתקציב. כל הוצאה דורשת את האישור המפורש שלך, ויצירה בתשלום כבויה כרגע.',
      INJECTION: 'אני ממשיך לפי הכללים הרגילים: לא מאשר, לא מפרסם ולא מוציא כסף בלי אישור שלך בכרטיס.',
    };
    t.say(`${text[kind]} ${can}`);
    const active = t.activeTask();
    if (active?.status === 'COLLECTING') t.say('נמשיך מאיפה שעצרנו?');
  }

  // ── Campaign workflow ──

  private async startCampaign(t: Turn, intent: 'CAMPAIGN' | 'PROMOTION' | 'LAUNCH', u: Understanding) {
    const active = t.activeTask();
    const params: DirectorTask['params'] = {
      ...(u.objective ? { objective: u.objective } : {}),
      ...(u.product ? { product: u.product.text, productIsNew: u.product.isNew } : {}),
      ...(u.window ? { window: u.window } : {}),
      ...(u.growth && !u.objective ? { growth: true } : {}),
    };
    if (active && active.kind === intent && ['COLLECTING', 'FAILED'].includes(active.status)) {
      // A changed goal mid-conversation replaces the old one; everything already learned stays.
      if (params.objective && active.params.objective && params.objective !== active.params.objective)
        t.say(`בסדר, שיניתי את המטרה ל${OBJECTIVE_LABELS[params.objective]}.`);
      const merged = { ...active, status: 'COLLECTING' as const, params: { ...active.params, ...params, ...(params.objective ? { growth: false } : {}) } };
      t.save(merged);
      return this.advance(t, merged);
    }
    if (active && ['WAITING_CHOICE', 'WAITING_APPROVAL'].includes(active.status) && params.objective && active.params.objective !== params.objective)
      t.say('הקמפיין הקודם נשמר כמו שהוא, ואפשר לחזור אליו.');
    const task = t.newTask(intent, params);
    t.say(
      intent === 'PROMOTION'
        ? 'בשמחה, נכין קמפיין מבצע.'
        : intent === 'LAUNCH'
          ? `בשמחה, נקדם את ${u.product?.text ?? 'המוצר החדש'}${u.window ? ` ${u.window}` : ''}.`
          : `בשמחה, נכין קמפיין${u.objective ? ` ל${OBJECTIVE_LABELS[u.objective]}` : ''}.`,
    );
    t.note(`התחלנו ${intent === 'PROMOTION' ? 'קמפיין מבצע' : intent === 'LAUNCH' ? `השקה: ${u.product?.text ?? ''}` : 'קמפיין'}`);
    return this.advance(t, task);
  }

  private async advance(t: Turn, task: DirectorTask): Promise<void> {
    if (task.kind === 'MODIFY') return this.advanceModify(t, task);
    if (task.status === 'WAITING_APPROVAL') {
      const pending = t.pendingFor(task.id);
      t.say(pending.length ? 'הקמפיין הזה מחכה לאישור שלך:' : 'הקמפיין הזה כבר בדרך.');
      for (const a of pending.slice(0, 3)) t.cards.push(t.approvalCard(a));
      return;
    }
    if (task.status === 'WAITING_CHOICE') {
      t.say('איזה מהרעיונות לבחור? אפשר לכתוב 1, 2 או 3, או "מה שאתה ממליץ".');
      return;
    }
    const requirements = requirementsFor(task, t.memory, t.now);
    const q = nextQuestion(requirements, t.state.skipped);
    if (q) {
      t.save({ ...task, status: 'COLLECTING', missing: requirements.filter((r) => r.essential).map((r) => r.key) });
      t.state.awaiting = { kind: 'FACTS', keys: q.keys, taskId: task.id };
      t.cards.push({ kind: 'QUESTION', keys: q.keys, skippable: q.skippable, suggestions: q.suggestions.slice(0, 6) });
      t.say(q.text);
      return;
    }
    t.state.awaiting = undefined;
    const model = usable(t.memory, 'business.model', t.now) as BusinessModel;
    const objective = taskObjective(task, t.memory, t.now)!;
    const product = taskProduct(task, t.memory, t.now)!;
    const promotion = task.kind === 'PROMOTION';
    const strategy = proposeCampaign({ model, objective, product, promotion, window: task.params.window, memory: t.memory, now: t.now, cost: t.ctx.cost });
    if ('needs' in strategy) {
      // Requirements cover destinations; reaching here means the memory changed under us. Ask plainly.
      t.state.awaiting = { kind: 'FACTS', keys: [strategy.needs], taskId: task.id };
      t.say(FACT_SPECS[strategy.needs].question);
      return;
    }
    const marketing = marketingRecommendation({
      model,
      objective,
      product,
      promotion,
      conversion: strategy.conversion,
      memory: t.memory,
      now: t.now,
      paidProvider: t.ctx.cost.providerPaid,
    });
    t.recordDecision('ProposeCampaignStrategy', `${strategy.recommendation.title} · יעד: ${ACTION_LABELS[strategy.conversion.action]}`);
    t.cards.push({ kind: 'RECOMMENDATION', recommendation: strategy.recommendation, conversion: strategy.conversion, marketing });
    if (task.params.growth && !usable(t.memory, 'goal.primary', t.now)) t.say(GROWTH_MEANING[model]);
    t.say(`הנה מה שאני מציע. ${strategy.recommendation.reasoning}`);
    t.say(`ההנחה שנבדוק: ${marketing.hypothesis} נמדוד את זה לפי ${marketing.measurement.primaryMetric}.`);

    const offer = promotion ? usable(t.memory, 'offer.current', t.now) : undefined;
    const brief = {
      goal: strategy.goal,
      productName: product.slice(0, 120),
      ...(isOffer(offer) ? { offer: offerLine(offer) } : {}),
      notes: [
        task.params.productDetail ? `על המוצר, במילים של בעל העסק: ${task.params.productDetail}` : '',
        task.params.window ? `לוח זמנים: ${task.params.window}` : '',
        usableText(t.memory, 'preferences.style', t.now) ? `העדפת סגנון של בעל העסק: ${usableText(t.memory, 'preferences.style', t.now)}` : '',
        `הלקוח מתבקש: ${ACTION_LABELS[strategy.conversion.action]}${strategy.conversion.destination ? ` (${strategy.conversion.destination})` : ''}`,
        `השערה שיווקית: ${marketing.hypothesis}`,
        `פורמטים: ${marketing.creativeFormats.map((f) => f.format).join(', ')}`,
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 1000),
      plan: { objective, goal: strategy.goal, conversion: strategy.conversion, meta: strategy.meta, recommendationId: strategy.recommendation.id },
    };
    if (t.ctx.cost.providerPaid) {
      await t.requestApproval(
        task,
        'PAID_GENERATION',
        'אישור הוצאה: רעיונות ותסריט בבינה מלאכותית',
        [`עלות משוערת: עד $${t.ctx.cost.creativeUsd.toFixed(2)}`, 'כולל 3 רעיונות ותסריט לרעיון שתבחר', 'שום דבר לא מתפרסם'],
        { brief },
        t.ctx.cost.creativeUsd,
      );
      t.save({ ...task, status: 'WAITING_APPROVAL' });
      t.say('הספק שמוגדר כרגע גובה תשלום, אז אני צריך את אישורך לפני שמתחילים.');
      return;
    }
    await this.createConcepts(t, task, brief);
  }

  private async createConcepts(t: Turn, task: DirectorTask, brief: Record<string, unknown>, auth?: Partial<ToolAuthContext>) {
    const created = await t.call('CreateCreativeBrief', brief, (r) => `נוצר קמפיין עם ${r.concepts.length} רעיונות`, auth);
    const recommended = created.concepts.find((c) => c.recommended) ?? created.concepts[0];
    t.save({ ...task, status: 'WAITING_CHOICE', refs: { ...task.refs, campaignId: created.campaignId } });
    t.state.awaiting = {
      kind: 'CONCEPT',
      taskId: task.id,
      campaignId: created.campaignId,
      conceptIds: created.concepts.map((c) => c.id),
      ...(recommended ? { recommendedId: recommended.id } : {}),
    };
    t.state.focus = { campaignId: created.campaignId };
    t.cards.push({ kind: 'CONCEPTS', campaignId: created.campaignId, concepts: created.concepts.slice(0, 6) });
    const idx = recommended ? created.concepts.indexOf(recommended) + 1 : 1;
    t.say(`הכנתי ${created.concepts.length} רעיונות. אני ממליץ על רעיון ${idx}${recommended ? ` ("${recommended.title}")` : ''}. איזה לבחור?`);
    t.note(`נוצרו רעיונות לקמפיין ${created.campaignId.slice(0, 8)}`);
  }

  private async chooseConcept(t: Turn, awaiting: Extract<DirectorConversationState['awaiting'], { kind: 'CONCEPT' }>, choice: number | 'RECOMMENDED') {
    const task = t.task(awaiting.taskId);
    const conceptId = choice === 'RECOMMENDED' ? (awaiting.recommendedId ?? awaiting.conceptIds[0]) : awaiting.conceptIds[choice - 1];
    if (!task || !conceptId) {
      t.say(`יש ${awaiting.conceptIds.length} רעיונות; בחר מספר ביניהם.`);
      return;
    }
    const sb = await t.call('RequestStoryboard', { campaignId: awaiting.campaignId, conceptId }, (r) => `תסריט: ${r.title}`);
    const next = { ...task, status: 'WAITING_APPROVAL' as const, refs: { ...task.refs, campaignId: awaiting.campaignId, conceptId, projectId: sb.projectId } };
    t.save(next);
    t.state.awaiting = undefined;
    t.state.focus = { campaignId: awaiting.campaignId, projectId: sb.projectId };
    await t.requestApproval(next, 'SCRIPT', `אישור תסריט: ${sb.title}`.slice(0, 160), sb.script.slice(0, 10), {
      projectId: sb.projectId,
      campaignId: awaiting.campaignId,
      followUp: 'ART_DIRECTION',
    });
    t.say('הנה התסריט. אם הוא מתאים, לחץ "אישור" בכרטיס ואכין את עיצובי המודעות. אם משהו לא מתאים, כתוב לי מה לשנות.');
    t.note(`נבחר רעיון; תסריט מחכה לאישור (${sb.projectId.slice(0, 8)})`);
  }

  // ── Revisions ──

  private async startModify(t: Turn, u: Understanding, text: string) {
    const m = u.modify!;
    const task = t.newTask('MODIFY', { target: m.target, ...(m.hasContent ? { instruction: m.instruction } : {}) });
    const history = await t.loadHistory();
    const ref = resolveReference(text, history, { target: m.target, reference: m.reference, focusProjectId: t.state.focus?.projectId });
    if (ref.kind === 'NONE') {
      t.save({ ...task, status: 'CANCELLED' });
      t.say(`${ref.reason} רוצה שנכין קמפיין חדש?`);
      return;
    }
    if (ref.kind === 'AMBIGUOUS') {
      const options = ref.options.map((c) => ({ id: c.projectId!, label: campaignLabel(c) }));
      t.state.awaiting = { kind: 'CLARIFY', taskId: task.id, options };
      t.cards.push({ kind: 'CLARIFY', question: 'לאיזה מהם התכוונת?', options });
      t.say(`יש ${options.length} ${m.target === 'DIRECTION' ? 'מודעות' : 'סרטונים'} שזה יכול להתאים להם. לאיזה התכוונת?`);
      return;
    }
    const next = { ...task, status: 'RUNNING' as const, refs: { campaignId: ref.campaign.campaignId, projectId: ref.campaign.projectId! } };
    t.save(next);
    // What the owner is talking about now: the next "יותר יוקרתי" or "תשנה את הכותרת" refers to it.
    t.state.focus = { campaignId: ref.campaign.campaignId, projectId: ref.campaign.projectId! };
    return this.advance(t, next);
  }

  private clarified(t: Turn, awaiting: Extract<DirectorConversationState['awaiting'], { kind: 'CLARIFY' }>, u: Understanding, text: string) {
    const task = t.task(awaiting.taskId);
    if (!task) return undefined;
    let option = typeof u.choice === 'number' ? awaiting.options[u.choice - 1] : undefined;
    if (!option) {
      // Match by the words that tell the options apart (the business name is in all of them).
      const words = awaiting.options.map((o) => new Set(o.label.split(' ').filter((w) => w.length > 2 && !/^\(/.test(w)).map((w) => w.replace(/^ה/, ''))));
      const shared = [...words[0]!].filter((w) => words.every((set) => set.has(w)));
      const scores = words.map((set) => [...set].filter((w) => !shared.includes(w) && text.includes(w)).length);
      const best = Math.max(...scores);
      if (best > 0 && scores.filter((x) => x === best).length === 1) option = awaiting.options[scores.indexOf(best)];
    }
    if (!option) return undefined;
    return (async () => {
      const history = await t.loadHistory();
      const campaign = history.find((c) => c.projectId === option.id);
      t.state.awaiting = undefined;
      const next = { ...task, status: 'RUNNING' as const, refs: { campaignId: campaign?.campaignId, projectId: option.id } };
      t.save(next);
      t.state.focus = { campaignId: campaign?.campaignId, projectId: option.id };
      t.say(`בסדר, ${option.label}.`);
      return this.advance(t, next);
    })();
  }

  private async advanceModify(t: Turn, task: DirectorTask) {
    if (!task.refs.projectId) {
      t.say('לא הבנתי לאיזה מהם התכוונת. אפשר לכתוב את המספר.');
      return;
    }
    const projectId = task.refs.projectId;
    const target = task.params.target!;
    const title = (await t.loadHistory()).find((c) => c.projectId === projectId)?.title ?? 'הסרטון';
    if (target === 'VIDEO_OTHER') {
      t.save({ ...task, status: 'DONE' });
      t.say(`בשיחה אפשר כרגע לשנות את פתיחת הסרטון ואת עיצוב המודעות. שינויים אחרים בסרטון של "${title}" עושים בסטודיו, בעמוד הפרויקט.`);
      t.cards.push({ kind: 'STATUS', items: [{ label: title, state: 'לעריכה בסטודיו', href: `/studio/projects/${projectId}` }] });
      return;
    }
    if (target === 'VIDEO_OPENING' && !task.params.instruction) {
      t.save({ ...task, status: 'COLLECTING' });
      t.state.awaiting = { kind: 'INSTRUCTION', taskId: task.id };
      t.cards.push({ kind: 'QUESTION', keys: [], skippable: false, suggestions: ['לפתוח בתקריב של המוצר', 'לפתוח בשאלה ללקוח', 'לפתוח במבצע'] });
      t.say(`מה תרצה שיהיה בפתיחה של "${title}"? אפשר לכתוב משפט במירכאות (הוא ייאמר ויופיע על המסך כמו שכתבת), או לתאר מה רואים.`);
      return;
    }
    const pendingDirection = t.pendingFor().find((a) => a.kind === 'CREATIVE_DIRECTION' && a.payload.projectId === projectId);
    const key = (pendingDirection?.payload.key as 'A' | 'B' | 'C' | undefined) ?? (task.refs.directionKey as 'A' | 'B' | 'C' | undefined) ?? 'A';
    const r = await t.call(
      'RequestTargetedRevision',
      { projectId, target, ...(target === 'DIRECTION' ? { directionKey: key } : {}), instruction: task.params.instruction! },
      (res) => res.summary,
    );
    if (!r.applied) {
      t.save({ ...task, status: target === 'VIDEO_OPENING' ? 'COLLECTING' : 'DONE', params: { ...task.params, instruction: undefined } });
      if (target === 'VIDEO_OPENING') t.state.awaiting = { kind: 'INSTRUCTION', taskId: task.id };
      t.say([r.summary, ...(r.suggestions?.length ? [`אפשר למשל: ${r.suggestions.slice(0, 3).join(' · ')}`] : [])].join(' '));
      return;
    }
    const next = { ...task, status: 'WAITING_APPROVAL' as const, refs: { ...task.refs, ...(target === 'DIRECTION' ? { directionKey: key } : {}) } };
    t.save(next);
    t.state.focus = { campaignId: task.refs.campaignId, projectId };
    if (target === 'VIDEO_OPENING') {
      // A newer opening replaces one still waiting, and production waits for the new script.
      for (const a of t.pendingFor().filter((x) => (x.kind === 'SCRIPT' || x.kind === 'PRODUCTION') && x.payload.projectId === projectId)) {
        t.approvals = t.approvals.map((x) => (x.id === a.id ? { ...x, status: 'REJECTED' } : x));
        t.superseded.push(a.id);
      }
      await t.requestApproval(next, 'SCRIPT', `אישור פתיחה חדשה: ${title}`.slice(0, 160), [`לפני: ${r.before ?? ''}`, `אחרי: ${r.after ?? ''}`].map((s) => s.slice(0, 300)), {
        projectId,
        campaignId: task.refs.campaignId,
        followUp: 'NONE',
      });
      t.say(`${r.summary} התסריט הקודם והאישור שלו נשמרים בהיסטוריה; הגרסה החדשה צריכה אישור שלך לפני שהסרטון נבנה מחדש.`);
    } else {
      const d = r.direction!;
      t.cards.push({ kind: 'CREATIVE', projectId, title, directions: [{ key: d.key, name: d.name, method: d.method, headline: d.headline }] });
      if (pendingDirection) {
        // The revised design replaces the one still waiting; the decision on it is recorded as superseded.
        t.approvals = t.approvals.map((a) => (a.id === pendingDirection.id ? { ...a, status: 'REJECTED' } : a));
        t.superseded.push(pendingDirection.id);
      }
      await t.requestApproval(next, 'CREATIVE_DIRECTION', `אישור עיצוב: ${d.name}`.slice(0, 160), [r.summary, `כותרת: ${d.headline}`].map((s) => s.slice(0, 300)), {
        projectId,
        campaignId: task.refs.campaignId,
        key: d.key,
        direction: d.direction,
      });
      t.say(`${r.summary} עיצוב שאישרת קודם נשאר שמור; זו גרסה חדשה לאישור.`);
    }
    t.note(`שינוי ${target === 'VIDEO_OPENING' ? 'פתיחה' : 'עיצוב'} ב-${title}`);
  }

  // ── Questions about the work ──

  private async status(t: Turn) {
    const pending = t.pendingFor();
    const items = await t.call('GetProductionStatus', {}, (r) => `${r.length} פריטים`);
    t.cards.push({
      kind: 'STATUS',
      items: [...pending.map((a) => ({ label: a.title, state: 'מחכה לאישור שלך' })), ...items].slice(0, 20),
    });
    t.say(
      pending.length
        ? `${pending.length === 1 ? 'דבר אחד מחכה' : `${pending.length} דברים מחכים`} לאישור שלך: ${pending.map((a) => a.title).join('; ')}.`
        : 'אין כרגע שום דבר שמחכה לאישור שלך.',
    );
    for (const a of pending.slice(0, 3)) t.cards.push(t.approvalCard(a));
    this.remind(t);
  }

  private async historyReply(t: Turn) {
    const history = await t.loadHistory();
    if (!history.length) {
      t.say('עדיין לא הכנו פרסומות. רוצה שנתחיל?');
      return;
    }
    t.cards.push({
      kind: 'STATUS',
      items: history.slice(0, 20).map((c) => ({
        label: campaignLabel(c),
        state: [
          c.hasVideo ? (c.scriptApproved ? 'תסריט מאושר' : 'תסריט ממתין') : 'רעיונות',
          c.staticAds ? `${c.staticAds} מודעות` : '',
          c.directionApproved ? 'עיצוב מאושר' : '',
          c.renderStatus ? `סרטון: ${c.renderStatus}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
        href: c.projectId ? `/studio/projects/${c.projectId}` : `/studio/campaigns/${c.campaignId}`,
      })),
    });
    t.say(`הכנו עד עכשיו ${history.length === 1 ? 'קמפיין אחד' : `${history.length} קמפיינים`}. האחרון: ${history[0]!.title}.`);
    this.remind(t);
  }

  private async recommendReply(t: Turn, intro?: string) {
    const recs = recommend({ memory: t.memory, now: t.now, history: await t.loadHistory(), approvals: t.approvals, cost: t.ctx.cost });
    if (!recs.length) {
      t.say('ספר לי קצת על העסק ואוכל להמליץ: איך קוראים לו ומה הוא עושה?');
      return;
    }
    for (const r of recs.slice(0, 3)) t.cards.push({ kind: 'RECOMMENDATION', recommendation: r, conversion: null });
    t.say(`${intro ? `${intro} ` : ''}הייתי מתחיל ב: ${recs[0]!.title}. ${recs[0]!.reasoning}`);
  }

  private remind(t: Turn) {
    const active = t.activeTask();
    if (active?.status === 'COLLECTING' && t.state.awaiting?.kind === 'FACTS') {
      const keys = t.state.awaiting.keys;
      t.say(`ועדיין חסר לי כדי להמשיך: ${keys.map((k) => FACT_SPECS[k].label).join(', ')}.`);
    }
  }

  private approveByText(t: Turn) {
    const pending = t.pendingFor();
    if (!pending.length) {
      t.say('אין כרגע שום דבר שמחכה לאישור.');
      return;
    }
    t.say('כדי לאשר, לחץ "אישור" בכרטיס. אישור נרשם רק מהכרטיס, כך שאף הודעה או טקסט שהודבק לא יאשרו משהו בשמך.');
    for (const a of pending.slice(0, 3)) t.cards.push(t.approvalCard(a));
  }

  private async retry(t: Turn) {
    const task = t.activeTask();
    if (!task || task.status !== 'FAILED') {
      t.say('אין כרגע פעולה שנכשלה.');
      return;
    }
    if (task.refs.campaignId && !task.refs.projectId && task.kind !== 'MODIFY') {
      const { concepts } = await t.call('GenerateCreativeConcepts', { campaignId: task.refs.campaignId }, (r) => `${r.concepts.length} רעיונות`);
      t.save({ ...task, status: 'WAITING_CHOICE', error: null });
      t.state.awaiting = { kind: 'CONCEPT', taskId: task.id, campaignId: task.refs.campaignId, conceptIds: concepts.map((c) => c.id), recommendedId: concepts.find((c) => c.recommended)?.id };
      t.cards.push({ kind: 'CONCEPTS', campaignId: task.refs.campaignId, concepts: concepts.slice(0, 6) });
      t.say('ממשיכים: איזה רעיון לבחור?');
      return;
    }
    const next = { ...task, status: (task.kind === 'MODIFY' ? 'RUNNING' : 'COLLECTING') as DirectorTask['status'], error: null };
    t.save(next);
    return this.advance(t, next);
  }

  private async greet(t: Turn) {
    if (!usableText(t.memory, 'business.name', t.now)) {
      t.say('שלום! אני מנהל השיווק שלך בקמפורה. אני זוכר מה שתספר לי, שואל רק מה שחסר, ומכין איתך קמפיינים. שום דבר לא מתפרסם ושום כסף לא יוצא בלי אישור שלך.');
      return this.onboardingNext(t);
    }
    const pending = t.pendingFor();
    t.say(`שלום שוב! ${pending.length ? `${pending.length === 1 ? 'דבר אחד מחכה' : `${pending.length} דברים מחכים`} לאישור שלך.` : ''}`.trim());
    return this.recommendReply(t);
  }

  /** Without an open task: keep learning the essentials, then recommend. */
  private async onboardingNext(t: Turn) {
    const model = usable(t.memory, 'business.model', t.now);
    const missing = ONBOARDING_KEYS.filter((k) => !(k === 'location.city' && model === 'ECOMMERCE') && !['USABLE', 'DECLINED'].includes(factState(t.memory[k], t.now)));
    const proposed = missing.filter((k) => t.memory[k]?.status === 'PROPOSED');
    if (proposed.length) {
      t.state.awaiting = { kind: 'FACTS', keys: proposed };
      t.say(`הבנתי ש${proposed.map((k) => displayFact(k, t.memory[k]!.value)).join(', ')}. נכון?`);
      t.cards.push({ kind: 'QUESTION', keys: proposed.slice(0, 3), skippable: false, suggestions: ['כן', 'לא'] });
      return;
    }
    if (missing.length) {
      const asked = missing.slice(0, 2);
      t.state.awaiting = { kind: 'FACTS', keys: asked };
      t.cards.push({ kind: 'QUESTION', keys: asked, skippable: false, suggestions: asked.length === 1 ? (FACT_SPECS[asked[0]!].suggestions ?? []).slice(0, 6) : [] });
      t.say(asked.map((k) => FACT_SPECS[k].question).join(' '));
      return;
    }
    t.state.awaiting = undefined;
    return this.recommendReply(t, 'יש לי תמונה טובה של העסק.');
  }

  private async continueOrFallback(t: Turn, u: Understanding) {
    const active = t.activeTask();
    if (active && active.status === 'COLLECTING') return this.advance(t, active);
    if (active && active.status === 'WAITING_CHOICE') {
      t.say('איזה מהרעיונות לבחור? אפשר לכתוב 1, 2 או 3, או "מה שאתה ממליץ".');
      return;
    }
    if (u.yes && t.pendingFor().length) return this.approveByText(t);
    // "כן" / "יאללה" after a recommendation: go ahead with the recommended campaign.
    if (u.yes && !active && usable(t.memory, 'business.model', t.now)) return this.startCampaign(t, 'CAMPAIGN', u);
    if (t.changedFacts.length || t.state.awaiting?.kind === 'FACTS' || !usableText(t.memory, 'business.name', t.now)) return this.onboardingNext(t);
    t.say('לא בטוח שהבנתי. אפשר לבקש למשל: "בוא נכין קמפיין", "יש לנו מבצע", "מה נשאר לאישור?" או "איזה פרסומות כבר הכנו?".');
  }

  // ── Approvals ──

  /** The owner's explicit decision on one approval (from the approvals endpoint only). Runs the approved action once. */
  async decideApproval(approvalId: string, decision: 'APPROVED' | 'REJECTED', ctx: DirectorContext): Promise<DecisionResult> {
    const t = new Turn(ctx, this.ports);
    const approval = t.approvals.find((a) => a.id === approvalId);
    if (!approval) throw new DirectorToolError('האישור לא נמצא', 'APPROVAL_NOT_FOUND');
    if (approval.status !== 'PENDING') {
      t.say('ההחלטה על זה כבר נרשמה.');
      return { ...t.result(), approvalStatus: approval.status, approvalError: null };
    }
    const task = t.task(approval.taskId);
    if (decision === 'REJECTED') {
      t.say(
        approval.kind === 'SCRIPT'
          ? 'בסדר, לא אישרת את התסריט. אפשר לכתוב מה לשנות (למשל "תשנה את הפתיחה") או לבחור רעיון אחר.'
          : 'בסדר, לא אישרת. כתוב לי מה לשנות.',
      );
      if (task && approval.kind === 'PRODUCTION') t.save({ ...task, status: 'DONE' });
      return { ...t.result(), approvalStatus: 'REJECTED', approvalError: null };
    }
    const approved = { ...approval, status: 'APPROVED' as const };
    const auth = { source: 'APPROVAL' as const, approval: approved };
    const projectId = approval.payload.projectId as string | undefined;
    try {
      switch (approval.kind) {
        case 'SCRIPT': {
          await this.ports.actions.approveScript(projectId!);
          if (approval.payload.followUp === 'ART_DIRECTION') {
            const { directions } = await t.call('RequestArtDirection', { projectId }, (r) => `${r.directions.length} כיווני עיצוב`, auth);
            const first = directions[0];
            t.cards.push({ kind: 'CREATIVE', projectId: projectId!, title: approval.title.replace(/^אישור תסריט: /, ''), directions: directions.map(({ key, name, method, headline }) => ({ key, name, method, headline })) });
            if (first && task) {
              await t.requestApproval(task, 'CREATIVE_DIRECTION', `אישור עיצוב: ${first.name}`.slice(0, 160), [`כותרת: ${first.headline}`, 'מודעות 1:1, 4:5 ו-9:16', 'שני כיוונים נוספים זמינים בסטודיו'], {
                projectId,
                campaignId: approval.payload.campaignId,
                key: first.key,
                direction: first.direction,
              });
            }
            t.say(`התסריט אושר. הכנתי ${directions.length} כיווני עיצוב למודעות; אני ממליץ על ${first ? `"${first.name}"` : 'הראשון'}. אשר אותו בכרטיס, או כתוב מה לשנות (למשל "יותר יוקרתי").`);
          } else {
            t.say('הפתיחה החדשה אושרה. כשתאשר הפקה, הסרטון ייבנה מחדש איתה.');
            if (task) await this.requestProduction(t, task, projectId!);
          }
          break;
        }
        case 'CREATIVE_DIRECTION': {
          const key = approval.payload.key as 'A' | 'B' | 'C';
          const r = await this.ports.actions.approveDirection(projectId!, key, approval.payload.direction);
          t.say(`העיצוב אושר ונשמרו גרסאות ל-${r.formats.join(', ')}. המודעות נשלחו לרינדור.`);
          if (task) await this.requestProduction(t, task, projectId!);
          break;
        }
        case 'PRODUCTION': {
          const r = await t.call('RequestProduction', { projectId }, (res) => res.detail, auth);
          t.say(r.detail);
          if (task) t.save({ ...task, status: 'DONE' });
          break;
        }
        case 'PAID_GENERATION': {
          if (!task) throw new DirectorToolError('המשימה לא נמצאה', 'TASK_NOT_FOUND');
          await this.createConcepts(t, task, { ...(approval.payload.brief as Record<string, unknown>), approvedUsd: approval.estimatedUsd }, auth);
          break;
        }
        default:
          t.say('פרסום ותקציב מודעות אינם זמינים בגרסה הזו. לא בוצע דבר.');
          return { ...t.result(), approvalStatus: 'FAILED', approvalError: 'NOT_AVAILABLE' };
      }
    } catch (error) {
      const message = error instanceof StepStop ? error.userMessage : error instanceof DirectorToolError ? error.userMessage : 'תקלה פנימית';
      t.say(`האישור נרשם, אבל הפעולה לא הושלמה: ${message}. שום דבר לא חויב.`);
      return { ...t.result(), approvalStatus: 'FAILED', approvalError: message };
    }
    return { ...t.result(), approvalStatus: 'EXECUTED', approvalError: null };
  }

  private async requestProduction(t: Turn, task: DirectorTask, projectId: string) {
    await t.requestApproval(task, 'PRODUCTION', 'הפקת סרטון תצוגה מקדימה', ['סרטון 9:16 לפי התסריט שאושר', 'הפקה מקומית, ללא עלות', 'קריינות ותמונות בתשלום כבויות', 'שום דבר לא מתפרסם'], { projectId });
  }
}

export { offerLine };
