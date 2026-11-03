import type { BusinessModel, FactKey, FactProposal, MarketingObjective, OfferFact, RevisionTarget } from '@kampora/shared';
import { isoDay } from './facts';

/**
 * Deterministic Hebrew understanding for the Campaign Director: what the owner wants (intent) and what they told
 * us (facts). Every fact carries the owner's words as evidence. Nothing here guesses a value the owner did not
 * say; a business type implied by a product mention is only a proposal.
 */

export type DirectorIntent =
  | 'GREETING'
  | 'CAMPAIGN'
  | 'PROMOTION'
  | 'LAUNCH'
  | 'MODIFY'
  | 'STATUS'
  | 'HISTORY'
  | 'RECOMMEND'
  | 'APPROVE_TEXT'
  | 'RETRY'
  | 'FORBIDDEN'
  | 'PROVIDE_INFO'
  | 'UNKNOWN';

export const DIRECTOR_INTENTS: readonly DirectorIntent[] = [
  'GREETING',
  'CAMPAIGN',
  'PROMOTION',
  'LAUNCH',
  'MODIFY',
  'STATUS',
  'HISTORY',
  'RECOMMEND',
  'APPROVE_TEXT',
  'RETRY',
  'FORBIDDEN',
  'PROVIDE_INFO',
  'UNKNOWN',
];

export interface Understanding {
  intent: DirectorIntent;
  facts: FactProposal[];
  /** Parts of an offer the owner gave (merged into the current offer by the engine). */
  offerPatch?: Partial<OfferFact>;
  objective?: MarketingObjective;
  product?: { text: string; isNew: boolean };
  window?: string;
  modify?: { target: RevisionTarget; instruction: string; hasContent: boolean; reference: 'LATEST' | 'FIRST' | 'NONE' };
  yes: boolean;
  no: boolean;
  skip: boolean;
  /** 1-based choice ("השני", "2", "כיוון B"), or 'RECOMMENDED' ("מה שאתה ממליץ"). */
  choice?: number | 'RECOMMENDED';
  forbidden?: 'PUBLISH' | 'APPROVE' | 'MESSAGE' | 'SPEND' | 'INJECTION';
  /** Tool calls an LLM brain asked for. Always checked by the policy; the rule-based brain never asks. */
  toolRequests: { tool: string; args: unknown }[];
  /** "יותר לקוחות": a goal without a channel. */
  growth?: boolean;
  /** A short natural reply from the LLM brain, already checked by `guardReply`. */
  reply?: string;
  /** Which reading this is (shown in diagnostics, never to the owner). */
  brain?: 'rules' | 'llm' | 'rules-fallback';
  /** Keys read from a bare message as the answer to the open question (a guess, not a parse). */
  guessed?: FactKey[];
  /** Why the model's reading was not used (schema or provider error), for logs and evaluation. */
  fallbackReason?: string;
  /** "מה אתה זוכר עליי?": the owner asks what the Director knows about the business. */
  asksProfile?: boolean;
}

