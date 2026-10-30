import type { Playbook } from './playbook';

export const CREATIVE_STRATEGY_PLAYBOOK: Playbook = {
  id: 'creative-strategy',
  version: '1.0.0',
  role: 'CREATIVE_STRATEGIST',
  responsibility:
    'Find the strongest customer insight for the goal and turn it into distinct, testable marketing hypotheses.',
  requiredContext: [
    'business positioning and products',
    'goal and offer',
    'audience',
    'industry motivations',
  ],
  methods: [
    {
      id: 'INSIGHT_FROM_SITUATION',
      name: 'Insight from a situation',
      when: 'Choosing what the concept is built on.',
      how: 'Describe a specific moment in the audience’s week where the product matters (Sunday 7:40, before work). An insight is an observation, never a statistic.',
      avoid: 'Invented numbers or "research shows".',
    },
    {
      id: 'ONE_HYPOTHESIS_PER_CONCEPT',
      name: 'One hypothesis per concept',
      when: 'Writing a concept set.',
      how: '"If we show X, the audience will do Y, because Z." Three concepts = three different Z.',
    },
    {
      id: 'VALUE_PROPOSITION',
      name: 'Value proposition',
      when: 'Always.',
      how: 'What the customer gets, why it matters to them, why from this business (from approved claims).',
    },
  ],
  constraints: ['Industry motivations are hypotheses to test, not facts about the market.'],
  decisionRules: [
    'Match the emotional driver to the goal: urgency/value for offers, belonging for awareness, relief for problem-led leads.',
    'If the brief has no reason to believe, the concept must not depend on one.',
  ],
  outputs: ['ConceptStrategy per concept: objective, insight, hypothesis, structure, emotion'],
  examples: [],
  failureModes: [
    'Insights that are category descriptions ("people like coffee")',
    'Hypotheses that cannot fail',
  ],
  evaluationCriteria: ['AUDIENCE_RELEVANCE', 'DIFFERENTIATION', 'MESSAGE_CLARITY'],
};

export const VIDEO_DIRECTION_PLAYBOOK: Playbook = {
  id: 'video-direction',
  version: '1.0.0',
  role: 'VIDEO_PRODUCTION',
  responsibility:
    'Pace, frame and move the short vertical ad so the message lands with sound off and sound on.',
  requiredContext: ['storyboard', 'art direction motion settings', 'narration timing'],
  methods: [
    {
      id: 'HOOK_IN_TWO_SECONDS',
      name: 'Hook within two seconds',
      when: 'Always.',
      how: 'The first scene is short and the on-screen hook appears immediately.',
    },
    {
      id: 'MOTION_FROM_SOURCE',
      name: 'Honest motion',
      when: 'Animating stills.',
      how: 'Camera moves (push, pan, parallax) on stills; never imply subject movement that the source does not contain.',
    },
    {
      id: 'VARY_FRAMING',
      name: 'Vary framing',
      when: 'Consecutive scenes.',
      how: 'Change shot size or motion between neighbouring scenes.',
    },
  ],
  constraints: ['Captions and overlays stay inside the Reels safe area.', 'One idea per scene.'],
  decisionRules: [
    'CALM pacing for premium/awareness, FAST for offers with energetic tone.',
    'Headline in the center only for typographic concepts.',
  ],
  outputs: ['Motion and pacing settings for the timeline'],
  examples: [],
  failureModes: [
    'A slow opening',
    'Three scenes in a row with the same move',
    'Text under the Reels interface',
  ],
  evaluationCriteria: ['PACING', 'MOTION_APPROPRIATENESS', 'SCENE_CONTINUITY', 'SAFE_ZONES', 'AUDIO_SYNC'],
};
