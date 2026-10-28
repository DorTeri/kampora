import type { PronunciationEntry } from '@kampora/shared';
import { countNoun, digitsToHebrew, numberToHebrew, type CountedNoun, type Gender } from './numbers';

/**
 * Hebrew speech normalization: turns customer-facing ad copy into text a TTS engine can read naturally.
 * The original text is never modified; subtitles keep using it.
 */

export interface NormalizeOptions {
  pronunciation?: PronunciationEntry[];
  /** formal: "עשרים ותשעה שקלים ותשעים אגורות"; colloquial: "עשרים ותשע תשעים". */
  priceStyle?: 'formal' | 'colloquial';
}

export interface NormalizationChange {
  rule: string;
  from: string;
  to: string;
}

export interface NormalizedSpeech {
  original: string;
  spoken: string;
  changes: NormalizationChange[];
  /** Things a human (or QC) should check, e.g. Latin words without a pronunciation entry. */
  warnings: string[];
}

const SHEKEL: CountedNoun = { singular: 'שקל', plural: 'שקלים', gender: 'm' };
const AGORA: CountedNoun = { singular: 'אגורה', plural: 'אגורות', gender: 'f' };
const PERCENT: CountedNoun = { singular: 'אחוז', plural: 'אחוזים', gender: 'm', singularAbove10: true };

const MONTHS = [
  'ינואר',
  'פברואר',
  'מרץ',
  'אפריל',
  'מאי',
  'יוני',
  'יולי',
  'אוגוסט',
  'ספטמבר',
  'אוקטובר',
  'נובמבר',
  'דצמבר',
];

/** Common nouns after numbers in ad copy, with grammatical gender. singular is used for n === 1. */
const NOUN_GENDER: Record<string, Gender> = {
  // masculine
  שקלים: 'm',
  שקל: 'm',
  מוצרים: 'm',
  מוצר: 'm',
  מאפים: 'm',
  מאפה: 'm',
  אנשים: 'm',
  ימים: 'm',
  יום: 'm',
  חודשים: 'm',
  חודש: 'm',
  סוגים: 'm',
  סוג: 'm',
  טעמים: 'm',
  טעם: 'm',
  פריטים: 'm',
  פריט: 'm',
  סניפים: 'm',
  סניף: 'm',
  לקוחות: 'm',
  לקוח: 'm',
  שבועות: 'm',
  שבוע: 'm',
  מקומות: 'm',
  מקום: 'm',
  זוגות: 'm',
  זוג: 'm',
  משלוחים: 'm',
  שירותים: 'm',
  שירות: 'm',
  טיפולים: 'm',
  טיפול: 'm',
  קורסים: 'm',
  קורס: 'm',
  מטרים: 'm',
  מטר: 'm',
  // feminine
  שעות: 'f',
  שעה: 'f',
  דקות: 'f',
  דקה: 'f',
  שנים: 'f',
  שנה: 'f',
  כוסות: 'f',
  כוס: 'f',
  עוגות: 'f',
  עוגה: 'f',
  עוגיות: 'f',
  עוגייה: 'f',
  מנות: 'f',
  מנה: 'f',
  פיצות: 'f',
  פיצה: 'f',
  חנויות: 'f',
  חנות: 'f',
  הנחות: 'f',
  פעמים: 'f',
  פעם: 'f',
  שניות: 'f',
  שנייה: 'f',
  תמונות: 'f',
  אגורות: 'f',
  אגורה: 'f',
  קומות: 'f',
  קומה: 'f',
  ארוחות: 'f',
  ארוחה: 'f',
  סדנאות: 'f',
  סדנה: 'f',
};

/** Abbreviations written with ASCII quotes (input gershayim are normalized to ASCII first). */
const ABBREVIATIONS: Array<[string, string]> = [
  ['בע"מ', 'בערבון מוגבל'],
  ['ת"א', 'תל אביב'],
  ['עו"ד', 'עורך דין'],
  ['ד"ר', 'דוקטור'],
  ['ק"ג', 'קילו'],
  ['ק"מ', 'קילומטר'],
  ['ס"מ', 'סנטימטר'],
  ['מ"ר', 'מטר רבוע'],
  ["א'-ה'", 'ראשון עד חמישי'],
  ["א'-ו'", 'ראשון עד שישי'],
  ["רח'", 'רחוב'],
  ["מס'", 'מספר'],
  ["וכו'", 'וכולי'],
];

