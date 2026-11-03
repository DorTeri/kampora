import type { CampaignGoal, HookTechnique } from '@kampora/shared';
import type { Method, Playbook } from './playbook';

/** Hook techniques. Three concepts in one set never share a technique (a different way to stop the scroll). */
export const HOOK_TECHNIQUES: Record<HookTechnique, Method> = {
  QUESTION: {
    id: 'QUESTION',
    name: 'The audience’s own question',
    when: 'The audience already has a specific frustration or doubt the business answers.',
    how: 'Ask the exact question they ask themselves, in their words, about one situation (not "מחפשים X?").',
    avoid: 'Generic yes/no questions anyone could ask about any business.',
  },
  BOLD_STATEMENT: {
    id: 'BOLD_STATEMENT',
    name: 'A confident, specific statement',
    when: 'There is an approved claim or a verified fact that is genuinely distinctive.',
    how: 'State it plainly and concretely in one short line; let the specific detail do the work.',
    avoid: 'Superlatives that are not approved claims ("הכי טוב בעיר").',
  },
  OFFER_FIRST: {
    id: 'OFFER_FIRST',
    name: 'The offer first',
    when: 'The goal is an offer or sales and the offer is clear value.',
    how: 'Open with what you get and the exact price/terms from the brief; nothing before it.',
    avoid: 'Burying the price, or rounding/changing the terms.',
    goals: ['OFFER', 'SALES'],
  },
  PATTERN_INTERRUPT: {
    id: 'PATTERN_INTERRUPT',
    name: 'Pattern interrupt',
    when: 'The category is visually or verbally repetitive and the audience scrolls past "ads".',
    how: 'An unexpected but true juxtaposition or a surprising first line that makes sense one second later.',
    avoid: 'Shock without relevance; anything mocking the audience.',
  },
  FIRST_PERSON: {
    id: 'FIRST_PERSON',
    name: 'First-person discovery',
    when: 'Trust matters and a recommendation feels more credible than an announcement.',
    how: 'A natural first-person line ("גיליתי...") voiced as the brand’s own discovery story.',
    avoid: 'Inventing a customer, a review or a testimonial.',
  },
  SENSORY_DETAIL: {
    id: 'SENSORY_DETAIL',
    name: 'Sensory detail',
    when: 'The product is experienced through taste, smell, texture or touch.',
    how: 'One concrete sensory detail that is true for this product category, said simply.',
    avoid: 'Stacking adjectives ("טעים, טרי ומדהים").',
  },
  CONTRAST: {
    id: 'CONTRAST',
    name: 'Contrast',
    when: 'The value is clearest against the usual alternative.',
    how: 'Ordinary vs. this, in two short beats; only truthful comparisons, never naming competitors.',
    avoid: 'Fake before/after, or disparaging others.',
  },
  HOW_TO: {
    id: 'HOW_TO',
    name: 'One useful tip',
    when: 'Lead generation or education: the audience needs knowledge before they act.',
    how: 'Promise one practical tip in the first line and deliver it within the ad.',
    avoid: 'Teasing a tip that never comes.',
    goals: ['LEADS', 'AWARENESS'],
  },
};

/**
 * The marketing idea of a concept: the reason to choose the business that the ad argues. A hook technique is how
 * the ad stops the scroll; the territory is what it says. Three concepts with the same territory are one idea in
 * three layouts, however different their hooks look.
 */
export interface CreativeTerritory {
  id: string;
  name: string;
  /** The argument, in one line. */
  idea: string;
  /** The audience truth it rests on (a hypothesis, never a statistic). */
  insight: string;
  /** What must exist in the business facts before this territory is used. */
  needs: string;
  goals: readonly CampaignGoal[];
  /** One Hebrew line in the territory's voice, as a model of tone (never copied into an ad). */
  example: string;
}

