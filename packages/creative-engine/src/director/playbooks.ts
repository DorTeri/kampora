import type {
  BusinessModel,
  ConversionPlan,
  CreativeFormat,
  DirectorApprovalKind,
  FactKey,
  MarketingObjective,
  MarketingRecommendation,
} from '@kampora/shared';
import { usable, usableText, type Memory } from './facts';
import { ACTION_LABELS, DEFAULT_OBJECTIVE, OBJECTIVE_LABELS, informationUsed } from './strategy';

/**
 * How different businesses grow. A coffee cart lives on people walking past in the morning and coming back; a
 * burger place on local demand and a hero product; a pilates studio on trial lessons that turn into memberships.
 * Each playbook gives a hypothesis to test, the creative formats that fit it and how the owner measures it with
 * what they already have. Nothing here predicts revenue or promises results.
 */

interface Play {
  hypothesis: string;
  strategy: string[];
  formats: { format: CreativeFormat; why: string }[];
  primaryMetric: string;
  secondaryMetrics: string[];
  method: string;
}

type Plays = Partial<Record<MarketingObjective, Play>> & { default: Play };

const REEL = (why: string) => ({ format: 'REEL_9_16' as const, why });
const STORY = (why: string) => ({ format: 'STORY_9_16' as const, why });
const FEED = (why: string) => ({ format: 'FEED_4_5' as const, why });

