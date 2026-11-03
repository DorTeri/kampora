import { describe, expect, it } from 'vitest';
import type { BusinessFact, DirectorCard, MarketingDecision } from '@kampora/shared';
import { MARKETING_SKILLS, skillDigest, skillsFor } from '@kampora/agent-expertise';
import { decideMarketing, decisionText, DirectorSandbox, memoryOf, recommendNext, understand, type DecisionInput } from './index';

/**
 * The marketing decision: which first step, whether paid ads fit now, and which workflow follows. Unit tests call
 * the decision directly; conversation tests run the engine with the rules brain and the sandbox tools (no AI).
 * These prove the decision follows the owner's situation; whether the advice is good is judged from transcripts.
 */

const NOW = new Date('2026-11-02T10:00:00Z'); // Monday
const now = () => NOW;
function ids() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`;
}
const sandbox = (data?: ConstructorParameters<typeof DirectorSandbox>[0]['data']) => new DirectorSandbox({ now, newId: ids(), data });

const fact = (key: BusinessFact['key'], value: BusinessFact['value'], over: Partial<BusinessFact> = {}): BusinessFact => ({
  key,
  value,
  source: 'OWNER_STATED',
  status: 'CONFIRMED',
  updatedAt: NOW.toISOString(),
  confirmedAt: NOW.toISOString(),
  ...over,
});

const decide = (facts: BusinessFact[], over: Partial<DecisionInput> = {}) =>
  decideMarketing({ model: 'RESTAURANT', objective: 'ORDERS', memory: memoryOf(facts), now: NOW, request: 'ADVICE', ...over });

const WOLT = [fact('conversion.ordering', 'Wolt'), fact('conversion.orderUrl', 'https://wolt.com/he/isr/x/restaurant/y')];
const decisions = (turn: { cards: DirectorCard[] }) => turn.cards.flatMap((c) => (c.kind === 'DECISION' ? [c.decision] : []));
const lastDecision = (turns: { cards: DirectorCard[] }[]): MarketingDecision | undefined => turns.flatMap(decisions).at(-1);
const hasConcepts = (turns: { cards: DirectorCard[] }[]) => turns.some((t) => t.cards.some((c) => c.kind === 'CONCEPTS'));

describe('marketing decision (unit)', () => {
  it('recommends paid ads when there is a working destination, room and a budget', () => {
    const d = decide([...WOLT, fact('budget.monthlyIls', 2000)], { request: 'CAMPAIGN' });
    expect(d.action).toBe('PAID_ADVERTISING');
    expect(d.paid.verdict).toBe('RECOMMENDED');
    expect(d.next).toBe('PAID_CONCEPTS');
    expect(d.confidence).toBe('HIGH');
  });

  it('fixes a conversion blocker first; paid comes back once it works', () => {
    const d = decide([fact('conversion.problem', 'בערב אף אחד לא עונה לטלפון')]);
    expect(d.action).toBe('CONVERSION_PROCESS_FIX');
    expect(d.paid).toMatchObject({ verdict: 'LATER', blockedBy: 'CONVERSION_BLOCKER' });
    expect(d.paid.condition).toBeTruthy();
    expect(d.checklist.length).toBeGreaterThan(0);
    expect(d.blocker).toContain('טלפון');
    // The paid step stays in the plan, after the condition.
    expect(d.sequence.find((x) => x.action === 'PAID_ADVERTISING')?.when).toBeTruthy();
  });

  it('a phone problem with a working ordering link does not block paid: the ad sends to the link', () => {
    const d = decide([...WOLT, fact('conversion.problem', 'בערב אף אחד לא עונה לטלפון')]);
    expect(d.rule).toBe('BLOCKER_BYPASSED');
    expect(d.action).toBe('COMBINED_STRATEGY');
    expect(d.paid.verdict).toBe('RECOMMENDED');
  });

  it('a full calendar is not a reason to advertise: paid is not for now, with no "until"', () => {
    const d = decide([fact('capacity.full', true)], { model: 'BEAUTY', objective: 'BOOKINGS' });
    expect(d.paid).toMatchObject({ verdict: 'NOT_NOW', blockedBy: 'FULL_CAPACITY', condition: null });
    expect(['OFFER_OPTIMIZATION', 'CUSTOMER_RETENTION']).toContain(d.action);
    expect(d.sequence.some((x) => x.action === 'PAID_ADVERTISING')).toBe(false);
  });

  it('no budget leads to own-channel work and no paid step at all', () => {
    const d = decide([fact('budget.monthlyIls', 0)]);
    expect(d.paid.verdict).toBe('NOT_NOW');
    expect(d.sequence.some((x) => x.action === 'PAID_ADVERTISING')).toBe(false);
    expect(d.next).toBe('ORGANIC_CONCEPTS');
  });

  it('traffic without sales is a conversion problem, not a reach problem', () => {
    const d = decide([fact('conversion.problem', 'יש הרבה כניסות לאתר אבל כמעט אף אחד לא קונה')], { model: 'ECOMMERCE', objective: 'ONLINE_SALES' });
    expect(d.action).toBe('CONVERSION_PROCESS_FIX');
    expect(['LATER', 'NOT_NOW']).toContain(d.paid.verdict);
  });

  it('an earlier campaign that "did not work" asks where it stalled before spending again', () => {
    const d = decide([...WOLT, fact('performance.notes', 'הקמפיין הקודם לא הביא הרבה הזמנות')]);
    expect(d.rule).toBe('UNDERPERFORMED');
    expect(d.action).toBe('BUSINESS_RESEARCH');
    expect(d.paid.verdict).toBe('LATER');
    expect(d.questions[0]?.key).toBe('performance.notes');
  });

  it('seen but not clicked: a new message and offer, paid stays', () => {
    const d = decide([...WOLT, fact('performance.notes', 'ראו את המודעה הרבה אנשים, אבל כמעט לא לחצו')]);
    expect(d.rule).toBe('LOW_ENGAGEMENT');
    expect(d.action).toBe('OFFER_OPTIMIZATION');
    expect(d.paid.verdict).toBe('RECOMMENDED');
  });

  it('without a known destination paid is "later", and the decision asks where customers would go', () => {
    const d = decide([], { launch: true, objective: 'PRODUCT_LAUNCH', product: 'פסטה כמהין' });
    expect(d.paid.verdict).toBe('LATER');
    expect(d.questions[0]?.key).toBe('conversion.ordering');
    // A reason that would claim a destination exists is not said.
    expect(d.why).not.toMatch(/יש לאן לשלוח|היעד שתבחרו/);
  });

  it('an owner who insists gets paid as their choice, with the risk stated', () => {
    const d = decide([fact('conversion.problem', 'בערב אף אחד לא עונה לטלפון')], { request: 'CAMPAIGN', ownerChoice: true });
    expect(d).toMatchObject({ rule: 'OWNER_CHOICE', action: 'PAID_ADVERTISING' });
    expect(d.paid.verdict).toBe('OWNER_CHOICE');
    expect(decisionText(d, 'CAMPAIGN')).toMatch(/רק שתדע/);
  });

  it('owner choice applies only when something argued against paid', () => {
    const d = decide([...WOLT, fact('budget.monthlyIls', 1000)], { request: 'CAMPAIGN', ownerChoice: true });
    expect(d.rule).not.toBe('OWNER_CHOICE');
    expect(d.paid.verdict).toBe('RECOMMENDED');
  });

  it('a grounded model hint is used when no owner fact decides; it never overrides a contraindication', () => {
    const hint = { action: 'CUSTOMER_RETENTION' as const, evidence: 'הלקוחות הקבועים הפסיקו להגיע', paidAds: 'NO' as const };
    const used = decide(WOLT, { hint });
    expect(used.rule).toBe('MODEL_HINT');
    expect(used.action).toBe('CUSTOMER_RETENTION');
    expect(used.model).toMatchObject({ used: true });
    expect(used.evidence.some((e) => e.source === 'MODEL')).toBe(true);

    const paidHint = { action: 'PAID_ADVERTISING' as const, evidence: 'אין מקום', paidAds: 'YES' as const };
    const blocked = decide([fact('capacity.full', true)], { model: 'BEAUTY', objective: 'BOOKINGS', hint: paidHint });
    expect(blocked.paid.verdict).toBe('NOT_NOW');
    expect(blocked.model).toMatchObject({ used: false });
  });

  it('on a campaign request, a hint against paid needs a blocker in the owner words', () => {
    const hint = { action: 'ORGANIC_CONTENT' as const, evidence: 'תכין לי קמפיין', paidAds: 'NO' as const };
    const d = decide([...WOLT, fact('budget.monthlyIls', 2000)], { request: 'CAMPAIGN', hint });
    expect(d.rule).not.toBe('MODEL_HINT');
    expect(d.paid.verdict).toBe('RECOMMENDED');
  });

  it('every decision is explainable: evidence, a skill, measurement and a version', () => {
    for (const facts of [[], WOLT, [fact('capacity.full', true)], [fact('budget.monthlyIls', 0)]]) {
      const d = decide(facts);
      expect(d.version).toMatch(/^decision@/);
      expect(d.evidence.length).toBeGreaterThan(0);
      expect(d.skills.some((s) => s.startsWith('paid-ads-economics@'))).toBe(true);
      expect(d.measurement.primaryMetric).toBeTruthy();
      expect(d.sequence.length).toBeGreaterThan(0);
      // No invented numbers: amounts and rates appear only if the owner gave them.
      expect(JSON.stringify(d)).not.toMatch(/\d+\s?%/);
    }
  });
});

describe('marketing skills', () => {
  it('are versioned and each one changes a decision or a play', () => {
    expect(MARKETING_SKILLS.length).toBeGreaterThanOrEqual(11);
    for (const s of MARKETING_SKILLS) {
      expect(s.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(s.responses.length + Object.keys(s.plays).length + s.contraindications.length).toBeGreaterThan(0);
      expect(s.digest.length).toBeLessThanOrEqual(260);
    }
  });

  it('are selected for the business, and the model gets a short digest only', () => {
    const beauty = skillsFor({ model: 'BEAUTY', objective: 'BOOKINGS', signals: ['FULL_CAPACITY'] }).map((s) => s.id);
    expect(beauty).toContain('beauty-appointments');
    expect(beauty).not.toContain('food-delivery-funnel');
    const digest = skillDigest(skillsFor({ model: 'RESTAURANT', objective: 'ORDERS', signals: [] }));
    expect(digest.length).toBeLessThanOrEqual(4);
    expect(digest.join('\n').length).toBeLessThan(1200);
    expect(digest.some((x) => x.startsWith('paid-ads-economics'))).toBe(true);
  });
});

describe('consultative conversation (rules brain, sandbox)', () => {
  it('A. a problem gets advice, not "נכין קמפיין", and no concepts', async () => {
    const s = sandbox();
    const r = await s.send('יש לי פיצרייה בחולון, ובערב אף אחד לא עונה לטלפון ואנשים מתייאשים. מה לעשות?');
    expect(r.text).not.toMatch(/נכין קמפיין|בשמחה/);
    expect(decisions(r)[0]).toMatchObject({ action: 'CONVERSION_PROCESS_FIX', next: 'CHECKLIST' });
    expect(hasConcepts([r])).toBe(false);
    expect((r.text.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
  });

  it('B. a fully booked clinic hears why paid ads are not for now', async () => {
    const r = await sandbox().send('יש לי קליניקה לטיפולי פנים ברמת גן, היומן מלא לחודש קדימה. כדאי לי לפרסם?');
    const d = decisions(r)[0]!;
    expect(d.paid.verdict).toBe('NOT_NOW');
    expect(r.text).toMatch(/לא מתאים עכשיו|אין כרגע מקום/);
  });

  it('D. paid is right: a campaign request with a Wolt link and a budget reaches concepts', async () => {
    const s = sandbox();
    const turns = [
      await s.send('יש לי המבורגריה בראשון לציון, מזמינים אצלנו דרך וולט: https://wolt.com/he/isr/rishon/restaurant/burger-house. תקציב 2000 שקל לחודש לפרסום. תכין לי קמפיין להמבורגר הדאבל שלנו'),
      await s.send('בורגר האוס'),
      await s.send('כן'),
    ];
    expect(hasConcepts(turns)).toBe(true);
    expect(lastDecision(turns)).toMatchObject({ action: 'PAID_ADVERTISING', next: 'PAID_CONCEPTS' });
    expect(lastDecision(turns)!.paid.verdict).toBe('RECOMMENDED');
  });

  it('F. no budget: an organic plan, and "yes" leads to content ideas, not ads', async () => {
    const s = sandbox();
    const r = await s.send('יש לי מאפייה קטנה בפתח תקווה ואין לי שקל לפרסום. איך משיגים עוד לקוחות?');
    expect(decisions(r)[0]).toMatchObject({ next: 'ORGANIC_CONCEPTS' });
    expect(s.executor.data.facts.find((f) => f.key === 'budget.monthlyIls')?.value).toBe(0);
    await s.send('כן');
    const task = s.tasks.at(-1);
    expect(task?.params.channel).toBe('ORGANIC');
  });

  it('I. a returning owner: where did it stall, then the fix that matches the answer', async () => {
    const s = sandbox({
      facts: [fact('business.model', 'RESTAURANT'), fact('business.category', 'שווארמה'), fact('location.city', 'באר שבע'), fact('conversion.orderUrl', 'https://order.example.co.il/s')],
      campaigns: [],
      approvals: [],
    });
    const first = await s.send('הקמפיין הקודם לא הביא הרבה הזמנות. מה היית עושה אחרת?');
    expect(decisions(first)[0]).toMatchObject({ rule: 'UNDERPERFORMED' });
    expect(first.text).toMatch(/ראו ולא לחצו/);
    const second = await s.send('ראו את המודעה הרבה אנשים, אבל כמעט לא לחצו');
    expect(decisions(second)[0]).toMatchObject({ rule: 'LOW_ENGAGEMENT', action: 'OFFER_OPTIMIZATION' });
  });

  it('J. the owner insists after hearing why not: paid concepts as the owner choice, risk said once', async () => {
    const s = sandbox();
    const turns = [await s.send('יש לי פיצרייה בחולון. בערב אף אחד לא עונה לטלפון. תכין לי קמפיין לפיצה משפחתית')];
    expect(decisions(turns[0]!)[0]?.paid.verdict).toBe('LATER');
    expect(hasConcepts(turns)).toBe(false);
    turns.push(await s.send('בכל זאת תכין לי קמפיין ממומן'));
    expect(turns[1]!.text).toMatch(/זו ההחלטה שלך/);
    for (const m of ['פיצה של שמעון', 'בטלפון', '03-5551234', 'אין']) turns.push(await s.send(m));
    expect(hasConcepts(turns)).toBe(true);
    expect(lastDecision(turns)).toMatchObject({ rule: 'OWNER_CHOICE' });
    expect(lastDecision(turns)!.paid.verdict).toBe('OWNER_CHOICE');
  });

  it('"רשמתי" appears at most once in a short advice conversation', async () => {
    const s = sandbox();
    const texts = [];
    for (const m of ['יש לי עגלת קפה בפארק בכפר סבא, אנשים פשוט לא יודעים שאני קיימת. מה הכי נכון לעשות?', 'ליד הכניסה לפארק, כל בוקר', 'תודה'])
      texts.push((await s.send(m)).text);
    expect(texts.filter((x) => /רשמתי/.test(x)).length).toBeLessThanOrEqual(1);
  });
});

describe('defects fixed in V2.1', () => {
  it('"השרון" is a region, never the city; the city is asked once, with a reason, and can be skipped', async () => {
    const u = understand('יש לי סטודיו ליוגה בשרון', { now: NOW });
    expect(u.facts.find((f) => f.key === 'location.region')?.value).toBe('השרון');
    expect(u.facts.some((f) => f.key === 'location.city')).toBe(false);
  });

  it('"תזכיר לי מה אתה יודע עליי" separates confirmed from uncertain facts and says how to correct', async () => {
    const s = sandbox({
      facts: [
        fact('business.name', 'בורגר בוי'),
        fact('location.city', 'תל אביב'),
        fact('offering.main', 'המבורגר כפול', { status: 'PROPOSED', confirmedAt: null }),
        fact('capacity.full', true, { updatedAt: '2026-09-01T10:00:00.000Z', confirmedAt: '2026-09-01T10:00:00.000Z' }),
      ],
      campaigns: [],
      approvals: [],
    });
    const r = await s.send('תזכיר לי מה אתה יודע עליי');
    expect(r.text).toMatch(/בוודאות/);
    expect(r.text).toMatch(/בורגר בוי/);
    expect(r.text).toMatch(/פחות בטוח:.*המבורגר כפול.*לא אישרת/);
    // A situation from two months ago is not presented as current.
    expect(r.text).toMatch(/לא אישרת לאחרונה/);
    expect(r.text).toMatch(/תיקון/);
    expect(r.cards.some((c) => c.kind === 'FACTS')).toBe(true);
  });

  it('long Hebrew dates are read ("עד ה-15 בנובמבר", "עד ה-15 לחודש")', async () => {
    const { parseValidity } = await import('./index');
    expect(parseValidity('המבצע בתוקף עד ה-15 בנובמבר', NOW)?.validUntil).toBe('2026-11-15');
    expect(parseValidity('עד 15 לנובמבר 2026', NOW)?.validUntil).toBe('2026-11-15');
    expect(parseValidity('עד ה-15 לחודש', NOW)?.validUntil).toBe('2026-11-15');
  });

  it('"דרך האתר שלי" is the channel, not part of the product, and makes it an online shop', () => {
    const u = understand('אני מוכרת נרות ריחניים בעבודת יד דרך האתר שלי', { now: NOW });
    expect(u.facts.find((f) => f.key === 'offering.main')?.value).toBe('נרות ריחניים בעבודת יד');
    expect(u.facts.find((f) => f.key === 'business.model')?.value).toBe('ECOMMERCE');
  });

  it('a product written onto "קמפיין ל..." is read; a channel after it is not a product', () => {
    expect(understand('תכין לי קמפיין לפיצה משפחתית', { now: NOW }).product?.text).toBe('פיצה משפחתית');
    expect(understand('תכין לי קמפיין להמבורגר הדאבל שלנו', { now: NOW }).product?.text).toBe('המבורגר הדאבל');
    expect(understand('תכין לי מודעה לאינסטגרם', { now: NOW }).product).toBeUndefined();
  });

  it('a link given as the way to sign up is the booking page', () => {
    const u = understand('אפשר להירשם דרך הקישור https://studio.example.co.il/trial', { now: NOW });
    expect(u.facts.find((f) => f.key === 'conversion.bookingUrl')?.value).toBe('https://studio.example.co.il/trial');
  });

  it('"כמעט אין הזמנות" is not "we do not take orders"', () => {
    const u = understand('יש לנו מסעדה וכמעט אין הזמנות בערב', { now: NOW });
    expect(u.facts.some((f) => f.key === 'conversion.ordering')).toBe(false);
  });
});

describe('defects found on the blind held-out sets', () => {
  it('"רעיונות" (regular nun) is read like "רעיון" (final nun): an advice question', () => {
    expect(understand('יש לך רעיונות?', { now: NOW }).intent).toBe('RECOMMEND');
  });

  it('a business the vocabulary does not know is kept in the owner words, and advice continues', async () => {
    const u = understand('יש לי בר נודלס קטן בחדרה', { now: NOW });
    expect(u.facts.find((f) => f.key === 'business.category')?.value).toBe('בר נודלס');
    expect(understand('פתחתי לפני חודש משתלה קטנה ביקנעם', { now: NOW }).facts.find((f) => f.key === 'business.category')?.value).toBe('משתלה');
    const r = await sandbox().send('יש לנו מבשלת בירה קטנה בזכרון יעקב. בעוד שלושה שבועות אנחנו משיקים בירה חדשה. איך הכי נכון לספר לאנשים?');
    expect(decisions(r)[0]?.action).not.toBe('BUSINESS_RESEARCH');
  });

  it('nothing known at all: a recorded decision that asks the one deciding question', async () => {
    const r = await sandbox().send('אני צריך יותר לקוחות, מה עושים?');
    expect(decisions(r)[0]).toMatchObject({ action: 'BUSINESS_RESEARCH', rule: 'NEEDS_BUSINESS_TYPE', next: 'QUESTION' });
    expect((r.text.match(/\?/g) ?? []).length).toBe(1);
  });

  it('"לפרסם בפייסבוק" in a question is advice, not a request to publish', () => {
    expect(understand('חברה אמרה לי להתחיל לפרסם בפייסבוק. שווה לפרסם עכשיו?', { now: NOW }).forbidden).toBeUndefined();
  });

  it('regulars who should come more often is retention, not a visits campaign', () => {
    const u = understand('יש לי קהל קבוע נחמד, אבל רובם באים פעם בשבועיים. הייתי רוצה שיבואו יותר. יש לך רעיונות?', { now: NOW });
    expect(u.objective).toBe('RETENTION');
    expect(u.intent).toBe('RECOMMEND');
  });

  it('a long onboarding says "רשמתי" once; later only a link or a number is read back', async () => {
    const s = sandbox();
    const texts = [];
    for (const m of ['יש לי מסעדת דגים בטבריה. תכין לי קמפיין למגש פירות ים', 'שם המסעדה: דייגי הכנרת', 'מזמינים בוואטסאפ 052-7781234', 'יש לי תמונות אמיתיות'])
      texts.push((await s.send(m)).text);
    expect(texts.filter((x) => /רשמתי/.test(x)).length).toBeLessThanOrEqual(1);
    expect(s.executor.data.facts.find((f) => f.key === 'business.name')?.value).toBe('דייגי הכנרת');
  });
});

describe('the side panel follows the decision', () => {
  const panel = (facts: BusinessFact[]) =>
    recommendNext({ memory: memoryOf([fact('business.model', 'RESTAURANT'), fact('business.category', 'מסעדה'), ...facts]), now: NOW, history: [], approvals: [], cost: { providerPaid: false, creativeUsd: 0 } });

  it('does not suggest a campaign while customers are stuck', () => {
    const recs = panel([fact('conversion.ordering', 'טלפון'), fact('conversion.problem', 'אף אחד לא עונה לטלפון')]);
    expect(recs.some((r) => r.kind === 'CAMPAIGN')).toBe(false);
    expect(recs.find((r) => r.kind === 'NEXT_STEP')?.title).toBe(decide([fact('conversion.ordering', 'טלפון'), fact('conversion.problem', 'אף אחד לא עונה לטלפון')]).title);
  });

  it('still suggests the campaign when the decision recommends paid ads', () => {
    const recs = panel([...WOLT, fact('budget.monthlyIls', 2000)]);
    expect(recs.some((r) => r.kind === 'CAMPAIGN')).toBe(true);
  });
});
