import { DEFAULT_PRICE_CATALOG } from '@kampora/cost-engine';
import type {
  CampaignBrief,
  CampaignGoal,
  ConceptSet,
  CreativeConcept,
  Storyboard,
  StoryboardScene,
} from '@kampora/shared';
import type {
  LlmProvider,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from '@kampora/media-providers';
import { BriefStepInputSchema, ConceptsStepInputSchema, StoryboardStepInputSchema } from './steps';

const MOCK_PRICE = DEFAULT_PRICE_CATALOG.find(
  (e) => e.provider === 'mock' && e.operation === 'LLM_COMPLETION',
)!;

const CTA_BY_GOAL: Record<CampaignGoal, string> = {
  OFFER: 'בואו לנצל את המבצע',
  SALES: 'הזמינו עכשיו',
  LEADS: 'השאירו פרטים ונחזור אליכם',
  PRODUCT_PROMO: 'בואו לטעום',
  AWARENESS: 'בואו להכיר',
};

/**
 * Deterministic stand-in for an LLM. Builds plausible Hebrew creative output from the structured input only,
 * using approved claims verbatim, so the full pipeline runs with zero API keys. Costs are SIMULATED.
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
      case 'creative.brief':
        return { data: this.brief(request.input), usage };
      case 'creative.concepts':
        return { data: this.concepts(request.input), usage };
      case 'creative.storyboard':
        return { data: this.storyboard(request.input), usage };
      default:
        throw new Error(`MockCreativeLlmProvider does not support task "${request.task}"`);
    }
  }

  private brief(raw: unknown): CampaignBrief {
    const { business, request, defaults } = BriefStepInputSchema.parse(raw);
    return {
      goal: request.goal,
      productName: request.productName,
      offer: request.offer,
      audience: business.targetAudience,
      keyMessage: business.approvedClaims[0] ?? business.description,
      cta: CTA_BY_GOAL[request.goal],
      platform: 'META_REELS',
      targetDurationSec: defaults.targetDurationSec,
      tone: business.tone,
      constraints: [
        'להשתמש רק בטענות שאושרו על ידי העסק',
        'טקסט על המסך קצר וקריא, בתוך האזורים הבטוחים של Reels',
        ...(request.notes ? [`הערת בעל העסק: ${request.notes}`] : []),
      ],
      productionBudgetUsd: defaults.budgetUsd,
      qualityTier: defaults.qualityTier,
    };
  }

  private concepts(raw: unknown): ConceptSet {
    const { business, brief } = ConceptsStepInputSchema.parse(raw);
    const [claimA, claimB] = [
      business.approvedClaims[0] ?? brief.keyMessage,
      business.approvedClaims[1] ?? '',
    ];
    const offerLine = brief.offer ? `${brief.offer}.` : '';
    const concepts: CreativeConcept[] = [
      {
        key: 'offer-driven',
        title: 'המבצע במרכז',
        angle: 'OFFER_DRIVEN',
        audience: brief.audience,
        hook: brief.offer ? `רגע, ראיתם את המבצע ב-${business.name}?` : `${brief.productName} כמו שצריך`,
        mainMessage: brief.offer ?? brief.keyMessage,
        visualDirection:
          'פתיחה בקלוז-אפ חם על המוצר, מעבר מהיר לכרטיס מבצע בצבעי המותג, סיום עם לוגו וכתובת.',
        voiceover: [`ב-${business.name} ${claimA}.`, offerLine, `${brief.cta}!`].filter(Boolean).join(' '),
        cta: brief.cta,
        rationale: 'מטרת הקמפיין היא מבצע: מחיר ברור בשניות הראשונות מגדיל הקלקות ומבקרים.',
        complexity: 'LOW',
      },
      {
        key: 'problem-solution',
        title: 'הבוקר שמגיע לך',
        angle: 'PROBLEM_SOLUTION',
        audience: brief.audience,
        hook: `נמאס מ${brief.productName} סתמי בדרך לעבודה?`,
        mainMessage: claimA,
        visualDirection: 'ניגוד בין בוקר אפור לפינה חמימה ומוארת; תנועת מצלמה איטית על המוצר.',
        voiceover: `נמאס מ${brief.productName} סתמי? ב-${business.name} ${claimA}${claimB ? `, ו${claimB}` : ''}.`,
        cta: brief.cta,
        rationale: 'מזהה כאב יומיומי של קהל היעד ומציג את העסק כפתרון פשוט וקרוב.',
        complexity: 'MEDIUM',
      },
      {
        key: 'emotional-moment',
        title: 'הרגע הקטן שלך',
        angle: 'EMOTIONAL',
        audience: brief.audience,
        hook: 'יש רגעים קטנים שעושים את כל היום',
        mainMessage: `${business.name} – המקום לרגע הקטן שלך`,
        visualDirection: 'צילומי אווירה רכים, אור בוקר, קצב רגוע ומוזיקה חמה.',
        voiceover: `יש רגעים קטנים שעושים את כל היום. ב-${business.name} ${claimA}.`,
        cta: brief.cta,
        rationale: 'בונה זיכרון מותג וחיבור רגשי; מתאים לקהל מקומי וחוזר.',
        complexity: 'MEDIUM',
      },
    ];
    const recommendedKey =
      brief.goal === 'OFFER' || brief.goal === 'SALES' ? 'offer-driven' : 'problem-solution';
    return {
      concepts,
      recommendedKey,
      recommendationReason:
        recommendedKey === 'offer-driven'
          ? 'המטרה היא מבצע, וכשהמחיר ברור כבר בפתיחה התגובה בדרך כלל גבוהה יותר.'
          : 'פתיחה שמזהה בעיה מוכרת עוצרת גלילה ומובילה בטבעיות למסר של העסק.',
    };
  }

  private storyboard(raw: unknown): Storyboard {
    const { business, brief, concept } = StoryboardStepInputSchema.parse(raw);
    const claimB = business.approvedClaims[1];
    const scenes: StoryboardScene[] = [
      {
        key: 'hook',
        order: 0,
        role: 'HOOK',
        durationSec: 4,
        visual: `קלוז-אפ קולנועי על ${brief.productName}, אור בוקר חם`,
        visualKind: 'PHOTO',
        voiceover: concept.hook,
        onScreenText: brief.offer ? `מבצע החודש ב-${business.name}` : concept.title,
        requiredAssets: [{ kind: 'image', description: 'תמונת גיבור של המוצר', tags: ['hero'] }],
        motion: { preset: 'cinematic-zoom' },
        quality: {
          requiresHumanMotion: false,
          requiresComplexAction: false,
          requiresProductAccuracy: true,
          brandCritical: false,
        },
      },
      {
        key: 'product',
        order: 1,
        role: 'PRODUCT',
        durationSec: 5.5,
        visual: 'פריסת מוצרים טריים על הדלפק',
        visualKind: 'PHOTO',
        voiceover: `ב-${business.name} ${concept.mainMessage === brief.offer ? business.approvedClaims[0] : concept.mainMessage}${claimB ? `, ו${claimB}` : ''}.`,
        onScreenText: claimB,
        requiredAssets: [{ kind: 'image', description: 'תמונת מוצרים', tags: ['product'] }],
        motion: { preset: 'pan-left' },
        quality: {
          requiresHumanMotion: false,
          requiresComplexAction: false,
          requiresProductAccuracy: true,
          brandCritical: false,
        },
      },
      brief.offer
        ? {
            key: 'offer',
            order: 2,
            role: 'OFFER',
            durationSec: 5,
            visual: 'כרטיס מבצע בצבעי המותג עם המחיר בגדול',
            visualKind: 'GRAPHIC',
            voiceover: `עכשיו: ${brief.offer}.`,
            onScreenText: brief.offer.replace(/\s+עד\s.+$/, ''),
            requiredAssets: [{ kind: 'image', description: 'רקע עדין של המוצר', tags: ['product'] }],
            motion: { preset: 'static' },
            quality: {
              requiresHumanMotion: false,
              requiresComplexAction: false,
              requiresProductAccuracy: false,
              brandCritical: true,
            },
          }
        : {
            key: 'proof',
            order: 2,
            role: 'PROOF',
            durationSec: 5,
            visual: 'אווירה במקום',
            visualKind: 'PHOTO',
            voiceover: business.approvedClaims[2] ?? brief.keyMessage,
            onScreenText: business.approvedClaims[2],
            requiredAssets: [{ kind: 'image', description: 'תמונת אווירה', tags: ['store'] }],
            motion: { preset: 'ken-burns-out' },
            quality: {
              requiresHumanMotion: false,
              requiresComplexAction: false,
              requiresProductAccuracy: false,
              brandCritical: false,
            },
          },
      {
        key: 'cta',
        order: 3,
        role: 'CTA',
        durationSec: 5,
        visual: 'חזית/פנים העסק עם לוגו וכתובת',
        visualKind: 'PHOTO',
        voiceover: `${concept.cta}${business.address ? ` – ${business.address}` : ''}.`,
        onScreenText: concept.cta,
        requiredAssets: [{ kind: 'image', description: 'תמונת המקום', tags: ['store'] }],
        motion: { preset: 'parallax' },
        quality: {
          requiresHumanMotion: false,
          requiresComplexAction: false,
          requiresProductAccuracy: false,
          brandCritical: true,
        },
      },
    ];
    return { conceptKey: concept.key, aspectRatio: '9:16', scenes };
  }
}
