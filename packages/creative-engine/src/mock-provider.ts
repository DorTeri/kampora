import { DEFAULT_PRICE_CATALOG } from '@kampora/cost-engine';
import type {
  LlmProvider,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from '@kampora/media-providers';
import type { CampaignGoal, ConceptAngle } from '@kampora/shared';
import { industryFor } from '@kampora/agent-expertise';
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

/** Cuts to whole words (the mock's copy must respect the same length rules as the model's). */
const clip = (text: string, maxWords: number) => text.trim().split(/\s+/).slice(0, maxWords).join(' ');

/** Goal-consistent CTA variants, so three concepts do not end with the same phrase. */
const CTA_VARIANTS: Record<CampaignGoal, string[]> = {
  OFFER: ['בואו לנצל את המבצע', 'קפצו אלינו', 'שמרו את המבצע ובואו'],
  SALES: ['הזמינו עכשיו', 'הזמינו באתר', 'בדקו את הפרטים'],
  LEADS: ['השאירו פרטים ונחזור אליכם', 'שלחו לנו הודעה', 'קבעו שיחת היכרות'],
  PRODUCT_PROMO: ['בואו לטעום', 'בואו לנסות', 'בואו לראות מקרוב'],
  AWARENESS: ['בואו להכיר', 'קפצו להגיד שלום', 'עקבו אחרינו'],
};

/** The audience's own question, per industry (hook technique QUESTION). */
const PROBLEM_HOOK: Record<string, string> = {
  'cafe-restaurant': 'גם לכם הקפה של הבוקר מאכזב?',
  fitness: 'רוצים להתחיל להתאמן ולא יודעים איפה?',
  'beauty-wellness': 'מתי בפעם האחרונה עשיתם משהו רק בשבילכם?',
  'local-services': 'תקלה בבית ואין למי להתקשר?',
  ecommerce: 'מחפשים מתנה שלא תיגמר במגירה?',
};

/** An everyday moment, per industry (hook technique PATTERN_INTERRUPT for awareness). */
const LIFESTYLE_HOOK: Record<string, string> = {
  'cafe-restaurant': 'ככה נראה בוקר טוב בשכונה',
  fitness: 'שבע בבוקר, והאנרגיה כבר כאן',
  'beauty-wellness': 'שעה אחת של שקט באמצע השבוע',
};

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
    const { profile: industry } = industryFor(business);
    const claimA = business.approvedClaims[0];
    const claimB = business.approvedClaims[1];
    const offer = brief.offer?.replace(/\s+עד\s.+$/, '').trim();
    const ctas = [brief.cta, ...CTA_VARIANTS[brief.goal].filter((c) => c !== brief.cta)];
    const said = (claim?: string) => (claim ? ` ${claim}.` : '');
    const base = {
      audience: brief.audience,
      complexity: 'MEDIUM' as const,
      estimatedDurationSec: 20,
    };

    // A: the offer itself (offer goals), otherwise the audience's own question.
    const offerConcept: ConceptLlm | undefined = offer
      ? {
          ...typeDefaults('OFFER_DRIVEN'),
          ...base,
          complexity: 'LOW',
          estimatedDurationSec: 18,
          title: 'המבצע במרכז',
          hookTechnique: 'OFFER_FIRST',
          hook: clip(`${offer} ב-${business.name}`, 8),
          headline: clip(`${brief.productName}, במחיר מבצע`, 7),
          subheadline: claimA ?? null,
          script: `${offer}, ב-${business.name}.${said(claimA)} ${ctas[0]}!`,
          mainMessage: offer,
          visualDirection: 'מה שמקבלים במבצע, יחד בפריים אחד; המחיר ברור על המסך מהשנייה הראשונה.',
          cta: ctas[0]!,
          rationale: 'כשהמטרה היא מבצע, הערך צריך להיות ברור לפני שהצופה ממשיך לגלול.',
          objective: 'להביא מבקרים לנצל את המבצע',
          insight: 'כשההצעה ברורה מהשנייה הראשונה, קל להחליט לבוא',
          hypothesis: 'אם נפתח במחיר עצמו, יותר אנשים יעצרו ויגיעו, כי הערך ברור מיד',
          storyStructure: ['פתיחה: המבצע', 'מה מקבלים', 'המחיר והתנאים', 'קריאה לפעולה'],
          claimsUsed: claimA ? [claimA] : [],
        }
      : undefined;

    const question: ConceptLlm = {
      ...typeDefaults('PROBLEM_SOLUTION'),
      ...base,
      title: 'השאלה של הקהל',
      hookTechnique: 'QUESTION',
      hook: PROBLEM_HOOK[industry.id] ?? `מחפשים ${clip(brief.productName, 4)} שאפשר לסמוך עליו?`,
      headline: clip(claimA ?? `${brief.productName} ב-${business.name}`, 7),
      subheadline: offer ?? null,
      script: `${PROBLEM_HOOK[industry.id] ?? `מחפשים ${brief.productName}?`} ב-${business.name}${claimA ? ` ${claimA}` : ` יש ${brief.productName}`}${claimB ? `, ו${claimB}` : ''}. ${ctas[1]}.`,
      mainMessage: claimA ?? brief.keyMessage,
      visualDirection: 'פתיחה ברגע המוכר של הבעיה, מעבר לפתרון אצל העסק; תנועת מצלמה רגועה.',
      cta: ctas[1]!,
      rationale: 'פותח בשאלה שהקהל כבר שואל את עצמו, ומציג את העסק כתשובה פשוטה וקרובה.',
      objective: `לבנות העדפה ל-${business.name} כפתרון`,
      insight: `השערה: ${industry.motivations[0]}`,
      hypothesis: 'אם נשאל את השאלה שהקהל כבר שואל, הוא יזדהה ויקשיב לתשובה',
      storyStructure: ['פתיחה: השאלה', 'למה זה מתסכל', `הפתרון: ${business.name}`, 'קריאה לפעולה'],
      claimsUsed: [claimA, claimB].filter((c): c is string => Boolean(c)),
    };

    const third = this.thirdConcept(business.name, brief, industry.id, claimA, ctas[2]!);
    const concepts = offerConcept
      ? [offerConcept, question, third]
      : [question, third, this.firstPerson(business.name, brief, claimB ?? claimA, ctas[0]!)];
    const recommendedIndex = 0;
    return {
      concepts,
      recommendedIndex,
      recommendationReason: offerConcept
        ? 'המטרה היא מבצע, וכשהמחיר ברור כבר בפתיחה התגובה בדרך כלל גבוהה יותר.'
        : 'פתיחה שמזהה צורך מוכר עוצרת גלילה ומובילה בטבעיות למסר של העסק.',
    };
  }

  /** The third idea differs by goal: product moment, lifestyle, or a useful tip. */
  private thirdConcept(
    name: string,
    brief: ReturnType<typeof ConceptsStepInputSchema.parse>['brief'],
    industryId: string,
    claim: string | undefined,
    cta: string,
  ): ConceptLlm {
    const common = { audience: brief.audience, cta, complexity: 'MEDIUM' as const, estimatedDurationSec: 20 };
    if (brief.goal === 'LEADS') {
      return {
        ...typeDefaults('EDUCATIONAL'),
        ...common,
        title: 'טיפ אחד שימושי',
        hookTechnique: 'HOW_TO',
        hook: `טיפ קטן לפני שבוחרים ${clip(brief.productName, 3)}`,
        headline: clip(`הטיפ שלנו: ${brief.productName}`, 7),
        subheadline: null,
        script: `טיפ קטן לפני שבוחרים ${brief.productName}: תשאלו מה בדיוק כלול. ב-${name}${claim ? ` ${claim}` : ' עונים על כל שאלה'}. ${cta}.`,
        mainMessage: 'בחירה נכונה מתחילה בשאלה הנכונה',
        visualDirection: 'צילום ישיר ופשוט של בעל המקצוע מסביר, כתוביות ברורות.',
        rationale: 'נותן ערך לפני שמבקש פרטים, ובונה אמון במומחיות.',
        objective: 'להשאיר פרטים אחרי שקיבלו ערך',
        insight: 'אנשים סומכים על מי שעזר להם לפני שביקש משהו',
        hypothesis: 'אם ניתן טיפ אמיתי, יותר אנשים ישאירו פרטים',
        storyStructure: ['פתיחה: הטיפ', 'למה זה חשוב', `${name} עוזרים`, 'קריאה לפעולה'],
        claimsUsed: claim ? [claim] : [],
      };
    }
    if (brief.goal === 'AWARENESS') {
      return {
        ...typeDefaults('LIFESTYLE'),
        ...common,
        title: `רגע עם ${name}`,
        hookTechnique: 'PATTERN_INTERRUPT',
        hook: LIFESTYLE_HOOK[industryId] ?? 'ככה נראה יום טוב בשכונה',
        headline: clip(`${name}. חלק מהשגרה`, 7),
        subheadline: claim ?? null,
        script: `${LIFESTYLE_HOOK[industryId] ?? 'ככה נראה יום טוב בשכונה'}. ${name}${claim ? `, ${claim}` : ''}. ${cta}.`,
        mainMessage: `${name} הוא חלק מהשגרה הטובה`,
        visualDirection: 'אור טבעי, אנשים אמיתיים, המוצר כחלק מהיום.',
        rationale: 'בונה מודעות דרך רגע שהקהל רוצה להיות חלק ממנו.',
        objective: `להכיר את ${name} לתושבי האזור`,
        insight: 'אנשים זוכרים מקומות שקשורים לרגע טוב בשבוע שלהם',
        hypothesis: 'אם נראה את העסק כחלק מרגע רצוי, הקהל יזכור אותו',
        storyStructure: ['פתיחה: הרגע', 'המוצר בתוך השגרה', 'המותג', 'קריאה לפעולה'],
        claimsUsed: claim ? [claim] : [],
      };
    }
    return {
      ...typeDefaults(
        brief.goal === 'PRODUCT_PROMO' || brief.goal === 'SALES' ? 'PRODUCT_DEMO' : 'EMOTIONAL',
      ),
      ...common,
      title: `${clip(brief.productName, 3)} מקרוב`,
      hookTechnique: 'SENSORY_DETAIL',
      hook: `ככה נראה ${clip(brief.productName, 4)} מקרוב`,
      headline: clip(`${brief.productName}, מקרוב`, 7),
      subheadline: claim ?? null,
      script: `ככה נראה ${brief.productName} מקרוב.${claim ? ` ב-${name} ${claim}.` : ''} ${cta}.`,
      mainMessage: claim ?? `${brief.productName} ב-${name}`,
      visualDirection: 'קלוז-אפים על המוצר האמיתי, מרקם ופרטים, תנועות מצלמה קצרות.',
      rationale: 'מראה את המוצר עצמו ונותן לקהל להחליט לפי מה שהוא רואה.',
      objective: `לעורר רצון לנסות את ${brief.productName}`,
      insight: 'אנשים סומכים על מה שהם רואים יותר מאשר על תיאורים',
      hypothesis: 'אם נראה את המוצר מקרוב, הרצון לנסות יעלה',
      storyStructure: ['פתיחה: רגע המוצר', 'הפרטים', 'היתרון', 'קריאה לפעולה'],
      claimsUsed: claim ? [claim] : [],
    };
  }

  /** First-person discovery (never a fake customer: the brand tells its own story). */
  private firstPerson(
    name: string,
    brief: ReturnType<typeof ConceptsStepInputSchema.parse>['brief'],
    claim: string | undefined,
    cta: string,
  ): ConceptLlm {
    return {
      ...typeDefaults('UGC'),
      audience: brief.audience,
      cta,
      complexity: 'LOW',
      estimatedDurationSec: 20,
      title: 'מאחורי הקלעים',
      hookTechnique: 'FIRST_PERSON',
      hook: `תנו לנו להראות לכם את ${name}`,
      headline: clip(`ככה עובדים ב-${name}`, 7),
      subheadline: claim ?? null,
      script: `תנו לנו להראות לכם את ${name}.${claim ? ` ${claim}.` : ''} ${cta}.`,
      mainMessage: claim ?? brief.keyMessage,
      visualDirection: 'צילום ידני בגובה העיניים, אנשי הצוות האמיתיים בעבודה.',
      rationale: 'מראה את האנשים שמאחורי העסק; אמון נבנה כשרואים מי עושה את העבודה.',
      objective: `לבנות אמון ב-${name}`,
      insight: 'קל יותר לפנות לעסק כשמכירים את האנשים שבו',
      hypothesis: 'אם נראה את הצוות האמיתי, יותר אנשים ירגישו בנוח לפנות',
      storyStructure: ['פתיחה: היכרות', 'איך עובדים', 'מה מקבלים', 'קריאה לפעולה'],
      claimsUsed: claim ? [claim] : [],
    };
  }

  private storyboard(raw: unknown): StoryboardLlm {
    const { business, brief, concept } = StoryboardStepInputSchema.parse(raw);
    const claimA = business.approvedClaims[0] ?? brief.keyMessage;
    const claimB = business.approvedClaims[1];
    const flags = { requiresHumanMotion: false, requiresComplexAction: false };
    // "קפה ומאפה" / "coffee + pastry" → one of each, all in frame.
    const heroSubjects = brief.productName
      .split(/\s*[+,&]\s*|\s+ו(?=\S{2,})/)
      .filter(Boolean)
      .map((name) => ({ name, quantity: 1 }));
    const products = business.products.slice(0, 4).map((p) => ({ name: p.name, quantity: null }));
    return {
      scenes: [
        {
          role: 'HOOK',
          durationSec: 4,
          visual: `קלוז-אפ קולנועי על ${brief.productName}, אור בוקר חם`,
          visualKind: 'PHOTO',
          voiceover: concept.hook,
          // The Copywriter's written headline is the on-screen hook (not the spoken line).
          onScreenText:
            concept.copy?.headline ?? (brief.offer ? `מבצע החודש ב-${business.name}` : concept.title),
          assetTags: ['hero'],
          motionPreset: 'cinematic-zoom',
          ...flags,
          requiresProductAccuracy: true,
          purpose: 'לעצור את הגלילה ולהציג את ההבטחה המרכזית',
          shot: heroSubjects.length > 1 ? 'close-up' : 'extreme-close-up',
          composition: 'SINGLE_HERO',
          subjects: heroSubjects,
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
          shot: 'overhead',
          composition: 'ASSORTMENT',
          subjects: products,
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
              composition: 'SINGLE_HERO',
              subjects: [],
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
              composition: 'ENVIRONMENT',
              subjects: [],
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
          composition: 'ENVIRONMENT',
          subjects: [],
          editorNote: 'הלוגו והכתובת נשארים על המסך עד הסוף',
        },
      ],
    };
  }
}
