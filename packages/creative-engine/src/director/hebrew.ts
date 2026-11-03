import type { BusinessModel, FactKey, FactProposal, MarketingAction, MarketingObjective, OfferFact, RevisionTarget } from '@kampora/shared';
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
  /** "בכל זאת תכין קמפיין ממומן": the owner chooses paid ads after hearing why not now. */
  insists?: boolean;
  /** "תכין תוכן לאינסטגרם, בלי ממומן": content for the business's own channels. */
  wantsOrganic?: boolean;
  /** The LLM's professional read of what to do next (checked by the brain; evidence quotes the owner). */
  decisionHint?: { action: MarketingAction; blocker?: string; evidence: string; paidAds: 'YES' | 'NO' | 'UNCLEAR' };
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
/** Regions, not cities: enough to advise and to describe the business, too wide to target a local ad. */
export const REGIONS = ['השרון', 'גוש דן', 'המרכז', 'השפלה', 'הצפון', 'הדרום', 'הגליל העליון', 'הגליל המערבי', 'הגליל', 'הנגב', 'העמק', 'עמק יזרעאל', 'הקריות', 'הכרמל', 'אזור ירושלים', 'יהודה ושומרון', 'הערבה'];
// "השרון" but not "הוד השרון" or "רמת השרון" (cities).
const REGION_RE = new RegExp(`(?:^|[\\s,(])(?:באזור |אזור |ב|מ|ל)?(?<!הוד |רמת )(${REGIONS.join('|')}|שרון)(?=$|[\\s,.!?)])`);
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
    re: /סטודיו (ל|של )?(פילאטיס|יוגה|כושר|אימונים|ריקוד|ספינינג|אגרוף|TRX)|פילאטיס|יוגה|חדר כושר|מכון כושר|אימוני כושר|קרוספיט|ספינינג|סטודיו לריקוד|בית ספר לריקוד|אומנויות לחימה/,
    category: (m) => (/יוגה/.test(m[0]) ? 'סטודיו ליוגה' : /פילאטיס/.test(m[0]) ? 'סטודיו לפילאטיס' : /ספינינג/.test(m[0]) ? 'סטודיו לספינינג' : 'סטודיו לכושר'),
  },
  {
    model: 'RESTAURANT',
    re: /מסעדת [א-ת]+|מסעדה|המבורגרי+[הא]|בורגר בר|בורגרי+[הא]|פיצרי+[הא]|שווארמ[הא]|פלאפל|סושי|ביסטרו|דיינר|גריל בר|מעדני+[הא]|חומוסי+[הא]|ג'חנון|מלאווח|בורקס|קייטרינג|אוכל ביתי|דוכן אוכל|פוד ?טראק|סביח|טאקו|ראמן/,
    category: (m) => (/מסעדה$/.test(m[0]) ? 'מסעדה' : /המבורגרי|בורגרי|בורגר בר/.test(m[0]) ? 'מסעדת המבורגרים' : /פיצרי/.test(m[0]) ? 'פיצרייה' : m[0]),
  },
  { model: 'CAFE', re: /בית (ה)?קפה|קפה שכונתי|קונדיטורי+[הא]|מאפי+[הא]|בייקרי|גלידרי+[הא]|גלידה|יוגורט קפוא|בר מיצים|שוקולטרי+[הא]/, category: (m) => m[0].replace('בית הקפה', 'בית קפה') },
  {
    model: 'BEAUTY',
    re: /מספרה|מספרת|ברברשופ|קוסמטיק[הא]|קוסמטיקאית|ציפורניים|מניקור|לק ג'ל|גבות|ריסים|מכון יופי|טיפולי פנים|הסרת שיער/,
    category: (m) => m[0],
  },
  {
    model: 'LOCAL_SERVICE',
    re: /אינסטלטור|חשמלאי|שיפוצ(ים|ניק)|הובלות|חברת ניקיון|ניקיון בתים|מנעולן|גנן|גינון|טכנאי|מוסך|מזגנים|מאלף כלבים|מאלפת כלבים|אילוף כלבים|דוג ?ווקר|פנסיון לכלבים|מספרה לכלבים|פיזיותרפיסט(?:ית)?|קלינאי(?:ת)? תקשורת|רפלקסולוג(?:ית)?|מטפל(?:ת)? (?:רגשי|רגשית|זוגי|זוגית|בשיאצו)|צלם(?:ת)? (?:אירועים|חתונות|משפחה)|מורה פרטי(?:ת)?|שיעורים פרטיים|מתווך|מתווכת|הנהלת חשבונות|רואה חשבון|עורך דין|עורכת דין/,
    category: (m) => m[0],
  },
  {
    model: 'ECOMMERCE',
    re: /חנות (אונליין|אינטרנטית|באינטרנט|ברשת|וירטואלית)|אתר מכירות|שופיפיי|shopify|מוכר(ת|ים)? (באתר|אונליין|ברשת)|מוכר(ת|ים)? [^.!?]{2,60} (?:דרך |ב)ה?אתר( שלי| שלנו)?(?=\s|$|[.,!?])/i,
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
  { re: /(?:קהל|לקוחות) (?:קבוע|קבועים)[^!?]{0,90}(?:שיבואו|שיחזרו|יבואו|יחזרו) (?:יותר|לעתים קרובות|יותר פעמים|שוב)|(?:שיבואו|שיחזרו) יותר (?:פעמים|לעתים קרובות)/, objective: 'RETENTION' },
  { re: /שיגיעו|שיבואו|יגיעו|יבואו|לקוחות (למקום|לעגלה|לחנות|לסטודיו)|תנועה (לחנות|למקום)|שיכנסו/, objective: 'VISITS' },
  { re: /לקוחות חוזרים|שיחזרו|נאמנות|לקוחות קבועים/, objective: 'RETENTION' },
  { re: /השקה|משיקים|להשיק|נשיק/, objective: 'PRODUCT_LAUNCH' },
  { re: /ש?יכירו|מודעות|חשיפה|ש?ידעו עלינו|ש?ישמעו עלינו|יותר אנשים (יכירו|ידעו|ישמעו)|לא (?:יודעים|מכירים|שמעו) (?:ש?אני|ש?אנחנו|אותי|אותנו|עליי|עלי|עלינו)/, objective: 'LOCAL_AWARENESS' },
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
  // "עד ה-15 בנובמבר", "15 לנובמבר 2026", "עד 15 בדצמבר": a day and a month name.
  if ((mm = t.match(new RegExp(`(?:ה-?)?(\\d{1,2}) (?:ב|ל)(${MONTHS.join('|')})(?: (\\d{4}))?`)))) {
    const day = Number(mm[1]);
    const month = MONTHS.indexOf(mm[2]!) + 1;
    let year = mm[3] ? Number(mm[3]) : y;
    if (day < 1 || day > lastDay(year, month)) return undefined;
    if (!mm[3] && iso(year, month, day) < iso(y, m, d)) year += 1;
    return { validUntil: iso(year, month, day), phrase: mm[0] };
  }
  // "עד ה-15 לחודש", "עד ה-20": this month, or next month when the day has passed.
  if ((mm = t.match(/עד (?:ה-?)(\d{1,2})(?: לחודש| בחודש| החודש)?(?=$|[\s.,!?])/))) {
    const day = Number(mm[1]);
    let [year, month] = [y, m];
    if (day < d) [year, month] = m === 12 ? [y + 1, 1] : [y, m + 1];
    if (day < 1 || day > lastDay(year, month)) return undefined;
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

/** "נרות ריחניים דרך האתר שלי" → "נרות ריחניים": where it is sold is a channel, not part of the product. */
export function stripChannel(value: string): string {
  return value
    .replace(/\s+(?:דרך|ב|באמצעות|גם ב|וגם ב)\s?(?:ה)?(?:אתר|אינסטגרם|אינסטה|פייסבוק|טיקטוק|וולט|wolt|תן ביס|וואטסאפ|ווטסאפ|חנות(?: האונליין| אונליין)?|אפליקציה|רשת|משלוחים)(?:\s+(?:שלי|שלנו|שלו|שלה))?(?:\s.*)?$/i, '')
    .replace(/\s+(?:אונליין|ברשת|באינטרנט)$/, '')
    .trim();
}

function clean(value: string): string {
  return value
    .replace(/^(זה|הוא|היא|זה ה|קוראים לו|קוראים לה|קוראים לנו|השם הוא|ה?שם:?)\s+/, '')
    .replace(/[\s.!?,:;]+$/, '')
    .replace(/^["']+|["']+$/g, '')
    .trim();
}

const NAME_STOP = new RegExp(`\\s+(?:(?:וב|ב|ל)(?:${CITIES.join('|')})|ש|שנמצא|שנמצאת|ויש|ואנחנו|ואני|וגם|עם|ליד|באזור|ברחוב|כבר|מאז)(?=\\s|$)`);

const NOT_A_BUSINESS = /^(?:בעיה|שאלה|תקציב|מבצע|אתר|קמפיין|לקוחות|הרבה|מקום|רעיון|עמוד|אינסטגרם|פייסבוק|קהל|רשימת|לינק|קישור|תמונות|כמה|עוד|מלא|את|לך|לו|לה|מה|חנות אונליין)(?:\s|$)/;
const BUSINESS_STOP = /^(?:קטן|קטנה|קטנים|חדש|חדשה|שכונתי|שכונתית|ביתי|ביתית|עם|כבר|ש|של|כי|ו|אבל|ואני|ויש)$/;

/** "יש לי בר נודלס קטן בחדרה" → "בר נודלס": the business as the owner names it, when no known kind matches. */
function unknownBusiness(t: string): string | undefined {
  const m = t.match(/(?:יש לי|יש לנו|פתחתי|פתחנו|אני מעביר(?:ה)?|אנחנו מעבירים|אני מנהל(?:ת)?|אני בעל(?:ת)?)\s+(?:לפני (?:חודש|שבוע|שנה|חודשיים|שבועיים|שנתיים|כמה (?:חודשים|שבועות|שנים)|\d+ (?:חודשים|שבועות|שנים))\s+)?(?:עסק (?:של|ל)\s*)?([^,.!?]{2,60})/);
  if (!m || NOT_A_BUSINESS.test(m[1]!)) return undefined;
  const words: string[] = [];
  for (const w of m[1]!.split(/\s+/)) {
    // Stop at a size word, a city ("בחדרה"), or a place after the kind ("סדנאות בישול ברעננה").
    if (BUSINESS_STOP.test(w) || CITY_RE.test(` ${w}`) || REGION_RE.test(` ${w}`) || (words.length >= 2 && /^ב/.test(w))) break;
    words.push(w);
    if (words.length === 3) break;
  }
  const name = words.join(' ').trim();
  return name.length >= 2 && !/\d/.test(name) ? name : undefined;
}

function extractName(t: string): string | undefined {
  const quoted = t.match(/(?:בשם|שנקרא|שנקראת|נקרא|נקראת|קוראים ל(?:ו|ה|נו|עסק|מסעדה|חנות|סטודיו|קליניקה|עגלה|מקום|מאפייה|ה?עסק שלי|ה?עסק שלנו)|שם ה(?:עסק|מסעדה|חנות|סטודיו|קליניקה|מקום)(?: הוא|:)?)\s*"([^"]{2,40})"/);
  if (quoted) return quoted[1]!.trim();
  const m = t.match(/(?:בשם|שנקרא|שנקראת|קוראים ל(?:ו|ה|נו|עסק|מסעדה|חנות|סטודיו|קליניקה|עגלה|מקום|מאפייה)|שם ה(?:עסק|מסעדה|חנות|סטודיו|קליניקה|מקום)(?: הוא|:)?|השם (?:שלו|שלה|שלנו) (?:הוא )?)\s+([^,.!?\n"]{2,60})/);
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

/** "אין לי שקל לפרסום", "בלי תקציב": no ad budget at all ("אין תקציב גדול" is a small budget, not none). */
export const NO_BUDGET_RE =
  /אין (?:לי |לנו )?(?:שקל|כסף|תקציב) (?:ל|בשביל |על )(?:פרסום|פרסומות|מודעות|קמפיין|שיווק)|אין (?:לי |לנו )?תקציב(?! (?:גדול|גבוה|רב|ענק|מספיק))|בלי (?:שום )?תקציב|אפס תקציב|תקציב (?:של )?(?:אפס|0)(?!\d)|אין (?:לי |לנו )?כסף לפרסם/;

/** "היומן שלי מלא לחודשיים", "אין תורים פנויים": the business cannot take more customers right now. */
const CAPACITY_FULL_RE =
  /(?:היומן|יומן|התורים|הלו"ז|הלוז|השיעורים|הקבוצות|הקליניקה|הסטודיו)(?: שלי| שלנו)? (?:מלא|מלאה|מלאים|מלאות|מפוצץ|מפוצצת|מפוצצים|תפוס|תפוסה|תפוסים)(?! ב?חלקית)|אין (?:לי |לנו )?(?:תורים|מקומות|מקום) (?:פנויים|פנויות|פנוי)|רשימת המתנה|בתפוסה מלאה|(?:לא|אין) (?:מספיק|מספיקה|מספיקים|יכול|יכולה|יכולים|לי איך|לנו איך) (?:לקבל|לקלוט) (?:עוד|יותר) (?:לקוחות|לקוחות חדשים|תורים|מטופלות|מטופלים|מתאמנים|מתאמנות)/;

/** "יש לנו מקומות פנויים בשיעורי ניסיון": there is room for new customers. */
const ROOM_RE =
  /יש (?:לי |לנו )?(?:עוד )?(?:מקום|מקומות|תורים|משבצות|שעות) (?:פנוי|פנויים|פנויות|ריקים|ריקות)|(?:מקומות|תורים|משבצות) (?:פנויים|פנויות) ב|השיעורים (?:לא מלאים|חצי ריקים|ריקים)|יש מקום ל(?:עוד )?(?:לקוחות|מתאמנים|מתאמנות|מטופלות)|(?:ה)?(?:אופניים|מקומות|מזרנים|כיסאות|שולחנות|תורים|משבצות|שיעורים)[^.!?]{0,15} (?:ריקים|ריקות|לא מלאים|לא מלאות)|(?:המטבח|המקום|הסטודיו|המסעדה) (?:די |כמעט )?ריק|יש (?:לנו |לי )?מקום ל(?:עוד |הרבה )?(?:יותר )?(?:הזמנות|לקוחות)/;

/** "בערב אין מי שיענה", "האתר לא עובד", "נכנסים לאתר ולא קונים": customers who already want to buy get stuck. */
const CONVERSION_PROBLEM_RE =
  /אין מי (?:שיענה|שעונה|שיענו|שעונים|שיחזיר)|(?:אף אחד |אין אף אחד ש)?לא (?:עונה|עונים|עונות) (?:ל)?(?:טלפון|טלפונים|שיחות|הודעות|וואטסאפ)|לא (?:מספיק|מספיקה|מספיקים) לענות|מפספס(?:ת|ים)? (?:שיחות|הזמנות|פניות|הודעות|לקוחות)|(?:שיחות|הזמנות|פניות|הודעות) (?:נופלות|הולכות לאיבוד|מתפספסות|לא נענות)|(?:האתר|הקישור|דף ההזמנה|דף ההזמנות|מערכת ההזמנות|מערכת ההרשמה|הלינק|הקופה|התשלום) (?:לא עובד|לא עובדת|נפל|נפלה|שבור|שבורה|תקוע|תקועה|נתקע|נתקעת)|(?:לקוחות|אנשים) (?:מתייאשים|מוותרים|נוטשים|מנתקים)|(?:נכנסים|נכנסו|מגיעים|הגיעו|באים|מבקרים|ביקרו) (?:ל|ב)?(?:ה)?(?:אתר|חנות)[^.!?]{0,30}(?:אבל |ו)?(?:לא|כמעט לא|אף אחד לא|כמעט אף אחד לא) (?:קונים|קונה|קנו|קנה|מזמינים|הזמינו|הזמין|השלים|השלימו|משלימים)|(?:הרבה|מלא|המון) (?:כניסות|מבקרים|תנועה)[^.!?]{0,30}(?:אבל |ו)?(?:כמעט |אף )?(?:אין|לא|אף אחד לא|מעט) ?(?:קניות|מכירות|קונים|קונה|הזמנות)|נוטשים (?:בעגלה|את העגלה|בקופה)|עגלות נטושות|לא (?:מצליחים|מצליחות|מצליח) (?:להשיג|לתפוס|להזמין|להירשם|לקבוע|להגיע אלי)|(?:הטלפון|הוואטסאפ) (?:לא מפסיק לצלצל|תפוס|לא מפסיק)|(?:מוסיפים|שמים|מכניסים) (?:ל|ב)(?:סל|עגלה)[^.!?]{0,50}(?:אבל|ו)|מחכים (?:חצי שעה|שעה|הרבה) (?:לתשובה|למענה)|(?:המשלוח|המשלוחים|ההזמנה|ההזמנות) (?:לוקח|לוקחים|לוקחת|מגיע|מגיעים|מגיעה)[^.!?]{0,20}(?:שעה|שעתיים|הרבה זמן)|(?:יש )?ביטולים|ביקורות (?:של )?(?:כוכב אחד|רעות|גרועות)|צריך להירשם כדי לקנות|(?:דמי )?(?:ה)?משלוח[^.!?]{0,30}(?:רק בסוף|בסוף התשלום)/;

/** "הקמפיין הקודם הביא הרבה צפיות אבל אפס הזמנות": what earlier marketing did, in the owner's words. */
const PERFORMANCE_RE =
  /(?:היו|היה|קיבלנו|קיבלתי|קיבל)(?: לא מעט| הרבה| מעט| כמה)? (?:קליקים|לחיצות|חשיפות|צפיות)|(?:הקמפיין|המודעה|הפרסום|הסרטון|הפרסומת)(?: הקודם| הקודמת| האחרון| האחרונה| שעשינו)?[^.!?]{0,60}(?:היה|הייתה|לא הגיעו|כמעט לא הגיעו|הביא|הביאה|עשה|עשתה|קיבל|קיבלה|היו לו|היו לה|לא הביא|לא הביאה)/;

/** "מה לעשות?", "איך לשפר?", "תייעץ לי": the owner asks for advice, not for a campaign. */
const ADVICE_RE =
  /מה (?:היית עושה|היית ממליץ|כדאי|מומלץ|אתה ממליץ|לדעתך|לעשות|(?:ה)?הכי (?:נכון|כדאי|חשוב)|נכון לעשות|אני עושה|אני אמור|עושים|אפשר לעשות|הייתי צריך|הצעד הבא|לשפר)|תמליץ|המלצה|תייעץ|לייעץ|עצה|במה להתמקד|איך (?:אני )?(?:אפשר )?(?:לשפר|להביא|להגדיל|למלא|למשוך|לגרום|מביאים|משפרים|ממלאים)|מה אתה אומר|שווה (?:לי )?(?:לפרסם|לעשות פרסום|קמפיין)|כדאי (?:לי )?(?:לפרסם|לעשות פרסום|לעשות קמפיין|קמפיין)|(?:להגדיל|להוסיף|להעלות|לשים) (?:את )?(?:ה)?(?:פרסום|תקציב|כסף)[^.!?]{0,20}\?|(?:^|\s)לפרסם\?|מאיפה (?:מתחילים|להתחיל|אני מתחיל|אני מתחילה)|איך (?:הכי )?(?:נכון|כדאי|מומלץ|עדיף)|מה (?:לשנות|אני משנה|משנים)|זה (?:יעזור|ישתלם|שווה|יעבוד)\?|(?:אני )?(?:שוקל|שוקלת|שוקלים) (?:ל|אם)|יש (?:לך|לכם) (?:רעיון|רעיונות)|(?:תן|תני|תנו) (?:לי )?(?:רעיון|רעיונות)|מה דעתך/;

/** "בכל זאת תכין קמפיין": the owner chooses paid ads after hearing why not now. */
const INSISTS_RE = /בכל זאת|בכל מקרה|למרות (?:זאת|זה|הכל)|אני עדיין רוצה|עדיין רוצה (?:קמפיין|פרסום|מודעה)|ממומן בכל זאת/;
/** Content for the business's own channels, not paid promotion. */
const ORGANIC_RE = /אורגני|אורגנית|בלי (?:קידום )?ממומן|לא ממומן|תוכן (?:לאינסטגרם|לרשתות|לטיקטוק|לפייסבוק|לעמוד)|פוסטים (?:לאינסטגרם|לעמוד)|תוכן בחינם/;

/** Messages that ask for something (not answers to the Director's question). */
const REQUEST_RE =
  /(רוצה|צריך|צריכה|בוא|בואו|תכין|להכין|נעשה|תעזור) .*(קמפיין|פרסומת|פרסום|מודעה|מודעות|סרטון|לקדם|לפרסם)|קמפיין|מה נשאר|מה הסטטוס|איזה (פרסומות|מודעות)|(תשנה|לשנות|תחליף|תתקן) |נקדם|לקדם|מה כדאי|תמליץ|נסה שוב|בכל זאת/;

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
  else if (/(תעלה|להעלות|העלה|תוציא|להוציא) (את )?(המודעה|הקמפיין|הפרסומת)? ?לאוויר|(תפעיל|להפעיל|הפעל|תריץ) (את )?(הקמפיין|המודעה|המודעות|הפרסום)|(?<![א-ת])(תפרסם|פרסם) (את )?(המודעה|הקמפיין|הסרטון|עכשיו|במטא|בפייסבוק|באינסטגרם)|\bpublish\b|go live/i.test(t))
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
  } else if (!waits('business.model') && unknownBusiness(t)) {
    owner('business.model', 'OTHER');
    owner('business.category', unknownBusiness(t)!);
  } else if (bare && waits('business.model') && !u.skip && !u.yes && !u.no && !/\d{3}|https?:|www\.|מזמינים|בטלפון|בוואטסאפ/.test(t) && t.split(' ').length <= 6) {
    fallback('business.model', 'OTHER', [{ key: 'business.category', value: clean(t).slice(0, 80) }]);
  }

  const city = t.match(CITY_RE);
  const region = city ? null : t.match(REGION_RE);
  if (city && (selfDesc || waits('location.city') || /נמצא|נמצאת|נמצאים|ממוקם|ממוקמת|עומד|עומדת|באזור|פועל|פועלת/.test(t)))
    owner('location.city', CANONICAL_CITY[city[1]!] ?? city[1]!);
  // "באזור השרון" is a region: kept as one, never stored as the city.
  else if (region && (selfDesc || waits('location.city') || waits('location.region') || waits('location.serviceArea') || /נמצא|נמצאת|נמצאים|באזור|פועל|פועלת|עובד|עובדת|עובדים/.test(t)))
    owner('location.region', region[1] === 'שרון' ? 'השרון' : region[1]!);
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

  const main = t.match(/(?:המנה|המוצר|השירות|הדבר|השיעור)(?: הכי)? (?:נמכר|נמכרת|פופולרי|פופולרית|מבוקש|מבוקשת|חשוב|חשובה)(?: אצלנו| שלנו| שלי)? (?:הוא |היא |זה )?((?!שלנו|שלי|אצלנו)[^,.!?]{2,60})/)
    ?? t.match(/(?:אנחנו |אני )(?:מוכרים|מוכר|מוכרת|מגישים|מגיש|מגישה|מתמחים ב|מתמחה ב|מעבירים|מעבירה)\s+([^,.!?]{2,60})/);
  if (main && !paired && stripChannel(clean(main[1]!))) owner('offering.main', stripChannel(clean(main[1]!)));
  else if (bare && waits('offering.main') && !u.skip && !DECLINE_RE.test(t) && stripChannel(clean(t))) fallback('offering.main', stripChannel(clean(t)).slice(0, 120));


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
    // "אפשר להירשם דרך הקישור": a link the owner names as the way to sign up or book is the booking page.
    else if (BOOKING_HOSTS.test(url) || waits('conversion.bookingUrl') || /להירשם|הרשמה|נרשמים|לקבוע תור|קובעים תור|זימון תורים/.test(t)) owner('conversion.bookingUrl', url);
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
  if (waits('conversion.ordering') || /(?:מזמינים|הזמנות|להזמין)[^.!?,]{0,15} (?:ב|דרך ה?)(?:טלפון|וואטסאפ|ווטסאפ|אתר)/.test(t)) {
    if (/טלפון|מתקשרים/.test(t)) channels.push('טלפון');
    if (WHATSAPP_WORD.test(t)) channels.push('וואטסאפ');
    if (/(ב|דרך ה)אתר/.test(t)) channels.push('אתר');
  }
  if (/אין (?:לנו |לי )(?:משלוחים|הזמנות)|אין (?:משלוחים|הזמנה אונליין|הזמנות אונליין)|רק במקום|לא עושים משלוחים|רק איסוף|בלי משלוחים/.test(t)) owner('conversion.ordering', false);
  else if (channels.length) owner('conversion.ordering', channels.length === 1 ? channels[0]! : channels);

  if (/יש (לי |לנו )?(המון |הרבה |כמה |מלא )?(תמונות|צילומים)|צילמתי|צילמנו/.test(t)) owner('media.realPhotos', true);
  else if (/אין (לי|לנו) (תמונות|צילומים)|בלי תמונות|אין צילומים|עדיין אין תמונות/.test(t)) owner('media.realPhotos', false);
  else if (waits('media.realPhotos') && (u.yes || u.no || DECLINE_RE.test(t))) owner('media.realPhotos', u.yes);

  const budget =
    t.match(/תקציב(?: של| חודשי של| חודשי)?\s*(?:כ-?)?(\d[\d,]*)/) ??
    t.match(/(\d[\d,]*)\s?(?:₪|ש"ח|שקל|שקלים)\s?(?:ל|ב)חודש/) ??
    t.match(/(\d[\d,]*)\s?(?:₪|ש"ח|שקל|שקלים)\s?(?:לפרסום|לשיווק|למודעות|לקמפיין)/);
  if (budget) owner('budget.monthlyIls', Number(budget[1]!.replace(/,/g, '')));
  else if (NO_BUDGET_RE.test(t) || (waits('budget.monthlyIls') && (DECLINE_RE.test(t) || /^(אין|כלום|אפס|0)$/.test(t)))) owner('budget.monthlyIls', 0);

  // Situations that come before buying reach: room for more customers, customers who cannot complete the buy,
  // and what earlier marketing did. Each is kept in the owner's own words.
  if (CAPACITY_FULL_RE.test(t)) owner('capacity.full', true);
  else if (ROOM_RE.test(t)) owner('capacity.full', false);
  const result = PERFORMANCE_RE.test(t) ? t.split(/[.!?;]/).find((x) => PERFORMANCE_RE.test(x)) : undefined;
  // The clause that describes the problem: "רוצה קמפיין, אבל בערב אין מי שיענה" keeps only what comes after "אבל".
  let problem = t.split(/[,.!?;]/).find((x) => CONVERSION_PROBLEM_RE.test(x));
  problem ??= t.split(/[.!?;]/).find((x) => CONVERSION_PROBLEM_RE.test(x));
  const after = problem?.split(/\s(?:אבל|אך|רק ש)\s/).pop();
  if (after && CONVERSION_PROBLEM_RE.test(after)) problem = after;
  if (result) owner('performance.notes', clean(result).slice(0, 200));
  // The answer to "where did the last campaign stall?": "ראו הרבה אבל כמעט לא לחצו".
  else if (bare && waits('performance.notes') && !u.skip && /ראו|צפו|לחצו|הזמינו|קנו|נרשמו|פנו|חשיפ|לחיצ|קליק/.test(t)) owner('performance.notes', clean(t).slice(0, 200));
  else if (problem) owner('conversion.problem', clean(problem).replace(/^ו(?=[א-ת])/, '').slice(0, 160));

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

  // "קמפיין לפיצה משפחתית" (the ל written onto the product) as well as "נקדם את הפיצה".
  const productMatch = t.match(/(?:(?:נקדם|לקדם|תקדם|קדם|לפרסם|נפרסם|תפרסם|פרסומת על|קמפיין על|מודעה על|סרטון על)\s+|(?:פרסומת|קמפיין|מודעה|סרטון)(?: ממומן| ממומנת| אורגני| אורגנית)? ל(?!י(?:\s|$)|נו(?:\s|$)|כם(?:\s|$)|ך(?:\s|$))\s*)(?:השבוע |החודש |היום |עכשיו )?(?:את\s+)?([^,.?!]{2,50})/);
  if (productMatch) {
    const text = clean(productMatch[1]!.replace(/\s+(השבוע|החודש|היום|עכשיו)$/, '').replace(/\s+(?:שלי|שלנו)$/, ''));
    if (text && !/^(ה?עסק|ה?מבצע|הנחה|המקום|הסטודיו|העגלה|המסעדה|אינסטגרם|פייסבוק|טיקטוק|גוגל|וולט|רשתות|חודש|שבוע|חג)/.test(text)) u.product = { text, isNew: /חדש|חדשה/.test(text) };
  }

  const modifyVerb = /(תשנה|לשנות|שנה|תחליף|להחליף|תתקן|לתקן|תעדכן|לעדכן|שינוי ב?)\s/;
  const styleChange = /(משהו|גרסה|עיצוב|כיוון|סגנון)\s+(יותר\s+)?(יוקרתי|יוקרתית|נועז|נועזת|רגוע|נקי|מינימליסטי|אלגנטי)|יותר (יוקרתי|יוקרתית|נועז|רגוע|נקי|אלגנטי|מעודן)|תבליט את המחיר|להבליט את המחיר|כותרת גדולה יותר|פחות טקסט|כיוון (עיצובי )?אחר|נסה כיוון|הטיפוגרפיה פשוטה/;
  const opening = /פתיחה|הפתיחה|התחלה|ההתחלה|הוק|השניות הראשונות|פתיח|(ת|שי|י)פתח (ב|עם)|(ת|שי|י)תחיל (ב|עם)/;
  const openWith = /^(תפתח|שיפתח|יפתח|תתחיל|שיתחיל|יתחיל) (ב|עם)|שהפתיחה תהיה|שההתחלה תהיה/;
  // "מה אתה יודע לעשות?" asks about the Director, not the business: "יודע" needs an object.
  if (INSISTS_RE.test(t)) u.insists = true;
  if (ORGANIC_RE.test(t)) u.wantsOrganic = true;
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
  } else if (ADVICE_RE.test(t) && !u.insists) u.intent = 'RECOMMEND';
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
