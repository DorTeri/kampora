import { DEFAULT_PRICE_CATALOG } from '@kampora/cost-engine';
import type {
  LlmProvider,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from '@kampora/media-providers';
import type { ConceptAngle } from '@kampora/shared';
import { CONCEPT_TYPES } from './concept-types';
import type { ConceptLlm, ConceptSetLlm, StoryboardLlm } from './llm-schemas';

/** Strategy fields that come straight from the concept type (the copy-specific ones are written per concept). */
const typeDefaults = (angle: ConceptAngle) => {
  const t = CONCEPT_TYPES[angle];
  return {
    angle,
    emotionalDirection: t.emotionalDriver,
    visualStyle: t.visualStyle,
    productionFormat: t.productionFormat,
    voiceStyle: t.voiceStyle,
  };
};
import { ConceptsStepInputSchema, StoryboardStepInputSchema } from './steps';

const MOCK_PRICE = DEFAULT_PRICE_CATALOG.find(
  (e) => e.provider === 'mock' && e.operation === 'LLM_COMPLETION',
)!;

/**
 * Deterministic stand-in for an LLM, used in development and tests (CREATIVE_PROVIDER=mock).
 * Emits exactly the same provider-facing shapes as the real model, so mapping, fact checks and retries run
 * identically. Copy is built only from the structured input (approved claims, exact offer). Costs: SIMULATED.
 */
export class MockCreativeLlmProvider implements LlmProvider {
  readonly id = 'mock';
  readonly model = MOCK_PRICE.model;
  readonly paid = false;

  async generateStructured(request: StructuredGenerationRequest): Promise<StructuredGenerationResult> {
    const usage = {
      provider: this.id,
      model: this.model,
      chargeType: 'SIMULATED' as const,
      costUsd: MOCK_PRICE.unitPriceUsd,
    };
    switch (request.task) {
      case 'creative.concepts':
        return { data: this.concepts(request.input), usage };
      case 'creative.storyboard':
        return { data: this.storyboard(request.input), usage };
      default:
        throw new Error(`MockCreativeLlmProvider does not support task "${request.task}"`);
    }
  }

  private concepts(raw: unknown): ConceptSetLlm {
    const { business, brief } = ConceptsStepInputSchema.parse(raw);
    const claimA = business.approvedClaims[0] ?? brief.keyMessage;
    const claimB = business.approvedClaims[1] ?? '';
    const offerLine = brief.offer ? `${brief.offer}.` : '';
    const recommendedIndex = brief.goal === 'OFFER' || brief.goal === 'SALES' ? 0 : 1;
    return {
      concepts: [
        {
          ...typeDefaults('OFFER_DRIVEN'),
          title: 'המבצע במרכז',
          audience: brief.audience,
          hook: brief.offer ? `רגע, ראיתם את המבצע ב-${business.name}?` : `${brief.productName} כמו שצריך`,
          script: [`ב-${business.name} ${claimA}.`, offerLine, `${brief.cta}!`].filter(Boolean).join(' '),
          mainMessage: brief.offer ?? brief.keyMessage,
          visualDirection:
            'פתיחה בקלוז-אפ חם על המוצר, מעבר מהיר לכרטיס מבצע בצבעי המותג, סיום עם לוגו וכתובת.',
          cta: brief.cta,
          rationale: 'מטרת הקמפיין היא מבצע: מחיר ברור בשניות הראשונות מגדיל הקלקות ומבקרים.',
          complexity: 'LOW',
          estimatedDurationSec: 18,
          objective: brief.offer ? 'להביא מבקרים לנצל את המבצע' : `לגרום לקהל לנסות את ${brief.productName}`,
          insight: 'כשההצעה ברורה מהשנייה הראשונה, קל להחליט לבוא',
          hypothesis: 'אם נפתח במבצע עצמו, יותר אנשים יעצרו ויגיעו, כי הערך ברור מיד',
          storyStructure: ['פתיחה: המבצע', 'מה מקבלים', 'המחיר והתנאים', 'קריאה לפעולה'],
        },
        {
          ...typeDefaults('PROBLEM_SOLUTION'),
          title: 'הבוקר שמגיע לך',
          audience: brief.audience,
          hook: `נמאס מ${brief.productName} סתמי בדרך לעבודה?`,
          script: `נמאס מ${brief.productName} סתמי? ב-${business.name} ${claimA}${claimB ? `, ו${claimB}` : ''}.`,
          mainMessage: claimA,
          visualDirection: 'ניגוד בין בוקר אפור לפינה חמימה ומוארת; תנועת מצלמה איטית על המוצר.',
          cta: brief.cta,
          rationale: 'מזהה כאב יומיומי של קהל היעד ומציג את העסק כפתרון פשוט וקרוב.',
          complexity: 'MEDIUM',
          estimatedDurationSec: 20,
          objective: `לבנות העדפה ל-${business.name} כפתרון לבוקר רגיל`,
          insight: `${brief.productName} סתמי בדרך לעבודה הוא פשרה שכולם מכירים`,
          hypothesis: 'אם נזכיר תסכול מוכר ונציג פתרון קרוב, הקהל יזדהה ויגיע',
          storyStructure: ['פתיחה: התסכול', 'למה זה קורה', `הפתרון: ${business.name}`, 'קריאה לפעולה'],
        },
        this.thirdConcept(business, brief, claimA),
      ],
      recommendedIndex,
      recommendationReason:
        recommendedIndex === 0
          ? 'המטרה היא מבצע, וכשהמחיר ברור כבר בפתיחה התגובה בדרך כלל גבוהה יותר.'
          : 'פתיחה שמזהה בעיה מוכרת עוצרת גלילה ומובילה בטבעיות למסר של העסק.',
    };
  }

  /** A third, different idea: a demo for product promotions, lifestyle for awareness, otherwise emotional. */
  private thirdConcept(
    business: ReturnType<typeof ConceptsStepInputSchema.parse>['business'],
    brief: ReturnType<typeof ConceptsStepInputSchema.parse>['brief'],
    claimA: string,
  ): ConceptLlm {
    const common = {
      audience: brief.audience,
      cta: brief.cta,
      complexity: 'MEDIUM' as const,
      estimatedDurationSec: 20,
    };
    if (brief.goal === 'PRODUCT_PROMO') {
      return {
        ...typeDefaults('PRODUCT_DEMO'),
        ...common,
        title: `${brief.productName} מקרוב`,
        hook: `ככה נראה ${brief.productName} אמיתי`,
        script: `ככה נראה ${brief.productName} אמיתי. ב-${business.name} ${claimA}.`,
        mainMessage: claimA,
        visualDirection: 'קלוז-אפים חדים על המוצר, פרטים ומרקמים, תנועות מצלמה קצרות.',
        rationale: 'מראה את המוצר עצמו ומאפשר לקהל להחליט לפי מה שהוא רואה.',
        objective: `לעורר רצון לנסות את ${brief.productName}`,
        insight: 'אנשים סומכים על מה שהם רואים יותר מאשר על תיאורים',
        hypothesis: 'אם נראה את המוצר מקרוב, הרצון לנסות יעלה',
        storyStructure: ['פתיחה: רגע המוצר', 'הדגמה: מה מקבלים', 'היתרון', 'קריאה לפעולה'],
      };
    }
    if (brief.goal === 'AWARENESS') {
      return {
        ...typeDefaults('LIFESTYLE'),
        ...common,
        title: `הבוקר עם ${business.name}`,
        hook: 'ככה נראה בוקר טוב בשכונה',
        script: `ככה נראה בוקר טוב בשכונה. ב-${business.name} ${claimA}.`,
        mainMessage: `${business.name} הוא חלק מהבוקר הטוב`,
        visualDirection: 'אווירת בוקר בשכונה, אור טבעי, המוצר כחלק מהשגרה.',
        rationale: 'בונה מודעות דרך שגרה שהקהל רוצה להיות חלק ממנה.',
        objective: `להכיר את ${business.name} לתושבי האזור`,
        insight: 'בוקר טוב מתחיל ממקום קבוע וקרוב',
        hypothesis: 'אם נראה את העסק כחלק מבוקר רצוי, הקהל יזכור אותו',
        storyStructure: ['פתיחה: בוקר בשכונה', 'המוצר בתוך השגרה', 'המותג', 'קריאה לפעולה'],
      };
    }
    return {
      ...typeDefaults('EMOTIONAL'),
      ...common,
      title: 'הרגע הקטן שלך',
      hook: 'יש רגעים קטנים שעושים את כל היום',
      script: `יש רגעים קטנים שעושים את כל היום. ב-${business.name} ${claimA}.`,
      mainMessage: `${business.name} – המקום לרגע הקטן שלך`,
      visualDirection: 'צילומי אווירה רכים, אור בוקר, קצב רגוע ומוזיקה חמה.',
      rationale: 'בונה זיכרון מותג וחיבור רגשי; מתאים לקהל מקומי וחוזר.',
      objective: `לבנות חיבור רגשי ל-${business.name}`,
      insight: 'רגע קטן ונעים בבוקר משפיע על כל היום',
      hypothesis: 'אם נתחבר לרגע מוכר ונעים, המותג ייזכר לטובה',
      storyStructure: ['פתיחה: הרגע', 'מה הופך אותו למיוחד', 'איפה זה קורה', 'קריאה לפעולה'],
    };
  }

  private storyboard(raw: unknown): StoryboardLlm {
    const { business, brief, concept } = StoryboardStepInputSchema.parse(raw);
    const claimA = business.approvedClaims[0] ?? brief.keyMessage;
    const claimB = business.approvedClaims[1];
    const flags = { requiresHumanMotion: false, requiresComplexAction: false };
    return {
      scenes: [
        {
          role: 'HOOK',
          durationSec: 4,
          visual: `קלוז-אפ קולנועי על ${brief.productName}, אור בוקר חם`,
          visualKind: 'PHOTO',
          voiceover: concept.hook,
          onScreenText: brief.offer ? `מבצע החודש ב-${business.name}` : concept.title,
          assetTags: ['hero'],
          motionPreset: 'cinematic-zoom',
          ...flags,
          requiresProductAccuracy: true,
          purpose: 'לעצור את הגלילה ולהציג את ההבטחה המרכזית',
          shot: 'extreme-close-up',
          editorNote: 'הטקסט נכנס כבר בשנייה הראשונה; חיתוך מהיר לסצנה הבאה',
        },
        {
          role: 'PRODUCT',
          durationSec: 5.5,
          visual: 'פריסת מוצרים טריים על הדלפק',
          visualKind: 'PHOTO',
          voiceover: `ב-${business.name} ${claimA}${claimB ? `, ו${claimB}` : ''}.`,
          onScreenText: claimB ?? null,
          assetTags: ['product'],
          motionPreset: 'pan-left',
          ...flags,
          requiresProductAccuracy: true,
          purpose: 'להראות מה מקבלים בפועל',
          shot: 'detail',
          editorNote: null,
        },
        brief.offer
          ? {
              role: 'OFFER',
              durationSec: 5,
              visual: 'כרטיס מבצע בצבעי המותג עם המחיר בגדול',
              visualKind: 'GRAPHIC',
              voiceover: `עכשיו: ${brief.offer}.`,
              onScreenText: brief.offer.replace(/\s+עד\s.+$/, ''),
              assetTags: ['product'],
              motionPreset: 'static',
              ...flags,
              requiresProductAccuracy: false,
              purpose: 'להבהיר את המחיר והתנאים בדיוק כפי שאושרו',
              shot: 'graphic',
              editorNote: 'המחיר הוא הדבר הגדול ביותר על המסך',
            }
          : {
              role: 'PROOF',
              durationSec: 5,
              visual: 'אווירה במקום',
              visualKind: 'PHOTO',
              voiceover: business.approvedClaims[2] ?? brief.keyMessage,
              onScreenText: business.approvedClaims[2] ?? null,
              assetTags: ['store'],
              motionPreset: 'ken-burns-out',
              ...flags,
              requiresProductAccuracy: false,
              purpose: 'לבסס אמון דרך המקום עצמו',
              shot: 'wide',
              editorNote: null,
            },
        {
          role: 'CTA',
          durationSec: 5,
          visual: 'חזית/פנים העסק עם לוגו וכתובת',
          visualKind: 'PHOTO',
          voiceover: `${concept.cta}${business.address ? ` – ${business.address}` : ''}.`,
          onScreenText: concept.cta,
          assetTags: ['store'],
          motionPreset: 'parallax',
          ...flags,
          requiresProductAccuracy: false,
          purpose: 'להגיד בדיוק מה לעשות ואיפה',
          shot: 'wide',
          editorNote: 'הלוגו והכתובת נשארים על המסך עד הסוף',
        },
      ],
    };
  }
}