const PLAYBOOKS: Record<BusinessModel, Plays> = {
  COFFEE_CART: {
    default: {
      hypothesis: 'אנשים שעוברים באזור בבוקר לא יודעים שיש עגלה במרחק הליכה. סרטון קצר שמראה איפה היא עומדת ומה מקבלים בה יביא אותם לנסות פעם ראשונה.',
      strategy: ['פרסום ממוקד ברדיוס הליכה סביב מקום העגלה, בשעות הבוקר', 'להראות את המיקום והקפה עצמו, לא רק לוגו', 'אחרי הביקור הראשון: סיבה לחזור (כרטיסייה או מאפה של הבוקר)'],
      formats: [REEL('הכנת הקפה והמקום בתנועה עוצרים גלילה'), STORY('סטורי עם המיקום מתאים להחלטה של "עכשיו בדרך"')],
      primaryMetric: 'מספר כוסות בבוקר לעומת השבועות שלפני הקמפיין',
      secondaryMetrics: ['לחיצות על ניווט מהמודעה', 'לקוחות שאומרים שראו אתכם באינסטגרם'],
      method: 'לספור כוסות בכל בוקר (או מהקופה) שבועיים לפני ובמהלך הקמפיין, ולשאול לקוחות חדשים איך שמעו עליכם.',
    },
    RETENTION: {
      hypothesis: 'מי שכבר קנה פעם אחת יחזור אם יש לו סיבה ותזכורת. הלקוחות הקבועים הם הבסיס של עגלת קפה.',
      strategy: ['פרסום לעוקבים ולמי שכבר צפה בתכנים שלכם', 'הצעה פשוטה לחזרה (כרטיסייה, מאפה של היום)', 'תוכן קבוע שמראה מה חדש השבוע'],
      formats: [STORY('סטוריז לעוקבים: תזכורת יומית בלי להציף'), REEL('מה חדש בעגלה השבוע')],
      primaryMetric: 'כמה לקוחות חוזרים בשבוע (כרטיסיות שהתמלאו)',
      secondaryMetrics: ['תגובות והודעות לעוקבים'],
      method: 'כרטיסייה פיזית או רשימה פשוטה של לקוחות קבועים; להשוות לחודש שלפני.',
    },
  },
  RESTAURANT: {
    default: {
      hypothesis: 'יש ביקוש מקומי לאוכל טוב באזור המשלוחים. מנה אחת בולטת בתקריב, עם דרך ברורה להזמין, תמיר צפייה להזמנה יותר ממודעה כללית על המסעדה.',
      strategy: ['מנת הדגל במרכז: תקריב, אדים, חיתוך', 'פרסום ברדיוס המשלוחים בשעות שלפני ארוחת צהריים וערב', 'המודעה שולחת ישר לערוץ ההזמנה שקיים היום'],
      formats: [REEL('אוכל בתנועה הוא מה שגורם לרעב'), FEED('תמונה סטטית ברורה עם המנה והדרך להזמין')],
      primaryMetric: 'מספר ההזמנות בשבוע בערוץ שהמודעה שולחת אליו',
      secondaryMetrics: ['לחיצות על הקישור להזמנה', 'הזמנות של מנת הדגל'],
      method: 'להשוות את מספר ההזמנות בדוח של אפליקציית ההזמנות (או ביומן ההזמנות) לשבועיים שלפני הקמפיין.',
    },
    VISITS: {
      hypothesis: 'אנשים באזור מחפשים מקום לשבת בו. אווירה ומנה בולטת, עם ניווט בלחיצה, יביאו הגעות פיזיות.',
      strategy: ['פרסום ברדיוס של כמה קילומטרים, בימים ובשעות שבהם יש מקום', 'להראות את המקום, לא רק את האוכל', 'ניווט בלחיצה מהמודעה'],
      formats: [REEL('המקום והמנה יחד: למה לבוא ולא להזמין'), STORY('סטורי עם ניווט לשעות הפנויות')],
      primaryMetric: 'מספר שולחנות/סועדים בימים הפנויים לעומת השבועות שלפני',
      secondaryMetrics: ['לחיצות על ניווט'],
      method: 'לספור סועדים בימים שבחרתם לחזק (או מהקופה), שבועיים לפני ובמהלך.',
    },
    PRODUCT_LAUNCH: {
      hypothesis: 'לקוחות קיימים ושכנים יבואו לנסות מנה חדשה אם רואים אותה מקרוב ויודעים שהיא חדשה ולזמן מוגבל.',
      strategy: ['חשיפה ראשונה לעוקבים ולמי שהזמין בעבר', 'אחר כך רדיוס מקומי', 'המנה החדשה בשם שלה, בלי להמציא מרכיבים'],
      formats: [REEL('חשיפת המנה החדשה בתקריב'), STORY('תזכורת קצרה בשבוע ההשקה')],
      primaryMetric: 'כמה פעמים הוזמנה המנה החדשה בשבוע הראשון והשני',
      secondaryMetrics: ['לחיצות על הקישור להזמנה'],
      method: 'לספור את המנה החדשה בדוח ההזמנות או בקופה.',
    },
  },
  CAFE: {
    default: {
      hypothesis: 'שעות הבוקר הן ההזדמנות: אנשים בשכונה בוחרים בית קפה לפי מה שהם רואים בדרך לעבודה. סרטון בוקר אמיתי יביא אותם לנסות.',
      strategy: ['פרסום מקומי בשעות הבוקר', 'הקפה והמאפה של הבוקר במרכז', 'ניווט בלחיצה, או הזמנה אם יש'],
      formats: [REEL('בוקר בבית הקפה בתנועה'), FEED('המאפה/המשקה החדש בתמונה ברורה')],
      primaryMetric: 'מספר עסקאות בבוקר לעומת השבועות שלפני',
      secondaryMetrics: ['לחיצות על ניווט', 'מכירות של המוצר שקודם'],
      method: 'דוח קופה לפי שעות: שבועיים לפני ובמהלך הקמפיין.',
    },
    PRODUCT_LAUNCH: {
      hypothesis: 'מוצר חדש הוא סיבה טובה לבקר שוב. הלקוחות הקבועים והשכנים ינסו אותו אם יראו אותו מקרוב.',
      strategy: ['להראות את המוצר החדש בתקריב', 'פרסום לעוקבים ואז לשכונה', 'זמן מוגבל אם זה נכון'],
      formats: [REEL('המוצר החדש בהכנה'), STORY('תזכורת לעוקבים')],
      primaryMetric: 'כמה יחידות של המוצר החדש נמכרו בשבועיים הראשונים',
      secondaryMetrics: ['ביקורים חוזרים'],
      method: 'לספור את המוצר בקופה.',
    },
  },
  FITNESS_STUDIO: {
    default: {
      hypothesis: 'אנשים לא קונים מנוי לפני שניסו. שיעור ניסיון במחיר נמוך או בחינם, עם הרשמה קלה, הוא הצעד הראשון; המנוי מגיע אחריו.',
      strategy: ['הצעה אחת ברורה: שיעור ניסיון', 'להראות שיעור אמיתי, מדריכה ואווירה (באישור המשתתפים)', 'הרשמה בדרך שקיימת היום, בלי דף נחיתה חדש', 'אחרי שיעור הניסיון: הצעת מנוי מסודרת'],
      formats: [REEL('שיעור בתנועה מראה מה מקבלים'), STORY('הרשמה לשיעור ניסיון בלחיצה')],
      primaryMetric: 'הרשמות לשיעור ניסיון בשבוע',
      secondaryMetrics: ['כמה ממשתתפי הניסיון קנו מנוי', 'הודעות ושאלות'],
      method: 'לספור הרשמות במערכת ההרשמה או בוואטסאפ, ולסמן מי מהם קנה מנוי תוך שבועיים.',
    },
    RETENTION: {
      hypothesis: 'מתאמנים שמרגישים שייכות נשארים. תוכן מהקהילה שומר על מנויים פעילים.',
      strategy: ['תוכן לעוקבים ולמנויים', 'סיפורים של מתאמנים (באישורם)', 'תזכורת לחידוש מנוי'],
      formats: [REEL('רגעים מהשיעורים'), STORY('מערכת שיעורים שבועית')],
      primaryMetric: 'מנויים שחודשו החודש',
      secondaryMetrics: ['השתתפות בשיעורים'],
      method: 'מדוח המנויים במערכת הסטודיו.',
    },
  },
  BEAUTY: {
    default: {
      hypothesis: 'לקוחות בוחרות מטפלת לפי תוצאות שהן רואות. לפני/אחרי אמיתי (באישור) ותור בלחיצה ממירים יותר מהבטחה כללית.',
      strategy: ['להראות עבודות אמיתיות באישור הלקוחות', 'פרסום ברדיוס מקומי', 'קביעת תור בדרך שקיימת היום'],
      formats: [REEL('תהליך הטיפול בקצרה'), FEED('תוצאה ברורה בתמונה')],
      primaryMetric: 'תורים חדשים בשבוע',
      secondaryMetrics: ['הודעות ושאלות על מחיר', 'לקוחות חדשות שחזרו'],
      method: 'לספור תורים של לקוחות חדשות ביומן, לעומת החודש שלפני.',
    },
  },
  LOCAL_SERVICE: {
    default: {
      hypothesis: 'מי שצריך בעל מקצוע צריך אותו עכשיו ובאזור שלו. אמינות (עבודות אמיתיות) וטלפון זמין הם מה שסוגר עבודה.',
      strategy: ['פרסום באזור השירות', 'להראות עבודות אמיתיות וזמני תגובה', 'שיחה או וואטסאפ בלחיצה'],
      formats: [REEL('עבודה אמיתית מהתחלה לסוף'), FEED('לפני/אחרי ברור')],
      primaryMetric: 'שיחות ופניות בשבוע',
      secondaryMetrics: ['כמה פניות הפכו לעבודה'],
      method: 'לרשום כל פנייה ואיך הגיעה, ולהשוות לחודש שלפני.',
    },
  },
  ECOMMERCE: {
    default: {
      hypothesis: 'מוצר אחד שמוצג היטב, עם דרך קצרה לקנות, מוכר יותר ממודעה על כל החנות. קונים חוזרים זולים יותר להשגה מקונים חדשים.',
      strategy: ['מוצר אחד או קולקציה קטנה בכל מודעה', 'המודעה שולחת ישר לעמוד המוצר', 'אחרי רכישה: תוכן ללקוחות קיימים לרכישה חוזרת'],
      formats: [REEL('המוצר בשימוש אמיתי'), { format: 'CAROUSEL', why: 'כמה מוצרים או זוויות בלחיצה' }, FEED('תמונת מוצר נקייה')],
      primaryMetric: 'רכישות מהמודעה (לפי קישור עם סימון מקור)',
      secondaryMetrics: ['לחיצות לעמוד המוצר', 'רכישות חוזרות'],
      method: 'קישור עם UTM לכל מודעה ודוח ההזמנות של החנות; להשוות לשבועיים שלפני.',
    },
    RETENTION: {
      hypothesis: 'לקוחות שכבר קנו ומרוצים יקנו שוב אם מזכירים להם בזמן הנכון ומראים מה חדש.',
      strategy: ['פרסום ללקוחות קיימים ולעוקבים', 'מוצרים משלימים או חדשים', 'עמוד מוצר ישיר'],
      formats: [{ format: 'CAROUSEL', why: 'מה חדש בחנות' }, STORY('תזכורת קצרה')],
      primaryMetric: 'רכישות חוזרות בחודש',
      secondaryMetrics: ['לחיצות מעוקבים'],
      method: 'דוח לקוחות חוזרים בחנות.',
    },
  },
  OTHER: {
    default: {
      hypothesis: 'אנשים באזור לא מכירים את העסק. מודעה ברורה שמראה מה מקבלים ואיך פונים היא הצעד הראשון.',
      strategy: ['מסר אחד ברור', 'פרסום ממוקד באזור', 'פנייה בדרך שקיימת היום'],
      formats: [REEL('להראות את העסק בפעולה'), FEED('מסר ברור בתמונה')],
      primaryMetric: 'פניות או ביקורים בשבוע',
      secondaryMetrics: ['לחיצות מהמודעה'],
      method: 'לרשום פניות והגעות ואיך שמעו עליכם.',
    },
  },
};

