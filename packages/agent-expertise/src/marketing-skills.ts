import type { BusinessModel, FactKey, MarketingAction, MarketingObjective } from '@kampora/shared';

/**
 * Marketing decision skills: how a professional reads a small business's situation before choosing a channel. The
 * Campaign Director's decision engine reads them directly. Contraindications say when an action wastes money,
 * responses say what to do in a situation, plays give the steps, checklist, question and measurement for an action.
 * The digest is the one line the LLM sees, so prompts stay small. Versioned like the role playbooks: every decision
 * records the skills (id@version) that shaped it.
 *
 * Texts may use {problem}, {destination} and {product}; the engine fills them from the owner's own words.
 */

export const MARKETING_SKILLS_VERSION = '1.0.0';

/** What a professional notices in the situation, derived from confirmed memory and campaign history. */
export type MarketingSignal =
  /** Customers who already want to buy get stuck (an unanswered phone, a broken link, an abandoned checkout). */
  | 'CONVERSION_BLOCKER'
  /** Reach or visits without purchases (an earlier campaign with views and no orders). */
  | 'TRAFFIC_NO_SALES'
  /** An earlier campaign did not deliver, and where it stalled is not known yet. */
  | 'UNDERPERFORMED'
  /** An earlier ad was seen but few responded: the message or the offer, not the reach. */
  | 'LOW_ENGAGEMENT'
  /** An earlier ad reached few people: the reach (budget, duration, area), not the message. */
  | 'LOW_REACH'
  /** Nowhere working to send customers yet. */
  | 'NO_DESTINATION'
  | 'DESTINATION_READY'
  | 'FULL_CAPACITY'
  /** The owner said there is room (open trial spots, free appointment slots). */
  | 'ROOM_AVAILABLE'
  | 'NO_BUDGET'
  | 'BUDGET_SET'
  | 'RETENTION_GOAL'
  | 'AWARENESS_GOAL'
  | 'LAUNCH'
  /** Earlier campaigns exist. */
  | 'RETURNING';

export interface SkillStep {
  action: MarketingAction;
  text: string;
  /** When this step comes ("אחרי שבוע שהטלפון נענה"); null when now. */
  when?: string;
}

export interface SkillPlay {
  steps: readonly SkillStep[];
  /** What the owner checks or changes themselves. Kampora does not change outside systems. */
  checklist?: readonly string[];
  /** The one question whose answer changes this play. key null: free text, nothing is stored from it. */
  question?: { key: FactKey | null; text: string; why: string };
  primaryMetric: string;
  secondaryMetrics?: readonly string[];
  method: string;
}

/**
 * Whether the play buys reach. INCLUDED: it does. IF_BUDGET: only with a budget (asked when unknown). A fixed verdict
 * says why paid ads wait in this play even when nothing forbids them.
 */
export type PaidInPlay = 'INCLUDED' | 'IF_BUDGET' | { verdict: 'LATER' | 'NOT_NOW'; why: string; condition: string | null };

export interface SkillResponse {
  signal: MarketingSignal;
  action: MarketingAction;
  /** Why this comes first, in Hebrew, for the owner. */
  why: string;
  paid: PaidInPlay;
  play: SkillPlay;
}

export interface Contraindication {
  signal: MarketingSignal;
  avoid: MarketingAction;
  why: string;
  /** LATER with this condition; absent: NOT_NOW. */
  until?: string;
}

export interface MarketingSkill {
  id: string;
  version: string;
  title: string;
  /** Applies when any listed model, objective or signal matches; a skill with none listed always applies. */
  models?: readonly BusinessModel[];
  objectives?: readonly MarketingObjective[];
  signals?: readonly MarketingSignal[];
  diagnostics: readonly string[];
  principles: readonly string[];
  contraindications: readonly Contraindication[];
  responses: readonly SkillResponse[];
  /** Plays per action, for when another rule or the model chose the action. */
  plays: Partial<Record<MarketingAction, SkillPlay>>;
  examples: readonly { situation: string; action: MarketingAction; why: string }[];
  /** One line for the LLM prompt (English, at most ~200 characters). */
  digest: string;
}

export const skillTag = (s: Pick<MarketingSkill, 'id' | 'version'>) => `${s.id}@${s.version}`;

const step = (action: MarketingAction, text: string, when?: string): SkillStep => ({ action, text, ...(when ? { when } : {}) });

const v = MARKETING_SKILLS_VERSION;

const CONVERSION_METHOD = 'לרשום שבוע אחד כמה פניות נכנסו וכמה מהן הושלמו, לתקן, ולספור שוב שבוע אחרי.';

