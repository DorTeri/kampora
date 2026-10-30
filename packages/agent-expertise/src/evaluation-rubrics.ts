import type { CreativeComponent, CritiqueDimension } from '@kampora/shared';

export interface RubricCriterion {
  id: string;
  dimension: CritiqueDimension;
  /** Hebrew label for the owner. */
  label: string;
  /** What a strong result looks like. */
  standard: string;
  /** Who fixes it when it is weak. */
  component: CreativeComponent;
  appliesTo: ReadonlyArray<'CONCEPT_SET' | 'STATIC_AD' | 'VIDEO'>;
  /**
   * DETERMINISTIC: measured by code. LLM_OPINION: judged by a model, reported as an opinion. Subjective criteria
   * without a measurable proxy are left to people (and to the optional opinion pass).
   */
  method: 'DETERMINISTIC' | 'LLM_OPINION';
}

/**
 * The Creative Critic's rubric. Versioned: a changed criterion is a new version, so evaluation results stay
 * comparable. Scores are 1–5 per criterion; there is no hidden overall score.
 */
export const CREATIVE_RUBRIC = {
  id: 'creative-rubric',
  version: '1.0.0',
  criteria: [
    // Marketing
    {
      id: 'HOOK_STRENGTH',
      dimension: 'MARKETING',
      label: 'כוח הפתיחה',
      standard: 'Specific to this business, ≤ 8 words, a clear stop-the-scroll technique, no cliché.',
      component: 'COPYWRITER',
      appliesTo: ['CONCEPT_SET', 'STATIC_AD'],
      method: 'DETERMINISTIC',
    },
    {
      id: 'MESSAGE_CLARITY',
      dimension: 'MARKETING',
      label: 'בהירות המסר',
      standard: 'One message and at most one price per ad.',
      component: 'COPYWRITER',
      appliesTo: ['CONCEPT_SET', 'STATIC_AD'],
      method: 'DETERMINISTIC',
    },
    {
      id: 'AUDIENCE_RELEVANCE',
      dimension: 'MARKETING',
      label: 'רלוונטיות לקהל',
      standard: 'Built on an audience situation, not a category description.',
      component: 'COPYWRITER',
      appliesTo: ['CONCEPT_SET'],
      method: 'LLM_OPINION',
    },
    {
      id: 'DIFFERENTIATION',
      dimension: 'MARKETING',
      label: 'רעיונות שונים באמת',
      standard: 'Different angle, hook technique, insight and wording per concept.',
      component: 'COPYWRITER',
      appliesTo: ['CONCEPT_SET'],
      method: 'DETERMINISTIC',
    },
    {
      id: 'CTA_CLARITY',
      dimension: 'MARKETING',
      label: 'קריאה לפעולה',
      standard: 'One verb-first action that matches the goal.',
      component: 'COPYWRITER',
      appliesTo: ['CONCEPT_SET', 'STATIC_AD'],
      method: 'DETERMINISTIC',
    },
    {
      id: 'OFFER_COMMUNICATION',
      dimension: 'MARKETING',
      label: 'הצגת ההצעה',
      standard: 'An offer, when there is one, is stated exactly and visible.',
      component: 'COPYWRITER',
      appliesTo: ['CONCEPT_SET', 'STATIC_AD'],
      method: 'DETERMINISTIC',
    },
    {
      id: 'FACTUAL_ACCURACY',
      dimension: 'MARKETING',
      label: 'דיוק עובדתי',
      standard: 'Only approved claims and verified facts; claims that need verification are approved.',
      component: 'COPYWRITER',
      appliesTo: ['CONCEPT_SET', 'STATIC_AD'],
      method: 'DETERMINISTIC',
    },
    {
      id: 'HEBREW_NATURALNESS',
      dimension: 'MARKETING',
      label: 'עברית טבעית',
      standard: 'No clichés, formal register or translated idioms; at most one exclamation mark.',
      component: 'COPYWRITER',
      appliesTo: ['CONCEPT_SET', 'STATIC_AD'],
      method: 'DETERMINISTIC',
    },
    // Visual
    {
      id: 'VISUAL_HIERARCHY',
      dimension: 'VISUAL',
      label: 'היררכיה חזותית',
      standard: 'The focal element the plan chose is the most prominent one.',
      component: 'ART_DIRECTOR',
      appliesTo: ['STATIC_AD'],
      method: 'DETERMINISTIC',
    },
    {
      id: 'LAYOUT_BALANCE',
      dimension: 'VISUAL',
      label: 'איזון הקומפוזיציה',
      standard: 'Text and picture each have their space; the product is not covered by text.',
      component: 'ART_DIRECTOR',
      appliesTo: ['STATIC_AD'],
      method: 'DETERMINISTIC',
    },
    {
      id: 'TYPOGRAPHY',
      dimension: 'VISUAL',
      label: 'טיפוגרפיה',
      standard:
        'Type fits without shrinking far below its design size; headline short enough for the format.',
      component: 'LAYOUT_ENGINE',
      appliesTo: ['STATIC_AD'],
      method: 'DETERMINISTIC',
    },
    {
      id: 'READABILITY',
      dimension: 'VISUAL',
      label: 'קריאות',
      standard: 'Text contrast ≥ 4.5:1 on solid surfaces; scrims only on calm pictures.',
      component: 'ART_DIRECTOR',
      appliesTo: ['STATIC_AD'],
      method: 'DETERMINISTIC',
    },
    {
      id: 'BRAND_CONSISTENCY',
      dimension: 'VISUAL',
      label: 'התאמה למותג',
      standard: 'Fields and accents come from the brand palette; logo or name present.',
      component: 'ART_DIRECTOR',
      appliesTo: ['STATIC_AD'],
      method: 'DETERMINISTIC',
    },
    {
      id: 'IMAGE_RELEVANCE',
      dimension: 'VISUAL',
      label: 'התאמת התמונה',
      standard: 'The picture shows what the ad sells.',
      component: 'VISUAL_PLANNER',
      appliesTo: ['STATIC_AD'],
      method: 'DETERMINISTIC',
    },
    {
      id: 'VISUAL_ORIGINALITY',
      dimension: 'VISUAL',
      label: 'מקוריות',
      standard: 'Not the same layout family as the business’s previous ads when another fits.',
      component: 'ART_DIRECTOR',
      appliesTo: ['STATIC_AD'],
      method: 'DETERMINISTIC',
    },
    {
      id: 'PROFESSIONAL_POLISH',
      dimension: 'VISUAL',
      label: 'גימור מקצועי',
      standard: 'Looks like agency work (people judge this; a model opinion is only a hint).',
      component: 'ART_DIRECTOR',
      appliesTo: ['STATIC_AD'],
      method: 'LLM_OPINION',
    },
    // Production
    {
      id: 'PRODUCT_AUTHENTICITY',
      dimension: 'PRODUCTION',
      label: 'אותנטיות המוצר',
      standard: 'AI pictures are labelled and never presented as the real product or place.',
      component: 'VISUAL_PLANNER',
      appliesTo: ['STATIC_AD', 'VIDEO'],
      method: 'DETERMINISTIC',
    },
    {
      id: 'HEBREW_RENDERING',
      dimension: 'PRODUCTION',
      label: 'עברית על המסך',
      standard: 'RTL text, no niqqud, prices kept together.',
      component: 'LAYOUT_ENGINE',
      appliesTo: ['STATIC_AD', 'VIDEO'],
      method: 'DETERMINISTIC',
    },
    {
      id: 'SAFE_ZONES',
      dimension: 'PRODUCTION',
      label: 'אזורים בטוחים',
      standard: 'All text inside the platform safe area.',
      component: 'LAYOUT_ENGINE',
      appliesTo: ['STATIC_AD', 'VIDEO'],
      method: 'DETERMINISTIC',
    },
    {
      id: 'PACING',
      dimension: 'PRODUCTION',
      label: 'קצב',
      standard: 'Hook ≤ 3 s; no scene drags; total near the target.',
      component: 'VIDEO_PLANNER',
      appliesTo: ['VIDEO'],
      method: 'DETERMINISTIC',
    },
    {
      id: 'SCENE_CONTINUITY',
      dimension: 'PRODUCTION',
      label: 'רצף סצנות',
      standard: 'Consecutive scenes vary framing or motion; one look across scenes.',
      component: 'VIDEO_PLANNER',
      appliesTo: ['VIDEO'],
      method: 'DETERMINISTIC',
    },
    {
      id: 'MOTION_APPROPRIATENESS',
      dimension: 'PRODUCTION',
      label: 'תנועה מתאימה',
      standard: 'Camera motion only; no implied subject motion; not three identical moves in a row.',
      component: 'VIDEO_PLANNER',
      appliesTo: ['VIDEO'],
      method: 'DETERMINISTIC',
    },
    {
      id: 'AUDIO_SYNC',
      dimension: 'PRODUCTION',
      label: 'סנכרון קול',
      standard: 'Narration fits each scene without long silences or cut-offs.',
      component: 'VOICE_ENGINE',
      appliesTo: ['VIDEO'],
      method: 'DETERMINISTIC',
    },
    {
      id: 'TECHNICAL_CORRECTNESS',
      dimension: 'PRODUCTION',
      label: 'תקינות טכנית',
      standard: 'Resolution, durations and assets valid.',
      component: 'LAYOUT_ENGINE',
      appliesTo: ['STATIC_AD', 'VIDEO'],
      method: 'DETERMINISTIC',
    },
  ] satisfies RubricCriterion[],
} as const;

export function rubricCriterion(id: string): RubricCriterion {
  const c = CREATIVE_RUBRIC.criteria.find((x) => x.id === id);
  if (!c) throw new Error(`Unknown rubric criterion "${id}"`);
  return c;
}

export const rubricTag = () => `${CREATIVE_RUBRIC.id}@${CREATIVE_RUBRIC.version}`;
