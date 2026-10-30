import type { IndustryProfile } from '@kampora/agent-expertise';
import type { BusinessProfile, CampaignBrief, ConceptSet, CriterionResult } from '@kampora/shared';
import { conceptSetQa } from '../copy-qa';
import { measured, notMeasured, type Finding } from './report';

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
const PRICE = /\d[\d,.]*\s?₪|₪\s?\d|\d+%/;

/**
 * The Critic on a concept set: measurable proxies for the marketing criteria. It reuses the Copywriter's gate
 * (so a set that passed generation rarely fails here) and adds what the gate does not block on: hook and
 * message length, offer communication, the CTA.
 */
export function critiqueConceptSet(
  set: ConceptSet,
  ctx: {
    business: BusinessProfile;
    brief: Pick<CampaignBrief, 'goal' | 'offer'>;
    industry: IndustryProfile;
    /** Phrases the fact check flagged in the stored concepts. */
    claimFlags?: readonly { phrase: string }[];
  },
): CriterionResult[] {
  const qa = conceptSetQa(set, ctx);
  const by = (...codes: string[]) => qa.filter((i) => codes.includes(i.code));
  const issue = (severity: Finding['severity'], codes: string[], correction: string): Finding[] =>
    by(...codes).map((i) => ({ severity, explanation: i.message, evidence: [i.code], correction }));

  const hook: Finding[] = [];
  for (const c of set.concepts) {
    const n = words(c.hook);
    if (n > 12)
      hook.push({
        severity: 'MAJOR',
        explanation: `"${c.title}": the hook has ${n} words.`,
        evidence: [c.hook],
        correction: 'Cut the hook to at most 8 words around one concrete detail.',
        target: c.key,
      });
    else if (n > 8)
      hook.push({
        severity: 'MINOR',
        explanation: `"${c.title}": the hook has ${n} words (aim for ≤ 8).`,
        evidence: [c.hook],
        target: c.key,
      });
    if (!c.copy?.hookTechnique)
      hook.push({
        severity: 'MINOR',
        explanation: `"${c.title}" has no named hook technique.`,
        target: c.key,
      });
  }
  hook.push(...issue('MAJOR', ['CLICHE'], 'Replace the cliché with a detail only this business can say.'));

  const clarity: Finding[] = set.concepts.flatMap((c): Finding[] => {
    const prices = new Set(c.voiceover.match(new RegExp(PRICE, 'g')) ?? []);
    const out: Finding[] = [];
    if (prices.size > 1)
      out.push({
        severity: 'MAJOR',
        explanation: `"${c.title}" names ${prices.size} different prices.`,
        evidence: [...prices],
        correction: 'Keep one price per ad.',
        target: c.key,
      });
    if (words(c.mainMessage) > 20)
      out.push({
        severity: 'MINOR',
        explanation: `"${c.title}": the main message has ${words(c.mainMessage)} words.`,
        target: c.key,
      });
    return out;
  });

  const cta: Finding[] = [
    ...set.concepts
      .filter((c) => words(c.cta) > 6)
      .map((c): Finding => ({
        severity: 'MINOR',
        explanation: `"${c.title}": the call to action has ${words(c.cta)} words.`,
        evidence: [c.cta],
        target: c.key,
      })),
    ...issue('MINOR', ['REPEATED_CTA'], 'Give each concept its own next step.'),
  ];

  const results: CriterionResult[] = [
    measured('HOOK_STRENGTH', hook, 'Every hook is short, names its technique and avoids clichés.'),
    measured('MESSAGE_CLARITY', clarity, 'One message and at most one price per concept.'),
    notMeasured(
      'AUDIENCE_RELEVANCE',
      'Whether the hook reflects a real audience situation is a judgement: opinion pass or people.',
    ),
    measured(
      'DIFFERENTIATION',
      issue(
        'MAJOR',
        ['SAME_HOOK_TECHNIQUE', 'SIMILAR_HOOKS', 'SIMILAR_SCRIPTS', 'SAME_INSIGHT'],
        'Rewrite one concept around another angle and technique.',
      ),
      'Different techniques, wording and insights across the set.',
      set.concepts.map((c) => `${c.key}: ${c.angle}/${c.copy?.hookTechnique ?? '—'}`),
    ),
    measured('CTA_CLARITY', cta, 'Each call to action is a short, concrete next step.'),
  ];

  if (ctx.brief.offer) {
    const priced = PRICE.test(ctx.brief.offer);
    const shows = set.concepts.filter((c) =>
      PRICE.test(`${c.hook} ${c.copy?.headline ?? ''} ${c.voiceover}`),
    );
    results.push(
      measured(
        'OFFER_COMMUNICATION',
        priced && !shows.length
          ? [
              {
                severity: 'MAJOR',
                explanation: 'No concept states the offer price.',
                evidence: [ctx.brief.offer],
                correction: 'State the exact offer in the offer-led concept, once.',
              },
            ]
          : [],
        'The exact offer appears where it should.',
        shows.map((c) => c.key),
      ),
    );
  } else
    results.push({
      ...notMeasured('OFFER_COMMUNICATION', 'No offer in this campaign.'),
      method: 'DETERMINISTIC',
    });

  results.push(
    measured(
      'FACTUAL_ACCURACY',
      [
        ...issue(
          'CRITICAL',
          ['UNAPPROVED_CLAIM', 'NEEDS_VERIFICATION'],
          'Remove the claim or confirm it in the business memory.',
        ),
        ...(ctx.claimFlags ?? []).map((f): Finding => ({
          severity: 'MAJOR',
          explanation: `"${f.phrase}" is not backed by the business memory.`,
          evidence: [f.phrase],
          correction: 'Confirm the fact or remove it.',
          component: 'OWNER',
        })),
      ],
      'Every claim comes from the approved claims.',
    ),
    measured(
      'HEBREW_NATURALNESS',
      [
        ...issue(
          'MAJOR',
          ['CLICHE', 'FORMAL_REGISTER', 'TRANSLATIONESE'],
          'Say it the way a Tel Aviv neighbour would.',
        ),
        ...issue('MINOR', ['EXCLAMATIONS'], 'One exclamation mark at most.'),
      ],
      'No cliché, formal register or translated phrasing found by the lint.',
    ),
  );
  return results;
}
