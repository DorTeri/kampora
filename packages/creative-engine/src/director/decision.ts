import {
  CONVERSION_RATE,
  MARKETING_SKILLS,
  PAID_ADS_ECONOMICS,
  skillTag,
  skillsFor,
  type MarketingSignal,
  type MarketingSkill,
  type PaidInPlay,
  type SkillPlay,
} from '@kampora/agent-expertise';
import type {
  BusinessModel,
  DecisionNext,
  DirectorCampaignSummary,
  FactKey,
  MarketingAction,
  MarketingDecision,
  MarketingObjective,
  PaidVerdict,
} from '@kampora/shared';
import { SITUATION_KEYS, factState, usable, usableText, type Memory } from './facts';
import { destinationRequirement } from './requirements';
import { ACTION_LABELS, OBJECTIVE_LABELS, displayFact, planConversion } from './strategy';

/**
 * The Marketing Decision Engine: what this business should do next, and whether paid ads make sense now. It reads
 * the confirmed memory (the owner's words), the campaign history, the marketing skills and, when an LLM brain is on,
 * the model's own suggestion. The skills decide: their contraindications say when paid ads waste money, their
 * responses say what to do instead, and their plays give the steps, checklist, question and measurement.
 *
 * Paid ads are neither the default answer nor forbidden. They are recommended when customers can complete the
 * purchase, the business has room for them and there is money to spend; a stated blocker, a full calendar, no budget
 * or nowhere to send customers each comes first. The model may change the decision only with the owner's words as
 * evidence, and never past a contraindication; the owner may still choose to advertise after hearing why not.
 */

export const DECISION_VERSION = 'decision@2.1.0';

export const MARKETING_ACTION_LABELS: Record<MarketingAction, string> = {
  PAID_ADVERTISING: 'פרסום ממומן',
  ORGANIC_CONTENT: 'תוכן אורגני',
  CONVERSION_PROCESS_FIX: 'לתקן את הדרך לקנות',
  LOCAL_VISIBILITY: 'נראות מקומית',
  CUSTOMER_RETENTION: 'לקוחות חוזרים',
  BRAND_AWARENESS: 'היכרות עם העסק',
  OFFER_OPTIMIZATION: 'מחיר והצעה',
  BUSINESS_RESEARCH: 'לברר עוד פרט',
  DEFER_SPENDING: 'לחכות עם הוצאות',
  COMBINED_STRATEGY: 'כמה צעדים לפי הסדר',
};

const TITLES: Record<MarketingAction, string> = {
  PAID_ADVERTISING: 'פרסום ממומן קטן ומדוד',
  ORGANIC_CONTENT: 'תוכן אורגני בערוצים שלכם',
  CONVERSION_PROCESS_FIX: 'קודם לתקן את הדרך שבה לקוחות קונים',
  LOCAL_VISIBILITY: 'שיוכלו למצוא אתכם באזור',
  CUSTOMER_RETENTION: 'להחזיר לקוחות קיימים',
  BRAND_AWARENESS: 'להכיר את העסק לקהל חדש',
  OFFER_OPTIMIZATION: 'מחיר והצעה, לא עוד חשיפה',
  BUSINESS_RESEARCH: 'לברר פרט אחד לפני שמחליטים',
  DEFER_SPENDING: 'לחכות עם הוצאות',
  COMBINED_STRATEGY: 'כמה צעדים, לפי הסדר',
};

/** The model's suggestion, already checked by the brain: `evidence` quotes the owner. */
export interface DecisionHint {
  action: MarketingAction;
  /** What stops customers, in the owner's words (quoted). */
  blocker?: string;
  evidence: string;
  paidAds: 'YES' | 'NO' | 'UNCLEAR';
}

export interface DecisionInput {
  model: BusinessModel;
  objective: MarketingObjective;
  memory: Memory;
  now: Date;
  /** ADVICE: the owner asked what to do. CAMPAIGN: the owner asked for a campaign, so paid is the plan unless something argues against it. */
  request: 'ADVICE' | 'CAMPAIGN';
  product?: string;
  launch?: boolean;
  history?: readonly DirectorCampaignSummary[];
  /** The owner chose paid ads after hearing why not now. */
  ownerChoice?: boolean;
  hint?: DecisionHint;
}