/** Hebrew one-letter prefixes that attach to the next word (and to numbers, often with a hyphen: "ב-20"). */
const PREFIX = '([ובכלמשה]{0,3})[-־]?';
/** An integer with optional thousands separators in groups of three ("1,200"), so "12, תל אביב" keeps its comma. */
const NUMBER = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)';
/** Word-start lookbehind that works for Hebrew (\b does not). */
const START = '(?<=^|[\\s(\\["\'“”])';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseAmount(raw: string): number {
  return Number(raw.replace(/,/g, ''));
}

/** "7.5" → "שבע וחצי", "4.25" → "ארבע נקודה עשרים וחמש", "1,200" → "אלף ומאתיים". */
function decimalToHebrew(raw: string, gender: Gender): string {
  const [intPart, fracPart] = raw.replace(/,/g, '').split('.');
  const whole = numberToHebrew(Number(intPart), gender);
  if (!fracPart) return whole;
  if (fracPart === '5') return `${whole} וחצי`;
  return `${whole} נקודה ${numberToHebrew(Number(fracPart), 'f')}`;
}

function priceToHebrew(raw: string, style: 'formal' | 'colloquial'): string {
  const value = parseAmount(raw);
  const shekels = Math.floor(value);
  const agorot = Math.round((value - shekels) * 100);
  if (style === 'colloquial') {
    if (!agorot) return countNoun(shekels, SHEKEL);
    return `${numberToHebrew(shekels, 'f')} ${numberToHebrew(agorot, 'f')}`;
  }
  if (!shekels) return countNoun(agorot, AGORA);
  if (!agorot) return countNoun(shekels, SHEKEL);
  return `${countNoun(shekels, SHEKEL)} ו${countNoun(agorot, AGORA)}`;
}

