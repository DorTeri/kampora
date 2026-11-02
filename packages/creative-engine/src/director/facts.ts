import type { BusinessFact, FactKey, FactProposal, FactSource, FactValue, OfferFact } from '@kampora/shared';

/**
 * Business memory rules. A fact can be used in an ad only when the owner said or confirmed it and it is still
 * fresh; inferences and outside research stay proposals until the owner confirms them.
 */

export interface FactSpec {
  label: string;
  /** How the Director asks for it (Hebrew, conversational). */
  question: string;
  suggestions?: string[];
}

export const FACT_SPECS: Record<FactKey, FactSpec> = {
  'business.name': { label: 'שם העסק', question: 'איך קוראים לעסק?' },
  'business.model': {
    label: 'סוג העסק',
    question: 'איזה סוג עסק זה?',
    suggestions: ['מסעדה', 'בית קפה', 'עגלת קפה', 'סטודיו לפילאטיס', 'קוסמטיקה', 'חנות אונליין', 'שירות מקומי'],
  },
  'business.category': { label: 'תחום', question: 'במה העסק עוסק?' },
  'location.city': { label: 'עיר', question: 'באיזו עיר אתם נמצאים?' },
  'location.address': { label: 'כתובת', question: 'מה הכתובת? כך לקוחות יוכלו לנווט אליכם בלחיצה.' },
  'location.serviceArea': {
    label: 'איפה נמצאים',
    question: 'איפה העגלה עומדת בדרך כלל? מקום קבוע, או שהמיקום מתחלף?',
    suggestions: ['מקום קבוע', 'מתחלף, מעדכנים באינסטגרם'],
  },
  'location.hours': { label: 'שעות פעילות', question: 'מה שעות הפעילות?' },
  'offering.main': { label: 'המוצר המרכזי', question: 'מה הדבר שהכי חשוב לך למכור עכשיו?' },
  'offering.products': { label: 'מוצרים', question: 'אילו מוצרים או שירותים כדאי שנכיר?' },
  'offer.current': { label: 'מבצע נוכחי', question: 'מה המבצע?' },
  audience: { label: 'קהל יעד', question: 'מי הלקוחות העיקריים שלכם?' },
  differentiator: { label: 'מה מייחד אתכם', question: 'מה מבדיל אתכם מהמתחרים?' },
  'brand.tone': { label: 'טון', question: 'איך העסק מדבר: חם, יוקרתי, אנרגטי, מקצועי?' },
  'channel.website': { label: 'אתר', question: 'יש לכם אתר? אם כן, מה הכתובת?', suggestions: ['אין לנו אתר'] },
  'channel.instagram': { label: 'אינסטגרם', question: 'מה שם המשתמש שלכם באינסטגרם?', suggestions: ['אין לנו אינסטגרם'] },
  'contact.whatsapp': { label: 'וואטסאפ', question: 'לאיזה מספר וואטסאפ לקוחות יכולים לכתוב?', suggestions: ['אין וואטסאפ עסקי'] },
  'contact.phone': { label: 'טלפון', question: 'לאיזה מספר לקוחות מתקשרים?' },
  'conversion.ordering': {
    label: 'איך מזמינים',
    question: 'איך לקוחות מזמינים היום?',
    suggestions: ['וולט', 'תן ביס', 'טלפון', 'אתר משלנו', 'רק במקום'],
  },
  'conversion.orderUrl': { label: 'קישור להזמנה', question: 'מה הקישור לדף ההזמנה שלכם?', suggestions: ['אין קישור'] },
  'conversion.bookingUrl': {
    label: 'קישור להרשמה',
    question: 'איך נרשמים לשיעור? אם יש קישור להרשמה (אתר או אפליקציה), שלחו אותו.',
    suggestions: ['נרשמים בוואטסאפ', 'אין קישור'],
  },
  'media.realPhotos': {
    label: 'תמונות אמיתיות',
    question: 'יש לך תמונות אמיתיות של המוצרים או של המקום?',
    suggestions: ['כן, יש', 'עדיין לא'],
  },
  'budget.monthlyIls': { label: 'תקציב חודשי לפרסום', question: 'כמה תרצה להשקיע בפרסום בחודש?' },
  'goal.primary': {
    label: 'מטרה',
    question: 'מה הכי חשוב לך עכשיו?',
    suggestions: ['יותר הזמנות', 'שיגיעו יותר לקוחות', 'יותר הרשמות', 'שיכירו אותנו'],
  },
  'preferences.style': { label: 'סגנון מועדף', question: 'יש סגנון שאתה אוהב במודעות?' },
};

/** Sources that come from the owner. Everything else is a proposal until the owner confirms it. */
const OWNER_SOURCES: readonly FactSource[] = ['OWNER_STATED', 'OWNER_CONFIRMED', 'OWNER_FORM'];
export const isOwnerSource = (source: FactSource) => OWNER_SOURCES.includes(source);

/** An offer without an end date is re-confirmed after this many days; a standing one after a month. */
export const OFFER_STALE_DAYS = 14;
export const ONGOING_OFFER_DAYS = 30;

export type Memory = Partial<Record<FactKey, BusinessFact>>;

export function memoryOf(facts: readonly BusinessFact[]): Memory {
  const memory: Memory = {};
  for (const f of facts) memory[f.key] = f;
  return memory;
}

