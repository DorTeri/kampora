import type { BusinessFact, CampaignGoal, DirectorApprovalSummary, DirectorCampaignSummary } from '@kampora/shared';
import { memoryOf, usableText } from './facts';
import { normalize } from './hebrew';
import {
  DirectorToolError,
  type ConceptSummary,
  type DirectionSummary,
  type DirectorApprovalActions,
  type DirectorToolExecutor,
  type RevisionResult,
  type StatusItem,
  type ToolArgs,
} from './tools';

/**
 * An in-memory implementation of the Director's tools, for tests and for the clearly labelled browser sandbox.
 * It makes no AI call: concepts and scripts are assembled from the owner's own words only. The real application
 * uses the API executor over the Studio services.
 */

const CTA: Record<CampaignGoal, string> = {
  SALES: 'להזמנה עכשיו',
  LEADS: 'להרשמה',
  AWARENESS: 'בואו לבקר',
  OFFER: 'לניצול המבצע',
  PRODUCT_PROMO: 'לטעום ראשונים',
};

interface SandboxCampaign {
  id: string;
  createdAt: string;
  goal: CampaignGoal;
  product: string;
  offer?: string;
  concepts: ConceptSummary[];
  projectId: string | null;
  title: string;
  script: string[];
  scriptApproved: boolean;
  directions: DirectionSummary[];
  approvedDirection?: string;
  produced: boolean;
}

export interface SandboxState {
  facts: BusinessFact[];
  campaigns: SandboxCampaign[];
  approvals: DirectorApprovalSummary[];
}

export class SandboxDirectorExecutor implements DirectorToolExecutor, DirectorApprovalActions {
  readonly kind = 'SANDBOX';
  /** Set by tests to make one tool fail once. */
  failNext?: keyof DirectorToolExecutor;

