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
