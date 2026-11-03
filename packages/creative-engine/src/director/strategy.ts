import type {
  BusinessModel,
  CampaignGoal,
  ConversionAction,
  ConversionPlan,
  DirectorApprovalSummary,
  DirectorCampaignSummary,
  FactKey,
  MarketingObjective,
  MetaCampaignDraft,
  Recommendation,
} from '@kampora/shared';
import { FACT_SPECS, factState, factValueText, isOffer, usable, usableText, type Memory } from './facts';

/**
 * Marketing decisions from the business memory: which customer action a campaign drives and where it sends people.
 * Destinations are only what the owner gave; when the ideal one does not exist the plan says so and offers what
 * exists. No landing page is assumed.
 */

export const OBJECTIVE_LABELS: Record<MarketingObjective, string> = {
  LOCAL_AWARENESS: 'חשיפה באזור',
  VISITS: 'הגעה אליכם',
  ORDERS: 'יותר הזמנות',
  ONLINE_SALES: 'מכירות באתר',
  LEADS: 'פניות מלקוחות',
  BOOKINGS: 'הרשמות',
  PRODUCT_LAUNCH: 'השקת מוצר',
  RETENTION: 'לקוחות חוזרים',
  BRAND: 'מיתוג',
};

export const ACTION_LABELS: Record<ConversionAction, string> = {
  WHATSAPP: 'הודעת וואטסאפ',
  WEBSITE: 'כניסה לאתר',
  PRODUCT_PAGE: 'עמוד המוצר',
  BOOKING_PAGE: 'דף ההרשמה',
  ORDERING_PAGE: 'דף ההזמנה',
  INSTAGRAM_DM: 'הודעה באינסטגרם',
  LEAD_FORM: 'טופס פרטים בתוך מטא',
  PHONE_CALL: 'שיחת טלפון',
  NAVIGATION: 'ניווט אליכם',
};

export const MODEL_LABELS: Record<BusinessModel, string> = {
  RESTAURANT: 'מסעדה',
  CAFE: 'בית קפה',
  COFFEE_CART: 'עגלת קפה',
  FITNESS_STUDIO: 'סטודיו לכושר',
  BEAUTY: 'טיפוח ויופי',
  LOCAL_SERVICE: 'שירות מקומי',
  ECOMMERCE: 'חנות אונליין',
  OTHER: 'עסק',
};

/** A fact value as the owner reads it (enums in Hebrew). */
export function displayFact(key: FactKey, value: Parameters<typeof factValueText>[0]): string {
  if (key === 'business.model' && typeof value === 'string' && value in MODEL_LABELS) return MODEL_LABELS[value as BusinessModel];
  if (key === 'goal.primary' && typeof value === 'string' && value in OBJECTIVE_LABELS) return OBJECTIVE_LABELS[value as MarketingObjective];
  if (key === 'budget.monthlyIls' && value === 0) return 'אין תקציב';
  if (key === 'capacity.full') return value === true ? 'אין כרגע מקום (היומן מלא)' : 'יש מקום';
  if (key === 'budget.monthlyIls' && typeof value === 'number') return `${value.toLocaleString('he-IL')} ₪`;
  return factValueText(value);
}

export const DEFAULT_OBJECTIVE: Record<BusinessModel, MarketingObjective> = {
  RESTAURANT: 'ORDERS',
  CAFE: 'VISITS',
  COFFEE_CART: 'LOCAL_AWARENESS',
  FITNESS_STUDIO: 'BOOKINGS',
  BEAUTY: 'BOOKINGS',
  LOCAL_SERVICE: 'LEADS',
  ECOMMERCE: 'ONLINE_SALES',
  OTHER: 'LOCAL_AWARENESS',
};

/** The objective mapped onto the Studio's existing campaign goals. */
export function goalFor(objective: MarketingObjective, promotion: boolean): CampaignGoal {
  if (promotion) return 'OFFER';
  switch (objective) {
    case 'ORDERS':
    case 'ONLINE_SALES':
      return 'SALES';
    case 'LEADS':
    case 'BOOKINGS':
      return 'LEADS';
    case 'PRODUCT_LAUNCH':
      return 'PRODUCT_PROMO';
    default:
      return 'AWARENESS';
  }
}

