import { describe, expect, it } from 'vitest';
import { retrieveProfessionalReferences } from '@kampora/agent-expertise';
import type { BrandColors } from '@kampora/shared';
import { directCreative, type DirectionInput } from './art-director-v2';
import { applyCreativeChange, parseChangeRequest } from './change-requests';

const LUZ: BrandColors = { primary: '#2B1B12', secondary: '#C8743A', accent: '#F2C14E', background: '#FBF5EC', text: '#1C140F' };
const luz: DirectionInput = {
  conceptKey: 'offer',
  goal: 'OFFER',
  tone: 'warm',
  industryId: 'cafe-restaurant',
  brand: { name: 'Luz', colors: LUZ },
  concept: { title: 'הקומבו של הבוקר', angle: 'OFFER_DRIVEN', hookTechnique: 'OFFER_FIRST' },
  copy: {
    eyebrow: 'Luz · פלורנטין',
    headline: 'קפה ומאפה בדרך לבוקר',
    subheadline: 'קולים את הפולים בעצמנו',
    price: { price: '29.90 ₪', label: 'עד סוף החודש' },
    cta: 'בואו לנצל את המבצע',
    brandName: 'Luz',
  },
  picture: { assetId: 'pic', focal: { x: 0.5, y: 0.5 }, authenticity: 'SYNTHETIC_AI' },
  references: retrieveProfessionalReferences({ industryId: 'cafe-restaurant', goal: 'OFFER', tone: 'warm', format: 'STATIC' }),
};
const set = directCreative(luz);
// A studio with no picture at all, and a subheadline that repeats the price (the real Q6 pilot copy).
const pilates: DirectionInput = {
  conceptKey: 'leads',
  goal: 'LEADS',
  tone: 'friendly',
  industryId: 'fitness',
  brand: { name: 'נשימה', colors: { primary: '#1F3A3D', secondary: '#7FB7A4', accent: '#F4B860', background: '#F6F3EE', text: '#14211F' } },
  concept: { title: 'מתחילות בקבוצה קטנה', angle: 'PROBLEM_SOLUTION', hookTechnique: 'QUESTION' },
  copy: {
    eyebrow: 'נשימה · חיפה',
    headline: 'מתחילות פילאטיס בקבוצה קטנה',
    subheadline: 'שיעור ניסיון ב-49 ₪',
    price: { price: '49 ₪', label: 'שיעור ניסיון' },
    cta: 'נשימה | השאירו פרטים',
    ctaSub: 'מוריה 40, חיפה',
    brandName: 'נשימה',
  },
  references: retrieveProfessionalReferences({ industryId: 'fitness', goal: 'LEADS', tone: 'friendly', format: 'STATIC' }),
};

describe('Hebrew change requests: recognition', () => {
  it.each([
    ['אני רוצה עיצוב יותר יוקרתי', 'MORE_PREMIUM'],
    ['התמונה לא מתאימה למוצר', 'IMAGE_MISMATCH'],
    ['תבליט יותר את המחיר', 'EMPHASIZE_PRICE'],
    ['הטיפוגרפיה פשוטה מדי', 'TYPOGRAPHY_TOO_SIMPLE'],
    ['נסה כיוון עיצובי אחר', 'ANOTHER_DIRECTION'],
    ['זה עמוס מדי', 'CALMER'],
    ['אפשר משהו יותר נועז?', 'BOLDER'],
    ['יש יותר מדי טקסט', 'SHORTER_COPY'],
    ['הכותרת קטנה מדי', 'BIGGER_HEADLINE'],
    ['לא רואים את המחיר', 'EMPHASIZE_PRICE'],
    ['בָּקָשָׁה: הַטִּיפּוֹגְרַפְיָה פְּשׁוּטָה מִדַּי', 'TYPOGRAPHY_TOO_SIMPLE'],
  ])('"%s" → %s', (text, intent) => {
    expect(parseChangeRequest(text).intents.map((i) => i.intent)).toEqual([intent]);
  });

  it('recognises several requests in one sentence, and contradictions', () => {
    expect(parseChangeRequest('יותר יוקרתי ותבליט את המחיר').intents.map((i) => i.intent).sort()).toEqual(['EMPHASIZE_PRICE', 'MORE_PREMIUM']);
    expect(parseChangeRequest('יותר רגוע אבל גם יותר נועז').conflicts).toEqual([['BOLDER', 'CALMER']]);
  });

  it('an unrelated sentence changes nothing', () => {
    const out = applyCreativeChange(luz, set, 'A', 'מה שלומך היום');
    expect(out.parsed.intents).toEqual([]);
    expect(out.direction).toBe(set.directions[0]);
    expect(out.suggestions?.length).toBeGreaterThan(0);
  });
});