/** Hebrew without niqqud, single spaces, Latin lower-cased; punctuation kept (URLs, prices). */
export function normalize(text: string): string {
  return text
    .replace(/[֑-ׇ]/g, '')
    .replace(/[“”״]/g, '"')
    .replace(/[׳’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Lexicons ──────────────────────────────────────────────────────────

export const CITIES = [
  'תל אביב-יפו', 'תל אביב', 'תל-אביב', 'ירושלים', 'חיפה', 'רמת גן', 'גבעתיים', 'הרצליה', 'רעננה', 'כפר סבא', 'פתח תקווה',
  'פתח תקוה', 'ראשון לציון', 'חולון', 'בת ים', 'נתניה', 'באר שבע', 'אשדוד', 'אשקלון', 'רחובות', 'מודיעין', 'הוד השרון',
  'רמת השרון', 'נס ציונה', 'קריית אונו', 'קרית אונו', 'אילת', 'עכו', 'נהריה', 'טבריה', 'צפת', 'כרמיאל', 'עפולה', 'יבנה',
  'בני ברק', 'יפו', 'זכרון יעקב', 'קיסריה', 'חדרה', 'רמלה', 'לוד', 'אור יהודה', 'יהוד', 'גבעת שמואל', 'ראש העין', 'שוהם',
  'קריית מוצקין', 'קריית ביאליק', 'קריית ים', 'קריית אתא', 'נצרת', 'אום אל-פחם', 'דימונה', 'שדרות', 'אופקים', 'נתיבות',
  'מעלה אדומים', 'בית שמש', 'אריאל', 'פרדס חנה', 'כרכור', 'יקנעם', 'מבשרת ציון', 'גדרה', 'קריית גת', 'קריית שמונה',
];
const CITY_RE = new RegExp(`(?:^|[\\s,(])(?:וב|ב|מ|ל|ו)?(${CITIES.map((c) => c.replace(/-/g, '\\-')).join('|')})(?=$|[\\s,.!?)])`);
const CANONICAL_CITY: Record<string, string> = { 'תל-אביב': 'תל אביב', 'תל אביב-יפו': 'תל אביב', 'פתח תקוה': 'פתח תקווה', 'קרית אונו': 'קריית אונו' };

interface ModelRule {
  model: BusinessModel;
  re: RegExp;
  category: (m: RegExpMatchArray) => string;
}
const MODEL_RULES: ModelRule[] = [
  { model: 'COFFEE_CART', re: /עגלת (ה)?קפה|עגלה (של |ל)?קפה|קפה נייד|קרוואן קפה|דוכן קפה/, category: () => 'עגלת קפה' },
  {
    model: 'FITNESS_STUDIO',
    re: /סטודיו (ל|של )?(פילאטיס|יוגה|כושר|אימונים|ריקוד)|פילאטיס|יוגה|חדר כושר|מכון כושר|אימוני כושר|קרוספיט/,
    category: (m) => (/יוגה/.test(m[0]) ? 'סטודיו ליוגה' : /פילאטיס/.test(m[0]) ? 'סטודיו לפילאטיס' : 'סטודיו לכושר'),
  },
  {
    model: 'RESTAURANT',
    re: /מסעדת [א-ת]+|מסעדה|המבורגרי+[הא]|בורגר בר|בורגרי+[הא]|פיצרי+[הא]|שווארמ[הא]|פלאפל|סושי|ביסטרו|דיינר|גריל בר|מעדני+[הא]/,
    category: (m) => (/מסעדה$/.test(m[0]) ? 'מסעדה' : /המבורגרי|בורגרי|בורגר בר/.test(m[0]) ? 'מסעדת המבורגרים' : /פיצרי/.test(m[0]) ? 'פיצרייה' : m[0]),
  },
  { model: 'CAFE', re: /בית (ה)?קפה|קפה שכונתי|קונדיטורי+[הא]|מאפי+[הא]|בייקרי/, category: (m) => m[0].replace('בית הקפה', 'בית קפה') },
  {
    model: 'BEAUTY',
    re: /מספרה|מספרת|ברברשופ|קוסמטיק[הא]|קוסמטיקאית|ציפורניים|מניקור|לק ג'ל|גבות|ריסים|מכון יופי|טיפולי פנים|הסרת שיער/,
    category: (m) => m[0],
  },
  {
    model: 'LOCAL_SERVICE',
    re: /אינסטלטור|חשמלאי|שיפוצ(ים|ניק)|הובלות|חברת ניקיון|ניקיון בתים|מנעולן|גנן|גינון|טכנאי|מוסך|מזגנים/,
    category: (m) => m[0],
  },
  {
    model: 'ECOMMERCE',
    re: /חנות (אונליין|אינטרנטית|באינטרנט|ברשת|וירטואלית)|אתר מכירות|שופיפיי|shopify|מוכר(ת|ים)? (באתר|אונליין|ברשת)/i,
    category: (m) => (m[0].startsWith('חנות') ? m[0] : 'חנות אונליין'),
  },
];

/** Words of a product mention that imply a business type, used only for a proposal the owner confirms. */
const IMPLIED_MODEL: { re: RegExp; model: BusinessModel; category: string }[] = [
  { re: /המבורגר|בורגר/, model: 'RESTAURANT', category: 'מסעדת המבורגרים' },
  { re: /פיצה/, model: 'RESTAURANT', category: 'פיצרייה' },
  { re: /קפה|אספרסו|קפוצ'ינו/, model: 'CAFE', category: 'בית קפה' },
];

const SELF_DESCRIPTION =
  /(יש לי|יש לנו|אני (ה)?(בעל|בעלת|בעלים|מנהל|מנהלת|מפעיל|מפעילה|מחזיק|מחזיקה)|העסק שלי|העסק שלנו|אנחנו|פתחתי|פתחנו|אני עם|[א-ת]+ שלי(?=\s|$|[.,!?])|[א-ת]+ שלנו(?=\s|$|[.,!?]))/;

/** A goal without a channel: "יותר לקוחות", "שהעסק יגדל". The business's playbook decides what it means. */
const GROWTH_RE =
  /(יותר|עוד|להביא|להגדיל( את)?( מספר)?( ה)?|תביא( לי)?|שיהיו( לי)?( יותר)?) ?(לקוחות|קליינטים|אנשים|מכירות|עבודה|עסקאות|קהל)|שהעסק (יגדל|יצמח)|לגדול|להגדיל את העסק/;

const OBJECTIVE_RULES: { re: RegExp; objective: MarketingObjective }[] = [
  { re: /הזמנות|שיזמינו|יזמינו|משלוחים/, objective: 'ORDERS' },
  { re: /הרשמות|שירשמו|ירשמו|להירשם|שיעור ניסיון|תורים|שיקבעו|לקבוע תור/, objective: 'BOOKINGS' },
  { re: /לידים|פניות|שיפנו|שיתקשרו|שיחות/, objective: 'LEADS' },
  { re: /מכירות (באתר|אונליין|ברשת)|שיקנו באתר|מכירות בחנות האונליין/, objective: 'ONLINE_SALES' },
  { re: /שיגיעו|שיבואו|יגיעו|יבואו|לקוחות (למקום|לעגלה|לחנות|לסטודיו)|תנועה (לחנות|למקום)|שיכנסו/, objective: 'VISITS' },
  { re: /לקוחות חוזרים|שיחזרו|נאמנות|לקוחות קבועים/, objective: 'RETENTION' },
  { re: /השקה|משיקים|להשיק|נשיק/, objective: 'PRODUCT_LAUNCH' },
  { re: /ש?יכירו|מודעות|חשיפה|ש?ידעו עלינו|ש?ישמעו עלינו|יותר אנשים (יכירו|ידעו|ישמעו)/, objective: 'LOCAL_AWARENESS' },
  { re: /מיתוג|תדמית/, objective: 'BRAND' },
];

export function objectiveIn(text: string): MarketingObjective | undefined {
  return OBJECTIVE_RULES.find((r) => r.re.test(text))?.objective;
}

// ── Dates ─────────────────────────────────────────────────────────────

const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

function dayParts(now: Date) {
  const [y, m, d] = isoDay(now).split('-').map(Number) as [number, number, number];
  return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** When an offer ends, from the owner's words. `ongoing`: no end date. Undefined: not said. */
export function parseValidity(text: string, now: Date): { validUntil?: string; ongoing?: boolean; phrase: string } | undefined {
  const t = normalize(text);
  const { y, m, d, weekday } = dayParts(now);
  const add = (days: number) => iso(y, m, d + days);
  let mm: RegExpMatchArray | null;
  if ((mm = t.match(/(עד )?סוף החודש|כל החודש|החודש בלבד|רק החודש/))) return { validUntil: iso(y, m, lastDay(y, m)), phrase: mm[0] };
  if ((mm = t.match(/(עד )?סוף השבוע|כל השבוע|השבוע בלבד|רק השבוע|עד שבת/))) return { validUntil: add((6 - weekday + 7) % 7), phrase: mm[0] };
  if ((mm = t.match(/היום בלבד|רק היום|עד הערב|עד היום/))) return { validUntil: add(0), phrase: mm[0] };
  if ((mm = t.match(/עד מחר|מחר בלבד/))) return { validUntil: add(1), phrase: mm[0] };
  if ((mm = t.match(/עד (ה-?|ל-?)?(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/))) {
    const day = Number(mm[2]);
    const month = Number(mm[3]);
    let year = mm[4] ? Number(mm[4].length === 2 ? `20${mm[4]}` : mm[4]) : y;
    if (month < 1 || month > 12 || day < 1 || day > lastDay(year, month)) return undefined;
    if (!mm[4] && iso(year, month, day) < iso(y, m, d)) year += 1;
    return { validUntil: iso(year, month, day), phrase: mm[0] };
  }
  if ((mm = t.match(new RegExp(`עד (יום )?(${WEEKDAYS.join('|')})`)))) {
    const target = WEEKDAYS.indexOf(mm[2]!);
    return { validUntil: add((target - weekday + 7) % 7 || 7), phrase: mm[0] };
  }
  if ((mm = t.match(new RegExp(`(עד )?סוף (${MONTHS.join('|')})`)))) {
    const month = MONTHS.indexOf(mm[2]!) + 1;
    const year = month < m ? y + 1 : y;
    return { validUntil: iso(year, month, lastDay(year, month)), phrase: mm[0] };
  }
  if ((mm = t.match(/(ל|במשך )שבועיים/))) return { validUntil: add(13), phrase: mm[0] };
  if ((mm = t.match(/(ל|במשך )שבוע(?=\s|$|[.,!?])/))) return { validUntil: add(6), phrase: mm[0] };
  if ((mm = t.match(/(ל|במשך )חודש(?=\s|$|[.,!?])/))) return { validUntil: add(29), phrase: mm[0] };
  if ((mm = t.match(/ללא (הגבלת זמן|תאריך)|אין (לו )?(תאריך|הגבלה)|קבוע|כל הזמן|תמיד/))) return { ongoing: true, phrase: mm[0] };
  return undefined;
}

// ── Values ────────────────────────────────────────────────────────────

const PRICE_RE = /(?:ב-?\s?)?(?:₪\s?(\d+(?:[.,]\d{1,2})?)|(\d+(?:[.,]\d{1,2})?)\s?(?:₪|ש"ח|שח|ש'ח|שקלים|שקל))/;
export function parsePrice(text: string): { price: string; phrase: string } | undefined {
  const m = normalize(text).match(PRICE_RE);
  if (!m) return undefined;
  return { price: `${(m[1] ?? m[2])!.replace(',', '.')} ₪`, phrase: m[0] };
}

const URL_RE = /(https?:\/\/[^\s,]+|www\.[^\s,]+|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:co\.il|org\.il|com|net|org|io|co|shop|store|me|link|page|app)(?:\/[^\s,]*)?)/gi;
const BOOKING_HOSTS = /calendly|arbox|boostapp|mindbody|setmore|booksy|bookme|tor4you|lee\.co\.il|simplybook|zappix|book/i;
const ORDER_HOSTS = /wolt|10bis|tenbis|mishloha|cibus|order/i;

const PHONE_RE = /(?:\+972[- ]?|0)(5\d)[- ]?(\d{3})[- ]?(\d{4})|\b0([2-489])[- ]?(\d{7})\b|\b(07\d)[- ]?(\d{7})\b/g;
const WHATSAPP_WORD = /וואטסאפ|ווטסאפ|ווצאפ|וואצאפ|ווטסאפ|וואטס|whatsapp|ווטס/i;

const YES_RE = /^(כן|נכון|בדיוק|מאשר|מאשרת|סבבה|יאללה|קדימה|אוקיי|אוקי|ok|okay|יופי|מעולה|בטח|ברור|זה נכון|נשמע טוב|תמשיך עם זה)(\s|$|[.!,])/i;
const NO_RE = /^(לא|ממש לא|לא נכון|טעות|זה לא נכון)(\s|$|[.!,])/;
const SKIP_RE = /^(דלג|תדלג|לדלג|נדלג|אחר כך|אחר-כך|לא יודע|לא יודעת|לא רלוונטי|לא חשוב|נמשיך|בוא נמשיך|תמשיך|skip|pass|עזוב)(\s|$|[.!,])|אפשר לדלג|נדלג על זה/i;
const DECLINE_RE = /^(אין|אין לי|אין לנו|עדיין אין|עדיין לא|לא קיים|אין כרגע)(\s|$|[.!,])/;

const ORDINALS: [RegExp, number][] = [
  [/הראשון|הראשונה|^אחד$|^א'?$/, 1],
  [/השני(?=\s|$|[.,!?])|השנייה|השניה|^ב'?$/, 2],
  [/השלישי|השלישית|^ג'?$/, 3],
];

export function parseChoice(text: string): number | 'RECOMMENDED' | undefined {
  const t = normalize(text);
  if (/מה שאתה ממליץ|המומלצ?ת?|הממולץ|ההמלצה שלך|לפי ההמלצה|מה שהמלצת|מה שהומלץ/.test(t)) return 'RECOMMENDED';
  const letter = t.match(/(?:כיוון|אפשרות)\s*([abc])\b/i);
  if (letter) return 'abc'.indexOf(letter[1]!.toLowerCase()) + 1;
  const digit = t.match(/(?:^|\s|#)([1-5])(?:\s|$|[.!,)])/) ?? t.match(/^([1-5])$/);
  if (digit) return Number(digit[1]);
  for (const [re, n] of ORDINALS) if (re.test(t)) return n;
  return undefined;
}

function phones(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PHONE_RE)) {
    if (m[1]) out.push(`0${m[1]}-${m[2]}${m[3]}`);
    else if (m[4]) out.push(`0${m[4]}-${m[5]}`);
    else if (m[6]) out.push(`${m[6]}-${m[7]}`);
  }
  return out;
}

function clean(value: string): string {
  return value
    .replace(/^(זה|הוא|היא|זה ה|קוראים לו|קוראים לה|קוראים לנו|השם הוא|ה?שם:?)\s+/, '')
    .replace(/[\s.!?,:;]+$/, '')
    .replace(/^["']+|["']+$/g, '')
    .trim();
}

const NAME_STOP = new RegExp(`\\s+(?:(?:וב|ב|ל)(?:${CITIES.join('|')})|ש|שנמצא|שנמצאת|ויש|ואנחנו|ואני|וגם|עם|ליד|באזור|ברחוב|כבר|מאז)(?=\\s|$)`);

function extractName(t: string): string | undefined {
  const quoted = t.match(/(?:בשם|שנקרא|שנקראת|נקרא|נקראת|קוראים ל(?:ו|ה|נו|עסק)|שם העסק(?: הוא|:)?)\s*"([^"]{2,40})"/);
  if (quoted) return quoted[1]!.trim();
  const m = t.match(/(?:בשם|שנקרא|שנקראת|קוראים ל(?:ו|ה|נו|עסק)|שם העסק(?: הוא|:)?|השם (?:שלו|שלה|שלנו) (?:הוא )?)\s+([^,.!?\n"]{2,60})/);
  if (!m) return undefined;
  const name = clean(m[1]!.split(NAME_STOP)[0]!);
  return name.length >= 2 && name.split(' ').length <= 5 ? name : undefined;
}

function offerText(t: string, cut: string[]): string | undefined {
  const sentence = t.split(/[.!?\n]/).find((s) => /מבצע|הנחה|1\+1|אחד פלוס אחד|הטבה|קופון|%|חינם|במתנה/.test(s));
  if (!sentence) return undefined;
  let s = sentence;
  for (const c of cut) if (c) s = s.replace(c, ' ');
  s = s
    .replace(/^.*?(?:יש לנו|יש לי|רוצה לפרסם|לפרסם|נפרסם|לקדם|נקדם|השבוע יש|החודש יש|יש)\s+/, '')
    .replace(/^(את\s+)?(ה)?מבצע(\s*של|\s*:)?\s*/, (all) => (/מבצע\s*(של|:)/.test(all) ? '' : all))
    .replace(/\s+/g, ' ')
    .replace(/[\s,:-]+$/, '')
    .trim();
  s = s.replace(/^את\s+/, '');
  // "בוא נעשה מבצע על קפה ומאפה" → "קפה ומאפה"
  const on = s.match(/(?:^|\s)(?:ה)?(?:מבצע|הנחה|הטבה)\s+(?:על|של|בשביל)\s+(.+)$/);
  if (on) s = on[1]!.trim();
  if (!s || /^(ה)?(מבצע|הנחה|הטבה)( חדש| חדשה| שלנו| הנוכחי)?$/.test(s)) return undefined;
  return s.slice(0, 160);
}

/** A new product, as the owner names it: "קוראים לו סמוקי ביף, עם בריסקט מעושן" → name + detail. */
export function parseProductAnswer(raw: string): { name: string; detail?: string } | undefined {
  const t = normalize(raw).replace(/^(קוראים לו|קוראים לה|השם שלו|השם שלה|הוא נקרא|היא נקראת|זה|השם הוא)\s+/, '');
  const m = t.match(/^(.+?)(?:,|\.|\s+-\s+|\s+–\s+|\s+(?=עם\s)|\s+(?=שיש בו)|\s+(?=עשוי)|$)(.*)$/);
  if (!m) return undefined;
  const name = clean(m[1]!);
  if (name.length < 2 || name.split(' ').length > 5) return undefined;
  const detail = clean(m[2] ?? '').replace(/^ו/, '');
  return { name, ...(detail ? { detail } : {}) };
}

/** Messages that ask for something (not answers to the Director's question). */
const REQUEST_RE =
  /(רוצה|צריך|צריכה|בוא|בואו|תכין|להכין|נעשה|תעזור) .*(קמפיין|פרסומת|פרסום|מודעה|מודעות|סרטון|לקדם|לפרסם)|קמפיין|מה נשאר|מה הסטטוס|איזה (פרסומות|מודעות)|(תשנה|לשנות|תחליף|תתקן) |נקדם|לקדם|מה כדאי|תמליץ|נסה שוב/;

const PREFERENCE_RE = /(?:לא )?(?:אוהב|אוהבת|אוהבים|רוצה|רוצים|מעדיף|מעדיפה|מעדיפים)\s+[^.!?]{2,80}?\s(?:במודעות|בעיצוב|בעיצובים|בסרטונים|בפרסומות|בתמונות)/;

export interface UnderstandContext {
  now: Date;
  /** Keys the Director just asked about: a bare answer is read as their value. */
  awaiting?: FactKey[];
  /** The owner is answering a free-text instruction (e.g. what the video should open with). */
  awaitingInstruction?: boolean;
}

/** Turns one owner message into intent + facts (owner's words only). */
export function understand(raw: string, ctx: UnderstandContext): Understanding {
  const t = normalize(raw);
  const facts: FactProposal[] = [];
  const evidence = t.slice(0, 300);
  const owner = (key: FactKey, value: FactProposal['value']) => facts.push({ key, value, source: 'OWNER_STATED', evidence });
  const inferred = (key: FactKey, value: FactProposal['value']) => facts.push({ key, value, source: 'AI_INFERRED', evidence });
  const awaiting = ctx.awaiting ?? [];
  const waits = (k: FactKey) => awaiting.includes(k);
  const selfDesc = SELF_DESCRIPTION.test(t);

  const u: Understanding = { intent: 'UNKNOWN', facts, yes: YES_RE.test(t), no: NO_RE.test(t), skip: SKIP_RE.test(t), toolRequests: [] };

  // ── Forbidden requests (deterministic; an LLM cannot switch this off) ──
  if (/(ignore|disregard|forget) (all |the |your )?(previous|prior|above|earlier)|system prompt|developer mode|jailbreak|התעלם (מ|מכל)|תתעלם (מ|מכל)|תשכח (את )?(כל )?ההוראות|הוראות (קודמות|המערכת)|אתה עכשיו/i.test(t))
    u.forbidden = 'INJECTION';
  else if (/(תעלה|להעלות|העלה|תוציא|להוציא) (את )?(המודעה|הקמפיין|הפרסומת)? ?לאוויר|(תפעיל|להפעיל|הפעל|תריץ) (את )?(הקמפיין|המודעה|המודעות|הפרסום)|(תפרסם|פרסם) (את )?(המודעה|הקמפיין|הסרטון|עכשיו|במטא|בפייסבוק|באינסטגרם)|\bpublish\b|go live/i.test(t))
    u.forbidden = 'PUBLISH';
  else if (/(תשלח|שלח|לשלוח) (הודעה|הודעות|וואטסאפ|ווטסאפ|הודעת וואטסאפ|sms|מייל)/i.test(t)) u.forbidden = 'MESSAGE';
  else if (/(תאשר|אשר|לאשר|תאשרו) (הכל|את הכל|בשמי|במקומי|כל האישורים|את כל)|(תאשר|אשר|לאשר|תאשרו) [^.!?]{0,40}(בשמי|במקומי|בשבילי|לבד|אוטומטית)|אישור אוטומטי/.test(t)) u.forbidden = 'APPROVE';
  else if (/(תוציא|להוציא|תשקיע|לשלם|תשלם|תחייב|לחייב) .*(כסף|תקציב|שקל|₪|\$|דולר)|תקציב פרסום עכשיו/.test(t)) u.forbidden = 'SPEND';

  // ── Facts ──
  // A bare reply ("בורגר בוי") answers the open question; a request ("אני רוצה קמפיין") never does.
  // "אני רוצה יותר הרשמות" states a goal: it starts a campaign and is never a bare answer.
  const goal = objectiveIn(t);
  const wantsVerb = /(רוצה|רוצים|נרצה|צריך|צריכה|מעוניין|מעוניינת|שיהיו|להביא|להגדיל|לקבל|מחפש|מחפשת|שיביא|שתביא|תביא|תביאו|תעשה ש|בא לי|באלי|הייתי רוצה|אשמח|עדיף|בעצם|דווקא)/.test(t);
  const wantsOutcome = Boolean(goal) && wantsVerb;
  // "יותר הזמנות" on its own states the goal too; it is never a business name.
  const statesGoal = Boolean(goal) && (wantsOutcome || waits('goal.primary') || /^(יותר|עוד|שיהיו|שיגיעו|שיבואו|שיזמינו|שירשמו|שיכירו)/.test(t));
  if (statesGoal) owner('goal.primary', goal!);
  u.growth = !goal && GROWTH_RE.test(t);
  const bare = !REQUEST_RE.test(t) && !u.forbidden && !statesGoal && !u.growth && !PREFERENCE_RE.test(t);
  // Bare answers wait until the end: they apply only when nothing more specific was recognised, and only to
  // the first open question ("ברמת גן" answers the city, not also the product asked with it).
  const fallbacks: { key: FactKey; value: FactProposal['value']; extra: { key: FactKey; value: FactProposal['value'] }[] }[] = [];
  const fallback = (key: FactKey, value: FactProposal['value'], extra: { key: FactKey; value: FactProposal['value'] }[] = []) =>
    fallbacks.push({ key, value, extra });

  // "בורגר דרום, הכי נמכר אצלנו הסמאש": two answers to the two questions asked together.
  const parts = t.split(',').map((x) => x.trim());
  const paired = bare && waits('business.name') && waits('offering.main') && parts.length >= 2 && parts[0]!.split(' ').length <= 5 && Boolean(parts[1]);
  if (paired) {
    owner('business.name', clean(parts[0]!));
    const rest = parts.slice(1).join(', ');
    const named = rest.match(/הכי (?:נמכר|נמכרת|מבוקש|מבוקשת|פופולרי|פופולרית)(?: אצלנו)?(?: זה| הוא| היא)? ([^,.!?]{2,60})$/);
    owner('offering.main', clean(named ? named[1]! : rest).slice(0, 120));
  }
  // While naming a product ("קוראים לו סמוקי ביף"), "קוראים לו" is the product's name, not the business's.
  const name = waits('offering.products') || paired ? undefined : extractName(t);
  if (name) owner('business.name', name);
  else if (bare && waits('business.name') && !u.skip && !DECLINE_RE.test(t) && t.split(' ').length <= 6 && !MODEL_RULES.some((r) => r.re.test(t)))
    fallback('business.name', clean(t));

  const modelRule = MODEL_RULES.map((r) => ({ r, m: t.match(r.re) })).find((x) => x.m);
  if (modelRule && (selfDesc || waits('business.model') || waits('business.name'))) {
    owner('business.model', modelRule.r.model);
    owner('business.category', modelRule.r.category(modelRule.m!));
  } else if ((selfDesc || waits('business.model')) && IMPLIED_MODEL.some((i) => i.re.test(t))) {
    const implied = IMPLIED_MODEL.find((i) => i.re.test(t))!;
    inferred('business.model', implied.model);
    inferred('business.category', implied.category);
  } else if (bare && waits('business.model') && !u.skip && !u.yes && !u.no) {
    fallback('business.model', 'OTHER', [{ key: 'business.category', value: clean(t).slice(0, 80) }]);
  }

  const city = t.match(CITY_RE);
  if (city && (selfDesc || waits('location.city') || /נמצא|נמצאת|נמצאים|ממוקם|ממוקמת|עומד|עומדת|באזור|פועל|פועלת/.test(t)))
    owner('location.city', CANONICAL_CITY[city[1]!] ?? city[1]!);
  else if (bare && waits('location.city') && !u.skip && t.split(' ').length <= 4) fallback('location.city', clean(t));

  const address = t.match(/(?:ברחוב|ברח'|רחוב|רח'|בשדרות|שדרות|שד')\s+([א-ת"' -]{2,30}?\s*\d{1,4})/);
  if (address) owner('location.address', `${address[0].replace(/^ב/, '').trim()}`);
  else if (bare && waits('location.address') && !u.skip && !DECLINE_RE.test(t) && /[א-ת]{2,}/.test(t)) fallback('location.address', clean(t));

  const area = t.match(/(?:עומדת|עומד|חונה|נמצאת|נמצא) (?:בדרך כלל |קבוע |כל יום )?(ב[^,.!?]{3,60})/);
  if (area && /עגלה|עגלת|העגלה|עומדת|חונה/.test(t)) owner('location.serviceArea', clean(area[1]!).replace(/^ב/, ''));
  else if (bare && waits('location.serviceArea') && !u.skip) fallback('location.serviceArea', clean(t));

  const hours = t.match(/(?:פתוחים|פתוח|פתוחה|עובדים|עובדת) ((?:מ|בין|כל)[^.!?]{3,60})/);
  if (hours) owner('location.hours', clean(hours[1]!));
  else if (bare && waits('location.hours') && !u.skip) fallback('location.hours', clean(t));

  const main = t.match(/(?:המנה|המוצר|השירות|הדבר|השיעור)(?: הכי)? (?:נמכר|נמכרת|פופולרי|פופולרית|מבוקש|מבוקשת|חשוב|חשובה)(?: אצלנו)? (?:הוא |היא |זה )?([^,.!?]{2,60})/)
    ?? t.match(/(?:אנחנו |אני )(?:מוכרים|מוכר|מוכרת|מגישים|מגיש|מגישה|מתמחים ב|מתמחה ב|מעבירים|מעבירה)\s+([^,.!?]{2,60})/);
  if (main && !paired) owner('offering.main', clean(main[1]!));
  else if (bare && waits('offering.main') && !u.skip && !DECLINE_RE.test(t)) fallback('offering.main', clean(t).slice(0, 120));


  const audience = t.match(/(?:קהל היעד|הלקוחות שלנו|הלקוחות שלי|הלקוחות)(?: שלנו)? (?:הם |זה |בעיקר )+([^,.!?]{3,80})/);
  if (audience) owner('audience', clean(audience[1]!));
  else if (bare && waits('audience') && !u.skip) fallback('audience', clean(t).slice(0, 120));

  const diff = t.match(/(?:מה שמייחד אותנו|הייחוד שלנו|מה שמיוחד אצלנו|אנחנו היחידים ש)(?: זה| הוא|:)?\s*([^.!?]{3,120})/);
  // A style preference ("לא אוהב ורוד במודעות", "מעדיף משהו נקי בעיצוב"): kept in the owner's words for every brief.
  const pref = t.match(PREFERENCE_RE);
  if (pref) owner('preferences.style', clean(pref[0]).slice(0, 160));
  if (diff) owner('differentiator', clean(diff[1]!));
  else if (bare && waits('differentiator') && !u.skip) fallback('differentiator', clean(t).slice(0, 160));

  // Links and contact details, exactly as written.
  for (const m of t.matchAll(URL_RE)) {
    const url = m[0].replace(/[).]+$/, '');
    if (/instagram\.com\/([a-z0-9._]+)/i.test(url)) owner('channel.instagram', `@${url.match(/instagram\.com\/([a-z0-9._]+)/i)![1]}`);
    else if (/wa\.me|whatsapp/i.test(url)) owner('contact.whatsapp', url);
    else if (ORDER_HOSTS.test(url) || waits('conversion.orderUrl')) owner('conversion.orderUrl', url);
    else if (BOOKING_HOSTS.test(url) || waits('conversion.bookingUrl')) owner('conversion.bookingUrl', url);
    else owner('channel.website', url);
  }
  const handle = t.match(/(?:^|[\s(])@([a-z0-9._]{2,30})\b/i);
  if (handle) owner('channel.instagram', `@${handle[1]}`);

  const nums = phones(t);
  if (nums.length) {
    if (WHATSAPP_WORD.test(t) || waits('contact.whatsapp') || (waits('conversion.bookingUrl') && /בוואטסאפ|בווטסאפ/.test(t))) owner('contact.whatsapp', nums[0]!);
    if (!WHATSAPP_WORD.test(t) || /טלפון|להתקשר|שיחה/.test(t) || waits('contact.phone')) owner('contact.phone', nums[0]!);
  }

  // How customers order today.
  const channels: string[] = [];
  if (/וולט|wolt/i.test(t)) channels.push('Wolt');
  if (/תן ביס|10bis|תןביס/i.test(t)) channels.push('תן ביס');
  if (/משלוחה|mishloha/i.test(t)) channels.push('משלוחה');
  if (waits('conversion.ordering')) {
    if (/טלפון|מתקשרים/.test(t)) channels.push('טלפון');
    if (WHATSAPP_WORD.test(t)) channels.push('וואטסאפ');
    if (/(ב|דרך ה)אתר/.test(t)) channels.push('אתר');
  }
  if (/אין (לנו |לי )?(משלוחים|הזמנות|הזמנה אונליין)|רק במקום|לא עושים משלוחים|רק איסוף|בלי משלוחים/.test(t)) owner('conversion.ordering', false);
  else if (channels.length) owner('conversion.ordering', channels.length === 1 ? channels[0]! : channels);

  if (/יש (לי |לנו )?(המון |הרבה |כמה |מלא )?(תמונות|צילומים)|צילמתי|צילמנו/.test(t)) owner('media.realPhotos', true);
  else if (/אין (לי|לנו) (תמונות|צילומים)|בלי תמונות|אין צילומים|עדיין אין תמונות/.test(t)) owner('media.realPhotos', false);
  else if (waits('media.realPhotos') && (u.yes || u.no || DECLINE_RE.test(t))) owner('media.realPhotos', u.yes);

  const budget = t.match(/תקציב(?: של| חודשי של| חודשי)?\s*(?:כ-?)?(\d[\d,]*)/) ?? t.match(/(\d[\d,]*)\s?(?:₪|ש"ח|שקל|שקלים)\s?(?:ל|ב)חודש/);
  if (budget) owner('budget.monthlyIls', Number(budget[1]!.replace(/,/g, '')));

  // "אין לנו אתר": an answer (the destination does not exist), not a gap.
  if (DECLINE_RE.test(t) || /^לא$/.test(t)) {
    for (const k of awaiting)
      if (['channel.website', 'channel.instagram', 'contact.whatsapp', 'conversion.orderUrl', 'conversion.bookingUrl', 'conversion.ordering', 'location.address'].includes(k) && !facts.some((f) => f.key === k))
        owner(k, false);
  }
  if (/אין (לנו |לי )?אתר/.test(t)) owner('channel.website', false);
  // Naming another channel answers a link question: "נרשמים בוואטסאפ" means there is no booking link.
  const otherChannel = /(ב|דרך ה?)(וואטסאפ|ווטסאפ|טלפון|אינסטגרם|הודעה|דיירקט)|מתקשרים|שולחים הודעה/.test(t);
  for (const k of ['conversion.bookingUrl', 'conversion.orderUrl'] as const)
    if (waits(k) && otherChannel && !facts.some((f) => f.key === k)) owner(k, false);
  if (/אין (לנו |לי )?(אינסטגרם|אינסטה)/.test(t)) owner('channel.instagram', false);

  if (!facts.some((f) => awaiting.includes(f.key))) {
    const first = awaiting.map((k) => fallbacks.find((f) => f.key === k)).find(Boolean);
    if (first) for (const p of [first, ...first.extra]) owner(p.key, p.value);
    if (first) u.guessed = [first.key, ...first.extra.map((p) => p.key)];
  }

  // ── Offer ──
  const price = parsePrice(t);
  const validity = parseValidity(t, ctx.now);
  const isBudgetSentence = Boolean(budget);
  const offerWords = /מבצע|הנחה|1\+1|אחד פלוס אחד|הטבה|קופון|%|חינם|במתנה/.test(t);
  if (offerWords || waits('offer.current')) {
    const patch: Partial<OfferFact> = {};
    const text = offerText(t, [price?.phrase ?? '', validity?.phrase ?? '']);
    if (text) patch.text = text;
    if (price && !isBudgetSentence) patch.price = price.price;
    if (validity?.validUntil) patch.validUntil = validity.validUntil;
    if (validity?.ongoing) patch.ongoing = true;
    if (Object.keys(patch).length) u.offerPatch = patch;
  }

  // ── Intent ──
  u.objective = objectiveIn(t);
  if (/השבוע/.test(t)) u.window = 'השבוע';
  else if (/החודש/.test(t)) u.window = 'החודש';

  const productMatch = t.match(/(?:נקדם|לקדם|תקדם|קדם|לפרסם|נפרסם|תפרסם|פרסומת ל|פרסומת על|קמפיין ל|קמפיין על|מודעה ל|מודעה על|סרטון ל|סרטון על)\s+(?:השבוע |החודש |היום |עכשיו )?(?:את\s+)?([^,.?!]{2,50})/);
  if (productMatch) {
    const text = clean(productMatch[1]!.replace(/\s+(השבוע|החודש|היום|עכשיו)$/, ''));
    if (text && !/^(העסק|המבצע|מבצע|הנחה|המקום|הסטודיו|העגלה|המסעדה)/.test(text)) u.product = { text, isNew: /חדש|חדשה/.test(text) };
  }

  const modifyVerb = /(תשנה|לשנות|שנה|תחליף|להחליף|תתקן|לתקן|תעדכן|לעדכן|שינוי ב?)\s/;
  const styleChange = /(משהו|גרסה|עיצוב|כיוון|סגנון)\s+(יותר\s+)?(יוקרתי|יוקרתית|נועז|נועזת|רגוע|נקי|מינימליסטי|אלגנטי)|יותר (יוקרתי|יוקרתית|נועז|רגוע|נקי|אלגנטי|מעודן)|תבליט את המחיר|להבליט את המחיר|כותרת גדולה יותר|פחות טקסט|כיוון (עיצובי )?אחר|נסה כיוון|הטיפוגרפיה פשוטה/;
  const opening = /פתיחה|הפתיחה|התחלה|ההתחלה|הוק|השניות הראשונות|פתיח|(ת|שי|י)פתח (ב|עם)|(ת|שי|י)תחיל (ב|עם)/;
  const openWith = /^(תפתח|שיפתח|יפתח|תתחיל|שיתחיל|יתחיל) (ב|עם)|שהפתיחה תהיה|שההתחלה תהיה/;
  // "מה אתה יודע לעשות?" asks about the Director, not the business: "יודע" needs an object.
  if (/(מה|תזכיר לי מה|ספר לי מה) (אתה )?(זוכר|רשמת|שמרת)|(מה|תזכיר לי מה|ספר לי מה) (אתה )?יודע (עליי|עלי|עלינו|על ה?עסק)/.test(t)) u.asksProfile = true;
  if (u.forbidden) u.intent = 'FORBIDDEN';
  else if (/^(נסה שוב|תנסה שוב|שוב|retry|נסה עוד פעם)(\s|$|[.!])/.test(t)) u.intent = 'RETRY';
  else if (/^(מאשר|מאשרת|אני מאשר|אני מאשרת|מאושר|אשר|approved?|approve)(\s|$|[.!])/i.test(t)) u.intent = 'APPROVE_TEXT';
  else if (/מה (נשאר|עוד צריך|ממתין|מחכה|פתוח)|מה ה?סטטוס|איפה (זה )?עומד|מה המצב|ממתין לאישור|מחכה לאישור|לאישור\?/.test(t)) u.intent = 'STATUS';
  else if (/(איזה|אילו|מה|כמה) (פרסומות|מודעות|קמפיינים|סרטונים)|מה (כבר )?(הכנו|עשינו)|הפרסומות (ש|הקודמות)|היסטוריה/.test(t)) u.intent = 'HISTORY';
  else if (openWith.test(t) || (modifyVerb.test(t) && /פתיחה|התחלה|הוק|כותרת|סרטון|מודעה|עיצוב|צבע|תמונה|טקסט|מוזיקה|קריינות|פתיח|קריין/.test(t)) || styleChange.test(t)) {
    u.intent = 'MODIFY';
    const target: RevisionTarget = opening.test(t) ? 'VIDEO_OPENING' : styleChange.test(t) || /עיצוב|כותרת|צבע|תמונה|מודעה/.test(t) ? 'DIRECTION' : 'VIDEO_OTHER';
    const quoted = t.match(/"([^"]{2,120})"/);
    const residue = t
      .replace(modifyVerb, ' ')
      .replace(/(?<=^|\s)(את|של|ה?סרטון|ה?מודעה|ה?פרסומת|ה?קודם|ה?קודמת|ה?אחרון|ה?אחרונה|ה?ראשון|ה?פתיחה|ה?התחלה|ה?הוק|פתיח|בבקשה|לי|רק|קצת)(?=\s|$)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    u.modify = {
      target,
      instruction: t,
      hasContent: Boolean(quoted) || target === 'DIRECTION' || openWith.test(t) || residue.split(' ').filter((w) => w.length > 1).length >= 2,
      reference: /ה?קודם|ה?קודמת|ה?אחרון|ה?אחרונה|ששלחת|שהכנו עכשיו/.test(t) ? 'LATEST' : /הראשון שהכנו|הראשונה שהכנו/.test(t) ? 'FIRST' : 'NONE',
    };
  } else if (/מה (כדאי|מומלץ|אתה ממליץ|לדעתך)|תמליץ|המלצה|מה הצעד הבא|מה לעשות (עכשיו|השבוע|החודש)|במה להתמקד/.test(t)) u.intent = 'RECOMMEND';
  else if (u.product?.isNew || /השקה|משיקים|להשיק|חדש בתפריט/.test(t)) u.intent = 'LAUNCH';
  else if (offerWords && /(יש (לנו|לי)|רוצה|לפרסם|לקדם|נפרסם|נקדם|בוא|עושים|מתחיל|מתחילים)/.test(t)) u.intent = 'PROMOTION';
  else if (wantsOutcome || u.growth) u.intent = 'CAMPAIGN';
  else if (/(קמפיין|פרסומת|פרסומות|מודעה|מודעות|פרסום|סרטון|ריל|רילס)/.test(t) && /(רוצה|צריך|צריכה|בוא|בואו|תכין|להכין|לעשות|נעשה|תעזור|אפשר)/.test(t))
    u.intent = 'CAMPAIGN';
  else if (u.product && /(נקדם|לקדם|תקדם|לפרסם|נפרסם)/.test(t)) u.intent = 'CAMPAIGN';
  else if (/^(היי|שלום|הי|בוקר טוב|ערב טוב|צהריים טובים|אהלן|מה נשמע|מה קורה)(\s|$|[.!,])/.test(t) && facts.length === 0) u.intent = 'GREETING';
  else if (facts.length || u.offerPatch) u.intent = 'PROVIDE_INFO';

  if (!['MODIFY', 'FORBIDDEN'].includes(u.intent)) {
    const choice = parseChoice(t);
    if (choice !== undefined && t.split(' ').length <= 6) u.choice = choice;
  }
  if (ctx.awaitingInstruction && u.intent === 'UNKNOWN') u.intent = 'PROVIDE_INFO';
  return u;
}
