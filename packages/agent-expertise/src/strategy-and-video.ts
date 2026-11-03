import type {
  CompositionType,
  ConceptAngle,
  HookTechnique,
  MotionPreset,
  SceneRole,
  ShotType,
  VideoTreatment,
} from '@kampora/shared';
import { conceptVisualStrategy, type ConceptVisualIdea } from './art-direction';
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
  version: '1.1.0',
  role: 'VIDEO_PRODUCTION',
  responsibility:
    'Pace, frame and move the short vertical ad so the message lands with sound off and sound on.',
  requiredContext: ['storyboard', 'concept video treatment', 'art direction motion settings', 'narration timing'],
  methods: [
    {
      id: 'TREATMENT_FROM_CONCEPT',
      name: 'The concept decides the cut',
      when: 'Planning the scenes of any concept.',
      how: 'Craving: macro, short cuts, the product last. Craft: process and hands, calm fades. Value: the price in the first second, a clear price card, the CTA on the price. Moment: people and place, slow moves. Statement: type first.',
      avoid: 'The same four-scene slideshow (hook, product, offer, storefront) for every concept.',
    },
    {
      id: 'AUTHENTIC_FOOTAGE_FIRST',
      name: 'Real footage first, honest stand-ins',
      when: 'A scene needs the real product, place or people.',
      how: 'Use the business’s own footage or photo; when none exists, name the shot and how to film it on a phone, and label any stand-in on screen.',
      avoid: 'A generated or demo picture presented as the real product.',
    },
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
    'The concept treatment sets pacing, cut and text timing; the art direction keeps headline placement.',
    'Text waits for the picture on appetite and moment concepts; it leads on value and statement concepts.',
  ],
  outputs: ['Concept video treatment on the storyboard', 'Motion and pacing settings for the timeline', 'Shot list for missing authentic media'],
  examples: [],
  failureModes: [
    'A slow opening',
    'Three scenes in a row with the same move',
    'Text under the Reels interface',
    'Every concept cut the same way',
    'A craving ad that ends on the storefront instead of the food',
  ],
  evaluationCriteria: ['PACING', 'MOTION_APPROPRIATENESS', 'SCENE_CONTINUITY', 'SAFE_ZONES', 'AUDIO_SYNC'],
};

/** One planned scene of a treatment. `{product}` in `visual` is replaced by the brief's product. */
export interface VideoBeat {
  role: SceneRole;
  shot: ShotType;
  composition: CompositionType;
  motion: MotionPreset;
  durationSec: number;
  visualKind: 'PHOTO' | 'FOOTAGE' | 'GRAPHIC';
  /** What the picture shows (Hebrew). */
  visual: string;
  /** What the scene does for the viewer (Hebrew). */
  purpose: string;
  assetTags: readonly string[];
  requiresProductAccuracy: boolean;
  /** How to film the authentic shot on a phone (Hebrew); absent for graphic scenes. */
  capture?: string;
  /** Only when the brief has an offer, or only when it has none. */
  when?: 'OFFER' | 'NO_OFFER';
}

/**
 * How a concept's idea is cut as a short vertical video. The same visual idea that sets the static layout
 * (`conceptVisualStrategy`) picks the treatment, so a concept reads the same in both formats.
 */
export interface ConceptVideoTreatment extends VideoTreatment {
  name: string;
  /** How the video opens, for the Storyboard Director (English). */
  hook: string;
  beats: readonly VideoBeat[];
}

const OFFER_CARD: VideoBeat = {
  role: 'OFFER',
  shot: 'graphic',
  composition: 'SINGLE_HERO',
  motion: 'static',
  durationSec: 4,
  visualKind: 'GRAPHIC',
  visual: 'כרטיס מבצע בצבעי המותג עם המחיר',
  purpose: 'להבהיר את המחיר והתנאים בדיוק כפי שאושרו',
  assetTags: ['product'],
  requiresProductAccuracy: false,
  when: 'OFFER',
};

const PLACE_CAPTURE = 'חזית העסק או הדלפק עם השלט, צילום רחב מהמדרכה או מהכניסה; טלפון אנכי, בשעה שיש אור יום.';

