import { describe, expect, it } from 'vitest';
import { FONTS, TYPE_SYSTEMS, breakLines, fillText, fitText, measureText, nearestWeight, tokenize, type FontSpec } from './index';

const heebo = (size: number, weight = 900): FontSpec => ({ family: 'Heebo', weight, size, lineHeight: 1.1, letterSpacing: 0 });

describe('Hebrew typography', () => {
  it('every type system uses fonts and weights that exist, all OFL', () => {
    for (const ts of Object.values(TYPE_SYSTEMS)) {
      for (const f of [ts.display, ts.text]) {
        expect(FONTS[f.family]).toBeDefined();
        expect(FONTS[f.family].license).toBe('SIL OFL 1.1');
        expect(nearestWeight(f.family, f.weight)).toBe(f.weight);
      }
    }
  });

  it('measures with real glyph metrics: wider faces, heavier weights and longer strings measure wider', () => {
    const s = 'קפה ומאפה בבוקר';
    expect(measureText(s, heebo(64))).toBeGreaterThan(measureText(s, heebo(32)) * 1.9);
    expect(measureText(s, heebo(64, 900))).toBeGreaterThan(measureText(s, heebo(64, 400)));
    expect(measureText(s + ' טרי', heebo(64))).toBeGreaterThan(measureText(s, heebo(64)));
    expect(measureText(s, { family: 'Karantina', weight: 700, size: 64, letterSpacing: 0 })).toBeLessThan(measureText(s, heebo(64)));
  });

  it('keeps a price together with its currency', () => {
    const tokens = tokenize('קפה + מאפה ב-29.90 ₪ עד סוף החודש');
    expect(tokens.some((t) => t.includes('29.90') && t.includes('₪'))).toBe(true);
  });

  it('breaks lines without leaving a lone word or a dangling function word', () => {
    const font = heebo(80);
    const text = 'איפה עוצרים לקפה לפני העבודה בפלורנטין?';
    const width = measureText(text, font) * 0.45;
    const lines = breakLines(text, width, font);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(measureText(l, font)).toBeLessThanOrEqual(width + 0.5);
    // A long final word may stand alone (the alternative here would leave "לפני" dangling); a short one may not.
    const last = lines.at(-1)!;
    expect(last.includes(' ') || last.length > 5).toBe(true);
    const short = breakLines('קפה ומאפה טריים כל בוקר רק אצלנו', measureText('קפה ומאפה טריים כל', font), font);
    expect(short.every((l) => l.includes(' ') || l.length > 5)).toBe(true);
    for (const l of lines.slice(0, -1)) expect(['של', 'עם', 'את', 'על', 'ב', 'ל', 'ו']).not.toContain(l.split(' ').at(-1));
  });

  it('never silently shrinks below 88%: it reports that the text does not fit instead', () => {
    const font = heebo(120);
    const text = 'רוצה להתחיל פילאטיס מכשירים ולא יודעת בכלל מאיפה להתחיל?';
    const r = fitText({ text, font, maxWidth: 600, maxHeight: 300, maxLines: 3 });
    expect(r.ratio).toBeGreaterThanOrEqual(0.88 - 1e-9);
    expect(r.fits).toBe(false);
    const ok = fitText({ text: 'הקומבו של הבוקר', font, maxWidth: 900, maxHeight: 400 });
    expect(ok.fits).toBe(true);
    expect(ok.ratio).toBe(1);
  });

  it('fillText finds the largest size that fills the box', () => {
    const r = fillText({ text: 'שיעור ניסיון', font: heebo(100), maxWidth: 800, maxHeight: 400, min: 40, max: 400, maxLines: 2 });
    expect(r.fits).toBe(true);
    expect(r.width).toBeLessThanOrEqual(800.5);
    const bigger = { ...heebo(r.size + 12) };
    const bigLines = breakLines('שיעור ניסיון', 800, bigger);
    expect(bigLines.length > 2 || bigLines.some((l) => measureText(l, bigger) > 800.5) || bigLines.length * bigger.size * 1.1 > 400).toBe(true);
  });
});