/** Situations that come before buying reach, in the order they are dealt with. */
const HARD: readonly MarketingSignal[] = ['CONVERSION_BLOCKER', 'TRAFFIC_NO_SALES', 'FULL_CAPACITY', 'NO_BUDGET', 'NO_DESTINATION', 'LOW_ENGAGEMENT', 'LOW_REACH', 'UNDERPERFORMED', 'RETENTION_GOAL'];
/** Preferences: an owner who asked for a campaign gets one unless a hard situation argues against it. */
const SOFT: Record<DecisionInput['request'], readonly MarketingSignal[]> = {
  ADVICE: ['LAUNCH', 'ROOM_AVAILABLE', 'AWARENESS_GOAL', 'DESTINATION_READY'],
  CAMPAIGN: ['LAUNCH', 'ROOM_AVAILABLE', 'DESTINATION_READY'],
};

const PHONE_PROBLEM = /טלפון|שיחות|לא עונ|שיענה|שעונה|להחזיר שיחות/;
const TRAFFIC_NO_SALES = /(צפיות|לייקים|כניסות|קליקים|לחיצות|תנועה|מבקרים|חשיפה)[^.]{0,40}(אין|לא|כמעט|מעט|בקושי|אפס)|(לא|כמעט לא|אף אחד לא|אף אחד) (קונים|קנו|קנה|מזמינים|הזמינו|הזמין|נרשמים|נרשמו|נרשם)/;
/** What an earlier campaign did: seen but ignored, seen by few, or just "did not work" (where it stalled unknown). */
const LOW_ENGAGEMENT = /(ראו|צפו|צפיות|חשיפות|חשיפה)[^.]{0,30}(לא|כמעט לא|מעט|בקושי) (לחצו|לחץ|לחצה|הגיבו|הגיב|נכנסו|נכנס|פנו|פנה)|(מעט|כמעט אין|אין|בלי) (לחיצות|קליקים|תגובות)/;
const LOW_REACH = /(מעט|כמעט לא|לא הרבה|רק מעט) (אנשים )?(ראו|צפו)|(מעט|כמעט אין|לא הרבה) (חשיפות|צפיות)|חשיפה נמוכה|כמעט לא הגיע לאנשים/;
const UNDERPERFORMED = /לא (הביא|הביאה|עבד|עבדה|הצליח|הצליחה|עשה|עשתה)|לא היו (תוצאות|הזמנות|פניות|לקוחות)|(הביא|הביאה|היו) (?:ממש |בקושי |רק )?(מעט|כמעט|מעט מאוד)|חלש|בזבוז|לא שווה|מאכזב|מאכזבת|לא הגיעו|כמעט לא הגיעו|כישלון/;
const OWN_CHANNEL_ACTIONS: readonly MarketingAction[] = ['ORGANIC_CONTENT', 'LOCAL_VISIBILITY', 'BRAND_AWARENESS', 'CUSTOMER_RETENTION'];

interface Situation {
  signals: MarketingSignal[];
  problem?: string;
  performance?: string;
  budget?: number;
  destination: { ready: boolean; label: string; text: string; why: string; needs?: FactKey; action?: string };
  /** The phone is the problem, but customers can order without it (an ordering link). */
  bypass: boolean;
}