/** "יותר לקוחות" for these businesses can mean two different campaigns; the owner chooses. */
export const GROWTH_CHOICE: Partial<Record<BusinessModel, { question: string; options: { label: string; objective: MarketingObjective }[] }>> = {
  RESTAURANT: {
    question: 'יותר לקוחות זה יותר הזמנות (משלוח ואיסוף), או יותר אנשים שמגיעים לשבת?',
    options: [
      { label: 'יותר הזמנות', objective: 'ORDERS' },
      { label: 'שיגיעו לשבת', objective: 'VISITS' },
    ],
  },
  CAFE: {
    question: 'יותר לקוחות זה יותר אנשים שעוברים בבוקר, או יותר הזמנות?',
    options: [
      { label: 'שיגיעו בבוקר', objective: 'VISITS' },
      { label: 'יותר הזמנות', objective: 'ORDERS' },
    ],
  },
};

/** What "more customers" usually means for a business, said when the Director decides without asking. */
export const GROWTH_MEANING: Record<BusinessModel, string> = {
  COFFEE_CART: 'לעגלת קפה, יותר לקוחות זה בעיקר יותר אנשים שעוצרים בבוקר ושחוזרים שוב.',
  RESTAURANT: 'למסעדה, יותר לקוחות זה בדרך כלל יותר הזמנות.',
  CAFE: 'לבית קפה, יותר לקוחות זה בעיקר יותר אנשים שמגיעים בבוקר.',
  FITNESS_STUDIO: 'לסטודיו, יותר לקוחות מתחיל בשיעורי ניסיון שהופכים למנויים.',
  BEAUTY: 'לטיפוח, יותר לקוחות זה יותר תורים חדשים.',
  LOCAL_SERVICE: 'לשירות מקומי, יותר לקוחות זה יותר פניות ושיחות.',
  ECOMMERCE: 'לחנות אונליין, יותר לקוחות זה יותר רכישות באתר ולקוחות שקונים שוב.',
  OTHER: 'נתחיל בכך שיותר אנשים באזור יכירו אתכם.',
};

