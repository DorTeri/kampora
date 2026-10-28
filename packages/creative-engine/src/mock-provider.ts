import { DEFAULT_PRICE_CATALOG } from '@kampora/cost-engine';
import type {
  LlmProvider,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from '@kampora/media-providers';
import type { ConceptSetLlm, StoryboardLlm } from './llm-schemas';
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
          title: 'המבצע במרכז',
          angle: 'OFFER_DRIVEN',
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
        },
        {
          title: 'הבוקר שמגיע לך',
          angle: 'PROBLEM_SOLUTION',
          audience: brief.audience,
          hook: `נמאס מ${brief.productName} סתמי בדרך לעבודה?`,
          script: `נמאס מ${brief.productName} סתמי? ב-${business.name} ${claimA}${claimB ? `, ו${claimB}` : ''}.`,
          mainMessage: claimA,
          visualDirection: 'ניגוד בין בוקר אפור לפינה חמימה ומוארת; תנועת מצלמה איטית על המוצר.',
          cta: brief.cta,
          rationale: 'מזהה כאב יומיומי של קהל היעד ומציג את העסק כפתרון פשוט וקרוב.',
          complexity: 'MEDIUM',
          estimatedDurationSec: 20,
        },
        {
          title: 'הרגע הקטן שלך',
          angle: 'EMOTIONAL',
          audience: brief.audience,
          hook: 'יש רגעים קטנים שעושים את כל היום',
          script: `יש רגעים קטנים שעושים את כל היום. ב-${business.name} ${claimA}.`,
          mainMessage: `${business.name} – המקום לרגע הקטן שלך`,
          visualDirection: 'צילומי אווירה רכים, אור בוקר, קצב רגוע ומוזיקה חמה.',
          cta: brief.cta,
          rationale: 'בונה זיכרון מותג וחיבור רגשי; מתאים לקהל מקומי וחוזר.',
          complexity: 'MEDIUM',
          estimatedDurationSec: 20,
        },
      ],
      recommendedIndex,
      recommendationReason:
        recommendedIndex === 0
          ? 'המטרה היא מבצע, וכשהמחיר ברור כבר בפתיחה התגובה בדרך כלל גבוהה יותר.'
          : 'פתיחה שמזהה בעיה מוכרת עוצרת גלילה ומובילה בטבעיות למסר של העסק.',
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
        },
      ],
    };
  }
}
