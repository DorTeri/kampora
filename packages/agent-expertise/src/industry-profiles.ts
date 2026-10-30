import type { CampaignGoal, ConceptAngle, LayoutFamily, VisualStyle } from '@kampora/shared';

/**
 * How advertising usually works in a business category. Motivations and approaches are professional hypotheses
 * to reason with, not market research: nothing here is a statistic, and nothing here may appear in an ad as fact.
 */
export interface IndustryProfile {
  id: string;
  version: string;
  label: string;
  /** Lower-case keywords matched against the business category and description. */
  keywords: readonly string[];
  typicalGoals: readonly CampaignGoal[];
  /** Common reasons customers buy (hypotheses, in Hebrew: they also appear in the owner's brief). */
  motivations: readonly string[];
  approaches: ReadonlyArray<{ name: string; how: string; angles: readonly ConceptAngle[] }>;
  /** Information a professional brief needs for this category; missing → a question to the owner. */
  importantInfo: ReadonlyArray<{
    id: string;
    label: string;
    question: string;
    /** Regex (source) that finds the information in the business's own text. */
    detect: string;
    goals?: readonly CampaignGoal[];
  }>;
  visual: { style: VisualStyle; use: readonly string[]; avoid: readonly string[] };
  approvalConcerns: readonly string[];
  /** Claims that need the business's explicit approval before appearing in an ad. */
  claimsRequiringVerification: ReadonlyArray<{ label: string; pattern: string }>;
  preferredLayouts: readonly LayoutFamily[];
  emotionalDirection: string;
}