export const PAID_ADS_ECONOMICS: MarketingSkill = {
  id: 'paid-ads-economics',
  version: v,
  title: 'כלכלת פרסום ממומן',
  diagnostics: ['יש לאן לשלוח לקוחות, והדרך הזו עובדת?', 'יש מקום ללקוחות חדשים?', 'יש תקציב שאפשר להפסיד בניסיון?'],
  principles: [
    'פרסום ממומן מגביר את מה שכבר עובד; הוא לא מתקן דרך שבורה.',
    'מתחילים קטן ובזמן מוגבל, ומודדים מול השבועות שלפני.',
    'ממומן מתאים כשיש לאן לשלוח, יש מקום ללקוחות ויש תקציב לניסיון.',
  ],
  contraindications: [
    { signal: 'CONVERSION_BLOCKER', avoid: 'PAID_ADVERTISING', why: 'פרסום יביא עוד אנשים לאותה נקודה שבה לקוחות נתקעים, ויבזבז כסף.', until: 'כשהדרך לקנות עובדת גם בשעות העומס' },
    { signal: 'TRAFFIC_NO_SALES', avoid: 'PAID_ADVERTISING', why: 'כבר יש צפיות או כניסות שלא הופכות לקנייה. עוד חשיפה לא תתקן את זה.', until: 'כשנבין למה מי שהגיע לא קנה, ונתקן' },
    { signal: 'NO_DESTINATION', avoid: 'PAID_ADVERTISING', why: 'אין עדיין לאן לשלוח לקוחות, אז מודעה לא תוביל לשום פעולה.', until: 'כשתהיה דרך ברורה ליצור קשר או לקנות' },
    { signal: 'UNDERPERFORMED', avoid: 'PAID_ADVERTISING', why: 'להריץ שוב קמפיין דומה בלי לדעת איפה הקודם נתקע יביא כנראה תוצאה דומה.', until: 'כשנדע איפה הקמפיין הקודם נתקע' },
    { signal: 'FULL_CAPACITY', avoid: 'PAID_ADVERTISING', why: 'אין כרגע מקום ללקוחות חדשים. פרסום יביא פניות שאי אפשר לקבל, ייצור המתנה ותסכול, ולא יוסיף הכנסה.' },
    { signal: 'NO_BUDGET', avoid: 'PAID_ADVERTISING', why: 'אמרת שאין תקציב לפרסום, אז לא נבנה תוכנית שתלויה במודעות ממומנות.' },
  ],
  responses: [
    {
      signal: 'DESTINATION_READY',
      action: 'PAID_ADVERTISING',
      why: 'יש לאן לשלוח לקוחות ({destination}) ולא סיפרת על משהו שעוצר אותם, אז הצעד עם ההשפעה הכי גדולה הוא חשיפה ממוקדת לאנשים שעוד לא מכירים אתכם, בהיקף קטן שנמדוד.',
      paid: 'INCLUDED',
      play: {
        steps: [
          step('PAID_ADVERTISING', 'מודעה ממוקדת לאנשים באזור שעוד לא מכירים אתכם, בהיקף קטן ובזמן מוגבל'),
          step('PAID_ADVERTISING', 'המודעה שולחת ישר ל{destination}, בלי דף נחיתה באמצע'),
          step('ORGANIC_CONTENT', 'במקביל: אותו תוכן גם בערוצים שלכם, בחינם'),
        ],
        primaryMetric: 'כמה לקוחות הגיעו מהמודעה לעומת השבועיים שלפני',
        method: 'להשוות לשבועיים שלפני הקמפיין, מהקופה, מהיומן או מדוח אפליקציית ההזמנות.',
      },
    },
    {
      signal: 'FULL_CAPACITY',
      action: 'OFFER_OPTIMIZATION',
      why: 'אין כרגע מקום ללקוחות חדשים, אז הבעיה היא לא שאנשים לא מכירים אתכם. כשהביקוש גבוה מהקיבולת, מחיר, רשימת המתנה ושמירה על הלקוחות הקיימים מוסיפים הכנסה; עוד חשיפה לא.',
      paid: { verdict: 'NOT_NOW', why: 'אין מקום ללקוחות שפרסום יביא.', condition: null },
      play: {
        steps: [
          step('OFFER_OPTIMIZATION', 'לבדוק העלאת מחיר ללקוחות חדשים: ביקוש שעולה על הקיבולת הוא בדיוק הסימן לזה'),
          step('CUSTOMER_RETENTION', 'רשימת המתנה מסודרת, עם עדכון כשמתפנה מקום'),
          step('BUSINESS_RESEARCH', 'לבדוק אם אפשר להוסיף קיבולת (שעות, עוד איש צוות) לפני שמביאים עוד לקוחות'),
        ],
        primaryMetric: 'הכנסה ממוצעת ללקוח, וכמה אנשים ברשימת ההמתנה',
        method: 'להשוות את ההכנסה החודשית ואת רשימת ההמתנה לחודש שלפני השינוי.',
      },
    },
    {
      signal: 'UNDERPERFORMED',
      action: 'BUSINESS_RESEARCH',
      why: 'קמפיין שלא הביא תוצאות נתקע באחד משלושה מקומות: מעט אנשים ראו אותו, ראו ולא הגיבו, או הגיבו ולא קנו. לכל אחד מהם תיקון אחר, אז קודם בודקים איפה.',
      paid: { verdict: 'LATER', why: 'להריץ שוב בלי לדעת איפה זה נתקע יביא כנראה תוצאה דומה.', condition: 'כשנדע איפה הקמפיין הקודם נתקע' },
      play: {
        steps: [
          step('BUSINESS_RESEARCH', 'לבדוק בדוח של הקמפיין הקודם: כמה ראו, כמה לחצו, וכמה מהם קנו או הזמינו'),
          step('OFFER_OPTIMIZATION', 'לשנות רק את החלק שנתקע: ההיקף, המסר וההצעה, או הדרך לקנות'),
          step('PAID_ADVERTISING', 'להריץ שוב בהיקף קטן, ולהשוות לקמפיין הקודם', 'אחרי שנדע איפה זה נתקע'),
        ],
        question: { key: 'performance.notes', text: 'מה ראית בתוצאות של הקמפיין הקודם: מעט אנשים ראו אותו, ראו ולא לחצו, או לחצו ולא הזמינו?', why: 'כל אחת מהתשובות מובילה לתיקון אחר.' },
        primaryMetric: 'איפה הקמפיין הקודם נתקע: חשיפה, לחיצות או קנייה',
        method: 'לקרוא את דוח הקמפיין הקודם (חשיפות, לחיצות) ולהשוות למספר ההזמנות באותם ימים.',
      },
    },
    {
      signal: 'LOW_ENGAGEMENT',
      action: 'OFFER_OPTIMIZATION',
      why: 'אנשים ראו את המודעה ולא הגיבו, אז ההיקף לא הבעיה: המסר או ההצעה לא שכנעו. עוד תקציב על אותה מודעה לא ישנה את זה; מודעה חדשה עם הצעה ברורה יותר כן.',
      paid: 'INCLUDED',
      play: {
        steps: [
          step('OFFER_OPTIMIZATION', 'הצעה אחת ברורה במקום כמה: מוצר אחד, מחיר או הטבה, ומה עושים עכשיו'),
          step('PAID_ADVERTISING', 'מודעה חדשה שפותחת במוצר עצמו ובהצעה, בהיקף קטן כמו הקודמת'),
          step('BUSINESS_RESEARCH', 'להשוות את הלחיצות למודעה הקודמת אחרי שבוע'),
        ],
        primaryMetric: 'לחיצות על המודעה החדשה לעומת הקודמת, באותו היקף',
        method: 'אותו תקציב ואותו אזור כמו הקמפיין הקודם, כדי שההבדל יהיה רק במסר.',
      },
    },
    {
      signal: 'LOW_REACH',
      action: 'PAID_ADVERTISING',
      why: 'מעט אנשים ראו את המודעה, אז אי אפשר עוד לדעת אם המסר עובד. הצעד הוא לתת לה להגיע ליותר אנשים באזור הנכון: זמן ריצה ארוך יותר, אזור מדויק, או תקציב יומי שמספיק.',
      paid: 'INCLUDED',
      play: {
        steps: [
          step('PAID_ADVERTISING', 'להריץ שוב לזמן ארוך יותר באזור מדויק, עם תקציב יומי קבוע'),
          step('BUSINESS_RESEARCH', 'לבדוק אחרי שבוע כמה ראו וכמה לחצו, ורק אז לשנות את המסר'),
        ],
        primaryMetric: 'כמה אנשים באזור ראו את המודעה, ואחר כך כמה לחצו',
        method: 'להשוות לדוח של הקמפיין הקודם: חשיפות ולחיצות.',
      },
    },
    {
      signal: 'NO_DESTINATION',
      action: 'CONVERSION_PROCESS_FIX',
      why: 'אין עדיין דרך ברורה ללקוח שמתעניין ליצור קשר או לקנות. קודם צריך שיהיה לאן לשלוח אותו, ורק אחר כך להביא קהל.',
      paid: { verdict: 'LATER', why: 'מודעה בלי יעד לא מובילה לשום פעולה.', condition: 'כשתהיה דרך ברורה ליצור קשר או לקנות' },
      play: {
        steps: [
          step('CONVERSION_PROCESS_FIX', 'לבחור דרך אחת ברורה: קישור הזמנה, וואטסאפ עסקי או כתובת לניווט'),
          step('LOCAL_VISIBILITY', 'לשים אותה בביו, בפרופיל הגוגל ובשלט במקום'),
        ],
        primaryMetric: 'כמה פניות מגיעות דרך הערוץ החדש',
        method: CONVERSION_METHOD,
      },
    },
  ],
  plays: {},
  examples: [
    { situation: 'המבורגרייה עם קישור וולט שעובד, מקום להזמנות ותקציב חודשי', action: 'PAID_ADVERTISING', why: 'כל התנאים לפרסום מתקיימים' },
    { situation: 'קליניקה שהיומן שלה מלא לחודשיים', action: 'OFFER_OPTIMIZATION', why: 'הבעיה היא קיבולת, לא חשיפה' },
  ],
  digest: 'Paid ads amplify what already works: only with a working destination, room for customers and a budget to test; start small, time-boxed, measured against the weeks before.',
};

