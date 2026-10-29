import { describe, expect, it } from 'vitest';
import { chunkCaption, splitCaptionChunks, stripNiqqud } from './text';
import { assertProjectTransition, canTransitionProject } from './workflow';
import { ConceptSetSchema } from './campaign';

describe('chunkCaption', () => {
  it('covers the scene without gaps, in order, after the lead-in', () => {
    const chunks = chunkCaption('רגע, ראיתם את המבצע ב-Luz?', 120);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.startFrame).toBe(4);
    expect(chunks.at(-1)!.endFrame).toBe(120);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i]!.startFrame).toBe(chunks[i - 1]!.endFrame);
    expect(chunks.map((c) => c.text).join(' ')).toBe('רגע, ראיתם את המבצע ב-Luz?');
  });

  it('never splits a price from its currency and drops standalone dashes', () => {
    const chunks = chunkCaption('עכשיו קפה ומאפה ב-29.90 ₪ – עד סוף החודש', 150);
    expect(chunks.some((c) => c.text.includes('29.90 ₪'))).toBe(true);
    expect(chunks.every((c) => !/^[-–—]/.test(c.text))).toBe(true);
  });

  it('keeps a "X + Y" bundle (and its price) in one chunk', () => {
    const chunks = splitCaptionChunks('ב-Luz יש קפה + מאפה ב-29.90 ₪ עד סוף החודש.');
    expect(chunks.join(' ')).toBe('ב-Luz יש קפה + מאפה ב-29.90 ₪ עד סוף החודש.');
    expect(chunks.some((c) => c.includes('קפה + מאפה'))).toBe(true);
    expect(chunks.some((c) => c.includes('29.90 ₪'))).toBe(true);
    expect(chunks.every((c) => !c.endsWith('+') && !c.startsWith('+'))).toBe(true);
  });

  it('never ends a chunk on a short connecting word ("עד", "של", "כל"…)', () => {
    const chunks = splitCaptionChunks('עכשיו: קפה + מאפה ב-29.90 ₪ עד סוף החודש.');
    expect(chunks).toEqual(['עכשיו: קפה + מאפה ב-29.90 ₪', 'עד סוף החודש.']);
    expect(
      splitCaptionChunks('קולים את הפולים בעצמנו ומאפים טריים כל בוקר').every((c) => !/ (כל|את)$/.test(c)),
    ).toBe(true);
  });

  it('strips niqqud from subtitles and returns nothing for empty text', () => {
    expect(chunkCaption('בואו ללוּז', 60)[0]!.text).toBe('בואו ללוז');
    expect(chunkCaption('   ', 60)).toEqual([]);
    expect(stripNiqqud('שָׁלוֹם')).toBe('שלום');
  });
});

describe('workflow transitions', () => {
  it('only allows defined transitions', () => {
    expect(canTransitionProject('PLAN_READY', 'APPROVED')).toBe(true);
    expect(canTransitionProject('STORYBOARD_READY', 'RENDERING')).toBe(false);
    expect(() => assertProjectTransition('STORYBOARD_READY', 'RENDERED')).toThrow(
      'Invalid workflow transition',
    );
  });
});

describe('ConceptSetSchema', () => {
  const concept = (key: string, angle: string) => ({
    key,
    title: 't',
    angle,
    audience: 'a',
    hook: 'h',
    mainMessage: 'm',
    visualDirection: 'v',
    voiceover: 'vo',
    cta: 'c',
    rationale: 'r',
    complexity: 'LOW',
  });

  it('requires three distinct angles and a valid recommendation', () => {
    const ok = {
      concepts: [concept('a', 'UGC'), concept('b', 'EMOTIONAL'), concept('c', 'OFFER_DRIVEN')],
      recommendedKey: 'a',
      recommendationReason: 'x',
    };
    expect(ConceptSetSchema.safeParse(ok).success).toBe(true);
    expect(ConceptSetSchema.safeParse({ ...ok, recommendedKey: 'zzz' }).success).toBe(false);
    expect(
      ConceptSetSchema.safeParse({
        ...ok,
        concepts: [concept('a', 'UGC'), concept('b', 'UGC'), concept('c', 'UGC')],
      }).success,
    ).toBe(false);
  });
});
