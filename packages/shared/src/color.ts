/** Color arithmetic for deterministic design decisions (contrast checks, tints). Hex colors only: #rrggbb. */

const channels = (hex: string): [number, number, number] => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const toHex = (rgb: readonly number[]) =>
  `#${rgb
    .map((c) =>
      Math.round(Math.min(255, Math.max(0, c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

/** WCAG 2.x relative luminance. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1–21). Normal text needs ≥ 4.5, large display text ≥ 3. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** `amount` of `b` mixed into `a` (0: a, 1: b). */
export function mixHex(a: string, b: string, amount: number): string {
  const ca = channels(a);
  const cb = channels(b);
  return toHex(ca.map((c, i) => c + (cb[i]! - c) * amount));
}

/** The candidate with the best contrast on `background` (the first one that reaches `min`, if any does). */
export function readableOn(background: string, candidates: readonly string[], min = 4.5): string {
  const ok = candidates.find((c) => contrastRatio(c, background) >= min);
  if (ok) return ok;
  return [...candidates, '#ffffff', '#111111'].sort(
    (x, y) => contrastRatio(y, background) - contrastRatio(x, background),
  )[0]!;
}
