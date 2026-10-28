/**
 * Ambiguous unvocalized Hebrew words that matter in ad copy. Without niqqud a TTS model must guess
 * (מבצע = mivtsa "promotion" / mevatse "performs"). We never add full niqqud; at most we vocalize the one word,
 * and only when (a) a safe default reading exists for ad context and (b) selective niqqud is enabled for the
 * provider after listening tests. Otherwise the word is only flagged for review.
 */
export interface AmbiguousWord {
  word: string;
  readings: string[];
  /** Reading to apply in ad copy when selective niqqud is enabled. Absent → flag only. */
  adDefault?: string;
}

export const AMBIGUOUS_WORDS: readonly AmbiguousWord[] = [
  { word: 'מבצע', readings: ['מִבְצָע', 'מְבַצֵּעַ'], adDefault: 'מִבְצָע' },
  { word: 'הנחה', readings: ['הֲנָחָה', 'הַנָּחָה'], adDefault: 'הֲנָחָה' },
  { word: 'בוקר', readings: ['בֹּקֶר', 'בּוֹקֵר'], adDefault: 'בֹּקֶר' },
  { word: 'שמן', readings: ['שֶׁמֶן', 'שָׁמֵן'] },
  { word: 'חלב', readings: ['חָלָב', 'חֵלֶב'] },
  { word: 'ספר', readings: ['סֵפֶר', 'סַפָּר', 'סִפֵּר'] },
  { word: 'מנות', readings: ['מָנוֹת', 'מְנוֹת'] },
];

export interface AmbiguityResult {
  text: string;
  flagged: Array<{ word: string; applied: boolean }>;
}

/**
 * Finds ambiguous words (standalone, or with one attached prefix letter) and optionally vocalizes the
 * standalone ones with their ad default. Prefixed forms are only flagged: vocalizing them needs the prefix
 * vowel too, which is easy to get wrong.
 */
export function resolveAmbiguities(text: string, apply: boolean): AmbiguityResult {
  const flagged: AmbiguityResult['flagged'] = [];
  let out = text;
  for (const entry of AMBIGUOUS_WORDS) {
    const re = new RegExp(`(?<![\\u0590-\\u05FF])([ובהלמשכ]?)${entry.word}(?![\\u0590-\\u05FF])`, 'g');
    out = out.replace(re, (match, prefix: string) => {
      const canApply = apply && !prefix && Boolean(entry.adDefault);
      flagged.push({ word: match, applied: canApply });
      return canApply ? entry.adDefault! : match;
    });
  }
  return { text: out, flagged };
}