/** Customer actions in order of preference, per business type and objective. */
function candidates(model: BusinessModel, objective: MarketingObjective): ConversionAction[] {
  switch (model) {
    case 'RESTAURANT':
      return ['VISITS', 'LOCAL_AWARENESS', 'BRAND'].includes(objective) ? ['NAVIGATION', 'ORDERING_PAGE', 'PHONE_CALL'] : ['ORDERING_PAGE', 'PHONE_CALL', 'WHATSAPP', 'NAVIGATION'];
    case 'CAFE':
      return objective === 'ORDERS' ? ['ORDERING_PAGE', 'NAVIGATION', 'INSTAGRAM_DM'] : ['NAVIGATION', 'INSTAGRAM_DM', 'ORDERING_PAGE'];
    case 'COFFEE_CART':
      return ['NAVIGATION', 'INSTAGRAM_DM', 'WHATSAPP'];
    case 'FITNESS_STUDIO':
      return ['BOOKING_PAGE', 'WHATSAPP', 'LEAD_FORM'];
    case 'BEAUTY':
      return ['BOOKING_PAGE', 'WHATSAPP', 'PHONE_CALL'];
    case 'LOCAL_SERVICE':
      return ['PHONE_CALL', 'WHATSAPP', 'LEAD_FORM'];
    case 'ECOMMERCE':
      return ['PRODUCT_PAGE', 'WEBSITE', 'INSTAGRAM_DM'];
    default:
      return ['WHATSAPP', 'PHONE_CALL', 'WEBSITE', 'INSTAGRAM_DM'];
  }
}

const ONLINE_ORDERING = /wolt|תן ביס|משלוחה|אתר/i;

type Probe = { kind: 'HAVE'; destination: string | null } | { kind: 'NO' } | { kind: 'ASK'; key: FactKey };

/** Whether the destination of one action exists, does not exist, or must be asked. */
function probe(action: ConversionAction, model: BusinessModel, memory: Memory, now: Date): Probe {
  const look = (key: FactKey): Probe => {
    const state = factState(memory[key], now);
    if (state === 'USABLE') return { kind: 'HAVE', destination: factValueText(memory[key]!.value) };
    if (state === 'DECLINED' || state === 'REJECTED') return { kind: 'NO' };
    return { kind: 'ASK', key };
  };
  switch (action) {
    case 'WHATSAPP':
      return look('contact.whatsapp');
    case 'WEBSITE':
    case 'PRODUCT_PAGE':
      return look('channel.website');
    case 'BOOKING_PAGE':
      return look('conversion.bookingUrl');
    case 'INSTAGRAM_DM':
      return look('channel.instagram');
    case 'PHONE_CALL':
      return look('contact.phone');
    case 'LEAD_FORM':
      // Built inside Meta when a campaign is published: nothing to invent and no website needed.
      return { kind: 'HAVE', destination: null };
    case 'NAVIGATION':
      return model === 'COFFEE_CART' ? look('location.serviceArea') : look('location.address');
    case 'ORDERING_PAGE': {
      // An ordering link the owner gave is the answer, whatever "how do customers order" says.
      if (factState(memory['conversion.orderUrl'], now) === 'USABLE') return look('conversion.orderUrl');
      const ordering = factState(memory['conversion.ordering'], now);
      if (ordering === 'DECLINED' || ordering === 'REJECTED') return { kind: 'NO' };
      if (ordering !== 'USABLE') return { kind: 'ASK', key: 'conversion.ordering' };
      const how = factValueText(memory['conversion.ordering']!.value);
      if (!ONLINE_ORDERING.test(how)) return { kind: 'NO' };
      return look('conversion.orderUrl');
    }
  }
}