export const CREATIVE_TERRITORIES: readonly CreativeTerritory[] = [
  {
    id: 'VALUE',
    name: 'What you get for the money',
    idea: 'The exact offer is the news: what is included, then the price, nothing before it.',
    insight: 'A closed price removes the last hesitation before ordering now rather than later.',
    needs: 'an offer with exact terms in the brief',
    goals: ['OFFER', 'SALES'],
    example: 'דאבל + צ׳יפס + שתייה ב-59 ₪',
  },
  {
    id: 'CRAVING',
    name: 'The moment of wanting it',
    idea: 'Meet the audience at the hour the desire starts, with the product itself in close-up.',
    insight: 'Food and treats are chosen in a moment of desire, not after comparing; whoever shows up in that moment gets the order.',
    needs: 'the real product (its name and, ideally, what is in it)',
    goals: ['PRODUCT_PROMO', 'SALES', 'OFFER'],
    example: 'ערב, רעב, והבטן כבר החליטה',
  },
  {
    id: 'CRAFT',
    name: 'How it is made',
    idea: 'One true detail of the making, said by the business itself, is the proof of quality.',
    insight: 'When every competitor says "fresh" and "quality", one concrete detail is more convincing than any praise.',
    needs: 'an approved claim about how the product is made',
    goals: ['PRODUCT_PROMO', 'AWARENESS', 'SALES'],
    example: 'אצלנו טוחנים את הבשר במקום',
  },
  {
    id: 'OCCASION',
    name: 'Own a recurring moment',
    idea: 'Tie the business to a moment that comes back every week, so the moment itself becomes the reminder.',
    insight: 'People do not choose a category; they solve a moment ("what do we do tonight"). A business linked to the moment is remembered each time it returns.',
    needs: 'nothing beyond the product; the moment must fit how the product is actually used',
    goals: ['AWARENESS', 'PRODUCT_PROMO', 'OFFER'],
    example: 'חמישי בערב, ואף אחד לא מתנדב לבשל',
  },
  {
    id: 'LOCAL',
    name: 'Right here',
    idea: 'Introduce the business to its own area: where it is and why it is worth the short trip.',
    insight: 'For a business people do not know yet, the first barrier is not knowing it exists, or that it is this close.',
    needs: 'the city or address',
    goals: ['AWARENESS'],
    example: 'ראשון לציון, תכירו: בורגר האוס',
  },
  {
    id: 'RELIEF',
    name: 'The problem goes away',
    idea: 'Name one familiar frustration in the audience’s words and show the business removing it.',
    insight: 'A problem the audience already feels gets attention that a benefit does not.',
    needs: 'a real problem the business solves',
    goals: ['LEADS', 'SALES'],
    example: 'פוחדת להיות החדשה בשיעור?',
  },
  {
    id: 'PEOPLE',
    name: 'The people behind it',
    idea: 'The owner or team, real and at eye level, telling the business’s own story.',
    insight: 'It is easier to order from, or walk into, a place whose people you have already seen.',
    needs: 'real people who agreed to appear (never an invented customer)',
    goals: ['AWARENESS', 'LEADS'],
    example: 'זה אני, ואת זה אני מכין כל בוקר',
  },
];

/** Compact guide for the prompt: one line per territory. */
export function creativeTerritoriesGuide(): string {
  return CREATIVE_TERRITORIES.map(
    (t) => `- ${t.id}: ${t.idea} Insight: ${t.insight} Needs: ${t.needs}. Tone, e.g. "${t.example}".`,
  ).join('\n');
}