export const CONVERSION_RATE: MarketingSkill = {
  id: 'conversion-rate',
  version: v,
  title: 'שיפור המרה',
  signals: ['CONVERSION_BLOCKER', 'TRAFFIC_NO_SALES'],
  diagnostics: ['איפה בדיוק לקוח שרוצה לקנות נתקע?', 'כמה פניות או ביקורים לא הופכים לקנייה?', 'יש דרך שנייה להשלים קנייה בלי לחכות?'],
  principles: [
    'קודם לסגור את הדליפה, אחר כך להגדיל את הזרם.',
    'לבדוק את המסלול בעצמך, כמו לקוח, בשעה הכי עמוסה.',
    'תיקון שאפשר למדוד בשבוע עדיף על שינוי גדול.',
  ],
  contraindications: [],
  responses: [
    {
      signal: 'CONVERSION_BLOCKER',
      action: 'CONVERSION_PROCESS_FIX',
      why: 'לקוחות שכבר רוצים לקנות נתקעים בדרך ("{problem}"). פרסום עכשיו יביא עוד אנשים לאותה נקודה, אז קודם סוגרים את זה.',
      paid: 'INCLUDED',
      play: {
        steps: [
          step('CONVERSION_PROCESS_FIX', 'לתקן את הנקודה שבה לקוחות נתקעים: {problem}'),
          step('CONVERSION_PROCESS_FIX', 'להוסיף דרך שנייה להשלים קנייה בלי לחכות, למשל קישור או וואטסאפ'),
          step('PAID_ADVERTISING', 'פרסום קטן שנמדוד', 'אחרי שבוע שבו הדרך עובדת'),
        ],
        checklist: ['לעבור על המסלול בעצמכם כמו לקוח', 'לרשום כמה פניות נכנסו וכמה הושלמו בשבוע אחד', 'לבדוק שהקישורים בביו ובגוגל עובדים'],
        primaryMetric: 'כמה פניות נכנסו וכמה מהן הושלמו',
        secondaryMetrics: ['פניות שלא נענו בשבוע'],
        method: CONVERSION_METHOD,
      },
    },
    {
      signal: 'TRAFFIC_NO_SALES',
      action: 'CONVERSION_PROCESS_FIX',
      why: 'אנשים כבר רואים אתכם ("{problem}"), אבל זה לא הופך לקנייה. עוד חשיפה תביא עוד צפיות; קודם צריך להבין איפה הם עוצרים.',
      paid: 'INCLUDED',
      play: {
        steps: [
          step('BUSINESS_RESEARCH', 'לבדוק לאן הגיעו מי שלחצו, והאם הדרך משם לקנייה ברורה'),
          step('OFFER_OPTIMIZATION', 'הצעה אחת ברורה עם מחיר, אותה הצעה במודעה ובדף'),
          step('PAID_ADVERTISING', 'לנסות שוב בהיקף קטן ולמדוד קנייה, לא צפיות', 'אחרי התיקון'),
        ],
        question: { key: 'performance.notes', text: 'כשאנשים לחצו על המודעה הקודמת, לאן הם הגיעו, ומה קרה שם?', why: 'זה מה שמבדיל בין בעיה במודעה לבעיה בדרך לקנות, וכל אחת מתוקנת אחרת.' },
        primaryMetric: 'כמה מהלחיצות הפכו לקנייה או לפנייה',
        method: 'להשוות את מספר הקניות למספר הלחיצות, לפני התיקון ואחריו.',
      },
    },
  ],
  plays: {},
  examples: [{ situation: 'חנות אונליין עם הרבה כניסות וכמעט בלי קניות', action: 'CONVERSION_PROCESS_FIX', why: 'עוד תנועה לאתר שלא ממיר שורפת כסף' }],
  digest: 'Conversion first: when interested customers get stuck (unanswered phone, broken link, abandoned checkout) or views do not turn into sales, fix and measure the path before buying more reach.',
};