export const INDUSTRY_PROFILES: readonly IndustryProfile[] = [
  {
    id: 'cafe-restaurant',
    version: '1.0.0',
    label: 'בתי קפה ומסעדות',
    keywords: [
      'קפה',
      'בית קפה',
      'מסעדה',
      'מאפייה',
      'מאפה',
      'ביסטרו',
      'פיצה',
      'אוכל',
      'cafe',
      'coffee',
      'restaurant',
      'bakery',
      'food',
    ],
    typicalGoals: ['OFFER', 'PRODUCT_PROMO', 'AWARENESS'],
    motivations: [
      'טקס יומי קטן (הקפה של הבוקר)',
      'חשק או פינוק',
      'מקום נעים וקרוב להיפגש בו',
      'תמורה טובה לקנייה שחוזרת על עצמה',
    ],
    approaches: [
      {
        name: 'Sensory product moment',
        how: 'One appetising, truthful detail of the real dish.',
        angles: ['PRODUCT_DEMO', 'EMOTIONAL'],
      },
      { name: 'Combo offer', how: 'What you get together, then the exact price.', angles: ['OFFER_DRIVEN'] },
      {
        name: 'The ritual',
        how: 'The place as part of the audience’s routine.',
        angles: ['LIFESTYLE', 'EMOTIONAL'],
      },
      {
        name: 'Behind the counter',
        how: 'Real preparation, real people (with their consent).',
        angles: ['PRODUCT_DEMO', 'UGC'],
      },
    ],
    importantInfo: [
      {
        id: 'hours',
        label: 'שעות פתיחה',
        question: 'מה שעות הפתיחה, ובאילו שעות המבצע תקף?',
        detect: '\\d{1,2}:\\d{2}|שעות|פתוח',
      },
      {
        id: 'kosher',
        label: 'כשרות',
        question: 'האם העסק כשר? אם כן – באיזו תעודה?',
        detect: 'כשר|כשרות|kosher',
      },
      {
        id: 'location',
        label: 'כתובת',
        question: 'מה הכתובת המדויקת של העסק?',
        detect: 'רחוב|רח׳|\\d+\\s*,|address',
      },
    ],
    visual: {
      style: 'photoreal-product',
      use: ['natural window light', 'real dishes and cups', 'texture and steam', 'warm surfaces'],
      avoid: [
        'plastic-looking food',
        'oversaturated colors',
        'empty generic interiors presented as the venue',
      ],
    },
    approvalConcerns: ['the dish must look like the real one', 'prices and hours', 'kosher statements'],
    claimsRequiringVerification: [
      { label: 'כשרות', pattern: 'כשר' },
      { label: 'תוצרת בית', pattern: 'תוצרת בית|ביתי' },
      { label: 'טרי כל יום', pattern: 'טרי(?:ים|ה|ות)? כל (?:יום|בוקר)' },
      { label: 'אורגני', pattern: 'אורגני' },
      { label: 'ללא גלוטן', pattern: 'ללא גלוטן|טבעוני' },
    ],
    preferredLayouts: ['SPLIT', 'OFFER_RETAIL', 'EDITORIAL_PRODUCT', 'LIFESTYLE_PHOTO', 'LOCAL_PROMO'],
    emotionalDirection: 'חמימות, תיאבון והנאה יומיומית',
  },
  {
    id: 'fitness',
    version: '1.0.0',
    label: 'סטודיו וחדרי כושר',
    keywords: [
      'כושר',
      'סטודיו',
      'פילאטיס',
      'יוגה',
      'אימון',
      'אימונים',
      'מאמן',
      'gym',
      'fitness',
      'pilates',
      'yoga',
      'crossfit',
    ],
    typicalGoals: ['LEADS', 'OFFER', 'AWARENESS'],
    motivations: ['להרגיש טוב וחזק יותר', 'שגרה שאפשר להתמיד בה', 'שייכות לקבוצה', 'חשש להתחיל כמתחילים'],
    approaches: [
      {
        name: 'Beginner reassurance',
        how: 'Name the fear of starting and answer it with a real fact (group size, trial class).',
        angles: ['PROBLEM_SOLUTION', 'EDUCATIONAL'],
      },
      {
        name: 'Community',
        how: 'Real members, real energy, the feeling of a class.',
        angles: ['LIFESTYLE', 'EMOTIONAL'],
      },
      { name: 'Trial offer', how: 'Lead with the trial terms exactly as given.', angles: ['OFFER_DRIVEN'] },
    ],
    importantInfo: [
      {
        id: 'trial',
        label: 'שיעור ניסיון',
        question: 'האם יש שיעור ניסיון? באיזה מחיר ובאילו תנאים?',
        detect: 'ניסיון|היכרות|trial',
        goals: ['LEADS', 'OFFER'],
      },
      {
        id: 'schedule',
        label: 'מערכת שיעורים',
        question: 'באילו ימים ושעות מתקיימים השיעורים?',
        detect: '\\d{1,2}:\\d{2}|ימי|בבוקר|בערב',
      },
      {
        id: 'credentials',
        label: 'הכשרת מאמנים',
        question: 'אילו הכשרות או תעודות יש למאמנים?',
        detect: 'מוסמך|הסמכה|תעודה|certified',
      },
    ],
    visual: {
      style: 'lifestyle-photo',
      use: ['real people moving', 'natural light', 'the actual studio'],
      avoid: ['unrealistic bodies', 'body before/after without documented consent', 'stock gym clichés'],
    },
    approvalConcerns: ['body image', 'health or medical promises', 'results promises'],
    claimsRequiringVerification: [
      { label: 'ירידה במשקל', pattern: 'ירידה במשקל|לרדת \\d|קילו' },
      { label: 'טענה רפואית', pattern: 'כאבי גב|מרפא|טיפול רפואי' },
      { label: 'תוצאות מובטחות', pattern: 'תוצאות מובטחות|מובטח' },
    ],
    preferredLayouts: ['BOLD_TYPOGRAPHIC', 'LIFESTYLE_PHOTO', 'SPLIT', 'OFFER_RETAIL'],
    emotionalDirection: 'אנרגיה, עידוד ושייכות',
  },
  {
    id: 'beauty-wellness',
    version: '1.0.0',
    label: 'יופי וטיפוח',
    keywords: [
      'יופי',
      'קוסמטיקה',
      'קוסמטיקאית',
      'ספא',
      'מספרה',
      'ציפורניים',
      'טיפוח',
      'עיסוי',
      'beauty',
      'salon',
      'spa',
      'wellness',
      'nails',
    ],
    typicalGoals: ['LEADS', 'OFFER', 'PRODUCT_PROMO'],
    motivations: ['זמן לעצמי', 'להיראות טוב לאירוע', 'אמון במקצועיות ובהיגיינה', 'רוגע'],
    approaches: [
      {
        name: 'Calm sensory',
        how: 'Soft light, texture, the feeling of the treatment.',
        angles: ['EMOTIONAL', 'LIFESTYLE'],
      },
      {
        name: 'Expertise and trust',
        how: 'The practitioner’s real experience and care.',
        angles: ['EDUCATIONAL', 'PROBLEM_SOLUTION'],
      },
      { name: 'Package offer', how: 'Treatment, duration and price, exactly.', angles: ['OFFER_DRIVEN'] },
    ],
    importantInfo: [
      { id: 'duration', label: 'משך הטיפול', question: 'כמה זמן נמשך הטיפול?', detect: 'דקות|שעה|minutes' },
      {
        id: 'booking',
        label: 'הזמנת תור',
        question: 'איך מזמינים תור – טלפון, וואטסאפ או אתר?',
        detect: 'תור|הזמנ|טלפון|\\d{2,3}-\\d{7}',
      },
    ],
    visual: {
      style: 'lifestyle-photo',
      use: ['soft diffused light', 'clean surfaces', 'realistic skin texture'],
      avoid: ['heavily retouched skin', 'before/after that is not real and consented'],
    },
    approvalConcerns: ['before/after must be real and consented', 'therapeutic or medical claims'],
    claimsRequiringVerification: [
      { label: 'טענה טיפולית', pattern: 'מרפא|קליני|רפואי|מעלים קמטים' },
      { label: 'תוצאה קבועה', pattern: 'לצמיתות|קבוע' },
    ],
    preferredLayouts: ['PREMIUM_MINIMAL', 'EDITORIAL_PRODUCT', 'SPLIT', 'PRODUCT_SHOWCASE'],
    emotionalDirection: 'רוגע, אכפתיות וביטחון',
  },
  {
    id: 'local-services',
    version: '1.0.0',
    label: 'שירותים מקומיים',
    keywords: [
      'שירות',
      'אינסטלטור',
      'חשמלאי',
      'מוסך',
      'ניקיון',
      'הובלות',
      'שיפוצים',
      'מנעולן',
      'מזגנים',
      'הדברה',
      'plumber',
      'electrician',
      'cleaning',
      'repair',
      'service',
    ],
    typicalGoals: ['LEADS', 'AWARENESS', 'OFFER'],
    motivations: ['תקלה דחופה שנפתרת מהר', 'בעל מקצוע אמין שנכנס הביתה', 'מחיר הוגן וברור', 'מישהו קרוב'],
    approaches: [
      {
        name: 'Problem solved',
        how: 'The problem in one line, the business as the calm fix.',
        angles: ['PROBLEM_SOLUTION'],
      },
      {
        name: 'Trust',
        how: 'Real credentials, the real person, the area served.',
        angles: ['UGC', 'EDUCATIONAL'],
      },
      { name: 'Useful tip', how: 'One practical tip that shows expertise.', angles: ['EDUCATIONAL'] },
    ],
    importantInfo: [
      {
        id: 'area',
        label: 'אזור שירות',
        question: 'באילו אזורים אתם נותנים שירות?',
        detect: 'אזור|באזור|גוש דן|השרון|בכל',
      },
      {
        id: 'license',
        label: 'רישיון',
        question: 'האם יש לכם רישיון או ביטוח שאפשר לציין?',
        detect: 'רישיון|מורשה|ביטוח|licensed',
      },
      {
        id: 'contact',
        label: 'דרך יצירת קשר',
        question: 'לאיזה טלפון או וואטסאפ לפנות?',
        detect: '\\d{2,3}-?\\d{7}|טלפון|וואטסאפ',
      },
    ],
    visual: {
      style: 'ugc-handheld',
      use: ['the real technician at work', 'a clean result', 'real vehicles and tools'],
      avoid: ['stock handshake photos', 'staff who do not work there'],
    },
    approvalConcerns: ['licence and insurance statements', 'response-time promises', 'price promises'],
    claimsRequiringVerification: [
      { label: 'זמינות 24/7', pattern: '24/7|24 שעות|מסביב לשעון' },
      { label: 'רישיון', pattern: 'מורשה|רישיון' },
      { label: 'אחריות', pattern: 'אחריות|מובטח' },
      { label: 'הכי זול', pattern: 'הכי זול|המחיר הזול' },
    ],
    preferredLayouts: ['LOCAL_PROMO', 'SPLIT', 'BOLD_TYPOGRAPHIC', 'OFFER_RETAIL'],
    emotionalDirection: 'ביטחון, מקצועיות וקרבה',
  },
  {
    id: 'ecommerce',
    version: '1.0.0',
    label: 'מוצרים ומסחר מקוון',
    keywords: [
      'חנות',
      'אונליין',
      'משלוח',
      'משלוחים',
      'מותג',
      'קולקציה',
      'eshop',
      'e-commerce',
      'ecommerce',
      'shop',
      'store',
      'online',
    ],
    typicalGoals: ['SALES', 'PRODUCT_PROMO', 'OFFER'],
    motivations: ['רצון במוצר עצמו', 'מתנה', 'תמורה', 'משלוח נוח'],
    approaches: [
      { name: 'Product demo', how: 'The product in use, its key detail up close.', angles: ['PRODUCT_DEMO'] },
      {
        name: 'Launch',
        how: 'What is new and why it matters, in one line.',
        angles: ['PRODUCT_DEMO', 'LIFESTYLE'],
      },
      { name: 'Offer', how: 'Exact discount or bundle terms.', angles: ['OFFER_DRIVEN'] },
    ],
    importantInfo: [
      {
        id: 'shipping',
        label: 'משלוח',
        question: 'מה תנאי המשלוח (מחיר וזמן אספקה)?',
        detect: 'משלוח|delivery|shipping',
      },
      { id: 'returns', label: 'החזרות', question: 'מה מדיניות ההחזרות?', detect: 'החזר|החלפה|returns' },
    ],
    visual: {
      style: 'photoreal-product',
      use: ['clean product photography', 'true colors and proportions', 'detail shots', 'in-use moments'],
      avoid: ['AI renders presented as the actual product', 'props that suggest included items that are not'],
    },
    approvalConcerns: [
      'exact product appearance (color, size)',
      'shipping and return terms',
      'discount terms',
    ],
    claimsRequiringVerification: [
      { label: 'משלוח חינם', pattern: 'משלוח חינם' },
      { label: 'מלאי מוגבל', pattern: 'מלאי מוגבל|אחרונים' },
      { label: 'חומרים', pattern: '100%|עור אמיתי|כותנה' },
    ],
    preferredLayouts: ['PRODUCT_SHOWCASE', 'EDITORIAL_PRODUCT', 'OFFER_RETAIL', 'BOLD_TYPOGRAPHIC'],
    emotionalDirection: 'תשוקה, ביטחון והנאה',
  },
];