describe('Hebrew change requests: validated changes', () => {
  const words = (d: (typeof set.directions)[number]) =>
    Object.values(d.specs).flatMap((s) => s.layers.flatMap((l) => (l.kind === 'text' ? [l.text] : []))).sort();

  it('"more premium" changes the art direction and never the words', () => {
    const before = set.directions.find((d) => d.key === 'B')!;
    const out = applyCreativeChange(luz, set, 'B', 'אני רוצה עיצוב יותר יוקרתי');
    expect(out.direction.typeSystem).toBe('LUXURY_SERIF');
    expect(out.direction.moves).toContain('GENEROUS_NEGATIVE_SPACE');
    expect(out.direction.moves).not.toContain('VIBRANT_COMPLEMENTARY');
    expect(out.direction.moves.some((m) => ['DARK_MOODY', 'MUTED_NATURAL_PALETTE'].includes(m))).toBe(true);
    expect(words(out.direction)).toEqual(words(before));
    expect(out.direction.rationale.at(-1)!.topic).toBe('owner change');
    expect(out.changes.every((c) => c.cost === 'FREE')).toBe(true);
  });

  it('"emphasize the price" makes the approved price the focus, unchanged', () => {
    const out = applyCreativeChange(luz, set, 'B', 'תבליט יותר את המחיר');
    expect(out.direction.emphasis).toBe('PRICE');
    const price = out.direction.specs['4:5']!.layers.find((l) => l.kind === 'text' && l.role === 'PRICE');
    expect(price && price.kind === 'text' && price.text).toBe('29.90 ₪');
    const beforePrice = set.directions[1]!.specs['4:5']!.layers.find((l) => l.kind === 'text' && l.role === 'PRICE')!;
    expect(price!.kind === 'text' && beforePrice.kind === 'text' && price.font.size).toBeGreaterThan(beforePrice.kind === 'text' ? beforePrice.font.size : 0);
  });

  it('without an approved price, emphasizing it goes to the owner instead of inventing one', () => {
    const noPrice = { ...luz, copy: { ...luz.copy, price: undefined } };
    const out = applyCreativeChange(noPrice, directCreative(noPrice), 'A', 'תבליט את המחיר');
    expect(out.changes[0]!.status).toBe('NEEDS_OWNER');
    expect(out.changes.some((c) => c.status === 'APPLIED')).toBe(false);
  });

  it('"the image does not fit" asks for a paid new picture and meanwhile drops the rejected one', () => {
    const out = applyCreativeChange(luz, set, 'A', 'התמונה לא מתאימה למוצר');
    const paid = out.changes.find((c) => c.component === 'VISUAL_PLANNER')!;
    expect(paid.cost).toBe('PAID');
    expect(paid.status).toBe('PENDING_APPROVAL');
    for (const s of Object.values(out.direction.specs)) expect(s.layers.some((l) => l.kind === 'image')).toBe(false);
  });

  it('"typography too simple" picks a face with more character, unused by the other directions', () => {
    const a = set.directions[0]!;
    const out = applyCreativeChange(luz, set, 'A', 'הטיפוגרפיה פשוטה מדי');
    expect(out.direction.typeSystem).not.toBe(a.typeSystem);
    expect(set.directions.filter((d) => d.key !== 'A').map((d) => d.typeSystem)).not.toContain(out.direction.typeSystem);
  });

  it('"another direction" uses an arrangement none of the three directions uses', () => {
    const out = applyCreativeChange(luz, set, 'C', 'נסה כיוון עיצובי אחר');
    expect(set.directions.map((d) => d.method)).not.toContain(out.direction.method);
    expect(out.direction.approach).toBe('BOLD_GRAPHIC');
  });

  it('shorter copy is a paid Copywriter request; the words stay as approved', () => {
    const out = applyCreativeChange(luz, set, 'A', 'יש יותר מדי טקסט');
    expect(out.changes.find((c) => c.component === 'COPYWRITER')!.status).toBe('PENDING_APPROVAL');
    for (const t of words(out.direction)) expect(words(set.directions[0]!)).toContain(t);
  });

  it.each([
    ['Luz (picture)', luz],
    ['Pilates (no picture)', pilates],
  ])('%s: every free change is applied, fits at full size and passes technical QA', (_name, input) => {
    const directions = directCreative(input);
    for (const text of ['אני רוצה עיצוב יותר יוקרתי', 'תבליט יותר את המחיר', 'הטיפוגרפיה פשוטה מדי', 'נסה כיוון עיצובי אחר', 'יותר נועז', 'יותר רגוע', 'התמונה לא מתאימה למוצר']) {
      for (const key of ['A', 'B', 'C'] as const) {
        const out = applyCreativeChange(input, directions, key, text);
        const where = `${key} "${text}"`;
        expect(out.changes.some((c) => c.status === 'NOT_POSSIBLE'), where).toBe(false);
        expect(Object.keys(out.technical).sort()).toEqual(['4:5', '9:16']);
        for (const [f, t] of Object.entries(out.technical)) expect(t, `${where} ${f}`).toEqual({ verdict: 'PASS', problems: [] });
        for (const s of Object.values(out.direction.specs)) expect(s.fit.status).not.toBe('UNRESOLVED');
      }
    }
  });
});
