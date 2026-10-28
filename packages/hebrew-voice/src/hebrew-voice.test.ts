import { describe, expect, it } from 'vitest';
import { stripNiqqud } from '@kampora/shared';
import { countNoun, digitsToHebrew, numberToHebrew } from './numbers';
import { normalizeHebrewForSpeech } from './normalize';
import { prepareForProvider } from './providers';

describe('numberToHebrew', () => {
  it.each([
    [0, 'f', 'אפס'],
    [1, 'f', 'אחת'],
    [1, 'm', 'אחד'],
    [2, 'm', 'שניים'],
    [12, 'f', 'שתים עשרה'],
    [12, 'm', 'שנים עשר'],
    [21, 'f', 'עשרים ואחת'],
    [29, 'm', 'עשרים ותשעה'],
    [100, 'f', 'מאה'],
    [120, 'f', 'מאה ועשרים'],
    [125, 'f', 'מאה עשרים וחמש'],
    [200, 'f', 'מאתיים'],
    [1000, 'f', 'אלף'],
    [1005, 'f', 'אלף וחמש'],
    [1100, 'f', 'אלף ומאה'],
    [2026, 'f', 'אלפיים עשרים ושש'],
    [2500, 'f', 'אלפיים וחמש מאות'],
    [11000, 'f', 'אחד עשר אלף'],
    [1_000_000, 'f', 'מיליון'],
    [3_200_000, 'f', 'שלושה מיליון ומאתיים אלף'],
  ] as const)('%i (%s) → %s', (n, gender, expected) => {
    expect(numberToHebrew(n, gender)).toBe(expected);
  });

  it('rejects negatives and fractions', () => {
    expect(() => numberToHebrew(-1)).toThrow(RangeError);
    expect(() => numberToHebrew(1.5)).toThrow(RangeError);
  });

  it('agrees counted nouns', () => {
    const shekel = { singular: 'שקל', plural: 'שקלים', gender: 'm' } as const;
    expect(countNoun(1, shekel)).toBe('שקל אחד');
    expect(countNoun(2, shekel)).toBe('שני שקלים');
    expect(countNoun(49, shekel)).toBe('ארבעים ותשעה שקלים');
  });

  it('reads digits', () => {
    expect(digitsToHebrew('052')).toBe('אפס חמש שתיים');
  });
});

describe('normalizeHebrewForSpeech', () => {
  const n = (text: string, opts = {}) => normalizeHebrewForSpeech(text, opts).spoken;

  it('speaks prices with shekels and agorot, including attached prefixes', () => {
    expect(n('קפה ומאפה ב-29.90 ₪ בלבד')).toBe('קפה ומאפה בעשרים ותשעה שקלים ותשעים אגורות בלבד');
    expect(n('רק 49 ש"ח')).toBe('רק ארבעים ותשעה שקלים');
    expect(n('₪120')).toBe('מאה ועשרים שקלים');
    expect(n('ב-29.90 ₪', { priceStyle: 'colloquial' })).toBe('בעשרים ותשע תשעים');
  });

  it('speaks percentages', () => {
    expect(n('20% הנחה')).toBe('עשרים אחוז הנחה');
    expect(n('הנחה של 5%')).toBe('הנחה של חמישה אחוזים');
    expect(n('ב-1%')).toBe('באחוז אחד');
  });

  it('agrees numbers with the following noun', () => {
    expect(n('3 מאפים')).toBe('שלושה מאפים');
    expect(n('3 עוגות')).toBe('שלוש עוגות');
    expect(n('2 כוסות')).toBe('שתי כוסות');
    expect(n('1 מאפה')).toBe('מאפה אחד');
    expect(n('רחוב פלורנטין 12')).toBe('רחוב פלורנטין שתים עשרה');
    expect(n('פלורנטין 12, תל אביב')).toBe('פלורנטין שתים עשרה, תל אביב');
    expect(n('1,200 לקוחות')).toBe('אלף ומאתיים לקוחות');
    expect(n('תוך 1.5 שעות')).toBe('תוך אחת וחצי שעות');
  });

  it('speaks dates, times and phone numbers', () => {
    expect(n('עד 31/10')).toBe('עד שלושים ואחד באוקטובר');
    expect(n('ב-28.10.2026')).toBe('בעשרים ושמונה באוקטובר אלפיים עשרים ושש');
    expect(n('פתוח מ-7:30 עד 19:00')).toBe('פתוח משבע וחצי עד תשע עשרה');
    expect(n('התקשרו 03-1234567')).toBe('התקשרו אפס שלוש, אחת שתיים שלוש, ארבע חמש שש שבע');
  });

  it('expands abbreviations and the plus sign', () => {
    expect(n('קפה + מאפה בת"א')).toBe('קפה ומאפה בתל אביב');
    expect(n('פתוח א׳-ה׳')).toBe('פתוח ראשון עד חמישי');
  });

  it('applies the pronunciation dictionary, keeping Hebrew prefixes', () => {
    const result = normalizeHebrewForSpeech('מחכים לכם ב-Luz', {
      pronunciation: [{ term: 'luz', spoken: 'לוּז', caseSensitive: false }],
    });
    expect(result.spoken).toBe('מחכים לכם בלוּז');
    expect(result.warnings).toEqual([]);
  });

  it('flags Latin words without a pronunciation entry and leaves the original intact', () => {
    const original = 'הכירו את Luz';
    const result = normalizeHebrewForSpeech(original);
    expect(result.warnings[0]).toContain('Luz');
    expect(result.original).toBe(original);
  });

  it('strips emoji', () => {
    expect(n('בוקר טוב ☕')).toBe('בוקר טוב');
  });
});

describe('provider preparation', () => {
  it('keeps dictionary niqqud for ElevenLabs as plain text with voice settings', () => {
    const p = prepareForProvider('בואו ללוּז', 'elevenlabs', { delivery: 'energetic' });
    expect(p.format).toBe('text');
    expect(p.payload).toBe('בואו ללוּז');
    expect(p.settings).toHaveProperty('voice_settings');
  });

  it('strips niqqud and builds escaped SSML for Google', () => {
    const p = prepareForProvider('קפה & מאפה בלוּז', 'google', { pauseAfterMs: 300 });
    expect(p.payload).toBe(
      '<speak><prosody rate="100%">קפה &amp; מאפה בלוז</prosody><break time="300ms"/></speak>',
    );
  });

  it('builds Azure SSML with a Hebrew voice', () => {
    const p = prepareForProvider('שלום', 'azure');
    expect(p.payload).toContain('xml:lang="he-IL"');
    expect(p.payload).toContain('he-IL-HilaNeural');
  });

  it('subtitle text never carries niqqud', () => {
    expect(stripNiqqud('לוּז')).toBe('לוז');
  });
});