export const LOCAL_RESTAURANT: MarketingSkill = {
  id: 'local-restaurant',
  version: v,
  title: 'מסעדה מקומית',
  models: ['RESTAURANT'],
  diagnostics: ['איך רוב ההזמנות מגיעות: וולט, טלפון, אתר או במקום?', 'עונים לטלפון בשעות העומס?', 'יש מנת דגל אחת להראות?'],
  principles: [
    'מנה אחת בולטת מוכרת יותר ממודעה על כל התפריט.',
    'המודעה שולחת לערוץ ההזמנה שכבר עובד, לא לדף נחיתה חדש.',
    'השעות שלפני הארוחות הן חלון ההחלטה.',
  ],
  contraindications: [],
  responses: [
    {
      signal: 'CONVERSION_BLOCKER',
      action: 'CONVERSION_PROCESS_FIX',
      why: 'לקוחות שכבר רוצים להזמין נתקעים ("{problem}") והולכים למקום אחר. פרסום עכשיו יביא עוד הזמנות לאותה נקודה, אז קודם סוגרים את זה.',
      paid: 'INCLUDED',
      play: {
        steps: [
          step('CONVERSION_PROCESS_FIX', 'מענה בשעות העומס: מישהו שאחראי על ההזמנות, או הודעה קולית שמפנה להזמנה אונליין'),
          step('CONVERSION_PROCESS_FIX', 'קישור להזמנה אונליין בביו, בגוגל ובהודעה הקולית, כדי שאפשר יהיה להזמין בלי לחכות'),
          step('PAID_ADVERTISING', 'מודעה קטנה ברדיוס המשלוחים, ונמדוד', 'אחרי שבוע שבו ההזמנות נענות'),
        ],
        checklist: [
          'לבדוק ביומן השיחות כמה שיחות לא נענו בערב אחד',
          'מי אחראי לענות בשעות העומס',
          'יש הודעה קולית או מענה אוטומטי שמפנה להזמנה אונליין?',
          'הקישור להזמנה מופיע בגוגל ובאינסטגרם?',
        ],
        question: {
          key: 'conversion.ordering',
          text: 'יש לכם הזמנה אונליין (וולט, תן ביס או אתר) שאפשר להפנות אליה במקום הטלפון?',
          why: 'אם יש, אפשר להפנות לשם לקוחות כבר עכשיו, וגם מודעה תשלח לשם ולא לטלפון.',
        },
        primaryMetric: 'הזמנות שהושלמו בערב, לעומת שיחות שלא נענו',
        method: 'שבוע אחד לספור שיחות שלא נענו (ביומן השיחות) והזמנות שהושלמו, לתקן, ולספור שוב שבוע אחרי.',
      },
    },
    {
      signal: 'LAUNCH',
      action: 'COMBINED_STRATEGY',
      why: 'מנה חדשה כדאי להכריז קודם למי שכבר מכיר אתכם, בחינם, ואז להראות אותה לאנשים חדשים באזור. יש לאן לשלוח ({destination}), אז פרסום קטן מתאים כאן.',
      paid: 'INCLUDED',
      play: {
        steps: [
          step('ORGANIC_CONTENT', 'להכריז ללקוחות הקיימים: סטורי, פוסט ושלט בקופה'),
          step('PAID_ADVERTISING', 'מודעה קטנה ברדיוס המשלוחים עם {product} בתקריב, שולחת ל{destination}'),
          step('BUSINESS_RESEARCH', 'לבדוק כמה מהמנה החדשה נמכרה בשבועיים הראשונים', 'אחרי שבועיים'),
        ],
        primaryMetric: 'כמה מנות של {product} נמכרו בשבועיים הראשונים',
        secondaryMetrics: ['הזמנות בשבוע בערוץ שהמודעה שולחת אליו'],
        method: 'לספור מהקופה או מדוח אפליקציית ההזמנות, ולהשוות למנה דומה.',
      },
    },
  ],
  plays: {
    PAID_ADVERTISING: {
      steps: [
        step('PAID_ADVERTISING', 'מודעה עם מנת הדגל בתקריב, ברדיוס המשלוחים, בשעות שלפני הארוחות'),
        step('PAID_ADVERTISING', 'המודעה שולחת ישר ל{destination}'),
        step('ORGANIC_CONTENT', 'אותו סרטון גם בערוצים שלכם'),
      ],
      primaryMetric: 'הזמנות בשבוע בערוץ שהמודעה שולחת אליו',
      method: 'להשוות לשבועיים שלפני, מדוח אפליקציית ההזמנות או מהקופה.',
    },
    ORGANIC_CONTENT: {
      steps: [
        step('ORGANIC_CONTENT', 'סרטון קצר של הכנת מנת הדגל, פעם-פעמיים בשבוע'),
        step('ORGANIC_CONTENT', 'לשתף תמונות וביקורות של לקוחות, באישורם'),
        step('LOCAL_VISIBILITY', 'קישור ההזמנה בביו ובפרופיל הגוגל'),
      ],
      primaryMetric: 'הזמנות שמגיעות מהאינסטגרם או מגוגל',
      method: 'לשאול לקוחות חדשים איך שמעו עליכם, ולבדוק לחיצות על הקישור בביו.',
    },
    LOCAL_VISIBILITY: {
      steps: [
        step('LOCAL_VISIBILITY', 'פרופיל גוגל מעודכן: שעות, תפריט, תמונות אמיתיות וקישור להזמנה'),
        step('LOCAL_VISIBILITY', 'לבקש מלקוחות קבועים ביקורת בגוגל'),
        step('LOCAL_VISIBILITY', 'שיתוף פעולה עם עסק שכן או עם קבוצת השכונה'),
      ],
      primaryMetric: 'שיחות, ניווטים ולחיצות מפרופיל הגוגל',
      method: 'הנתונים בפרופיל העסק בגוגל, חודש לפני וחודש אחרי.',
    },
  },
  examples: [
    { situation: 'פיצרייה שבערב לא עונים בה לטלפון', action: 'CONVERSION_PROCESS_FIX', why: 'מודעה תביא עוד שיחות שלא ייענו' },
    { situation: 'מסעדה שמשיקה מנה חדשה ויש לה קישור הזמנה', action: 'COMBINED_STRATEGY', why: 'לקוחות קיימים בחינם, ואז פרסום קטן לקהל חדש' },
  ],
  digest: 'Restaurant: one hero dish beats the whole menu; ads go to the ordering channel that already works; an unanswered phone or broken order link is fixed before buying reach.',
};

export const FOOD_DELIVERY_FUNNEL: MarketingSkill = {
  id: 'food-delivery-funnel',
  version: v,
  title: 'משפך הזמנות אוכל',
  models: ['RESTAURANT', 'CAFE'],
  objectives: ['ORDERS'],
  diagnostics: ['כמה לחיצות מהמודעה עד הזמנה?', 'דמי משלוח ומינימום הזמנה גלויים מראש?', 'הדף באפליקציה נראה טוב: תמונות אמיתיות ומנה מומלצת?'],
  principles: [
    'מהמודעה להזמנה צריכה להיות לחיצה אחת.',
    'דמי משלוח או מינימום שמפתיעים בסוף מבריחים לקוחות.',
    'הדף באפליקציית ההזמנות הוא חלון הראווה: אותה מנה שבמודעה, בראש הדף.',
  ],
  contraindications: [],
  responses: [
    {
      signal: 'TRAFFIC_NO_SALES',
      action: 'CONVERSION_PROCESS_FIX',
      why: 'אנשים ראו את המודעה ("{problem}") אבל לא הזמינו. בדרך כלל זה הדף שאליו הם מגיעים או ההצעה, ולא המודעה עצמה. נבדוק את זה לפני שמשלמים על עוד חשיפה.',
      paid: 'INCLUDED',
      play: {
        steps: [
          step('CONVERSION_PROCESS_FIX', 'לעבור על הדף באפליקציית ההזמנות כמו לקוח: תמונות, מחירים, דמי משלוח וזמן משלוח'),
          step('OFFER_OPTIMIZATION', 'המנה מהמודעה בראש הדף, עם מחיר ברור'),
          step('PAID_ADVERTISING', 'לנסות שוב בהיקף קטן ולמדוד הזמנות, לא צפיות', 'אחרי התיקון'),
        ],
        checklist: ['הקישור במודעה מוביל ישר לדף ההזמנה, לא לדף כללי', 'דמי המשלוח והמינימום גלויים', 'יש תמונה אמיתית של המנה שבמודעה'],
        question: { key: 'performance.notes', text: 'כשאנשים לחצו על המודעה, לאן הם הגיעו, והאם ההזמנות באפליקציה עלו בכלל?', why: 'אם הגיעו לדף הנכון ולא הזמינו, הבעיה בדף או בהצעה; אם לא הגיעו, בקישור.' },
        primaryMetric: 'הזמנות מתוך הלחיצות על המודעה',
        method: 'לשים את הלחיצות מדוח המודעה ליד ההזמנות מאפליקציית ההזמנות, לפני ואחרי התיקון.',
      },
    },
  ],
  plays: {},
  examples: [{ situation: 'קמפיין קודם עם הרבה צפיות ומעט הזמנות בוולט', action: 'CONVERSION_PROCESS_FIX', why: 'הדף או ההצעה, לא החשיפה' }],
  digest: 'Food ordering funnel: one tap from ad to order page; surprise delivery fees or minimums kill orders; views without orders usually mean the order page or offer, not the ad.',
};