function why(action: ConversionAction, memory: Memory, now: Date): string {
  const ordering = usableText(memory, 'conversion.ordering', now);
  switch (action) {
    case 'ORDERING_PAGE':
      return `ההזמנות שלכם עוברות דרך ${ordering ?? 'דף ההזמנה'}, אז המודעה שולחת ישר לשם, בלי דף נחיתה באמצע.`;
    case 'NAVIGATION':
      return 'המטרה היא שיגיעו פיזית; ניווט בלחיצה הוא הצעד הקצר ביותר.';
    case 'BOOKING_PAGE':
      return 'הרשמה היא הפעולה שאתם רוצים, וקישור ההרשמה הקיים מספיק. לא צריך דף נחיתה חדש.';
    case 'WHATSAPP':
      return 'הודעת וואטסאפ מתאימה לשאלות לפני שמחליטים, והיא כבר קיימת אצלכם.';
    case 'PHONE_CALL':
      return 'שיחה היא הדרך המהירה לסגור עבודה או הזמנה.';
    case 'INSTAGRAM_DM':
      return 'באינסטגרם הלקוחות כבר עוקבים אחריכם; הודעה ישירה שם טבעית להם.';
    case 'PRODUCT_PAGE':
    case 'WEBSITE':
      return 'באתר הלקוח יכול לקנות מיד.';
    case 'LEAD_FORM':
      return 'טופס פרטים בתוך מטא: הלקוח משאיר פרטים בלי לצאת מהאפליקציה, ולא צריך אתר.';
  }
}

export interface ConversionDecision {
  plan?: ConversionPlan;
  /** The fact to ask for before the destination can be decided. */
  needs?: FactKey;
}

export function planConversion(model: BusinessModel, objective: MarketingObjective, memory: Memory, now: Date): ConversionDecision {
  const list = candidates(model, objective);
  const found: { action: ConversionAction; destination: string | null }[] = [];
  let firstAsk: FactKey | undefined;
  let declinedSoFar = true;
  for (const action of list) {
    const p = probe(action, model, memory, now);
    // The preferred action is worth a question (and so is the next one when the owner said the preferred one does
    // not exist, e.g. "נרשמים בוואטסאפ"); for the others, something that already exists is enough.
    if (p.kind === 'ASK' && declinedSoFar && !found.length) return { needs: p.key };
    if (p.kind === 'ASK') firstAsk ??= p.key;
    if (p.kind === 'HAVE') found.push({ action, destination: p.destination });
    if (p.kind !== 'NO') declinedSoFar = false;
  }
  if (!found.length && firstAsk) return { needs: firstAsk };
  const [best, next] = found;
  if (!best) {
    const ideal = list[0]!;
    return {
      plan: {
        action: ideal,
        destination: null,
        exists: false,
        why: `ל${ACTION_LABELS[ideal]} אין עדיין יעד. לפני שמשקיעים בפרסום כדאי שיהיה לאן לשלוח את הלקוחות.`,
      },
    };
  }
  return {
    plan: {
      action: best.action,
      destination: best.destination,
      exists: true,
      why: why(best.action, memory, now),
      ...(next ? { alternative: { action: next.action, destination: next.destination, why: why(next.action, memory, now) } } : {}),
    },
  };
}

const RADIUS_KM: Record<BusinessModel, number | null> = {
  RESTAURANT: 5,
  CAFE: 3,
  COFFEE_CART: 3,
  FITNESS_STUDIO: 5,
  BEAUTY: 6,
  LOCAL_SERVICE: 15,
  ECOMMERCE: null,
  OTHER: 10,
};