function situation(input: DecisionInput): Situation {
  const { model, objective, memory, now } = input;
  const conv = planConversion(model, objective, memory, now);
  const plan = conv.plan;
  const problem = usableText(memory, 'conversion.problem', now);
  const performance = usableText(memory, 'performance.notes', now);
  const budget = usable(memory, 'budget.monthlyIls', now) as number | undefined;
  const signals: MarketingSignal[] = [];
  const bypass = Boolean(problem && plan?.exists && PHONE_PROBLEM.test(problem) && plan.action !== 'PHONE_CALL');
  if (problem && !bypass) signals.push('CONVERSION_BLOCKER');
  if (performance && TRAFFIC_NO_SALES.test(performance)) signals.push('TRAFFIC_NO_SALES');
  else if (performance && LOW_ENGAGEMENT.test(performance)) signals.push('LOW_ENGAGEMENT');
  else if (performance && LOW_REACH.test(performance)) signals.push('LOW_REACH');
  else if (performance && UNDERPERFORMED.test(performance)) signals.push('UNDERPERFORMED');
  if (usable(memory, 'capacity.full', now) === true) signals.push('FULL_CAPACITY');
  if (factState(memory['capacity.full'], now) === 'DECLINED') signals.push('ROOM_AVAILABLE');
  if (budget === 0) signals.push('NO_BUDGET');
  if (typeof budget === 'number' && budget > 0) signals.push('BUDGET_SET');
  if (plan && !plan.exists) signals.push('NO_DESTINATION');
  if (plan?.exists) signals.push('DESTINATION_READY');
  if (objective === 'RETENTION') signals.push('RETENTION_GOAL');
  if (objective === 'LOCAL_AWARENESS' || objective === 'BRAND') signals.push('AWARENESS_GOAL');
  if (input.launch || objective === 'PRODUCT_LAUNCH') signals.push('LAUNCH');
  if (input.history?.length) signals.push('RETURNING');
  const text = plan?.exists ? (plan.destination ? `${ACTION_LABELS[plan.action]} (${plan.destination})` : ACTION_LABELS[plan.action]) : '';
  return {
    signals,
    problem,
    performance,
    budget,
    bypass,
    destination: plan
      ? { ready: plan.exists, label: plan.exists ? text : `אין עדיין יעד ל${ACTION_LABELS[plan.action]}`, text, why: plan.why, action: plan.action }
      : { ready: false, label: 'עוד לא ברור לאן לשלוח לקוחות', text: '', why: 'צריך לדעת איך לקוחות קונים או יוצרים קשר היום.', needs: conv.needs },
  };
}

interface Chosen {
  rule: string;
  action: MarketingAction;
  why: string;
  paid: PaidInPlay;
  play: SkillPlay;
  skill: MarketingSkill;
}

/** The first skill (most specific first) that answers this signal. */
function respond(skills: readonly MarketingSkill[], signal: MarketingSignal): Chosen | undefined {
  // The business's own skills first; a general skill answers a situation that business has no answer for.
  for (const skill of [...skills, ...MARKETING_SKILLS.filter((k) => !k.models && !skills.includes(k))]) {
    const r = skill.responses.find((x) => x.signal === signal);
    if (r) return { rule: signal, action: r.action, why: r.why, paid: r.paid, play: r.play, skill };
  }
  return undefined;
}

/** A play for an action another rule (or the model) chose: this business's skills first, then the general ones. */
function playFor(skills: readonly MarketingSkill[], action: MarketingAction): { play: SkillPlay; skill: MarketingSkill } | undefined {
  // General skills (retention, organic, local awareness, conversion) cover any business.
  for (const skill of [...skills, ...MARKETING_SKILLS.filter((k) => !k.models && !skills.includes(k))]) {
    // A skill may hold the play only in its response ("לקוחות חוזרים"); paid keeps its own fallback below.
    const play = skill.plays[action] ?? (action === 'PAID_ADVERTISING' ? undefined : skill.responses.find((r) => r.action === action)?.play);
    if (play) return { play, skill };
  }
  if (action === 'PAID_ADVERTISING') {
    const r = PAID_ADS_ECONOMICS.responses.find((x) => x.signal === 'DESTINATION_READY')!;
    return { play: r.play, skill: PAID_ADS_ECONOMICS };
  }
  return undefined;
}

