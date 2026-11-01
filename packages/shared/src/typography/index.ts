import { z } from 'zod';
import { stripNiqqud } from '../text';
import { FONT_METRICS } from './font-metrics.generated';

/**
 * Kampora's Hebrew typography system. Every family is a Google Font under the SIL Open Font License 1.1
 * (commercial use, embedding and modification allowed) with full Hebrew coverage. Text is measured with the
 * fonts' real advance widths (font-metrics.generated.ts), so layout decisions are made on measured lines.
 */
export const FontFamilySchema = z.enum([
  'Heebo',
  'Rubik',
  'Assistant',
  'Frank Ruhl Libre',
  'Secular One',
  'Suez One',
  'Karantina',
  'Bellefair',
  'Noto Serif Hebrew',
  'IBM Plex Sans Hebrew',
  'Amatic SC',
  'Varela Round',
]);
export type FontFamily = z.infer<typeof FontFamilySchema>;

export type FontCategory = 'SANS' | 'SERIF' | 'DISPLAY' | 'CONDENSED' | 'ROUNDED' | 'HAND';

export interface FontInfo {
  family: FontFamily;
  category: FontCategory;
  weights: readonly number[];
  /** What the face says, used when matching a brand personality. */
  voice: readonly string[];
  license: 'SIL OFL 1.1';
}

export const FONTS: Record<FontFamily, FontInfo> = Object.fromEntries(
  (
    [
      ['Heebo', 'SANS', ['neutral', 'modern', 'direct']],
      ['Rubik', 'SANS', ['friendly', 'energetic', 'confident']],
      ['Assistant', 'SANS', ['light', 'clean', 'calm']],
      ['Frank Ruhl Libre', 'SERIF', ['editorial', 'classic', 'crafted']],
      ['Secular One', 'DISPLAY', ['bold', 'loud', 'punchy']],
      ['Suez One', 'DISPLAY', ['warm', 'traditional', 'heavy serif']],
      ['Karantina', 'CONDENSED', ['urgent', 'poster', 'sporty']],
      ['Bellefair', 'SERIF', ['luxury', 'refined', 'quiet']],
      ['Noto Serif Hebrew', 'SERIF', ['serious', 'trustworthy', 'literary']],
      ['IBM Plex Sans Hebrew', 'SANS', ['technical', 'precise', 'professional']],
      ['Amatic SC', 'HAND', ['handmade', 'playful', 'casual']],
      ['Varela Round', 'ROUNDED', ['soft', 'approachable', 'gentle']],
    ] as const
  ).map(([family, category, voice]) => [
    family,
    {
      family,
      category,
      weights: Object.keys(FONT_METRICS[family] ?? {}).map(Number),
      voice,
      license: 'SIL OFL 1.1',
    },
  ]),
) as unknown as Record<FontFamily, FontInfo>;

export interface FontSpec {
  family: FontFamily;
  weight: number;
  /** px */
  size: number;
  /** Multiple of size. */
  lineHeight: number;
  /** em */
  letterSpacing: number;
}

/**
 * A type system: a display face for headlines and prices, a text face for supporting copy, and an optional accent
 * face for short eyebrows. Systems are chosen by brand personality and design moves, never one face for everything.
 */
export const TypeSystemIdSchema = z.enum([
  'MODERN_SANS',
  'EDITORIAL_SERIF',
  'LUXURY_SERIF',
  'BOLD_DISPLAY',
  'CONDENSED_IMPACT',
  'FRIENDLY_ROUND',
  'CLASSIC_WARM',
  'PRECISE_CLEAN',
]);
export type TypeSystemId = z.infer<typeof TypeSystemIdSchema>;

export interface TypeSystem {
  id: TypeSystemId;
  display: { family: FontFamily; weight: number; letterSpacing: number; lineHeight: number };
  text: { family: FontFamily; weight: number; strongWeight: number };
  accent: { family: FontFamily; weight: number; letterSpacing: number };
  /** Personality words this system expresses. */
  voice: readonly string[];
}