export const COFFEE_CART_CAFE: MarketingSkill = {
  id: 'coffee-cart-cafe',
  version: v,
  title: 'עגלת קפה ובית קפה',
  models: ['COFFEE_CART', 'CAFE'],
  diagnostics: ['איפה עומדים ובאילו שעות?', 'אנשים יודעים איפה אתם היום?', 'מה מביא לקוח לחזור מחר?'],
  principles: [
    'עגלה או בית קפה חיים מאנשים שעוברים בדרך ומלקוחות שחוזרים.',
    'מיקום ושעות ברורים חשובים יותר מעיצוב.',
    'קהל מקומי בונים קודם בחינם: שלט, גוגל, קבוצות השכונה.',
  ],
  contraindications: [],
  responses: [
    {
      signal: 'AWARENESS_GOAL',
      action: 'COMBINED_STRATEGY',
      why: 'כדי שיכירו אתכם באזור, הדבר הראשון הוא שיידעו איפה אתם ומתי, וזה לא עולה כסף. פרסום קטן ברדיוס הליכה יכול להאיץ את זה, אבל הוא לא הבסיס.',
      paid: 'IF_BUDGET',
      play: {
        steps: [
          step('LOCAL_VISIBILITY', 'לסמן את המקום: שלט בולט, ופרופיל גוגל עם המיקום והשעות'),
          step('ORGANIC_CONTENT', 'סטורי קבוע "איפה אנחנו היום" ושיתוף בקבוצות השכונה'),
          step('PAID_ADVERTISING', 'מודעה ברדיוס הליכה בשעות הבוקר', 'אם יש תקציב קטן לניסיון'),
        ],
        primaryMetric: 'כוסות בבוקר לעומת השבועות שלפני',
        secondaryMetrics: ['לקוחות חדשים שאומרים איך שמעו עליכם'],
        method: 'לספור כוסות בכל בוקר (או מהקופה), ולשאול לקוחות חדשים איך שמעו עליכם.',
      },
    },
  ],
  plays: {
    PAID_ADVERTISING: {
      steps: [
        step('PAID_ADVERTISING', 'מודעה ברדיוס הליכה סביב {destination}, בשעות הבוקר'),
        step('PAID_ADVERTISING', 'להראות את המקום ואת הקפה עצמו, לא רק לוגו'),
        step('CUSTOMER_RETENTION', 'סיבה לחזור אחרי הביקור הראשון: כרטיסייה או מאפה של הבוקר'),
      ],
      primaryMetric: 'כוסות בבוקר לעומת השבועות שלפני',
      method: 'לספור כוסות בכל בוקר, שבועיים לפני ובמהלך הקמפיין.',
    },
    ORGANIC_CONTENT: {
      steps: [
        step('ORGANIC_CONTENT', 'סטורי יומי: איפה אתם היום ומה חדש'),
        step('ORGANIC_CONTENT', 'סרטון קצר של הכנת הקפה, פעם בשבוע'),
        step('LOCAL_VISIBILITY', 'פרופיל גוגל עם המיקום והשעות'),
      ],
      primaryMetric: 'כוסות בבוקר לעומת השבועות שלפני',
      method: 'לספור כוסות בכל בוקר, ולשאול לקוחות חדשים איך שמעו עליכם.',
    },
    LOCAL_VISIBILITY: {
      steps: [
        step('LOCAL_VISIBILITY', 'שלט בולט במקום, עם השעות'),
        step('LOCAL_VISIBILITY', 'פרופיל גוגל עם המיקום, השעות ותמונות אמיתיות'),
        step('LOCAL_VISIBILITY', 'שיתוף פעולה עם עסק שכן או קבוצת השכונה'),
      ],
      primaryMetric: 'לקוחות חדשים בשבוע',
      method: 'לשאול לקוחות חדשים איך שמעו עליכם, ולספור.',
    },
    CUSTOMER_RETENTION: {
      steps: [
        step('CUSTOMER_RETENTION', 'כרטיסייה: הקפה העשירי עלינו'),
        step('ORGANIC_CONTENT', 'סטורי לעוקבים כשיש משהו חדש'),
      ],
      primaryMetric: 'כרטיסיות שהתמלאו בחודש',
      method: 'לספור כרטיסיות, ולהשוות לחודש שלפני.',
    },
  },
  examples: [{ situation: 'עגלת קפה חדשה שרוצה שיכירו אותה בשכונה', action: 'COMBINED_STRATEGY', why: 'מיקום ושעות ברורים בחינם, פרסום קטן רק אם יש תקציב' }],
  digest: 'Coffee cart/café: lives on passers-by and repeat visits; a clear location and hours come first (sign, Google profile, neighbourhood groups); small walking-radius ads only with a budget.',
};

export const FITNESS_MEMBERSHIP: MarketingSkill = {
  id: 'fitness-membership',
  version: v,
  title: 'סטודיו ומנויים',
  models: ['FITNESS_STUDIO'],
  diagnostics: ['יש מקום פנוי בשיעורים?', 'איך נרשמים לשיעור ניסיון?', 'מה קורה עם מי שהגיע לשיעור ניסיון?'],
  principles: [
    'מוכרים שיעור ניסיון, לא מנוי.',
    'מקום פנוי בשיעורים הוא בדיוק מה שכדאי לפרסם.',
    'הודעת מעקב אחרי שיעור הניסיון קובעת אם הוא יהפוך למנוי.',
  ],
  contraindications: [],
  responses: [
    {
      signal: 'ROOM_AVAILABLE',
      action: 'PAID_ADVERTISING',
      why: 'יש מקום בשיעורים, אז יש מה למכור. ההרשמה כבר קיימת ({destination}), ומודעה לשיעור ניסיון היא הצעד הישיר ביותר למלא אותם.',
      paid: 'INCLUDED',
      play: {
        steps: [
          step('PAID_ADVERTISING', 'מודעה לשיעור ניסיון, עם השעות שיש בהן מקום'),
          step('PAID_ADVERTISING', 'הרשמה בלחיצה: {destination}'),
          step('CUSTOMER_RETENTION', 'הודעת מעקב לכל מי שהגיע לשיעור ניסיון, באותו יום'),
        ],
        primaryMetric: 'הרשמות לשיעור ניסיון בשבוע',
        secondaryMetrics: ['כמה מהנרשמים הגיעו', 'כמה עברו למנוי'],
        method: 'רשימה פשוטה של מי נרשם, מי הגיע ומי המשיך, לעומת החודש שלפני.',
      },
    },
    {
      signal: 'FULL_CAPACITY',
      action: 'OFFER_OPTIMIZATION',
      why: 'השיעורים מלאים, אז הבעיה היא לא חשיפה. רשימת המתנה ומחיר נכון מנצלים את הביקוש שכבר יש.',
      paid: 'INCLUDED',
      play: {
        steps: [
          step('OFFER_OPTIMIZATION', 'רשימת המתנה לשיעורים המלאים'),
          step('OFFER_OPTIMIZATION', 'לבדוק את המחיר למנויים חדשים'),
          step('OFFER_OPTIMIZATION', 'לשקול שיעור נוסף בשעה הכי מבוקשת'),
        ],
        question: { key: null, text: 'יש שעות או ימים שבהם עדיין יש מקום?', why: 'אם יש, אפשר לפרסם דווקא אותם. אם אין, פרסום רק יאריך את רשימת ההמתנה.' },
        primaryMetric: 'כמה אנשים ברשימת ההמתנה',
        method: 'לספור את רשימת ההמתנה פעם בשבוע.',
      },
    },
  ],
  plays: {
    PAID_ADVERTISING: {
      steps: [step('PAID_ADVERTISING', 'מודעה לשיעור ניסיון'), step('PAID_ADVERTISING', 'הרשמה בלחיצה: {destination}'), step('CUSTOMER_RETENTION', 'מעקב אחרי שיעור הניסיון')],
      primaryMetric: 'הרשמות לשיעור ניסיון בשבוע',
      method: 'רשימה של מי נרשם ומי הגיע, לעומת החודש שלפני.',
    },
    ORGANIC_CONTENT: {
      steps: [step('ORGANIC_CONTENT', 'סרטון קצר משיעור (באישור המשתתפות)'), step('ORGANIC_CONTENT', 'מה מצפה למי שמגיעה לשיעור ניסיון'), step('LOCAL_VISIBILITY', 'קישור ההרשמה בביו')],
      primaryMetric: 'הרשמות לשיעור ניסיון מהאינסטגרם',
      method: 'לשאול כל נרשמת איך שמעה עליכם.',
    },
  },
  examples: [
    { situation: 'סטודיו לפילאטיס עם מקום פנוי בשיעורי ניסיון והרשמה בוואטסאפ', action: 'PAID_ADVERTISING', why: 'יש מה למכור ויש דרך להירשם' },
    { situation: 'סטודיו שכל השיעורים בו מלאים', action: 'OFFER_OPTIMIZATION', why: 'רשימת המתנה ומחיר, לא חשיפה' },
  ],
  digest: 'Fitness/membership: sell the trial class, not the membership; open spots are worth advertising; follow-up after the trial converts; a full schedule needs a waiting list or pricing, not ads.',
};