export function growthObjective(model: BusinessModel): MarketingObjective {
  return DEFAULT_OBJECTIVE[model];
}

export interface MarketingInput {
  model: BusinessModel;
  objective: MarketingObjective;
  product: string;
  promotion: boolean;
  conversion: ConversionPlan | null;
  memory: Memory;
  now: Date;
  /** Approvals the plan needs before anything is produced (paid generation when the provider charges). */
  paidProvider: boolean;
}

export function marketingRecommendation(input: MarketingInput): MarketingRecommendation {
  const { model, objective, memory, now } = input;
  const plays = PLAYBOOKS[model];
  const play = plays[objective] ?? plays.default;
  const ordering = usableText(memory, 'conversion.ordering', now);
  const goal =
    objective === 'ORDERS' && ordering ? `יותר הזמנות ב${ordering}` : input.promotion ? `לקדם את המבצע: ${input.product}` : `${OBJECTIVE_LABELS[objective]}: ${input.product}`;
  const keys: FactKey[] = ['business.category', 'location.city', 'offering.main', 'conversion.ordering', 'audience', ...(input.promotion ? (['offer.current'] as FactKey[]) : [])];
  const missing: string[] = [];
  if (usable(memory, 'media.realPhotos', now) !== true) missing.push('תמונות אמיתיות של המוצר והמקום (אחרת: עיצוב טיפוגרפי או המחשה מסומנת)');
  if (input.conversion && !input.conversion.exists) missing.push(`יעד ל${ACTION_LABELS[input.conversion.action]}`);
  if (!usable(memory, 'audience', now)) missing.push('קהל היעד (כרגע: אנשים באזור, לא אישרת)');
  const approvals: DirectorApprovalKind[] = [...(input.paidProvider ? (['PAID_GENERATION'] as const) : []), 'SCRIPT', 'CREATIVE_DIRECTION', 'PRODUCTION'];
  const strategy = [...play.strategy];
  if (input.conversion?.exists) strategy.push(`הלקוח מגיע ל${ACTION_LABELS[input.conversion.action]}${input.conversion.destination ? ` (${input.conversion.destination})` : ''}`);
  return {
    businessGoal: goal.slice(0, 200),
    objective,
    relevantFacts: informationUsed(memory, now, keys).slice(0, 12),
    hypothesis: play.hypothesis,
    strategy: strategy.slice(0, 6),
    creativeFormats: play.formats.slice(0, 4),
    conversion: input.conversion,
    missingInformation: missing,
    requiredApprovals: approvals,
    measurement: {
      primaryMetric: play.primaryMetric,
      secondaryMetrics: play.secondaryMetrics,
      method: play.method,
      baseline: 'השבועיים שלפני הקמפיין. בלי נתוני אמת אני לא מבטיח תוצאה; הקמפיין הוא ניסוי שנמדוד.',
    },
  };
}