export const GENERIC_INDUSTRY: IndustryProfile = {
  id: 'generic',
  version: '1.0.0',
  label: 'עסק מקומי',
  keywords: [],
  typicalGoals: ['LEADS', 'OFFER', 'AWARENESS'],
  motivations: ['פתרון לצורך', 'אמון', 'תמורה'],
  approaches: [
    {
      name: 'Clear value',
      how: 'What the customer gets and why from this business.',
      angles: ['PROBLEM_SOLUTION', 'OFFER_DRIVEN'],
    },
  ],
  importantInfo: [
    {
      id: 'location',
      label: 'כתובת',
      question: 'מה הכתובת או אזור הפעילות של העסק?',
      detect: 'רחוב|\\d+\\s*,|אזור',
    },
  ],
  visual: { style: 'lifestyle-photo', use: ['real people and places'], avoid: ['stock clichés'] },
  approvalConcerns: ['every factual statement'],
  claimsRequiringVerification: [],
  preferredLayouts: ['SPLIT', 'LOCAL_PROMO', 'BOLD_TYPOGRAPHIC'],
  emotionalDirection: 'ידידותי ואמין',
};

/**
 * The best-matching profile for a business (category first, then description). A weak match falls back to the
 * generic profile rather than forcing a wrong industry onto the business.
 */
export function industryFor(business: { category: string; description?: string }): {
  profile: IndustryProfile;
  matched: boolean;
} {
  const category = business.category.toLowerCase();
  const description = (business.description ?? '').toLowerCase();
  let best: { profile: IndustryProfile; score: number } | undefined;
  for (const profile of INDUSTRY_PROFILES) {
    const score = profile.keywords.reduce(
      (s, k) => s + (category.includes(k) ? 3 : 0) + (description.includes(k) ? 1 : 0),
      0,
    );
    if (score > (best?.score ?? 0)) best = { profile, score };
  }
  return best && best.score >= 2
    ? { profile: best.profile, matched: true }
    : { profile: GENERIC_INDUSTRY, matched: false };
}

export function industryById(id: string): IndustryProfile {
  return INDUSTRY_PROFILES.find((p) => p.id === id) ?? GENERIC_INDUSTRY;
}