export const TYPE_SYSTEMS: Record<TypeSystemId, TypeSystem> = {
  MODERN_SANS: {
    id: 'MODERN_SANS',
    display: { family: 'Heebo', weight: 900, letterSpacing: -0.02, lineHeight: 1.02 },
    text: { family: 'Heebo', weight: 400, strongWeight: 700 },
    accent: { family: 'Heebo', weight: 700, letterSpacing: 0.12 },
    voice: ['modern', 'direct', 'neutral', 'urban'],
  },
  EDITORIAL_SERIF: {
    id: 'EDITORIAL_SERIF',
    display: { family: 'Frank Ruhl Libre', weight: 700, letterSpacing: -0.01, lineHeight: 1.08 },
    text: { family: 'Assistant', weight: 400, strongWeight: 600 },
    accent: { family: 'Assistant', weight: 600, letterSpacing: 0.18 },
    voice: ['editorial', 'crafted', 'artisan', 'warm', 'considered'],
  },
  LUXURY_SERIF: {
    id: 'LUXURY_SERIF',
    display: { family: 'Bellefair', weight: 400, letterSpacing: 0, lineHeight: 1.1 },
    text: { family: 'Assistant', weight: 400, strongWeight: 600 },
    accent: { family: 'Assistant', weight: 400, letterSpacing: 0.24 },
    voice: ['luxury', 'premium', 'refined', 'calm', 'elegant'],
  },
  BOLD_DISPLAY: {
    id: 'BOLD_DISPLAY',
    display: { family: 'Secular One', weight: 400, letterSpacing: -0.01, lineHeight: 1.0 },
    text: { family: 'Rubik', weight: 400, strongWeight: 700 },
    accent: { family: 'Rubik', weight: 700, letterSpacing: 0.1 },
    voice: ['bold', 'playful', 'loud', 'promotional', 'youthful'],
  },
  CONDENSED_IMPACT: {
    id: 'CONDENSED_IMPACT',
    display: { family: 'Karantina', weight: 700, letterSpacing: 0, lineHeight: 0.92 },
    text: { family: 'Heebo', weight: 500, strongWeight: 800 },
    accent: { family: 'Heebo', weight: 800, letterSpacing: 0.14 },
    voice: ['energetic', 'sporty', 'urgent', 'athletic', 'poster'],
  },
  FRIENDLY_ROUND: {
    id: 'FRIENDLY_ROUND',
    display: { family: 'Rubik', weight: 900, letterSpacing: -0.02, lineHeight: 1.04 },
    text: { family: 'Rubik', weight: 400, strongWeight: 500 },
    accent: { family: 'Rubik', weight: 500, letterSpacing: 0.08 },
    voice: ['friendly', 'approachable', 'family', 'local', 'cheerful'],
  },
  CLASSIC_WARM: {
    id: 'CLASSIC_WARM',
    display: { family: 'Suez One', weight: 400, letterSpacing: 0, lineHeight: 1.06 },
    text: { family: 'Assistant', weight: 400, strongWeight: 800 },
    accent: { family: 'Assistant', weight: 800, letterSpacing: 0.12 },
    voice: ['traditional', 'homely', 'hearty', 'trusted', 'neighbourhood'],
  },
  PRECISE_CLEAN: {
    id: 'PRECISE_CLEAN',
    display: { family: 'IBM Plex Sans Hebrew', weight: 700, letterSpacing: -0.01, lineHeight: 1.08 },
    text: { family: 'IBM Plex Sans Hebrew', weight: 400, strongWeight: 500 },
    accent: { family: 'IBM Plex Sans Hebrew', weight: 500, letterSpacing: 0.14 },
    voice: ['professional', 'precise', 'reliable', 'clinical', 'technical'],
  },
};

/** Nearest available weight of a family (fonts ship a few weights; the renderer loads exactly these). */
export function nearestWeight(family: FontFamily, weight: number): number {
  const ws = FONTS[family].weights;
  return ws.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), ws[0]!);
}

const FALLBACK_ADVANCE = 0.6;

/** Width in px of one line of text in the given font. */
export function measureText(text: string, font: Pick<FontSpec, 'family' | 'weight' | 'size' | 'letterSpacing'>): number {
  const m = FONT_METRICS[font.family]?.[nearestWeight(font.family, font.weight)];
  let em = 0;
  let n = 0;
  for (const ch of stripNiqqud(text)) {
    em += m?.adv[ch] ?? (ch === '⁠' ? 0 : FALLBACK_ADVANCE);
    n++;
  }
  // Kerning is not in hmtx; 1.5% keeps the estimate on the safe side.
  return (em + Math.max(0, n - 1) * font.letterSpacing) * font.size * 1.015;
}

/**
 * Words that must stay on one line: an amount with its currency sign ("29.90 ₪", "₪ 29.90"), and a one-to-three
 * letter Hebrew prefix glued with a hyphen is already one token.
 */
export function tokenize(text: string): string[] {
  const raw = stripNiqqud(text).replace(/\s+/g, ' ').trim().split(' ');
  const out: string[] = [];
  for (const w of raw) {
    const prev = out[out.length - 1];
    if (prev !== undefined && (/^[₪%]$/.test(w) || /^₪$/.test(prev) || /^[\d.,]+$/.test(prev) && /^[₪%]/.test(w)))
      out[out.length - 1] = `${prev}\u00A0${w}`;
    else out.push(w);
  }
  return out;
}