/** YYYY-MM-DD in Israel time. */
export function isoDay(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

const DAY_MS = 86_400_000;

export type FactState = 'MISSING' | 'PROPOSED' | 'REJECTED' | 'DECLINED' | 'EXPIRED' | 'STALE' | 'USABLE';

export function isOffer(value: FactValue | undefined): value is OfferFact {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'text' in value;
}

/**
 * The state of one fact today. DECLINED: the owner said it does not exist ("אין לנו אתר"), which is an answer,
 * not a gap. An offer is EXPIRED after its end date and STALE when it never had one and was not re-confirmed.
 */
export function factState(fact: BusinessFact | undefined, now: Date): FactState {
  if (!fact) return 'MISSING';
  if (fact.status === 'REJECTED') return 'REJECTED';
  if (fact.status === 'PROPOSED' || !isOwnerSource(fact.source)) return 'PROPOSED';
  if (fact.value === false) return 'DECLINED';
  if (isOffer(fact.value)) {
    const offer = fact.value;
    if (offer.validUntil) return offer.validUntil < isoDay(now) ? 'EXPIRED' : 'USABLE';
    const since = now.getTime() - Date.parse(fact.confirmedAt ?? fact.updatedAt);
    return since > (offer.ongoing ? ONGOING_OFFER_DAYS : OFFER_STALE_DAYS) * DAY_MS ? 'STALE' : 'USABLE';
  }
  return 'USABLE';
}

export function usable(memory: Memory, key: FactKey, now: Date): FactValue | undefined {
  const f = memory[key];
  return factState(f, now) === 'USABLE' ? f!.value : undefined;
}

export function usableText(memory: Memory, key: FactKey, now: Date): string | undefined {
  const v = usable(memory, key, now);
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.join(', ');
  return undefined;
}

export function formatDay(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
}

export function factValueText(value: FactValue): string {
  if (value === true) return 'כן';
  if (value === false) return 'אין';
  if (typeof value === 'number') return value.toLocaleString('he-IL');
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.join(', ');
  return [value.text, value.price, value.validUntil ? `עד ${formatDay(value.validUntil)}` : value.ongoing ? 'ללא תאריך סיום' : '']
    .filter(Boolean)
    .join(' · ');
}

export interface MergeResult {
  memory: Memory;
  changed: BusinessFact[];
  /** Proposals that were not applied, with the reason (shown in the activity, never silently dropped). */
  ignored: { key: FactKey; reason: string }[];
}

/**
 * Applies proposals to the memory. The owner's words are confirmed facts; inferences are proposals and never
 * replace something the owner said.
 */
export function mergeFacts(memory: Memory, proposals: readonly FactProposal[], now: Date): MergeResult {
  const next: Memory = { ...memory };
  const changed: BusinessFact[] = [];
  const ignored: MergeResult['ignored'] = [];
  const at = now.toISOString();
  for (const p of proposals) {
    const existing = next[p.key];
    const fromOwner = isOwnerSource(p.source);
    if (!fromOwner && existing && existing.status === 'CONFIRMED' && isOwnerSource(existing.source)) {
      ignored.push({ key: p.key, reason: 'הבעלים כבר אמר אחרת' });
      continue;
    }
    const fact: BusinessFact = {
      key: p.key,
      value: p.value,
      source: p.source,
      status: fromOwner ? 'CONFIRMED' : 'PROPOSED',
      ...(p.evidence ? { evidence: p.evidence.slice(0, 300) } : {}),
      updatedAt: at,
      confirmedAt: fromOwner ? at : null,
    };
    const same =
      existing &&
      JSON.stringify(existing.value) === JSON.stringify(fact.value) &&
      existing.status === fact.status &&
      // Re-stating an offer refreshes it (it is re-confirmed today).
      !(fromOwner && isOffer(fact.value));
    if (same) continue;
    next[p.key] = fact;
    changed.push(fact);
  }
  return { memory: next, changed, ignored };
}

/** The owner confirmed or rejected proposals (from the conversation or the memory panel). */
export function decideFacts(memory: Memory, keys: readonly FactKey[], decision: 'CONFIRM' | 'REJECT', now: Date): MergeResult {
  const next: Memory = { ...memory };
  const changed: BusinessFact[] = [];
  const at = now.toISOString();
  for (const key of keys) {
    const f = next[key];
    if (!f) continue;
    const fact: BusinessFact =
      decision === 'CONFIRM'
        ? { ...f, status: 'CONFIRMED', source: isOwnerSource(f.source) ? f.source : 'OWNER_CONFIRMED', updatedAt: at, confirmedAt: at }
        : { ...f, status: 'REJECTED', updatedAt: at, confirmedAt: null };
    next[key] = fact;
    changed.push(fact);
  }
  return { memory: next, changed, ignored: [] };
}

/** Facts the owner approved, written as claims an ad may make (the offer only while it is valid). */
export function claimsFromMemory(memory: Memory, now: Date): string[] {
  const claims: string[] = [];
  const offer = usable(memory, 'offer.current', now);
  if (isOffer(offer)) claims.push(factValueText(offer));
  const diff = usableText(memory, 'differentiator', now);
  if (diff) claims.push(diff);
  return claims;
}

/** Claim texts a fact has ever produced (to remove them from the profile when the fact changes or expires). */
export function claimOf(fact: BusinessFact | undefined): string | undefined {
  if (!fact) return undefined;
  if (fact.key === 'offer.current' && isOffer(fact.value)) return factValueText(fact.value);
  if (fact.key === 'differentiator' && typeof fact.value === 'string') return fact.value;
  return undefined;
}
