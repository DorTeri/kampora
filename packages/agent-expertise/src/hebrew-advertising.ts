import type { Playbook } from './playbook';

/**
 * Hebrew advertising language. The lists are deliberately short and specific: they catch the phrases that make
 * Israeli ad copy sound generic, formal or translated. They are checks on copy, not a style the model imitates.
 */
export const HEBREW_ADVERTISING_PLAYBOOK: Playbook = {
  id: 'hebrew-advertising',
  version: '1.0.0',
  role: 'COPYWRITER',
  responsibility: 'Keep every customer-facing word natural, modern, spoken Israeli Hebrew.',
  requiredContext: ['business tone of voice', 'whether the text is spoken or written'],
  methods: [
    {
      id: 'SPOKEN_REGISTER',
      name: 'Spoken register',
      when: 'Voiceover and on-screen copy.',
      how: 'Write how a friendly local business owner talks: short sentences, everyday words, plural "you" (אתם).',
    },
    {
      id: 'CONCRETE_NOUNS',
      name: 'Concrete nouns',
      when: 'Describing value.',
      how: 'Name the thing ("קרואסון חמאה", "שיעור ניסיון") instead of abstractions ("חוויה", "עולם של").',
    },
    {
      id: 'READ_ALOUD',
      name: 'Read it aloud',
      when: 'Every voice line.',
      how: 'If a sentence needs a breath in the middle, split it; avoid words with ambiguous pronunciation next to each other.',
    },
  ],
  constraints: ['No niqqud in copy.', 'Numbers as digits.', 'At most one exclamation mark per ad.'],
  decisionRules: [
    'Replace formal words with their spoken equivalent.',
    'Cut any phrase that could appear unchanged in a competitor’s ad.',
  ],
  outputs: ['Lint issues with suggestions'],
  examples: [
    {
      situation: 'Formal register',
      good: '"כדי להזמין, שלחו לנו הודעה"',
      weak: '"על מנת להזמין, הנכם מוזמנים לפנות אלינו"',
      why: 'Spoken Hebrew, half the words.',
    },
  ],
  failureModes: [
    'Clichés',
    'Formal written register',
    'Translated English idioms',
    'Exclamation marks everywhere',
  ],
  evaluationCriteria: ['HEBREW_NATURALNESS'],
};

/** Phrases that fit any business in the category: they add words and remove meaning. */
export const HEBREW_CLICHES: readonly string[] = [
  'חוויה בלתי נשכחת',
  'איכות ללא פשרות',
  'פשוט מושלם',
  'עולם של',
  'מגוון רחב',
  'ברמה הגבוהה ביותר',
  'שירות ברמה',
  'חוויה קולינרית',
  'מחכים לכם',
  'אל תפספסו',
  'הזדמנות פז',
  'לא תאמינו',
  'בלתי רגיל',
  'פשוט תענוג',
  'חוויה של פעם בחיים',
];

/** Formal written words and their spoken equivalents. */
export const HEBREW_FORMAL: ReadonlyArray<readonly [string, string]> = [
  ['הינו', 'הוא'],
  ['הינה', 'היא'],
  ['הנכם', 'אתם'],
  ['על מנת', 'כדי'],
  ['באפשרותכם', 'אתם יכולים'],
  ['אנו ', 'אנחנו '],
  ['כמו כן', 'וגם'],
  ['לרשותכם', 'בשבילכם'],
  ['ברצוננו', 'אנחנו רוצים'],
  ['הנו ', 'הוא '],
];

/** Calques of English advertising idioms. */
export const HEBREW_TRANSLATIONESE: ReadonlyArray<readonly [string, string]> = [
  ['לקחת את זה לשלב הבא', 'להתקדם'],
  ['לקחת החלטה', 'להחליט'],
  ['בסופו של יום', 'בסוף'],
  ['זה הכל עליך', 'זה בשבילך'],
  ['תהיו מוכנים להיות מופתעים', 'תופתעו'],
  ['עושה שכל', 'הגיוני'],
];

export interface HebrewCopyIssue {
  code: 'CLICHE' | 'FORMAL' | 'TRANSLATIONESE' | 'EXCLAMATION';
  phrase: string;
  suggestion?: string;
}

/** Deterministic Hebrew copy lint (used by the Copywriter's validation and by the Critic). */
export function hebrewCopyIssues(text: string): HebrewCopyIssue[] {
  const issues: HebrewCopyIssue[] = [];
  const padded = ` ${text} `;
  for (const phrase of HEBREW_CLICHES) if (text.includes(phrase)) issues.push({ code: 'CLICHE', phrase });
  for (const [formal, spoken] of HEBREW_FORMAL) {
    // A one-letter prefix (ש, ו, ה, ב, כ, ל, מ) may be attached: "שהינה" is still formal.
    const re = new RegExp(`(?<![\\u0590-\\u05FF])[ושהבכלמ]?${formal.trim()}(?![\\u0590-\\u05FF])`);
    if (re.test(padded)) issues.push({ code: 'FORMAL', phrase: formal.trim(), suggestion: spoken.trim() });
  }
  for (const [calque, natural] of HEBREW_TRANSLATIONESE)
    if (text.includes(calque)) issues.push({ code: 'TRANSLATIONESE', phrase: calque, suggestion: natural });
  const bangs = (text.match(/!/g) ?? []).length;
  if (bangs > 1 || /!!/.test(text))
    issues.push({ code: 'EXCLAMATION', phrase: '!'.repeat(Math.min(bangs, 3)) });
  return issues;
}