/** Settings for a future Meta campaign. Status is always DRAFT_NOT_PUBLISHED: nothing is sent to Meta. */
export function metaDraft(model: BusinessModel, objective: MarketingObjective, conversion: ConversionPlan, memory: Memory, now: Date): MetaCampaignDraft {
  const destinationType: MetaCampaignDraft['destinationType'] = !conversion.exists
    ? 'NONE'
    : (({
        WHATSAPP: 'WHATSAPP',
        INSTAGRAM_DM: 'INSTAGRAM_DIRECT',
        PHONE_CALL: 'PHONE_CALL',
        LEAD_FORM: 'ON_AD',
        NAVIGATION: 'NONE',
        WEBSITE: 'WEBSITE',
        PRODUCT_PAGE: 'WEBSITE',
        BOOKING_PAGE: 'WEBSITE',
        ORDERING_PAGE: 'WEBSITE',
      }) as const)[conversion.action];
  const metaObjective: MetaCampaignDraft['objective'] =
    objective === 'LEADS' || objective === 'BOOKINGS'
      ? 'OUTCOME_LEADS'
      : objective === 'ORDERS' || objective === 'ONLINE_SALES'
        ? destinationType === 'WEBSITE'
          ? 'OUTCOME_SALES'
          : destinationType === 'WHATSAPP' || destinationType === 'INSTAGRAM_DIRECT'
            ? 'OUTCOME_ENGAGEMENT'
            : 'OUTCOME_TRAFFIC'
        : objective === 'RETENTION'
          ? 'OUTCOME_ENGAGEMENT'
          : 'OUTCOME_AWARENESS';
  // A region ("השרון") targets wider than a city.
  const region = usableText(memory, 'location.region', now);
  const city = usableText(memory, 'location.city', now) ?? region;
  const radius = RADIUS_KM[model] && !usableText(memory, 'location.city', now) && region ? Math.max(RADIUS_KM[model]!, 20) : RADIUS_KM[model];
  const monthly = usable(memory, 'budget.monthlyIls', now);
  return {
    objective: metaObjective,
    destinationType,
    destination: conversion.destination,
    geo: city && radius ? { city, radiusKm: radius } : null,
    placements: ['FEED', 'STORIES', 'REELS'],
    dailyBudgetIls: typeof monthly === 'number' && monthly > 0 ? Math.round((monthly / 30) * 10) / 10 : null,
    status: 'DRAFT_NOT_PUBLISHED',
  };
}

export interface CostContext {
  /** Estimated USD of the creative steps (concepts, storyboard) with the configured provider. */
  creativeUsd: number;
  providerPaid: boolean;
}

export function costNote(cost: CostContext): string {
  const creative = cost.providerPaid
    ? `הכנת רעיונות ותסריט: עד $${cost.creativeUsd.toFixed(2)} (דורש את אישורך לפני שמתחילים).`
    : 'הכנת רעיונות, תסריט ועיצוב: $0 (ספק מדומה, ללא חיוב).';
  return `${creative} הפקה מקומית של הסרטון: $0. תמונות AI וקריינות בתשלום כבויות ויבקשו אישור נפרד. פרסום במטא אינו חלק מהגרסה הזו.`;
}

/** Facts the Director relied on, as the owner would say them. */
export function informationUsed(memory: Memory, now: Date, keys: FactKey[]): string[] {
  return keys.flatMap((k) => {
    const v = usable(memory, k, now);
    return v === undefined ? [] : [`${FACT_SPECS[k].label}: ${displayFact(k, v)}`];
  });
}

export interface StrategyInput {
  model: BusinessModel;
  objective: MarketingObjective;
  product: string;
  promotion: boolean;
  window?: string;
  memory: Memory;
  now: Date;
  cost: CostContext;
}

export interface CampaignStrategy {
  recommendation: Recommendation;
  conversion: ConversionPlan;
  meta: MetaCampaignDraft;
  goal: CampaignGoal;
}