export const CONCEPT_VIDEO_TREATMENTS: Record<ConceptVisualIdea, ConceptVideoTreatment> = {
  VALUE: {
    idea: 'VALUE',
    name: 'Price first',
    hook: 'The product and the price together in the first second; the offer card is the longest scene and the video ends on the price and the CTA.',
    pacing: 'FAST',
    transition: 'zoom',
    motionIntensity: 0.5,
    textDelaySec: 0,
    endFrame: 'PRICE',
    beats: [
      {
        role: 'HOOK',
        shot: 'close-up',
        composition: 'SINGLE_HERO',
        motion: 'cinematic-zoom',
        durationSec: 3,
        visualKind: 'PHOTO',
        visual: '{product} מקרוב, המוצר שבמבצע',
        purpose: 'המוצר והמחיר כבר בשנייה הראשונה',
        assetTags: ['hero', 'product'],
        requiresProductAccuracy: true,
        capture: 'המוצר שבמבצע מקרוב, בגובה השולחן, ליד חלון; טלפון אנכי, בלי זום דיגיטלי, 5 שניות בלי תזוזה.',
      },
      {
        role: 'PRODUCT',
        shot: 'overhead',
        composition: 'ASSORTMENT',
        motion: 'pan-left',
        durationSec: 4,
        visualKind: 'PHOTO',
        visual: 'כל מה שכלול במבצע, מסודר יחד',
        purpose: 'להראות בדיוק מה מקבלים במחיר',
        assetTags: ['product'],
        requiresProductAccuracy: true,
        capture: 'כל מה שכלול במבצע על שולחן אחד, צילום מלמעלה כשהטלפון מקביל לשולחן.',
      },
      { ...OFFER_CARD, durationSec: 5, purpose: 'המחיר הוא הדבר הגדול ביותר על המסך' },
      {
        role: 'CTA',
        shot: 'close-up',
        composition: 'SINGLE_HERO',
        motion: 'ken-burns-out',
        durationSec: 4,
        visualKind: 'PHOTO',
        visual: '{product} עם הקריאה לפעולה',
        purpose: 'המחיר והקריאה לפעולה נשארים על המסך',
        assetTags: ['hero', 'product'],
        requiresProductAccuracy: true,
      },
    ],
  },
  APPETITE: {
    idea: 'APPETITE',
    name: 'Craving close-ups',
    hook: 'An extreme close-up of the product’s texture before any text; short cuts between close shots; the video ends on the product, not the storefront.',
    pacing: 'FAST',
    transition: 'none',
    motionIntensity: 0.6,
    textDelaySec: 0.6,
    endFrame: 'PRODUCT',
    beats: [
      {
        role: 'HOOK',
        shot: 'extreme-close-up',
        composition: 'DETAIL',
        motion: 'cinematic-zoom',
        durationSec: 2.5,
        visualKind: 'PHOTO',
        visual: 'מאקרו על המרקם של {product}',
        purpose: 'לעורר תיאבון לפני כל מילה',
        assetTags: ['hero', 'product'],
        requiresProductAccuracy: true,
        capture: 'מאקרו על המנה הטרייה (גבינה נמסה, אדים, פירורים): 10–15 ס״מ מהמנה, אור צד מחלון, וידאו 60fps אם אפשר.',
      },
      {
        role: 'PRODUCT',
        shot: 'close-up',
        composition: 'SINGLE_HERO',
        motion: 'product-reveal',
        durationSec: 3.5,
        visualKind: 'PHOTO',
        visual: '{product} שלם, בפריים נקי',
        purpose: 'המנה כולה, כמו שהיא מגיעה ללקוח',
        assetTags: ['hero', 'product'],
        requiresProductAccuracy: true,
        capture: 'המנה השלמה בגובה העין על רקע נקי; תנועה איטית של הטלפון חצי סיבוב סביבה (4 שניות).',
      },
      {
        role: 'DEMO',
        shot: 'detail',
        composition: 'DETAIL',
        motion: 'pan-right',
        durationSec: 3,
        visualKind: 'PHOTO',
        visual: 'רגע הביס או החיתוך של {product}',
        purpose: 'הרגע שגורם לרצות עכשיו',
        assetTags: ['product'],
        requiresProductAccuracy: true,
        capture: 'רגע אחד בתנועה: חיתוך המנה לשניים או ביס ראשון, קרוב ובהילוך איטי (slow-mo).',
      },
      { ...OFFER_CARD, durationSec: 3.5, purpose: 'המחיר ברור, אבל לא גדול מהאוכל' },
      {
        role: 'CTA',
        shot: 'close-up',
        composition: 'SINGLE_HERO',
        motion: 'ken-burns-out',
        durationSec: 3.5,
        visualKind: 'PHOTO',
        visual: '{product} מקרוב עם הקריאה לפעולה',
        purpose: 'לסיים על האוכל, עם מה לעשות עכשיו',
        assetTags: ['hero', 'product'],
        requiresProductAccuracy: true,
      },
    ],
  },
  CRAFT: {
    idea: 'CRAFT',
    name: 'Process and hands',
    hook: 'Hands and raw ingredients at work in the first shot; the video follows the making, then the finished product; calm fades, no hard sell.',
    pacing: 'BALANCED',
    transition: 'fade',
    motionIntensity: 0.35,
    textDelaySec: 0.3,
    endFrame: 'HEADLINE',
    beats: [
      {
        role: 'HOOK',
        shot: 'detail',
        composition: 'DETAIL',
        motion: 'ken-burns-in',
        durationSec: 3,
        visualKind: 'PHOTO',
        visual: 'ידיים וחומרי גלם על משטח העבודה',
        purpose: 'להראות שכאן מכינים, לא מחממים',
        assetTags: ['kitchen', 'process', 'product'],
        requiresProductAccuracy: true,
        capture: 'ידיים בעבודה מעל משטח ההכנה (טחינה, קיצוץ, עיצוב), צילום מלמעלה, 8 שניות בלי לחתוך.',
      },
      {
        role: 'DEMO',
        shot: 'medium',
        composition: 'DEMONSTRATION',
        motion: 'pan-right',
        durationSec: 4.5,
        visualKind: 'PHOTO',
        visual: 'ההכנה של {product} בזמן אמת',
        purpose: 'התהליך עצמו, צעד אחרי צעד',
        assetTags: ['kitchen', 'process'],
        requiresProductAccuracy: true,
        capture: 'קליפ של 5–8 שניות מההכנה (על הגריל, בתנור או על הדלפק), הטלפון יציב על משטח בגובה העבודה.',
      },
      {
        role: 'PRODUCT',
        shot: 'close-up',
        composition: 'SINGLE_HERO',
        motion: 'product-reveal',
        durationSec: 4,
        visualKind: 'PHOTO',
        visual: '{product} מוכן, רגע אחרי ההכנה',
        purpose: 'התוצאה של העבודה',
        assetTags: ['hero', 'product'],
        requiresProductAccuracy: true,
        capture: 'המנה המוכנה מיד כשהיא יוצאת, על משטח העבודה ולא על רקע מבוים.',
      },
      { ...OFFER_CARD, durationSec: 3.5, purpose: 'המחיר כפרט, לא כסיבה' },
      {
        role: 'CTA',
        shot: 'wide',
        composition: 'ENVIRONMENT',
        motion: 'ken-burns-out',
        durationSec: 4,
        visualKind: 'PHOTO',
        visual: 'המטבח או הדלפק עם הצוות',
        purpose: 'להזמין לראות את זה במקום',
        assetTags: ['store', 'kitchen'],
        requiresProductAccuracy: false,
        capture: PLACE_CAPTURE,
      },
    ],
  },
  MOMENT: {
    idea: 'MOMENT',
    name: 'Atmosphere and people',
    hook: 'People in the place enjoying it, in the first shot (only with real photos of people); slow moves and soft fades; the brand closes.',
    pacing: 'CALM',
    transition: 'fade',
    motionIntensity: 0.3,
    textDelaySec: 0.5,
    endFrame: 'BRAND',
    beats: [
      {
        role: 'HOOK',
        shot: 'medium',
        composition: 'LIFESTYLE',
        motion: 'ken-burns-in',
        durationSec: 3.5,
        visualKind: 'PHOTO',
        visual: 'אנשים נהנים במקום, עם {product}',
        purpose: 'לראות את עצמך שם',
        assetTags: ['people', 'store'],
        requiresProductAccuracy: false,
        capture: 'חברים או לקוחות סביב שולחן עם המנות, בגובה העיניים ובאור טבעי; לבקש מהמצולמים אישור לפרסום.',
      },
      {
        role: 'BENEFIT',
        shot: 'wide',
        composition: 'ENVIRONMENT',
        motion: 'pan-left',
        durationSec: 4.5,
        visualKind: 'PHOTO',
        visual: 'האווירה במקום',
        purpose: 'האווירה היא ההבטחה',
        assetTags: ['store', 'interior'],
        requiresProductAccuracy: false,
        capture: 'המקום בשעת עומס נעימה, צילום רחב מפינת החדר, תנועה איטית של הטלפון משמאל לימין.',
      },
      {
        role: 'PRODUCT',
        shot: 'close-up',
        composition: 'SINGLE_HERO',
        motion: 'cinematic-zoom',
        durationSec: 4,
        visualKind: 'PHOTO',
        visual: '{product} על השולחן',
        purpose: 'מה מחכה על השולחן',
        assetTags: ['hero', 'product'],
        requiresProductAccuracy: true,
        capture: 'המנה על שולחן אמיתי במקום (לא על רקע לבן), צילום קרוב בזווית של 45 מעלות.',
      },
      { ...OFFER_CARD, durationSec: 3.5, purpose: 'סיבה לבוא דווקא עכשיו' },
      {
        role: 'CTA',
        shot: 'wide',
        composition: 'ENVIRONMENT',
        motion: 'parallax',
        durationSec: 4.5,
        visualKind: 'PHOTO',
        visual: 'חזית העסק עם השלט',
        purpose: 'איפה זה ומה לעשות',
        assetTags: ['store'],
        requiresProductAccuracy: false,
        capture: PLACE_CAPTURE,
      },
    ],
  },
  STATEMENT: {
    idea: 'STATEMENT',
    name: 'Type first',
    hook: 'The statement as bold type on a brand-colour card in the first second; then the product answers it.',
    pacing: 'BALANCED',
    transition: 'slide-up',
    motionIntensity: 0.45,
    textDelaySec: 0,
    endFrame: 'HEADLINE',
    beats: [
      {
        role: 'HOOK',
        shot: 'graphic',
        composition: 'SINGLE_HERO',
        motion: 'static',
        durationSec: 3,
        visualKind: 'GRAPHIC',
        visual: 'כרטיס טיפוגרפי בצבעי המותג',
        purpose: 'המשפט עוצר את הגלילה',
        assetTags: [],
        requiresProductAccuracy: false,
      },
      {
        // The business answers the statement; a picture of the place or the work, so a type-first ad never
        // runs three graphic cards in a row when the product photo is missing.
        role: 'SOLUTION',
        shot: 'medium',
        composition: 'ENVIRONMENT',
        motion: 'pan-right',
        durationSec: 4.5,
        visualKind: 'PHOTO',
        visual: 'העסק בעבודה',
        purpose: 'מי עונה על המשפט',
        assetTags: ['store', 'interior'],
        requiresProductAccuracy: false,
        capture: 'הצוות בעבודה במקום, צילום בגובה העיניים מ-2 מטרים, הטלפון יציב, 5–8 שניות.',
      },
      {
        role: 'PRODUCT',
        shot: 'close-up',
        composition: 'SINGLE_HERO',
        motion: 'product-reveal',
        durationSec: 4,
        visualKind: 'PHOTO',
        visual: '{product} כתשובה',
        purpose: 'מה מקבלים בפועל',
        assetTags: ['hero', 'product'],
        requiresProductAccuracy: true,
        capture: 'המוצר מקרוב על רקע נקי, טלפון אנכי, אור רך מהצד.',
      },
      { ...OFFER_CARD, durationSec: 3.5 },
      {
        role: 'CTA',
        shot: 'wide',
        composition: 'ENVIRONMENT',
        motion: 'parallax',
        durationSec: 4,
        visualKind: 'PHOTO',
        visual: 'חזית העסק עם השלט',
        purpose: 'איפה זה ומה לעשות',
        assetTags: ['store'],
        requiresProductAccuracy: false,
        capture: PLACE_CAPTURE,
      },
    ],
  },
};

