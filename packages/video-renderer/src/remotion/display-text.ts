import { stripNiqqud } from '@kampora/shared';
import { keepPricesTogether } from './overlays';

const WORD_JOINER = String.fromCharCode(0x2060);

/**
 * Display text: no niqqud, an amount never wraps away from its ₪, and a short Hebrew prefix never wraps away from
 * the word it is attached to ("ב-Luz?" breaking after the hyphen read as "ב-" / "Luz?").
 */
export function displayText(text: string): string {
  return keepPricesTogether(stripNiqqud(text)).replace(/(^|\s)(\p{L}{1,3})-(?=\S)/gu, `$1$2-${WORD_JOINER}`);
}
