/**
 * Flags advertising claims that need explicit business approval: superlatives, guarantees and
 * absolute statements. A phrase is allowed when it appears inside one of the approved claims.
 */
const RISKY_PATTERNS: RegExp[] = [
  /הכי\s+[֐-׿]+/g,
  /מספר\s?1/g,
  /[֐-׿]+\s+ביותר/g,
  /100\s?%/g,
  /מובטח[תים]*/g,
  /(?:ה)?ראשונ(?:ה|ים)?\s+ב(?:ישראל|ארץ)/g,
  /ללא\s+(?:תחרות|מתחרים)/g,
  /אין\s+כמונו/g,
  /הוכח\s+(?:מדעית|קלינית)/g,
];

export interface ClaimFlag {
  phrase: string;
  source: string;
}

export function checkClaims(texts: readonly string[], approvedClaims: readonly string[]): ClaimFlag[] {
  const approved = approvedClaims.join(' | ');
  const flags: ClaimFlag[] = [];
  for (const source of texts) {
    for (const pattern of RISKY_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        const phrase = match[0];
        if (!approved.includes(phrase) && !flags.some((f) => f.phrase === phrase)) {
          flags.push({ phrase, source });
        }
      }
    }
  }
  return flags;
}

const TESTIMONIAL_PATTERNS: RegExp[] = [
  /לקוחות?\s+(?:ממליצ|מספר|אומר|כותב|משתפ)[֐-׿]*/g,
  /(?:ביקורות|המלצות\s+של\s+לקוחות|דירוג|כוכבים|⭐)/g,
  /["“”][^"“”]{6,}["“”]\s*[-–—]\s*[֐-׿]+/g,
];

/** Words that assert a commercial fact which must come from the business's own offer. */
const OFFER_WORDS: Array<{ re: RegExp; label: string }> = [
  { re: /הנחה|הנחות|%/, label: 'הנחה' },
  { re: /חינם|בחינם|מתנה/, label: 'חינם/מתנה' },
  { re: /1\s*\+\s*1|אחד\s+פלוס\s+אחד/, label: '1+1' },
];

export interface FactSources {
  /** Free text the business supplied or approved: offer, product names/prices, address, approved claims. */
  allowedText: string[];
}

function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,:]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ''));
}

/**
 * Hard grounding check for generated copy: every number (price, percentage, time, address) must appear in
 * the business-supplied data, discounts/"free" claims only when the offer says so, and no testimonials or
 * reviews at all (we have none on record). Returns problems in English for the model's repair hint.
 */
export function checkFacts(texts: readonly string[], sources: FactSources): string[] {
  const corpus = sources.allowedText.join(' \n ');
  const allowedNumbers = new Set(numbersIn(corpus));
  const problems = new Set<string>();
  for (const text of texts) {
    for (const n of numbersIn(text)) {
      if (!allowedNumbers.has(n)) {
        problems.add(
          `The number "${n}" does not appear in the business data. Do not invent numbers or prices.`,
        );
      }
    }
    for (const { re, label } of OFFER_WORDS) {
      if (re.test(text) && !re.test(corpus)) {
        problems.add(
          `"${label}" is not part of the business's offer. Do not invent discounts or free items.`,
        );
      }
    }
    for (const pattern of TESTIMONIAL_PATTERNS) {
      const match = text.match(pattern);
      if (match) problems.add(`Testimonials/reviews are not allowed ("${match[0]}"). Remove them.`);
    }
  }
  return [...problems];
}