export const COPYWRITING_PLAYBOOK: Playbook = {
  id: 'copywriting',
  version: '1.1.0',
  role: 'COPYWRITER',
  responsibility:
    'Turn the creative brief into genuinely different advertising concepts and the exact words for each format: hook, spoken script, written headline, CTA, with the reasoning behind them.',
  requiredContext: [
    'business facts and approved claims',
    'campaign goal, exact offer and desired action',
    'audience',
    'industry profile',
    'target formats and duration',
  ],
  methods: [
    {
      id: 'PROBLEM_AGITATE_SOLVE',
      name: 'Problem → consequence → solution',
      when: 'A real, familiar problem exists that the business solves.',
      how: 'Name the problem in one line, make its cost felt in one line, present the business as the simple way out.',
      avoid: 'Inventing a problem the audience does not have, or medical/financial fear tactics.',
      goals: ['LEADS', 'SALES', 'PRODUCT_PROMO'],
    },
    {
      id: 'BENEFIT_NOT_FEATURE',
      name: 'Benefit over feature',
      when: 'Always, when describing a product.',
      how: 'Translate each feature into what it changes for the customer ("קולים בעצמנו" → coffee that tastes fresh).',
      avoid: 'Lists of features with no "so what".',
    },
    {
      id: 'REASON_TO_BELIEVE',
      name: 'Reason to believe',
      when: 'The message makes a promise.',
      how: 'Back the promise with one approved claim or verified fact, quoted accurately.',
      avoid: 'Unapproved proof: numbers, awards, reviews or guarantees that the business did not give.',
    },
    {
      id: 'OFFER_FRAMING',
      name: 'Offer framing',
      when: 'There is an offer.',
      how: 'Say what is included before the price, then the exact price and terms; one offer per ad.',
      avoid:
        'Two prices in one ad, invented deadlines or "only today" urgency that the brief does not state.',
      goals: ['OFFER', 'SALES'],
    },
    {
      id: 'OBJECTION_HANDLING',
      name: 'Answer the main objection',
      when: 'The audience has an obvious hesitation (price, time, "not for me").',
      how: 'Name it lightly and answer it with a fact from the brief.',
      avoid: 'Introducing objections the audience would not have thought of.',
      goals: ['LEADS', 'SALES'],
    },
    {
      id: 'ONE_ACTION_CTA',
      name: 'One clear action',
      when: 'Always.',
      how: 'One verb-first action that matches the goal and the channel (בואו / הזמינו / השאירו פרטים), plus where or how.',
      avoid: 'Several actions, vague CTAs ("לפרטים נוספים"), the same CTA phrase repeated in every concept.',
    },
    {
      id: 'WRITTEN_VS_SPOKEN',
      name: 'Separate written and spoken copy',
      when: 'Every concept that runs as video and as a static ad.',
      how: 'The spoken script is conversational and full; the written headline is 3–7 words, scannable in a second, and is not a transcript of the voice line.',
      avoid: 'Putting the whole voiceover on screen.',
    },
  ],
  constraints: [
    'Natural spoken Israeli Hebrew, plural "you", no niqqud, no translated-English phrasing.',
    'Only facts from the business and the brief; prices and terms quoted exactly, as digits.',
    'No invented testimonials, reviews, statistics, awards, guarantees or deadlines.',
    'One message and one offer per ad.',
    'Hook ≤ 8 words; written headline ≤ 7 words; spoken pace ≈ 2.3 words per second.',
  ],
  decisionRules: [
    'Each of the three concepts tests a different marketing hypothesis: a different angle, a different hook technique and a different insight.',
    'Each concept argues a different creative territory (a different reason to choose the business). An approved claim is the main message of one concept at most; the others may use it only as supporting proof.',
    'Use the business’s own product details (what is in the dish, how it is made) before any adjective.',
    'For OFFER and SALES goals one concept leads with the offer; the others must still be able to carry the offer.',
    'Prefer the specific over the general: a named product, a real detail, the exact offer.',
    'Use an approved claim only when it supports this concept’s message.',
    'The recommended concept is the one most likely to achieve the stated goal for this audience, not the most creative one.',
  ],
  outputs: ['ConceptSet with strategy and copy per concept', 'CopywritingProposal per concept'],
  examples: [
    {
      situation: 'Café, offer "קפה + מאפה ב-29.90 ₪", goal OFFER',
      good: 'Hook: "קפה ומאפה חם ב-29.90 ₪" (offer first)',
      weak: 'Hook: "חוויה של בוקר מושלם מחכה לכם"',
      why: 'The good hook carries the value in two seconds; the weak one is a cliché that fits any café.',
    },
    {
      situation: 'Burger place, product "דאבל סמאש" (two thin patties, cheddar, caramelised onion), goal PRODUCT_PROMO',
      good: 'Three territories: craving ("ערב, רעב, והבטן כבר החליטה" + the real ingredients), craft ("אצלנו טוחנים את הבשר במקום"), occasion ("חמישי בערב, ואף אחד לא מתנדב לבשל")',
      weak: 'Three hooks around the same claim: "מחפשים המבורגר שאפשר לסמוך עליו?", "ככה נראה המבורגר מקרוב", "תנו לנו להראות לכם"',
      why: 'The good set tests three reasons to order; the weak one repeats one message in three layouts with template openers.',
    },
    {
      situation: 'Pilates studio, goal LEADS, approved claim "קבוצות של עד 6 מתאמנות"',
      good: 'Hook: "פוחדת להיות החדשה בשיעור?" → reassurance via the small groups claim',
      weak: 'Hook: "מחפשים סטודיו פילאטיס?"',
      why: 'The good hook names the real hesitation of beginners; the weak one only restates the category.',
    },
  ],
  failureModes: [
    'Three concepts that are the same idea with different adjectives.',
    'Three concepts that all lead with the same approved claim.',
    'Template openers that fit any business: "מחפשים X?", "ככה נראה X מקרוב", "תנו לנו להראות לכם".',
    'A hyphen between a prefix letter and a Hebrew word ("ב-בורגר האוס"); the hyphen is only for digits and Latin ("ב-59 ₪", "ב-Luz").',
    'Clichés: "חוויה בלתי נשכחת", "איכות ללא פשרות", "מחכים לכם", "פשוט מושלם".',
    'Formal written Hebrew in a spoken script ("הינו", "על מנת", "באפשרותכם").',
    'A CTA that does not match the goal (e.g. "בואו להכיר" for an offer).',
    'Copy that asserts something the business did not approve.',
  ],
  evaluationCriteria: [
    'HOOK_STRENGTH',
    'MESSAGE_CLARITY',
    'AUDIENCE_RELEVANCE',
    'DIFFERENTIATION',
    'CTA_CLARITY',
    'OFFER_COMMUNICATION',
    'FACTUAL_ACCURACY',
    'HEBREW_NATURALNESS',
  ],
};