  constructor(
    readonly data: SandboxState = { facts: [], campaigns: [], approvals: [] },
    private readonly newId: () => string = () => crypto.randomUUID(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private maybeFail(tool: keyof DirectorToolExecutor) {
    if (this.failNext === tool) {
      this.failNext = undefined;
      throw new DirectorToolError('השירות לא הגיב (תקלה מדומה בבדיקה)', 'SANDBOX_FAILURE');
    }
  }

  private campaign(id: string) {
    const c = this.data.campaigns.find((x) => x.id === id);
    if (!c) throw new DirectorToolError('הקמפיין לא נמצא', 'NOT_FOUND');
    return c;
  }

  private project(id: string) {
    const c = this.data.campaigns.find((x) => x.projectId === id);
    if (!c) throw new DirectorToolError('הפרויקט לא נמצא', 'NOT_FOUND');
    return c;
  }

  async ReadBusinessProfile() {
    return { facts: this.data.facts };
  }

  async ProposeBusinessProfileUpdate(args: ToolArgs<'ProposeBusinessProfileUpdate'>) {
    this.maybeFail('ProposeBusinessProfileUpdate');
    for (const f of args.facts) {
      const i = this.data.facts.findIndex((x) => x.key === f.key);
      if (i >= 0) this.data.facts[i] = f;
      else this.data.facts.push(f);
    }
    return { saved: args.facts.length };
  }

  async GetCampaignHistory(args: ToolArgs<'GetCampaignHistory'>): Promise<DirectorCampaignSummary[]> {
    return [...this.data.campaigns]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, args.limit ?? 20)
      .map((c) => ({
        campaignId: c.id,
        projectId: c.projectId,
        title: c.title,
        product: c.product,
        goal: c.goal,
        createdAt: c.createdAt,
        hasVideo: Boolean(c.projectId),
        scriptApproved: c.scriptApproved,
        staticAds: c.directions.length ? 3 : 0,
        directionApproved: Boolean(c.approvedDirection),
        renderStatus: c.produced ? 'תצוגה מקדימה (סימולציה)' : null,
      }));
  }

  async GetAvailableAssets() {
    return { photos: 0, verified: 0, demonstration: 0 };
  }

  async CreateCreativeBrief(args: ToolArgs<'CreateCreativeBrief'>) {
    this.maybeFail('CreateCreativeBrief');
    const memory = memoryOf(this.data.facts);
    const name = usableText(memory, 'business.name', this.clock()) ?? 'העסק';
    const city = usableText(memory, 'location.city', this.clock());
    const id = this.newId();
    const concepts: ConceptSummary[] = [
      { id: this.newId(), title: 'המוצר במרכז', hook: `${args.productName} ב${name}`, recommended: !args.offer },
      ...(args.offer ? [{ id: this.newId(), title: 'המבצע', hook: args.offer, recommended: true }] : []),
      { id: this.newId(), title: 'מקומי', hook: city ? `${name}, ${city}` : name, recommended: false },
      { id: this.newId(), title: 'הקריאה לפעולה', hook: `${args.productName}: ${CTA[args.goal]}`, recommended: false },
    ].slice(0, 3);
    this.data.campaigns.push({
      id,
      createdAt: this.clock().toISOString(),
      goal: args.goal,
      product: args.productName,
      ...(args.offer ? { offer: args.offer } : {}),
      concepts,
      projectId: null,
      title: `${name} · ${args.productName}`,
      script: [],
      scriptApproved: false,
      directions: [],
      produced: false,
    });
    return { campaignId: id, concepts };
  }

  async GenerateCreativeConcepts(args: ToolArgs<'GenerateCreativeConcepts'>) {
    return { concepts: this.campaign(args.campaignId).concepts };
  }

  async RequestStoryboard(args: ToolArgs<'RequestStoryboard'>) {
    this.maybeFail('RequestStoryboard');
    const c = this.campaign(args.campaignId);
    const concept = c.concepts.find((x) => x.id === args.conceptId);
    if (!concept) throw new DirectorToolError('הרעיון לא נמצא', 'NOT_FOUND');
    if (!c.projectId) {
      c.projectId = this.newId();
      c.title = `${c.title} · ${concept.title}`;
      c.script = [concept.hook, c.product, ...(c.offer ? [c.offer] : []), CTA[c.goal]];
    }
    return { projectId: c.projectId, title: c.title, script: c.script };
  }

  async RequestArtDirection(args: ToolArgs<'RequestArtDirection'>) {
    const c = this.project(args.projectId);
    if (!c.scriptApproved) throw new DirectorToolError('התסריט עוד לא אושר', 'SCRIPT_NOT_APPROVED');
    const headline = c.script[0] ?? c.product;
    c.directions = (
      [
        ['A', 'תמונה במרכז', 'IMAGE_FIRST'],
        ['B', 'עריכה נקייה', 'EDITORIAL'],
        ['C', 'טיפוגרפיה נועזת', 'BOLD_TYPE'],
      ] as const
    ).map(([key, name, method]) => ({ key, name, method, headline, direction: { key, method, headline, sandbox: true } }));
    return { directions: c.directions };
  }

  async RequestProduction(args: ToolArgs<'RequestProduction'>) {
    const c = this.project(args.projectId);
    c.produced = true;
    return { status: 'SIMULATED', detail: 'בסביבת ההדגמה ההפקה מסומלצת: לא נוצר קובץ וידאו.' };
  }

  async GetProductionStatus(args: ToolArgs<'GetProductionStatus'>): Promise<StatusItem[]> {
    return this.data.campaigns
      .filter((c) => c.projectId && (!args.projectId || c.projectId === args.projectId))
      .map((c) => ({
        label: c.title,
        state: c.produced ? 'הופק (סימולציה)' : c.approvedDirection ? 'עיצוב מאושר' : c.scriptApproved ? 'תסריט מאושר' : 'תסריט ממתין לאישור',
      }));
  }

  async PresentCreativeForApproval(args: ToolArgs<'PresentCreativeForApproval'>) {
    const id = this.newId();
    this.data.approvals.push({
      id,
      taskId: args.taskId,
      kind: args.kind,
      title: args.title,
      details: args.details,
      status: 'PENDING',
      payload: args.payload,
      estimatedUsd: args.estimatedUsd,
      createdAt: this.clock().toISOString(),
    });
    return { approvalId: id };
  }

  async RequestTargetedRevision(args: ToolArgs<'RequestTargetedRevision'>): Promise<RevisionResult> {
    this.maybeFail('RequestTargetedRevision');
    const c = this.project(args.projectId);
    if (args.target === 'VIDEO_OPENING') {
      const quoted = normalize(args.instruction).match(/"([^"]{2,120})"/)?.[1];
      const before = c.script[0] ?? '';
      const after = quoted ?? `(פתיחה חזותית) ${args.instruction}`;
      c.script = [after, ...c.script.slice(1)];
      c.scriptApproved = false;
      return { applied: true, summary: quoted ? 'החלפתי את משפט הפתיחה.' : 'עדכנתי את מה שרואים בפתיחה.', before, after };
    }
    const base = c.directions.find((d) => d.key === (args.directionKey ?? 'A'));
    if (!base) return { applied: false, summary: 'עוד אין עיצובים לפרויקט הזה.' };
    if (!/יוקרת|אלגנט|נועז|רגוע|נקי|מחיר|כותרת|טקסט|כיוון/.test(args.instruction))
      return { applied: false, summary: 'לא זיהיתי שינוי עיצובי בבקשה.', suggestions: ['יותר יוקרתי', 'תבליט את המחיר', 'כיוון אחר'] };
    const direction: DirectionSummary = {
      ...base,
      name: `${base.name} · ${/יוקרת|אלגנט/.test(args.instruction) ? 'יוקרתי' : 'מעודכן'}`,
      method: 'EDITORIAL',
      direction: { ...(base.direction as object), revised: args.instruction },
    };
    return { applied: true, summary: 'יותר אוויר, פלטה שקטה וטיפוגרפיה מעודנת (הדגמה).', direction };
  }

  async approveScript(projectId: string) {
    this.project(projectId).scriptApproved = true;
  }

  async approveDirection(projectId: string, key: 'A' | 'B' | 'C') {
    this.project(projectId).approvedDirection = key;
    return { formats: ['1:1', '4:5', '9:16'] };
  }
}