/** The campaign the Director proposes once nothing essential is missing. */
export function proposeCampaign(input: StrategyInput): CampaignStrategy | { needs: FactKey } {
  const { model, objective, memory, now } = input;
  const decision = planConversion(model, objective, memory, now);
  if (!decision.plan) return { needs: decision.needs! };
  const conversion = decision.plan;
  const goal = goalFor(objective, input.promotion);
  const offer = usable(memory, 'offer.current', now);
  const photos = usable(memory, 'media.realPhotos', now);
  const missing: string[] = [];
  if (photos !== true) missing.push('תמונות אמיתיות: בלעדיהן נשתמש בעיצוב טיפוגרפי או בתמונות המחשה מסומנות, לא כאילו הן המוצר שלך');
  if (!conversion.exists) missing.push(`יעד ל${ACTION_LABELS[conversion.action]}`);
  const reasoning = [
    `המטרה: ${OBJECTIVE_LABELS[objective]}.`,
    `הלקוח יגיע ל${ACTION_LABELS[conversion.action]}${conversion.destination ? ` (${conversion.destination})` : ''}: ${conversion.why}`,
    input.promotion && isOffer(offer) ? `המבצע מאושר ובתוקף${offer.validUntil ? ' עד התאריך שציינת' : ''}, אז הוא מופיע במודעה כמו שאמרת אותו.` : '',
    input.window ? `לוח זמנים: ${input.window}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const recommendation: Recommendation = {
    id: `${input.promotion ? 'promotion' : objective.toLowerCase()}-${now.getTime().toString(36)}`,
    kind: input.promotion ? 'PROMOTION' : 'CAMPAIGN',
    title: input.promotion ? `קמפיין מבצע: ${input.product}` : `קמפיין ${OBJECTIVE_LABELS[objective]}: ${input.product}`,
    objective,
    reasoning,
    informationUsed: informationUsed(memory, now, [
      'business.name',
      'business.category',
      'location.city',
      'offering.main',
      ...(input.promotion ? (['offer.current'] as FactKey[]) : []),
      'conversion.ordering',
    ]),
    missingInformation: missing,
    proposedAction: 'להכין 3 רעיונות קריאייטיב, לבחור אחד, לאשר תסריט ועיצוב. שום דבר לא מתפרסם.',
    estimatedCostUsd: input.cost.providerPaid ? input.cost.creativeUsd : 0,
    costNote: costNote(input.cost),
    approvalRequired: true,
  };
  return { recommendation, conversion, meta: metaDraft(model, objective, conversion, memory, now), goal };
}

export interface RecommendInput {
  memory: Memory;
  now: Date;
  history: DirectorCampaignSummary[];
  approvals: DirectorApprovalSummary[];
  cost: CostContext;
}

/** What the Director suggests doing next, from what it knows. No growth or ROI is promised. */
export function recommend(input: RecommendInput): Recommendation[] {
  const { memory, now } = input;
  const model = usable(memory, 'business.model', now) as BusinessModel | undefined;
  const product = usableText(memory, 'offering.main', now);
  const recs: Recommendation[] = [];
  const base = { estimatedCostUsd: null, costNote: 'לא כרוך בהוצאה.', approvalRequired: false };
  const pending = input.approvals.filter((a) => a.status === 'PENDING');
  if (pending.length)
    recs.push({
      ...base,
      id: 'wait-approvals',
      kind: 'WAIT',
      title: `${pending.length === 1 ? 'דבר אחד מחכה' : `${pending.length} דברים מחכים`} לאישור שלך`,
      objective: 'BRAND',
      reasoning: 'כדאי לסיים את מה שכבר הוכן לפני שמתחילים משהו חדש.',
      informationUsed: pending.map((p) => p.title),
      missingInformation: [],
      proposedAction: 'לעבור על הכרטיסים ולאשר או לבקש שינוי.',
      approvalRequired: true,
    });
  if (!model) return recs;
  const objective = (usable(memory, 'goal.primary', now) as MarketingObjective | undefined) ?? DEFAULT_OBJECTIVE[model];
  const offerFact = memory['offer.current'];
  const offerState = factState(offerFact, now);
  if (offerState === 'USABLE' && isOffer(offerFact!.value))
    recs.push({
      ...base,
      id: 'promotion-current',
      kind: 'PROMOTION',
      title: `לקדם את המבצע: ${offerFact!.value.text}`,
      objective: 'ORDERS',
      reasoning: 'יש מבצע מאושר ובתוקף; מבצע עם תאריך סיום נותן ללקוחות סיבה לפעול עכשיו.',
      informationUsed: informationUsed(memory, now, ['offer.current']),
      missingInformation: [],
      proposedAction: 'להכין קמפיין מבצע.',
      estimatedCostUsd: input.cost.providerPaid ? input.cost.creativeUsd : 0,
      costNote: costNote(input.cost),
      approvalRequired: true,
    });
  else if ((offerState === 'EXPIRED' || offerState === 'STALE') && isOffer(offerFact!.value))
    recs.push({
      ...base,
      id: 'offer-check',
      kind: 'PROMOTION',
      title: 'לבדוק אם המבצע עדיין רץ',
      objective: 'ORDERS',
      reasoning: offerState === 'EXPIRED' ? `המבצע "${offerFact!.value.text}" הסתיים, ולא אשתמש בו במודעות.` : `לא אישרת לאחרונה שהמבצע "${offerFact!.value.text}" עדיין בתוקף.`,
      informationUsed: [],
      missingInformation: ['האם המבצע עדיין בתוקף, ועד מתי'],
      proposedAction: 'לספר לי אם יש מבצע עכשיו.',
    });
  const decision = planConversion(model, objective, memory, now);
  if (decision.plan && !decision.plan.exists)
    recs.push({
      ...base,
      id: 'fix-destination',
      kind: 'FIX_DESTINATION',
      title: `להגדיר לאן לשלוח לקוחות (${ACTION_LABELS[decision.plan.action]})`,
      objective,
      reasoning: decision.plan.why,
      informationUsed: [],
      missingInformation: [ACTION_LABELS[decision.plan.action]],
      proposedAction: 'לשלוח לי קישור, מספר וואטסאפ או כתובת.',
    });
  recs.push({
    ...base,
    id: `campaign-${objective.toLowerCase()}`,
    kind: 'CAMPAIGN',
    title: `קמפיין ${OBJECTIVE_LABELS[objective]}${product ? `: ${product}` : ''}`,
    objective,
    reasoning: `לעסק מסוג ${usableText(memory, 'business.category', now) ?? 'זה'}, ${OBJECTIVE_LABELS[objective]} היא בדרך כלל המטרה הישירה ביותר. אפשר לשנות מטרה בכל רגע.`,
    informationUsed: informationUsed(memory, now, ['business.name', 'business.category', 'location.city', 'offering.main']),
    missingInformation: product ? [] : [FACT_SPECS['offering.main'].label],
    proposedAction: 'להכין 3 רעיונות קריאייטיב לבחירה.',
    estimatedCostUsd: input.cost.providerPaid ? input.cost.creativeUsd : 0,
    costNote: costNote(input.cost),
    approvalRequired: true,
  });
  if (usable(memory, 'media.realPhotos', now) !== true)
    recs.push({
      ...base,
      id: 'collect-photos',
      kind: 'COLLECT_PHOTOS',
      title: 'לצלם 3–5 תמונות אמיתיות',
      objective,
      reasoning:
        'מודעה עם המוצר האמיתי אמינה יותר. בלי תמונות אשתמש בעיצוב טיפוגרפי או בתמונות המחשה שמסומנות כהמחשה, ולא אציג אותן כמוצר שלך.',
      informationUsed: [],
      missingInformation: ['תמונות של המוצר המרכזי, של המקום ושל אנשים בפעולה (באישורם)'],
      proposedAction: 'להעלות תמונות בעמוד "העסק שלי".',
    });
  const last = input.history[0];
  if (last && now.getTime() - Date.parse(last.createdAt) > 21 * 86_400_000)
    recs.push({
      ...base,
      id: 'refresh-creative',
      kind: 'REFRESH_CREATIVE',
      title: 'לרענן את הקריאייטיב',
      objective,
      reasoning: 'הקמפיין האחרון הוכן לפני יותר משלושה שבועות; קהל מקומי רואה את אותה מודעה שוב ושוב.',
      informationUsed: [last.title],
      missingInformation: [],
      proposedAction: 'להכין גרסה חדשה על אותו מוצר.',
    });
  return recs;
}