/** The video treatment of a concept: the same visual idea that directs its static layout. */
export function conceptVideoTreatment(concept: {
  angle: ConceptAngle;
  hookTechnique?: HookTechnique;
}): ConceptVideoTreatment {
  return CONCEPT_VIDEO_TREATMENTS[conceptVisualStrategy(concept).id];
}

/** The treatment's scenes for a brief: offer-only beats drop when there is no offer. */
export function treatmentBeats(treatment: ConceptVideoTreatment, hasOffer: boolean): VideoBeat[] {
  return treatment.beats.filter((b) => !b.when || (b.when === 'OFFER') === hasOffer);
}

/** The schema-level treatment the storyboard carries (no beats or Hebrew copy). */
export function storyboardTreatment(t: ConceptVideoTreatment): VideoTreatment {
  const { idea, pacing, transition, motionIntensity, textDelaySec, endFrame } = t;
  return { idea, pacing, transition, motionIntensity, textDelaySec, endFrame };
}

/** A phone-capture instruction for a scene the treatment did not plan, from its framing. */
export function captureForShot(shot: ShotType, composition?: CompositionType): string | undefined {
  if (shot === 'graphic') return undefined;
  if (composition === 'ENVIRONMENT') return PLACE_CAPTURE;
  if (composition === 'LIFESTYLE') return 'אנשים במקום עם המוצר, בגובה העיניים ובאור טבעי; לבקש מהמצולמים אישור לפרסום.';
  if (composition === 'ASSORTMENT' || shot === 'overhead') return 'כמה מוצרים יחד על משטח אחד, צילום מלמעלה.';
  if (shot === 'wide' || shot === 'medium') return 'המקום או התהליך בצילום רחב, הטלפון יציב, 5–8 שניות.';
  return 'המוצר האמיתי מקרוב, טלפון אנכי, אור יום מהצד, בלי זום דיגיטלי.';
}