export function decideMarketing(input: DecisionInput): MarketingDecision {
  const { model, objective, memory, now } = input;
  const s = situation(input);
  const skills = skillsFor({ model, objective, signals: s.signals });
  const contras = skills.flatMap((k) => k.contraindications.filter((c) => c.avoid === 'PAID_ADVERTISING' && s.signals.includes(c.signal)).map((c) => ({ ...c, skill: k })));
  const paidBlocked = contras.length > 0;
  const fill = (text: string) =>
    text
      .replace(/ל\{destination\}/g, s.destination.text ? `ל${s.destination.text}` : 'ליעד שתבחרו')
      .replace(/\{destination\}/g, s.destination.text || 'היעד שתבחרו')
      .replace(/\{problem\}/g, s.problem ?? s.performance ?? 'הדרך לקנות')
      .replace(/\{product\}/g, input.product ?? 'המוצר החדש');

  let modelNote: MarketingDecision['model'] = input.hint ? { action: input.hint.action, used: false, note: '' } : null;
  let chosen: Chosen | undefined;

  if (input.ownerChoice && paidBlocked) {
    const p = playFor(skills, 'PAID_ADVERTISING')!;
    chosen = { rule: 'OWNER_CHOICE', action: 'PAID_ADVERTISING', why: 'בחרת להתקדם עם פרסום ממומן למרות מה שאמרתי, וזו החלטה שלך.', paid: 'INCLUDED', play: p.play, skill: p.skill };
  }
  const hard = HARD.find((sig) => s.signals.includes(sig));
  if (!chosen && s.bypass && !hard) {
    const conversion = respond(skills, 'CONVERSION_BLOCKER') ?? respond([CONVERSION_RATE], 'CONVERSION_BLOCKER')!;
    const paid = playFor(skills, 'PAID_ADVERTISING')!;
    chosen = {
      rule: 'BLOCKER_BYPASSED',
      action: 'COMBINED_STRATEGY',
      why: `"${s.problem}" עדיין צריך תיקון, אבל יש לכם ${s.destination.text} שעובד בלי לחכות לטלפון. אז אפשר לפרסם כבר עכשיו, בתנאי שהמודעה שולחת לשם ולא לטלפון.`,
      paid: 'INCLUDED',
      play: {
        ...paid.play,
        steps: [conversion.play.steps[0]!, ...paid.play.steps.slice(0, 2)],
        checklist: conversion.play.checklist,
      },
      skill: conversion.skill,
    };
  }
  if (!chosen && hard) chosen = respond(skills, hard);
  if (chosen && modelNote) modelNote.note = 'לא נדרש: עובדה שסיפרת קבעה כאן את ההחלטה.';

  // The model's suggestion, when nothing the owner said already decided. On a campaign request it must name a blocker.
  const hint = input.hint;
  if (!chosen && hint && modelNote) {
    if (input.request === 'CAMPAIGN' && !hint.blocker && hint.action !== 'PAID_ADVERTISING') modelNote.note = 'לא שימש: ביקשת קמפיין, והמודל לא הצביע על מכשול בדברים שלך.';
    else if (hint.action === 'PAID_ADVERTISING' && !s.destination.ready) modelNote.note = 'לא שימש: עוד לא ברור לאן המודעה תשלח.';
    else {
      const p = playFor(skills, hint.action === 'COMBINED_STRATEGY' ? 'ORGANIC_CONTENT' : hint.action);
      if (!p) modelNote.note = 'לא שימש: אין לי עדיין דרך עבודה מוכחת לצעד הזה.';
      else {
        chosen = {
          rule: 'MODEL_HINT',
          action: hint.action,
          why: `${hint.blocker ? `מה שתוקע כרגע: "${hint.blocker}". ` : ''}לפי מה שסיפרת ("${hint.evidence}"), הצעד הזה ישפיע יותר מכל דבר אחר עכשיו.`,
          paid: hint.action === 'PAID_ADVERTISING' ? 'INCLUDED' : { verdict: 'LATER', why: 'הצעד הראשון לא דורש תקציב פרסום.', condition: null },
          play: p.play,
          skill: p.skill,
        };
        modelNote = { action: hint.action, used: true, note: 'ההצעה של המודל התקבלה: יש לה בסיס בדברים שלך.' };
      }
    }
  }
  if (!chosen) for (const sig of SOFT[input.request]) if (s.signals.includes(sig) && (chosen = respond(skills, sig))) break;
  // A reason that rests on a destination nobody named yet is not said: the sentence goes, the question comes instead.
  if (chosen && !s.destination.ready && chosen.why.includes('{destination}'))
    chosen = { ...chosen, why: chosen.why.split(/(?<=\.)\s+/).filter((x) => !x.includes('{destination}')).join(' ') || 'קודם צריך לדעת לאן לקוחות ימשיכו.' };
  if (!chosen) {
    // Nothing decided yet: where customers would go is the one thing to learn before any spending.
    const p = playFor(skills, 'PAID_ADVERTISING')!;
    chosen = {
      rule: 'NEEDS_DESTINATION',
      action: 'BUSINESS_RESEARCH',
      why: 'לפני שמחליטים על פרסום, צריך לדעת לאן לקוח שמתעניין ממשיך: הזמנה, הרשמה, וואטסאפ או הגעה למקום.',
      paid: { verdict: 'LATER', why: 'עוד לא ברור לאן מודעה תשלח.', condition: 'כשנדע לאן לשלוח לקוחות' },
      play: { ...p.play, steps: [{ action: 'BUSINESS_RESEARCH', text: 'לברר איך לקוחות קונים או יוצרים קשר היום' }, ...p.play.steps.slice(0, 1).map((x) => ({ ...x, when: 'אחרי שנדע' }))] },
      skill: p.skill,
    };
  }
  if (modelNote && !modelNote.used && !modelNote.note) modelNote.note = 'לא שימש: ההחלטה נשענה על כללי המקצוע ועל מה שסיפרת.';

  // ── Paid ads verdict ──
  const budgetQuestion = { key: 'budget.monthlyIls' as FactKey, question: 'יש תקציב חודשי קטן שאפשר לנסות בו פרסום? גם "אין" זו תשובה.', why: 'עם תקציב, מודעה ממוקדת תאיץ את זה; בלי תקציב, נבנה הכול על תוכן ונוכחות.' };
  const questions: MarketingDecision['questions'] = [];
  let verdict: PaidVerdict;
  let paidWhy: string;
  let condition: string | null = null;
  const paidSteps = chosen.play.steps.filter((x) => x.action === 'PAID_ADVERTISING');
  if (chosen.rule === 'OWNER_CHOICE') {
    verdict = 'OWNER_CHOICE';
    paidWhy = contras[0]!.why;
    condition = contras[0]!.until ?? null;
  } else if (paidBlocked) {
    const hardest = contras.find((c) => !c.until) ?? contras[0]!;
    verdict = hardest.until ? 'LATER' : 'NOT_NOW';
    paidWhy = hardest.why;
    condition = hardest.until ?? null;
  } else if (chosen.paid === 'IF_BUDGET') {
    if (typeof s.budget === 'number' && s.budget > 0 && s.destination.ready) [verdict, paidWhy] = ['RECOMMENDED', 'יש תקציב, אז מודעה קטנה וממוקדת תאיץ את מה שהנוכחות בונה.'];
    else if (typeof s.budget === 'number' && s.budget > 0) [verdict, paidWhy, condition] = ['LATER', 'יש תקציב, אבל עוד לא ברור לאן מודעה תשלח.', 'כשנדע לאן לשלוח לקוחות'];
    else {
      [verdict, paidWhy, condition] = ['LATER', 'הבסיס לא דורש תקציב; פרסום כאן מאיץ, לא מחליף.', 'אם יש תקציב קטן לניסיון'];
      if (s.budget === undefined) questions.push(budgetQuestion);
    }
  } else if (typeof chosen.paid === 'object') {
    verdict = chosen.paid.verdict;
    paidWhy = chosen.paid.why;
    condition = chosen.paid.condition;
  } else if (paidSteps.some((x) => !x.when) && !s.destination.ready) {
    // Paid would fit, but an ad needs somewhere to send people first.
    verdict = 'LATER';
    paidWhy = 'עוד לא ברור לאן מודעה תשלח.';
    condition = 'כשנדע לאן לשלוח לקוחות';
  } else if (paidSteps.some((x) => !x.when)) {
    verdict = 'RECOMMENDED';
    paidWhy = PAID_ADS_ECONOMICS.principles[2]!;
  } else {
    verdict = 'LATER';
    paidWhy = 'הצעד הראשון לא דורש תקציב פרסום.';
    condition = paidSteps[0]?.when ?? null;
  }

  // ── Sequence: paid steps wait for their condition, or go when paid is not for now ──
  const sequence: MarketingDecision['sequence'] = [];
  for (const x of chosen.play.steps) {
    if (x.action === 'PAID_ADVERTISING' && verdict === 'NOT_NOW') continue;
    const when = x.action === 'PAID_ADVERTISING' && verdict === 'LATER' ? (x.when ?? condition) : x.when;
    sequence.push({ action: x.action, step: fill(x.text).slice(0, 240), when: when ? fill(when).slice(0, 160) : null });
  }
  if (verdict === 'LATER' && condition && !sequence.some((x) => x.action === 'PAID_ADVERTISING') && sequence.length < 5)
    sequence.push({ action: 'PAID_ADVERTISING', step: 'פרסום ממומן קטן, ולמדוד מול השבועות שלפני', when: fill(condition).slice(0, 160) });

  // ── Questions that change the decision ──
  const q = chosen.play.question;
  // A diagnostic question about the situation itself ("where did it stall?") is asked even though a first answer exists.
  const diagnostic = Boolean(q?.key && (SITUATION_KEYS as readonly string[]).includes(q.key));
  if (q && (!q.key || diagnostic || !['USABLE', 'DECLINED'].includes(factState(memory[q.key], now)))) questions.unshift({ key: q.key, question: fill(q.text), why: q.why });
  const wantsPaid = verdict === 'RECOMMENDED' || verdict === 'OWNER_CHOICE';
  if (wantsPaid && !s.destination.ready && s.destination.needs) {
    const r = destinationRequirement(s.destination.needs, model);
    questions.unshift({ key: r.key, question: r.question, why: r.why });
  }
  if ((chosen.rule === 'NEEDS_DESTINATION' || (verdict === 'LATER' && !s.destination.ready && paidSteps.length)) && s.destination.needs && !questions.some((x) => x.key === s.destination.needs)) {
    const r = destinationRequirement(s.destination.needs, model);
    questions.unshift({ key: r.key, question: r.question, why: r.why });
  }

  // ── The workflow it leads to ──
  const first = sequence[0]?.action ?? chosen.action;
  let next: DecisionNext;
  if (wantsPaid) next = s.destination.ready ? 'PAID_CONCEPTS' : 'QUESTION';
  else if (chosen.action === 'BUSINESS_RESEARCH') next = 'QUESTION';
  else if (OWN_CHANNEL_ACTIONS.includes(chosen.action) || (chosen.action === 'COMBINED_STRATEGY' && OWN_CHANNEL_ACTIONS.includes(first))) next = 'ORGANIC_CONCEPTS';
  else if (chosen.action === 'DEFER_SPENDING') next = 'NONE';
  else next = 'CHECKLIST';

  // ── What it rests on ──
  const evidence: MarketingDecision['evidence'] = [];
  if (s.problem) evidence.push({ source: 'OWNER', text: `"${s.problem}"` });
  if (s.performance) evidence.push({ source: 'OWNER', text: `על הקמפיין הקודם: "${s.performance}"` });
  if (s.signals.includes('FULL_CAPACITY')) evidence.push({ source: 'OWNER', text: 'אמרת שאין כרגע מקום ללקוחות חדשים' });
  if (s.signals.includes('ROOM_AVAILABLE')) evidence.push({ source: 'OWNER', text: 'אמרת שיש מקום ללקוחות חדשים' });
  if (s.budget !== undefined) evidence.push({ source: 'OWNER', text: `תקציב לפרסום: ${displayFact('budget.monthlyIls', s.budget)}` });
  evidence.push({ source: 'MEMORY', text: `לאן לקוחות ממשיכים: ${s.destination.label}`.slice(0, 240) });
  evidence.push({ source: 'MEMORY', text: `מטרה: ${OBJECTIVE_LABELS[objective]}` });
  if (input.history?.[0]) evidence.push({ source: 'HISTORY', text: `קמפיין קודם: ${input.history[0].title}`.slice(0, 240) });
  if (modelNote?.used && hint) evidence.push({ source: 'MODEL', text: `"${hint.evidence}"`.slice(0, 240) });
  evidence.push({ source: 'SKILL', text: `${chosen.skill.title}: ${chosen.skill.principles[0]}`.slice(0, 240) });

  const hardRule = (HARD as readonly string[]).includes(chosen.rule) || chosen.rule === 'BLOCKER_BYPASSED';
  const confidence: MarketingDecision['confidence'] =
    model === 'OTHER' || chosen.rule === 'NEEDS_DESTINATION' ? 'LOW' : hardRule || (verdict === 'RECOMMENDED' && s.signals.includes('BUDGET_SET') && s.destination.ready) ? 'HIGH' : 'MEDIUM';
  const used = [chosen.skill, ...contras.map((c) => c.skill), PAID_ADS_ECONOMICS];
  const measurement = chosen.play;

  return {
    version: DECISION_VERSION,
    action: chosen.action,
    title: TITLES[chosen.action],
    goal: `${OBJECTIVE_LABELS[objective]}${input.product ? `: ${input.product}` : ''}`.slice(0, 200),
    blocker: (s.signals.includes('CONVERSION_BLOCKER') || s.bypass ? s.problem : (['TRAFFIC_NO_SALES', 'LOW_ENGAGEMENT', 'UNDERPERFORMED'] as const).some((x) => s.signals.includes(x)) ? s.performance : (modelNote?.used ? hint?.blocker : undefined))?.slice(0, 240) ?? null,
    why: fill(chosen.why).slice(0, 700),
    evidence: evidence.slice(0, 8),
    sequence: sequence.slice(0, 5),
    paid: { verdict, why: fill(paidWhy).slice(0, 400), condition: condition ? fill(condition).slice(0, 240) : null, blockedBy: paidBlocked ? contras[0]!.signal : null },
    destination: { ready: s.destination.ready, label: s.destination.label.slice(0, 160), why: s.destination.why.slice(0, 300) },
    checklist: (chosen.play.checklist ?? []).map(fill).slice(0, 8),
    questions: questions.slice(0, 2),
    measurement: { primaryMetric: fill(measurement.primaryMetric).slice(0, 160), secondaryMetrics: (measurement.secondaryMetrics ?? []).map(fill).slice(0, 4), method: fill(measurement.method).slice(0, 400) },
    confidence,
    rule: chosen.rule,
    skills: [...new Set(used.map(skillTag))].slice(0, 8),
    model: modelNote,
    next,
  };
}