export function normalizeHebrewForSpeech(original: string, options: NormalizeOptions = {}): NormalizedSpeech {
  const changes: NormalizationChange[] = [];
  const warnings: string[] = [];
  const priceStyle = options.priceStyle ?? 'formal';

  const apply = (text: string, rule: string, re: RegExp, fn: (...m: string[]) => string): string =>
    text.replace(re, (...args: unknown[]) => {
      const match = args[0] as string;
      const groups = args.slice(1, -2) as string[];
      const replacement = fn(match, ...groups.map((g) => g ?? ''));
      if (replacement !== match) changes.push({ rule, from: match, to: replacement });
      return replacement;
    });

  let text = original
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[״“”]/g, '"')
    .replace(/[׳‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  // 1. Business pronunciation dictionary (brand names, products, English terms). Longest terms first.
  const entries = [...(options.pronunciation ?? [])].sort((a, b) => b.term.length - a.term.length);
  for (const entry of entries) {
    const flags = entry.caseSensitive ? 'gu' : 'giu';
    const re = new RegExp(`${START}${PREFIX}${escapeRegExp(entry.term)}(?![\\p{L}\\p{N}])`, flags);
    text = apply(text, 'pronunciation', re, (_m, prefix) => `${prefix}${entry.spoken}`);
  }

  // 2. Abbreviations.
  for (const [abbr, expansion] of ABBREVIATIONS) {
    const re = new RegExp(`${START}${PREFIX}${escapeRegExp(abbr)}(?![\\p{L}])`, 'gu');
    text = apply(text, 'abbreviation', re, (_m, prefix) => `${prefix}${expansion}`);
  }

  // 3. "קפה + מאפה" → "קפה ומאפה".
  text = apply(text, 'plus', /\s\+\s*(?=\S)/g, () => ' ו');

  // 4. Currency spellings → ₪ placed after the amount.
  text = text
    .replace(/ש"ח|(?<=\d\s?)שח(?![\p{L}])|NIS(?![\p{L}])/gu, '₪')
    .replace(/₪\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)/g, '$1 ₪');

  // 5. Israeli phone numbers → digit by digit.
  text = apply(text, 'phone', /(?<!\d)(0(?:5\d|[2-9]|7\d))-?(\d{3})-?(\d{4})(?!\d)/g, (_m, a, b, c) =>
    [a, b, c].map((g) => digitsToHebrew(g)).join(', '),
  );

  // 6. Dates: 28/10, 28/10/2026, 28.10.2026.
  const dateRe = new RegExp(
    `${START}${PREFIX}(\\d{1,2})(?:/(\\d{1,2})(?:/(\\d{2,4}))?|\\.(\\d{1,2})\\.(\\d{4}))(?!\\d)`,
    'gu',
  );
  text = apply(text, 'date', dateRe, (match, prefix, d, m1, y1, m2, y2) => {
    const day = Number(d);
    const month = Number(m1 || m2);
    if (!month || month > 12 || day < 1 || day > 31) return match;
    const yearRaw = y1 || y2;
    const year = yearRaw ? (yearRaw.length === 2 ? 2000 + Number(yearRaw) : Number(yearRaw)) : undefined;
    const spokenDate = `${numberToHebrew(day, 'm')} ב${MONTHS[month - 1]}${year ? ` ${numberToHebrew(year, 'f')}` : ''}`;
    return `${prefix}${spokenDate}`;
  });

  // 7. Times: 8:00, 08:30, ב-19:45.
  const timeRe = new RegExp(`${START}${PREFIX}([01]?\\d|2[0-3]):([0-5]\\d)(?!\\d)`, 'gu');
  text = apply(text, 'time', timeRe, (_m, prefix, h, mm) => {
    const hour = numberToHebrew(Number(h), 'f');
    const minutes = Number(mm);
    const tail =
      minutes === 0
        ? ''
        : minutes === 15
          ? ' ורבע'
          : minutes === 30
            ? ' וחצי'
            : ` ו${numberToHebrew(minutes, 'f')}`;
    return `${prefix}${hour}${tail}`;
  });

  // 8. Prices: "29.90 ₪", "ב-29.90 ₪".
  const priceRe = new RegExp(`${START}${PREFIX}(${NUMBER}(?:\\.\\d{1,2})?)\\s?₪`, 'gu');
  text = apply(
    text,
    'price',
    priceRe,
    (_m, prefix, amount) => `${prefix}${priceToHebrew(amount, priceStyle)}`,
  );

  // 9. Percentages: "20%", "ב-20%".
  const percentRe = new RegExp(`${START}${PREFIX}(\\d+(?:\\.\\d+)?)\\s?%`, 'gu');
  text = apply(text, 'percent', percentRe, (_m, prefix, n) =>
    n.includes('.')
      ? `${prefix}${decimalToHebrew(n, 'f')} אחוז`
      : `${prefix}${countNoun(Number(n), PERCENT)}`,
  );

  // 10. Remaining numbers, with gender agreement when followed by a known noun.
  const numberRe = new RegExp(
    `${START}${PREFIX}(${NUMBER}(?:\\.\\d+)?)(?!\\d)(\\s+([\\u0590-\\u05FF]+))?`,
    'gu',
  );
  text = apply(text, 'number', numberRe, (_m, prefix, raw, nounPart, noun) => {
    const gender = noun ? NOUN_GENDER[noun] : undefined;
    const value = parseAmount(raw);
    if (gender && Number.isInteger(value)) {
      if (value === 1) return `${prefix}${noun} ${numberToHebrew(1, gender)}`;
      if (value === 2) return `${prefix}${gender === 'm' ? 'שני' : 'שתי'} ${noun}`;
      return `${prefix}${numberToHebrew(value, gender)} ${noun}`;
    }
    return `${prefix}${decimalToHebrew(raw, gender ?? 'f')}${nounPart}`;
  });

  // 11. Leftover Latin words need a pronunciation entry (or provider handling); flag them.
  const latin = text.match(/[A-Za-z][A-Za-z'&.-]*/g);
  if (latin) {
    for (const word of new Set(latin)) {
      warnings.push(`UNRESOLVED_LATIN: "${word}" has no pronunciation entry`);
    }
  }

  return { original, spoken: text.replace(/\s+/g, ' ').trim(), changes, warnings };
}