export const BEAUTY_APPOINTMENTS: MarketingSkill = {
  id: 'beauty-appointments',
  version: v,
  title: 'יופי ותורים',
  models: ['BEAUTY'],
  diagnostics: ['כמה מלא היומן בשבועות הקרובים?', 'יש ימים או שעות חלשים?', 'לקוחות קובעים את התור הבא לפני שהם יוצאים?'],
  principles: [
    'יומן מלא אומר שהביקוש גבוה מהקיבולת: זה זמן למחיר ולרשימת המתנה, לא לעוד חשיפה.',
    'משבצות פנויות מסוימות קל יותר למלא מ"יותר לקוחות".',
    'תוצאות אמיתיות (באישור הלקוחה) הן התוכן הכי משכנע.',
  ],
  contraindications: [],
  responses: [
    {
      signal: 'FULL_CAPACITY',
      action: 'OFFER_OPTIMIZATION',
      why: 'היומן מלא, אז הבעיה היא לא שאנשים לא מכירים אתכם. כשהביקוש גבוה מהקיבולת, מחיר ורשימת המתנה מנצלים אותו טוב יותר מעוד פניות.',
      paid: 'INCLUDED',
      play: {
        steps: [
          step('OFFER_OPTIMIZATION', 'לבדוק העלאת מחיר ללקוחות חדשות: יומן מלא הוא בדיוק הסימן לזה'),
          step('OFFER_OPTIMIZATION', 'רשימת המתנה, עם עדכון כשמתפנה תור'),
          step('CUSTOMER_RETENTION', 'לקבוע את התור הבא כבר ביציאה, כדי שהיומן יישאר יציב'),
        ],
        checklist: ['כמה שבועות קדימה היומן מלא', 'כמה פניות לא קיבלו תור החודש', 'מתי עודכן המחיר בפעם האחרונה'],
        question: { key: null, text: 'יש ימים או שעות שעדיין לא מלאים?', why: 'אם יש, אפשר למלא דווקא אותם, גם בפרסום קטן וממוקד. אם אין, פרסום רק יאריך את ההמתנה.' },
        primaryMetric: 'מחיר ממוצע לטיפול, וכמה אנשים ברשימת ההמתנה',
        method: 'להשוות את החודש שלפני השינוי לחודש שאחריו, מהיומן.',
      },
    },
    {
      signal: 'ROOM_AVAILABLE',
      action: 'PAID_ADVERTISING',
      why: 'יש תורים פנויים, אז יש מה למלא. יש גם דרך לקבוע ({destination}), אז פרסום ממוקד יכול למלא אותם.',
      paid: 'INCLUDED',
      play: {
        steps: [
          step('PAID_ADVERTISING', 'מודעה לטיפול אחד, עם תוצאה אמיתית (באישור)'),
          step('PAID_ADVERTISING', 'קביעת תור בלחיצה: {destination}'),
          step('CUSTOMER_RETENTION', 'לקבוע את התור הבא כבר ביציאה'),
        ],
        primaryMetric: 'תורים חדשים שנקבעו בשבוע',
        method: 'מהיומן, לעומת השבועיים שלפני.',
      },
    },
  ],
  plays: {
    ORGANIC_CONTENT: {
      steps: [step('ORGANIC_CONTENT', 'תוצאות לפני ואחרי, באישור הלקוחות'), step('ORGANIC_CONTENT', 'מאחורי הקלעים של טיפול'), step('LOCAL_VISIBILITY', 'קישור לקביעת תור בביו')],
      primaryMetric: 'פניות לקביעת תור מהאינסטגרם',
      method: 'לשאול כל לקוחה חדשה איך שמעה עליכם.',
    },
  },
  examples: [{ situation: 'קליניקה שהיומן שלה מלא לחודשיים', action: 'OFFER_OPTIMIZATION', why: 'מחיר ורשימת המתנה, לא עוד פניות' }],
  digest: 'Beauty/appointments: a full calendar means demand exceeds capacity, so price and a waiting list come before reach; specific free slots are easy to fill; real results (with consent) persuade.',
};