/** The decision in a few natural sentences: what to do first and why, paid ads or not, and the next step. */
export function decisionText(d: MarketingDecision, request: DecisionInput['request']): string {
  const parts = [d.why];
  if (d.paid.verdict === 'OWNER_CHOICE') parts.push(`רק שתדע: ${d.paid.why}${d.paid.condition ? ` הייתי מחכה ${d.paid.condition}.` : ''}`);
  else if (d.paid.verdict === 'NOT_NOW') parts.push(/פרסום/.test(d.why) ? '' : `פרסום ממומן לא מתאים עכשיו: ${d.paid.why}`);
  else if (d.paid.verdict === 'LATER' && d.paid.condition) parts.push(`לפרסום ממומן נחזור ${d.paid.condition}.`);
  const first = d.sequence[0];
  if (first && d.next !== 'PAID_CONCEPTS') parts.push(`הצעד הראשון: ${first.step}.`);
  const q = d.questions[0];
  switch (d.next) {
    case 'PAID_CONCEPTS':
      if (request === 'ADVICE') parts.push('רוצה שאכין לזה רעיונות למודעה?');
      break;
    case 'ORGANIC_CONCEPTS':
      parts.push(q ? q.question : 'רוצה שאכין רעיונות לתוכן לערוצים שלכם, בלי קידום ממומן?');
      break;
    case 'CHECKLIST':
    case 'QUESTION':
      if (q) parts.push(q.question);
      else parts.push('כשזה מסודר, תגיד לי ונבנה את הצעד הבא.');
      break;
    case 'NONE':
      break;
  }
  return parts.filter(Boolean).join(' ');
}