function greedy(tokens: string[], maxWidth: number, font: FontSpec): string[] {
  const lines: string[] = [];
  let line = '';
  for (const t of tokens) {
    const next = line ? `${line} ${t}` : t;
    if (line && measureText(next, font) > maxWidth) {
      lines.push(line);
      line = t;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

const DANGLING = /^(ו?(לא|של|את|עם|על|אל|גם|כי|או|אם|כל|בין|לפני|אחרי|עד|מול|בלי)|ו|ה|ב|ל|מ|ש|כ)$/;

/**
 * Line breaks chosen deliberately: the fewest lines that fit, then, among breaks with that line count, the least
 * ragged one, so lines are balanced and no short word is left alone on a line. Explicit "\n" is honoured.
 */
export function breakLines(text: string, maxWidth: number, font: FontSpec): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const tokens = tokenize(para);
    if (!tokens.length) continue;
    const base = greedy(tokens, maxWidth, font);
    if (base.length === 1) {
      out.push(...base);
      continue;
    }
    // Same line count, least ragged: lines close to each other in width, a last line that is not a lone word.
    const cost = (lines: string[]) => {
      const w = lines.map((l) => measureText(l, font));
      const widest = Math.max(...w);
      const ragged = w.reduce((sum, x, i) => sum + (i === w.length - 1 ? 0.6 : 1) * (widest - x) ** 2, 0) / widest ** 2;
      // A lone word on a line reads as a mistake; a line that ends at a comma or full stop reads as a phrase.
      const lone = lines.filter((l) => !l.includes(' ')).length * 0.35;
      const phrase = lines.slice(0, -1).filter((l) => /[,.:;!?]$/.test(l)).length * 0.12;
      // Hebrew function words ("ולא", "של", "עם"…) belong with the words after them, not at a line end.
      const dangling = lines.slice(0, -1).filter((l) => DANGLING.test(l.split(' ').pop() ?? '')).length * 0.5;
      return ragged + lone + dangling - phrase;
    };
    let best = base;
    let bestCost = cost(base);
    const consider = (attempt: string[]) => {
      if (attempt.length !== base.length || attempt.some((l) => measureText(l, font) > maxWidth)) return;
      const c = cost(attempt);
      if (c < bestCost - 1e-9) {
        best = attempt;
        bestCost = c;
      }
    };
    if (tokens.length <= 16) {
      // Short copy (headlines, offers): every way of cutting the words into the same number of lines.
      const k = base.length;
      const cut = (start: number, left: number, acc: string[]) => {
        if (left === 1) return consider([...acc, tokens.slice(start).join(' ')]);
        for (let end = start + 1; end <= tokens.length - left + 1; end++) {
          const line = tokens.slice(start, end).join(' ');
          if (measureText(line, font) > maxWidth) break;
          cut(end, left - 1, [...acc, line]);
        }
      };
      cut(0, k, []);
    } else {
      for (let k = 0; k <= 24; k++) consider(greedy(tokens, maxWidth * (0.45 + (0.55 * k) / 24), font));
    }
    out.push(...best);
  }
  return out;
}

export interface FittedText {
  lines: string[];
  size: number;
  /** size / requested size */
  ratio: number;
  width: number;
  height: number;
  fits: boolean;
}

export interface FitRequest {
  text: string;
  font: FontSpec;
  maxWidth: number;
  maxHeight: number;
  maxLines?: number;
  /** Smallest share of the requested size the block may take without being reported (default 0.88). */
  minRatio?: number;
}

export function textBlockHeight(lines: number, font: Pick<FontSpec, 'size' | 'lineHeight'>): number {
  return lines * font.size * font.lineHeight;
}

/**
 * Fits a text block: first by line breaking at the planned size, then by small size steps down to `minRatio`.
 * It never goes further: when the text still does not fit it returns fits=false so the composer can reflow the
 * layout, choose another arrangement or ask for shorter copy. Headlines are never silently shrunk to ~70%.
 */
export function fitText(req: FitRequest): FittedText {
  const minRatio = req.minRatio ?? 0.88;
  const maxLines = req.maxLines ?? 6;
  let ratio = 1;
  let last: FittedText | undefined;
  while (ratio >= minRatio - 1e-9) {
    const font = { ...req.font, size: Math.round(req.font.size * ratio) };
    const lines = breakLines(req.text, req.maxWidth, font);
    const width = Math.max(...lines.map((l) => measureText(l, font)));
    const height = textBlockHeight(lines.length, font);
    last = { lines, size: font.size, ratio, width, height, fits: lines.length <= maxLines && height <= req.maxHeight && width <= req.maxWidth + 0.5 };
    if (last.fits) return last;
    ratio = Math.round((ratio - 0.04) * 100) / 100;
  }
  return last!;
}

/** The largest size (up to `max`) at which the text fills the box in at most `maxLines` lines. */
export function fillText(req: Omit<FitRequest, 'minRatio'> & { min: number; max: number }): FittedText {
  let lo = req.min;
  let hi = req.max;
  let best: FittedText | undefined;
  for (let i = 0; i < 16; i++) {
    const size = (lo + hi) / 2;
    const font = { ...req.font, size: Math.round(size) };
    const lines = breakLines(req.text, req.maxWidth, font);
    const width = Math.max(...lines.map((l) => measureText(l, font)));
    const height = textBlockHeight(lines.length, font);
    const fits = lines.length <= (req.maxLines ?? 4) && height <= req.maxHeight && width <= req.maxWidth + 0.5;
    if (fits) {
      best = { lines, size: font.size, ratio: font.size / req.max, width, height, fits };
      lo = size;
    } else hi = size;
  }
  if (best) return best;
  const font = { ...req.font, size: req.min };
  const lines = breakLines(req.text, req.maxWidth, font);
  return { lines, size: req.min, ratio: req.min / req.max, width: Math.max(...lines.map((l) => measureText(l, font))), height: textBlockHeight(lines.length, font), fits: false };
}