export const ECOMMERCE_FUNNEL: MarketingSkill = {
  id: 'ecommerce-funnel',
  version: v,
  title: 'משפך חנות אונליין',
  models: ['ECOMMERCE'],
  diagnostics: ['כמה מבקרים קונים, לפי נתוני האתר?', 'איפה עוזבים: דף מוצר, עגלה או תשלום?', 'האתר עובד טוב בטלפון?'],
  principles: [
    'קודם המרה, אחר כך תנועה: עוד מבקרים לאתר שלא ממיר זה כסף שנשרף.',
    'מחיר משלוח שמופיע רק בסוף הוא סיבה נפוצה לנטישה.',
    'רוב הקונים בטלפון: הקנייה צריכה לעבוד מצוין במובייל.',
  ],
  contraindications: [{ signal: 'CONVERSION_BLOCKER', avoid: 'PAID_ADVERTISING', why: 'עוד תנועה לאתר שלא ממיר תעלה כסף ולא תביא מכירות.', until: 'כשיותר מהמבקרים יקנו' }],
  responses: [
    {
      signal: 'CONVERSION_BLOCKER',
      action: 'CONVERSION_PROCESS_FIX',
      why: 'אנשים כבר מגיעים לאתר ("{problem}"), אבל לא קונים. זה המקום עם ההשפעה הכי גדולה: כל שיפור בהמרה מכפיל את מה שכבר משלמים עליו, ופרסום עכשיו רק יביא עוד מבקרים שלא יקנו.',
      paid: 'INCLUDED',
      play: {
        steps: [
          step('CONVERSION_PROCESS_FIX', 'לעבור על קנייה מהטלפון כמו לקוח, מדף המוצר ועד התשלום'),
          step('CONVERSION_PROCESS_FIX', 'להציג דמי משלוח וזמן אספקה כבר בדף המוצר'),
          step('CONVERSION_PROCESS_FIX', 'תמונות אמיתיות, פרטים מלאים וביקורות בדף המוצר'),
          step('PAID_ADVERTISING', 'פרסום קטן לדף המוצר, ומדידת קניות', 'כשיותר מהמבקרים יקנו'),
        ],
        checklist: [
          'כמה שלבים יש עד התשלום',
          'יש אמצעי תשלום מוכרים (כרטיס, ביט, פייפאל)?',
          'כמה זמן לוקח לדף להיטען בטלפון',
          'מחיר המשלוח מופיע לפני הקופה?',
          'יש דרך לשאול שאלה (וואטסאפ) לפני שקונים?',
        ],
        question: {
          key: null,
          text: 'איפה רוב האנשים עוזבים: בדף המוצר, בעגלה או בתשלום? אם יש לך את הנתונים של האתר (למשל בשופיפיי), הם יגידו לנו.',
          why: 'כל שלב מתוקן אחרת, ובלי לדעת איפה זה קורה אנחנו מנחשים.',
        },
        primaryMetric: 'אחוז המבקרים שקונים, לפי נתוני האתר',
        secondaryMetrics: ['עגלות שננטשו'],
        method: 'להשוות את אחוז ההמרה בנתוני האתר שבועיים לפני התיקון ושבועיים אחריו.',
      },
    },
  ],
  plays: {
    PAID_ADVERTISING: {
      steps: [step('PAID_ADVERTISING', 'מודעה למוצר אחד, שולחת ישר לדף המוצר ({destination})'), step('PAID_ADVERTISING', 'פרסום חוזר למי שביקר ולא קנה'), step('ORGANIC_CONTENT', 'אותו תוכן בערוצים שלכם')],
      primaryMetric: 'קניות מהמודעה לעומת העלות שלה',
      method: 'מנתוני האתר והמודעה, לעומת השבועיים שלפני.',
    },
    ORGANIC_CONTENT: {
      steps: [step('ORGANIC_CONTENT', 'סרטון קצר של המוצר בשימוש'), step('ORGANIC_CONTENT', 'ביקורות ותמונות של לקוחות, באישורם'), step('LOCAL_VISIBILITY', 'קישור לדף המוצר בביו')],
      primaryMetric: 'כניסות מהאינסטגרם וקניות מהן',
      method: 'מנתוני האתר: מקור התנועה והקניות.',
    },
  },
  examples: [{ situation: 'חנות עם הרבה כניסות ומעט קניות', action: 'CONVERSION_PROCESS_FIX', why: 'כל שיפור בהמרה מכפיל את התנועה הקיימת' }],
  digest: 'E-commerce: conversion before traffic; check mobile checkout, surprise shipping costs, product page proof; more visitors to a site that does not convert burns money.',
};

export const RETENTION: MarketingSkill = {
  id: 'retention',
  version: v,
  title: 'לקוחות חוזרים',
  objectives: ['RETENTION'],
  signals: ['RETENTION_GOAL'],
  diagnostics: ['איך מגיעים היום ללקוחות קיימים?', 'יש להם סיבה לחזור?', 'יש רשימה של לקוחות שהסכימו לקבל עדכונים?'],
  principles: ['להחזיר לקוח קיים זול יותר מלהביא חדש.', 'סיבה לחזור, ותזכורת בערוץ שכבר שלכם.', 'שולחים עדכונים רק למי שהסכים.'],
  contraindications: [],
  responses: [
    {
      signal: 'RETENTION_GOAL',
      action: 'CUSTOMER_RETENTION',
      why: 'המטרה היא שלקוחות קיימים יחזרו. אליהם מגיעים בחינם, בערוצים שכבר שלכם, אז לא צריך לקנות חשיפה כדי להתחיל.',
      paid: { verdict: 'LATER', why: 'ללקוחות קיימים מגיעים בחינם, בערוצים שכבר שלכם.', condition: 'אם תרצו להגיע גם למי שצפה בתכנים ועוד לא קנה, מודעה קטנה לקהל הזה' },
      play: {
        steps: [
          step('CUSTOMER_RETENTION', 'סיבה אחת ברורה לחזור: כרטיסייה, הטבה ללקוח חוזר או מוצר עונתי'),
          step('CUSTOMER_RETENTION', 'רשימת לקוחות שהסכימו לקבל עדכונים, והודעה כשיש סיבה לחזור'),
          step('ORGANIC_CONTENT', 'תוכן קבוע לעוקבים: מה חדש השבוע'),
        ],
        primaryMetric: 'לקוחות שחזרו החודש',
        secondaryMetrics: ['תגובות והודעות מלקוחות קיימים'],
        method: 'רשימה פשוטה של לקוחות קבועים או דוח הקופה, לעומת החודש שלפני.',
      },
    },
  ],
  plays: {},
  examples: [{ situation: 'עגלת קפה שרוצה שהקבועים יחזרו יותר', action: 'CUSTOMER_RETENTION', why: 'כרטיסייה ותזכורת בערוצים שלכם' }],
  digest: 'Retention: bringing back existing customers is cheaper than finding new ones; a reason to return plus a reminder in owned channels (with consent) before any paid retargeting.',
};

