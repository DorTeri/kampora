/**
 * Hebrew number words (unvocalized, Israeli standard).
 * `f` = feminine form (also the default form for standalone numbers, counting, and times),
 * `m` = masculine form (used with masculine nouns such as שקל, אחוז, מוצר).
 */
export type Gender = 'f' | 'm';

const UNITS: Record<Gender, string[]> = {
  f: ['אפס', 'אחת', 'שתיים', 'שלוש', 'ארבע', 'חמש', 'שש', 'שבע', 'שמונה', 'תשע'],
  m: ['אפס', 'אחד', 'שניים', 'שלושה', 'ארבעה', 'חמישה', 'שישה', 'שבעה', 'שמונה', 'תשעה'],
};

const TEENS: Record<Gender, string[]> = {
  f: [
    'עשר',
    'אחת עשרה',
    'שתים עשרה',
    'שלוש עשרה',
    'ארבע עשרה',
    'חמש עשרה',
    'שש עשרה',
    'שבע עשרה',
    'שמונה עשרה',
    'תשע עשרה',
  ],
  m: [
    'עשרה',
    'אחד עשר',
    'שנים עשר',
    'שלושה עשר',
    'ארבעה עשר',
    'חמישה עשר',
    'שישה עשר',
    'שבעה עשר',
    'שמונה עשר',
    'תשעה עשר',
  ],
};

const TENS = ['', '', 'עשרים', 'שלושים', 'ארבעים', 'חמישים', 'שישים', 'שבעים', 'שמונים', 'תשעים'];
const HUNDREDS = [
  '',
  'מאה',
  'מאתיים',
  'שלוש מאות',
  'ארבע מאות',
  'חמש מאות',
  'שש מאות',
  'שבע מאות',
  'שמונה מאות',
  'תשע מאות',
];
const THOUSANDS_CONSTRUCT = [
  '',
  'אלף',
  'אלפיים',
  'שלושת אלפים',
  'ארבעת אלפים',
  'חמשת אלפים',
  'ששת אלפים',
  'שבעת אלפים',
  'שמונת אלפים',
  'תשעת אלפים',
  'עשרת אלפים',
];

/** Returns the parts of a number below 1000, without the conjunction "ו". */
function partsBelowThousand(n: number, gender: Gender): string[] {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) parts.push(HUNDREDS[h]!);
  if (rest >= 20) {
    parts.push(TENS[Math.floor(rest / 10)]!);
    if (rest % 10) parts.push(UNITS[gender][rest % 10]!);
  } else if (rest >= 10) {
    parts.push(TEENS[gender][rest - 10]!);
  } else if (rest > 0) {
    parts.push(UNITS[gender][rest]!);
  }
  return parts;
}

/** Joins parts Hebrew-style: the conjunction "ו" attaches to the last part only. */
function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  const last = parts[parts.length - 1]!;
  return [...parts.slice(0, -1), `ו${last}`].join(' ');
}

/**
 * Converts a non-negative integer (up to 999,999,999) to Hebrew words.
 * @example numberToHebrew(29, 'm') === 'עשרים ותשעה'
 * @example numberToHebrew(2026) === 'אלפיים עשרים ושש'
 */
export function numberToHebrew(n: number, gender: Gender = 'f'): string {
  if (!Number.isInteger(n) || n < 0)
    throw new RangeError(`numberToHebrew expects a non-negative integer, got ${n}`);
  if (n > 999_999_999) throw new RangeError('numberToHebrew supports values up to 999,999,999');
  if (n === 0) return UNITS[gender][0]!;

  const parts: string[] = [];
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;

  if (millions) {
    if (millions === 1) parts.push('מיליון');
    else if (millions === 2) parts.push('שני מיליון');
    else parts.push(`${joinParts(partsBelowThousand(millions, 'm'))} מיליון`);
  }
  if (thousands) {
    if (thousands <= 10) parts.push(THOUSANDS_CONSTRUCT[thousands]!);
    else parts.push(`${joinParts(partsBelowThousand(thousands, 'm'))} אלף`);
  }
  parts.push(...partsBelowThousand(rest, gender));
  return joinParts(parts);
}

/** Construct ("smichut") forms of two, used directly before a plural noun: שני שקלים / שתי אגורות. */
const TWO_CONSTRUCT: Record<Gender, string> = { m: 'שני', f: 'שתי' };

export interface CountedNoun {
  singular: string;
  plural: string;
  gender: Gender;
  /** Some nouns keep the singular after numbers above 10 in speech (e.g. "עשרים אחוז"). */
  singularAbove10?: boolean;
}

/**
 * Speaks a quantity with its noun using correct agreement:
 * 1 → "שקל אחד", 2 → "שני שקלים", 29 → "עשרים ותשעה שקלים".
 */
export function countNoun(n: number, noun: CountedNoun): string {
  if (n === 1) return `${noun.singular} ${UNITS[noun.gender][1]}`;
  if (n === 2) return `${TWO_CONSTRUCT[noun.gender]} ${noun.plural}`;
  const word = n > 10 && noun.singularAbove10 ? noun.singular : noun.plural;
  return `${numberToHebrew(n, noun.gender)} ${word}`;
}

/** Reads digits one by one (phone numbers, codes). */
export function digitsToHebrew(digits: string): string {
  return digits
    .replace(/\D/g, '')
    .split('')
    .map((d) => UNITS.f[Number(d)]!)
    .join(' ');
}