export const ORGANIC_SOCIAL: MarketingSkill = {
  id: 'organic-social',
  version: v,
  title: 'תוכן אורגני',
  signals: ['NO_BUDGET'],
  diagnostics: ['כמה זמן בשבוע יש לתוכן?', 'מה הכי מעניין לראות אצלכם?', 'לאן כל תוכן שולח?'],
  principles: ['תוכן אורגני עולה זמן, לא כסף: עקביות חשובה יותר מהפקה.', 'להראות את העסק האמיתי: אנשים, תהליך, לקוחות.', 'כל תוכן עם צעד ברור: קישור בביו, ניווט או וואטסאפ.'],
  contraindications: [],
  responses: [
    {
      signal: 'LAUNCH',
      action: 'COMBINED_STRATEGY',
      why: 'משהו חדש כדאי להכריז קודם למי שכבר מכיר אתכם, בחינם: הם הקונים הראשונים והסבירים ביותר. אחר כך מראים אותו לאנשים חדשים באזור.',
      paid: 'IF_BUDGET',
      play: {
        steps: [
          step('ORGANIC_CONTENT', 'להכריז ללקוחות הקיימים: פוסט, סטורי ושלט במקום, עם {product}'),
          step('ORGANIC_CONTENT', 'תוכן קצר של {product}: ההכנה, הטעימה הראשונה, תגובות של לקוחות'),
          step('PAID_ADVERTISING', 'פרסום קטן לאנשים באזור עם {product}'),
        ],
        primaryMetric: 'כמה מ{product} נמכר בשבועיים הראשונים',
        method: 'לספור מהקופה בשבועיים הראשונים ולהשוות למוצר דומה.',
      },
    },
    {
      signal: 'NO_BUDGET',
      action: 'COMBINED_STRATEGY',
      why: 'בלי תקציב לפרסום מתחילים במה שעולה זמן ולא כסף: תוכן מהעסק עצמו ונוכחות מקומית. זה איטי יותר מפרסום, אבל בונה בסיס.',
      paid: 'INCLUDED',
      play: {
        steps: [
          step('ORGANIC_CONTENT', '2–3 תכנים קצרים בשבוע מהעסק עצמו: המוצר, ההכנה, הלקוחות (באישורם)'),
          step('LOCAL_VISIBILITY', 'פרופיל גוגל מעודכן, וביקורות מלקוחות מרוצים'),
          step('LOCAL_VISIBILITY', 'שיתוף פעולה עם עסק שכן או עם קבוצת השכונה'),
        ],
        primaryMetric: 'לקוחות חדשים שאומרים שראו אתכם ברשת או בגוגל',
        secondaryMetrics: ['צפיות ושמירות של התכנים'],
        method: 'לשאול כל לקוח חדש איך שמע עליכם, ולספור פעם בשבוע.',
      },
    },
  ],
  plays: {
    ORGANIC_CONTENT: {
      steps: [
        step('ORGANIC_CONTENT', '2–3 תכנים קצרים בשבוע: המוצר, התהליך, הלקוחות (באישורם)'),
        step('ORGANIC_CONTENT', 'כל תוכן עם צעד ברור ל{destination}'),
        step('LOCAL_VISIBILITY', 'לבקש מלקוחות מרוצים לתייג ולשתף'),
      ],
      primaryMetric: 'לקוחות חדשים שאומרים שראו אתכם ברשת',
      secondaryMetrics: ['צפיות ושמירות של התכנים'],
      method: 'לשאול כל לקוח חדש איך שמע עליכם, ולספור פעם בשבוע.',
    },
  },
  examples: [{ situation: 'עסק מקומי בלי שקל לפרסום', action: 'COMBINED_STRATEGY', why: 'תוכן ונוכחות מקומית עולים זמן, לא כסף' }],
  digest: 'Organic social: costs time not money; consistency over production; show the real business; every post has one clear next step (link in bio, navigation, WhatsApp).',
};

export const LOCAL_AWARENESS: MarketingSkill = {
  id: 'local-awareness',
  version: v,
  title: 'היכרות מקומית',
  objectives: ['LOCAL_AWARENESS', 'BRAND'],
  signals: ['AWARENESS_GOAL'],
  diagnostics: ['מי גר או עובר בסביבה?', 'אפשר למצוא אתכם בגוגל?', 'יש שכנים או קהילות שאפשר לשתף איתם פעולה?'],
  principles: ['שיכירו אתכם באזור מתחיל בכך שאפשר למצוא אתכם: גוגל, שלט, המלצות.', 'קהילות מקומיות ושכנים מביאים אמון שמודעה לא קונה.', 'פרסום ממומן מקומי מאיץ, אבל לא מחליף נוכחות.'],
  contraindications: [],
  responses: [
    {
      signal: 'AWARENESS_GOAL',
      action: 'COMBINED_STRATEGY',
      why: 'כדי שיכירו אתכם באזור, קודם צריך שאפשר יהיה למצוא אתכם ולסמוך עליכם, וזה לא עולה כסף. פרסום מקומי קטן יכול להאיץ את זה.',
      paid: 'IF_BUDGET',
      play: {
        steps: [
          step('LOCAL_VISIBILITY', 'פרופיל גוגל מלא: שעות, תמונות אמיתיות, דרך ליצור קשר'),
          step('LOCAL_VISIBILITY', 'שיתוף פעולה עם עסק שכן או קבוצת השכונה'),
          step('PAID_ADVERTISING', 'מודעה מקומית קטנה', 'אם יש תקציב לניסיון'),
        ],
        primaryMetric: 'לקוחות חדשים בשבוע שאומרים איך שמעו עליכם',
        method: 'לשאול כל לקוח חדש איך שמע עליכם, ולספור פעם בשבוע.',
      },
    },
  ],
  plays: {
    LOCAL_VISIBILITY: {
      steps: [step('LOCAL_VISIBILITY', 'פרופיל גוגל מלא ומעודכן'), step('LOCAL_VISIBILITY', 'ביקורות מלקוחות מרוצים'), step('LOCAL_VISIBILITY', 'שיתוף פעולה עם עסק שכן')],
      primaryMetric: 'שיחות, ניווטים ולחיצות מפרופיל הגוגל',
      method: 'הנתונים בפרופיל העסק בגוגל, חודש לפני וחודש אחרי.',
    },
    BRAND_AWARENESS: {
      steps: [step('ORGANIC_CONTENT', 'סיפור העסק בכמה סרטונים קצרים'), step('LOCAL_VISIBILITY', 'נוכחות באירועים ובקבוצות מקומיות'), step('PAID_ADVERTISING', 'מודעת היכרות מקומית', 'אם יש תקציב')],
      primaryMetric: 'לקוחות חדשים שאומרים שראו אתכם',
      method: 'לשאול לקוחות חדשים איך שמעו עליכם.',
    },
  },
  examples: [{ situation: 'שירות מקומי חדש באזור', action: 'LOCAL_VISIBILITY', why: 'שיוכלו למצוא אתכם לפני שמשלמים על חשיפה' }],
  digest: 'Local awareness: being findable (Google profile, signage, reviews) and local partnerships come first and cost nothing; small local ads accelerate but do not replace presence.',
};

/** Every marketing skill, most specific first: business-type skills, then situations, then the general economics. */
export const MARKETING_SKILLS: readonly MarketingSkill[] = [
  LOCAL_RESTAURANT,
  FOOD_DELIVERY_FUNNEL,
  COFFEE_CART_CAFE,
  FITNESS_MEMBERSHIP,
  BEAUTY_APPOINTMENTS,
  ECOMMERCE_FUNNEL,
  RETENTION,
  CONVERSION_RATE,
  ORGANIC_SOCIAL,
  LOCAL_AWARENESS,
  PAID_ADS_ECONOMICS,
];

export interface SkillContext {
  model?: BusinessModel;
  objective?: MarketingObjective;
  signals: readonly MarketingSignal[];
}

/** The skills that apply to this business and situation, most specific first. */
export function skillsFor(ctx: SkillContext): MarketingSkill[] {
  return MARKETING_SKILLS.filter((s) => {
    if (!s.models && !s.objectives && !s.signals) return true;
    if (s.models && !(ctx.model && s.models.includes(ctx.model))) return false;
    if (s.objectives && s.models) return Boolean(ctx.objective && s.objectives.includes(ctx.objective));
    if (s.models) return true;
    return Boolean((ctx.objective && s.objectives?.includes(ctx.objective)) || s.signals?.some((x) => ctx.signals.includes(x)));
  });
}

/** One line per skill for the LLM: the principles, not the texts (a few hundred tokens at most). Paid-ads economics always. */
export function skillDigest(skills: readonly MarketingSkill[], max = 4): string[] {
  const picked = [...skills.filter((s) => s !== PAID_ADS_ECONOMICS).slice(0, max - 1), PAID_ADS_ECONOMICS];
  return picked.map((s) => `${s.id}: ${s.digest}`);
}
