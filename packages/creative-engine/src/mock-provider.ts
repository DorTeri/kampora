import { DEFAULT_PRICE_CATALOG } from '@kampora/cost-engine';
import type {
  LlmProvider,
  StructuredGenerationRequest,
  StructuredGenerationResult,
} from '@kampora/media-providers';
import type { CampaignGoal, ConceptAngle, SceneRole } from '@kampora/shared';
import { industryFor, treatmentBeats } from '@kampora/agent-expertise';
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
import { ConceptsStepInputSchema, StoryboardStepInputSchema, videoTreatmentFor } from './steps';
import { CritiqueOpinionInputSchema, type CritiqueOpinionLlm } from './critic/opinion';

/** A prefix letter joins a Hebrew word ("בבורגר האוס"); before digits or Latin it takes a hyphen ("ב-Luz"). */
const prefixed = (letter: string, word: string) => (/^[\u05D0-\u05EA]/.test(word.trim()) ? `${letter}${word.trim()}` : `${letter}-${word.trim()}`);
/** "שתי קציצות, צ׳דר, בצל" → "שתי קציצות, צ׳דר ובצל", as a list is said aloud. */
const spokenList = (text: string) => text.trim().replace(/[.\s]+$/, '').replace(/,\s*([^,]+)$/, (_, last: string) => ` ${prefixed('ו', last)}`);

/** Cuts to whole words (the mock's copy must respect the same length rules as the model's). */
const clip = (text: string, maxWords: number) => text.trim().split(/\s+/).slice(0, maxWords).join(' ');

/** Goal-consistent CTA variants, so three concepts do not end with the same phrase. */
const CTA_VARIANTS: Record<CampaignGoal, string[]> = {
  OFFER: ['תפסו את המבצע', 'קפצו אלינו', 'שמרו את המבצע ובואו'],
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
  ecommerce: 'מחפשים משהו מיוחד שלא ייגמר במגירה?',
};

/** An everyday moment, per industry (hook technique PATTERN_INTERRUPT for awareness). */
const LIFESTYLE_HOOK: Record<string, string> = {
  'cafe-restaurant': 'ככה נראה בוקר טוב בשכונה',
  fitness: 'שבע בבוקר, והאנרגיה כבר כאן',
  'beauty-wellness': 'שעה אחת של שקט באמצע השבוע',
};

/** The mock writes the words first; the design intent is added per hook technique, as a copywriter would brief it. */
type MockConcept = Omit<ConceptLlm, 'visualIdea' | 'designMoves' | 'emphasis' | 'eyebrow'>;

const DESIGN_BY_HOOK: Record<ConceptLlm['hookTechnique'], Pick<ConceptLlm, 'visualIdea' | 'designMoves' | 'emphasis'>> = {
  OFFER_FIRST: { visualIdea: 'מה שמקבלים, מצולם מקרוב על משטח שקט; המחיר גדול ככותרת בצד הריק.', designMoves: ['PRICE_AS_GRAPHIC', 'PRODUCT_AS_HERO', 'SINGLE_FOCAL_POINT'], emphasis: 'PRICE' },
  QUESTION: { visualIdea: 'השאלה עצמה בגדול, כמעט כמו שלט; תמונה קטנה ושקטה של הרגע שהיא מתארת.', designMoves: ['OVERSIZED_HEADLINE', 'GENEROUS_NEGATIVE_SPACE', 'ASYMMETRIC_GRID'], emphasis: 'HEADLINE' },
  BOLD_STATEMENT: { visualIdea: 'משפט אחד על שדה צבע של המותג, בלי תמונה שמתחרה בו.', designMoves: ['TYPE_AS_IMAGE', 'BRAND_COLOR_FLOOD', 'MINIMAL_COPY'], emphasis: 'HEADLINE' },
  PATTERN_INTERRUPT: { visualIdea: 'תמונה של רגע יומיומי, חתוכה באופן לא צפוי; הטקסט נשען על הקצה השקט שלה.', designMoves: ['FULL_BLEED_IMAGE', 'SINGLE_FOCAL_POINT', 'MINIMAL_COPY'], emphasis: 'IMAGE' },
  FIRST_PERSON: { visualIdea: 'אנשים אמיתיים במקום, בגובה העיניים; הכותרת כציטוט קצר.', designMoves: ['PEOPLE_AS_HERO', 'FULL_BLEED_IMAGE', 'CTA_AS_TEXT_LINE'], emphasis: 'IMAGE' },
  SENSORY_DETAIL: { visualIdea: 'פרט אחד בתקריב (קצף, קרום, מרקם) ממלא את הפריים; מעט מילים.', designMoves: ['DETAIL_MACRO_CROP', 'FULL_BLEED_IMAGE', 'MINIMAL_COPY'], emphasis: 'IMAGE' },
  CONTRAST: { visualIdea: 'שני חצאים: לפני ואחרי, או שתי אפשרויות, זו מול זו.', designMoves: ['SPLIT_PANEL', 'Z_READING_PATH'], emphasis: 'HEADLINE' },
  HOW_TO: { visualIdea: 'מבנה עריכתי נקי: כותרת סריפית, שורת פתיח וקווים דקים, כמו עמוד במגזין.', designMoves: ['SERIF_EDITORIAL', 'RULE_LINES', 'GENEROUS_NEGATIVE_SPACE', 'CTA_AS_TEXT_LINE'], emphasis: 'HEADLINE' },
};

const withDesign = (c: MockConcept, eyebrow: string | null): ConceptLlm => ({ ...c, ...DESIGN_BY_HOOK[c.hookTechnique], eyebrow });

/** Creative territories the food mock writes in (see CREATIVE_TERRITORIES in agent-expertise). */
type FoodTerritory = 'VALUE' | 'CRAVING' | 'CRAFT' | 'OCCASION' | 'LOCAL';

/** Which reasons to order lead, per goal; a territory is skipped when its facts are missing (no offer, claim or city). */
const FOOD_ORDER: Record<CampaignGoal, FoodTerritory[]> = {
  OFFER: ['VALUE', 'CRAVING', 'CRAFT', 'OCCASION'],
  SALES: ['VALUE', 'CRAVING', 'CRAFT', 'OCCASION'],
  PRODUCT_PROMO: ['CRAVING', 'CRAFT', 'OCCASION', 'LOCAL'],
  AWARENESS: ['LOCAL', 'OCCASION', 'CRAFT', 'CRAVING'],
  LEADS: ['CRAVING', 'CRAFT', 'OCCASION', 'LOCAL'],
};

const FOOD_REASON: Record<FoodTerritory, string> = {
  VALUE: 'המטרה היא מבצע, וכשמה שמקבלים והמחיר ברורים כבר בפתיחה, קל להחליט עכשיו.',
  CRAVING: 'המטרה היא שיזמינו את המנה הזו, והדרך הקצרה לשם היא להראות אותה ברגע שבו מחליטים מה לאכול.',
  CRAFT: 'פרט אמיתי מהמטבח בונה אמון מהר יותר משבחים, וזה מה שמבדיל אתכם מכל מקום אחר באזור.',
  OCCASION: 'רגע קבוע בשבוע מזכיר אתכם שוב ושוב, גם בלי מבצע.',
  LOCAL: 'המטרה היא שיכירו אתכם, והצעד הראשון הוא שיידעו שאתם קיימים וכמה אתם קרובים.',
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
      case 'creative.critique':
        return { data: this.critique(request.input), usage };
      default:
        throw new Error(`MockCreativeLlmProvider does not support task "${request.task}"`);
    }
  }

  /** The mock does not judge creative work: it says so, and leaves the score empty. */
  private critique(raw: unknown): CritiqueOpinionLlm {
    const { criteria } = CritiqueOpinionInputSchema.parse(raw);
    return {
      opinions: criteria.map((criterion) => ({
        criterion,
        score: null,
        explanation:
          'Simulation only: the mock provider does not judge creative work. A person should review this.',
        evidence: [],
      })),
    };
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
    const offerConcept: MockConcept | undefined = offer
      ? {
          ...typeDefaults('OFFER_DRIVEN'),
          ...base,
          complexity: 'LOW',
          estimatedDurationSec: 18,
          title: 'המבצע במרכז',
          hookTechnique: 'OFFER_FIRST',
          hook: clip(`${offer} ${prefixed('ב', business.name)}`, 8),
          headline: clip(`${brief.productName}, במחיר מבצע`, 7),
          subheadline: claimA ?? null,
          script: `${offer}, ${prefixed('ב', business.name)}.${said(claimA)} ${ctas[0]}!`,
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

    const question: MockConcept = {
      ...typeDefaults('PROBLEM_SOLUTION'),
      ...base,
      title: 'השאלה של הקהל',
      hookTechnique: 'QUESTION',
      hook: PROBLEM_HOOK[industry.id] ?? `מחפשים ${clip(brief.productName, 4)} שאפשר לסמוך עליו?`,
      headline: clip(claimA ?? `${brief.productName} ${prefixed('ב', business.name)}`, 7),
      subheadline: offer ?? null,
      script: `${PROBLEM_HOOK[industry.id] ?? `מחפשים ${brief.productName}?`} ${prefixed('ב', business.name)}${claimA ? ` ${claimA}` : ` יש ${brief.productName}`}${claimB ? `, ו${claimB}` : ''}. ${ctas[1]}.`,
      mainMessage: claimA ?? brief.keyMessage,
      visualDirection: 'פתיחה ברגע המוכר של הבעיה, מעבר לפתרון אצל העסק; תנועת מצלמה רגועה.',
      cta: ctas[1]!,
      rationale: 'פותח בשאלה שהקהל כבר שואל את עצמו, ומציג את העסק כתשובה פשוטה וקרובה.',
      objective: `לבנות העדפה ${prefixed('ל', business.name)} כפתרון`,
      insight: `השערה: ${industry.motivations[0]}`,
      hypothesis: 'אם נשאל את השאלה שהקהל כבר שואל, הוא יזדהה ויקשיב לתשובה',
      storyStructure: ['פתיחה: השאלה', 'למה זה מתסכל', `הפתרון: ${business.name}`, 'קריאה לפעולה'],
      claimsUsed: [claimA, claimB].filter((c): c is string => Boolean(c)),
    };

    if (industry.id === 'cafe-restaurant') return this.foodConcepts(business, brief, offer);

    const third = this.thirdConcept(business.name, brief, industry.id, claimB ?? claimA, ctas[2]!);
    const concepts = offerConcept
      ? [offerConcept, question, third]
      : [question, third, this.firstPerson(business.name, brief, claimB ?? claimA, ctas[0]!)];
    const recommendedIndex = 0;
    return {
      concepts: concepts.map((c) => withDesign(c, business.city ? `${business.name} · ${business.city}` : null)),
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
  ): MockConcept {
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
        script: `טיפ קטן לפני שבוחרים ${brief.productName}: תשאלו מה בדיוק כלול. ${prefixed('ב', name)}${claim ? ` ${claim}` : ' עונים על כל שאלה'}. ${cta}.`,
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
      script: `ככה נראה ${brief.productName} מקרוב.${claim ? ` ${prefixed('ב', name)} ${claim}.` : ''} ${cta}.`,
      mainMessage: `רואים את ${brief.productName} מקרוב, ומחליטים לבד`,
      visualDirection: 'קלוז-אפים על המוצר האמיתי, מרקם ופרטים, תנועות מצלמה קצרות.',
      rationale: 'מראה את המוצר עצמו ונותן לקהל להחליט לפי מה שהוא רואה.',
      objective: `לעורר רצון לנסות את ${brief.productName}`,
      insight: 'אנשים סומכים על מה שהם רואים יותר מאשר על תיאורים',
      hypothesis: 'אם נראה את המוצר מקרוב, הרצון לנסות יעלה',
      storyStructure: ['פתיחה: רגע המוצר', 'הפרטים', 'היתרון', 'קריאה לפעולה'],
      claimsUsed: claim ? [claim] : [],
    };
  }

  /**
   * Food and drink: three concepts from three creative territories (CREATIVE_TERRITORIES), each a different reason
   * to order, written only from the business's facts: its product details, its approved claims, its offer, its city.
   */
  private foodConcepts(
    business: ReturnType<typeof ConceptsStepInputSchema.parse>['business'],
    brief: ReturnType<typeof ConceptsStepInputSchema.parse>['brief'],
    offer: string | undefined,
  ): ConceptSetLlm {
    const { name, city } = business;
    const product = brief.productName;
    const inName = prefixed('ב', name);
    const fromName = prefixed('מ', name);
    const details = business.products.find((p) => p.name === product)?.description?.trim();
    const street = business.address?.split(',')[0]?.trim();
    const [claimA, claimB] = business.approvedClaims;
    // A café or bakery lives in the morning; a restaurant in the evening.
    const morning = /קפה|מאפ|בוקר|cafe|coffee|bakery/i.test(`${business.category} ${business.description}`);
    const base = { audience: brief.audience, complexity: 'MEDIUM' as const, estimatedDurationSec: 20 };
    const ctaOf: Record<FoodTerritory, string> = morning
      ? { VALUE: brief.cta, CRAVING: 'קפצו בדרך', CRAFT: 'בואו לטעום', OCCASION: 'תתחילו את הבוקר אצלנו', LOCAL: 'קפצו להגיד שלום' }
      : { VALUE: brief.cta, CRAVING: 'הזמינו עכשיו', CRAFT: 'קפצו לטעום', OCCASION: 'הזמינו לערב', LOCAL: 'קפצו להכיר' };

    const build: Record<FoodTerritory, (cta: string) => MockConcept | undefined> = {
      VALUE: (cta) => {
        if (!offer) return undefined;
        const items = offer.replace(/\s*ב-?\s*\d[\d.,]*\s*₪?.*$/, '').trim();
        const list = spokenList(items.replace(/\s*\+\s*/g, ', '));
        return {
          ...typeDefaults('OFFER_DRIVEN'),
          ...base,
          complexity: 'LOW',
          estimatedDurationSec: 18,
          title: 'המחיר הוא החדשות',
          hookTechnique: 'OFFER_FIRST',
          hook: clip(offer, 8),
          headline: clip(items && items !== offer ? `${list}, במחיר אחד` : offer, 7),
          subheadline: null,
          script: `${offer}, ${inName}.${details ? ` ${product}: ${spokenList(details)}.` : ''} ${cta}.`,
          mainMessage: offer,
          visualDirection: 'כל מה שבמבצע יחד בפריים אחד, מלמעלה; המחיר גדול וברור מהשנייה הראשונה.',
          cta,
          rationale: 'כשיש מבצע ברור, הוא המסר: מה מקבלים וכמה זה עולה, לפני שהצופה ממשיך לגלול.',
          objective: 'להביא הזמנות במחיר המבצע',
          insight: morning
            ? 'בבוקר אין זמן להתלבט; מחיר סגור מראש הופך את ההחלטה לקלה.'
            : 'כשמזמינים לערב, מחיר סגור מראש מוריד את ההתלבטות האחרונה.',
          hypothesis: 'אם מה שמקבלים והמחיר ברורים בשנייה הראשונה, יותר אנשים יזמינו עכשיו ולא "אחר כך".',
          storyStructure: ['פתיחה: המבצע והמחיר', 'מה בדיוק מקבלים', 'איפה', 'קריאה לפעולה'],
          claimsUsed: [],
        };
      },
      CRAVING: (cta) => ({
        ...typeDefaults('PRODUCT_DEMO'),
        ...base,
        title: 'רגע החשק',
        hookTechnique: 'SENSORY_DETAIL',
        hook: morning ? clip(`${product}, רגע לפני שהיום מתחיל`, 8) : 'ערב, רעב, והבטן כבר החליטה',
        headline: clip(details ? spokenList(details) : `${product}, ישר מהמטבח`, 7),
        subheadline: details ? product : null,
        script: morning
          ? `${product} ${fromName}, רגע לפני שהיום מתחיל.${details ? ` ${spokenList(details)}.` : ''} ${cta}.`
          : `ערב, רעב, והבטן כבר החליטה: ${product} ${fromName}.${details ? ` ${spokenList(details)}.` : ''} ${cta}.`,
        mainMessage: morning ? `${product} הוא הרגע הטוב הראשון של הבוקר` : `${product} הוא התשובה לחשק של הערב`,
        visualDirection: 'תקריב של המנה האמיתית: מרקם, אדים, הביס הראשון; תנועות מצלמה קצרות וקרובות.',
        cta,
        rationale: 'מוכר את המנה עצמה ברגע שבו מחליטים מה לאכול, עם הפרטים האמיתיים שלה במקום שבחים.',
        objective: `שיזמינו ${product}`,
        insight: 'אוכל נבחר ברגע של חשק, לא אחרי השוואה; מי שמופיע ברגע הזה מקבל את ההזמנה.',
        hypothesis: 'אם נראה את המנה עצמה מקרוב, בשעה שבה החשק מתחיל, יותר אנשים יזמינו אותה.',
        storyStructure: ['פתיחה: השעה והחשק', 'המנה בתקריב', 'מה יש בה', 'קריאה לפעולה'],
        claimsUsed: [],
      }),
      CRAFT: (cta) =>
        claimA
          ? {
              ...typeDefaults('UGC'),
              ...base,
              complexity: 'LOW',
              title: 'מה שקורה במטבח',
              hookTechnique: 'FIRST_PERSON',
              hook: clip(`אצלנו ${claimA}`, 8),
              headline: clip(claimA, 7),
              subheadline: claimB ?? null,
              script: `אצלנו ${claimA}.${claimB ? ` וגם: ${claimB}.` : ''} ככה מכינים ${product} ${inName}. ${cta}.`,
              mainMessage: 'רואים איך מכינים, ומבינים מה מקבלים',
              visualDirection: 'מצלמה ביד בתוך המטבח: הפעולה עצמה בגובה העיניים, עם הצוות האמיתי (באישורו).',
              cta,
              rationale: 'מוכיח איכות דרך מה שהעסק באמת עושה, במילים שלו, בלי סופרלטיבים.',
              objective: `לבנות אמון באיכות של ${name}`,
              insight: 'כשכולם אומרים "טרי" ו"איכותי", פרט אמיתי אחד מהמטבח משכנע יותר מכל שבח.',
              hypothesis: 'אם נראה פעולה אמיתית מהמטבח, יותר אנשים יאמינו שזה שווה הזמנה.',
              storyStructure: ['פתיחה: הפעולה במטבח', 'מה בדיוק עושים', 'המנה המוכנה', 'קריאה לפעולה'],
              claimsUsed: [claimA, claimB].filter((c): c is string => Boolean(c)),
            }
          : undefined,
      OCCASION: (cta) => ({
        ...typeDefaults('LIFESTYLE'),
        ...base,
        title: morning ? 'הרגע הקבוע של הבוקר' : 'הערב של חמישי',
        hookTechnique: 'PATTERN_INTERRUPT',
        hook: morning ? 'עוד לפני ההודעה הראשונה של היום' : 'חמישי בערב, ואף אחד לא מתנדב לבשל',
        headline: morning ? clip(`הבוקר מתחיל ${inName}`, 7) : clip(`חמישי בערב? ${product}`, 7),
        subheadline: null,
        script: morning
          ? `עוד לפני ההודעה הראשונה של היום, יש רגע אחד שהוא רק שלכם: ${product} ${inName}. ${cta}.`
          : `חמישי בערב, ואף אחד לא מתנדב לבשל. אז לא מבשלים: ${product} ${fromName}${city ? `, כאן ${prefixed('ב', city)}` : ''}. ${cta}.`,
        mainMessage: morning ? `${name} הוא הרגע הקבוע של הבוקר` : `${name} הוא הפתרון הקבוע לערב שבו לא מבשלים`,
        visualDirection: morning
          ? 'אור בוקר רך, ידיים סביב כוס, השולחן לפני שהיום מתחיל; המוצר חלק מהרגע.'
          : 'שולחן של חברים או משפחה בערב, ידיים שמושיטות יד למגש; המנה במרכז, האנשים חלקית מחוץ לפריים.',
        cta,
        rationale: 'מחבר את העסק לרגע שחוזר כל שבוע, כך שהרגע עצמו מזכיר אותו.',
        objective: `שיחשבו על ${name} בכל פעם שהרגע הזה מגיע`,
        insight: 'אנשים לא בוחרים קטגוריה, הם פותרים רגע ("מה עושים הערב"); עסק שקשור לרגע קבוע נזכר בו כל שבוע.',
        hypothesis: 'אם נתחבר לרגע קבוע בשבוע, הקהל ייזכר בנו בפעם הבאה שהוא מגיע, גם בלי מבצע.',
        storyStructure: ['פתיחה: הרגע המוכר', 'הדילמה הקטנה', 'הפתרון: המנה על השולחן', 'קריאה לפעולה'],
        claimsUsed: [],
      }),
      LOCAL: (cta) =>
        city
          ? {
              ...typeDefaults('EMOTIONAL'),
              ...base,
              title: `${name} בשכונה`,
              hookTechnique: 'BOLD_STATEMENT',
              hook: clip(`${city}, תכירו: ${name}`, 8),
              headline: clip(`${name}, ${street ? prefixed('ב', street) : `כאן ${prefixed('ב', city)}`}`, 7),
              subheadline: product,
              script: `${city}, תכירו: ${name}${street ? `, ${prefixed('ב', street)}` : ''}. ${product}${details ? `: ${spokenList(details)}` : ''}. ${cta}.`,
              mainMessage: `${name} ממש קרוב, וכדאי להכיר`,
              visualDirection: 'החזית או הדלפק עם השם ברור, רחוב מוכר ברקע; אחר כך המנה. מרגיש כמו המלצה של שכן.',
              cta,
              rationale: 'לעסק שעוד לא מכירים, החסם הראשון הוא לדעת שהוא קיים וכמה הוא קרוב.',
              objective: `להכיר את ${name} לתושבי ${city}`,
              insight: 'לעסק שלא מכירים עדיין, החסם הראשון הוא לא לדעת שהוא קיים, או כמה הוא קרוב.',
              hypothesis: 'אם נציג את העסק בשמו ובמקומו, אנשים מהאזור ייזכרו בו כשיחפשו מה לאכול.',
              storyStructure: ['פתיחה: פנייה לעיר', 'איפה בדיוק', 'מה כדאי לטעום', 'קריאה לפעולה'],
              claimsUsed: [],
            }
          : undefined,
    };

    const picked: { territory: FoodTerritory; concept: MockConcept }[] = [];
    for (const territory of FOOD_ORDER[brief.goal]) {
      if (picked.length === 3) break;
      const concept = build[territory](picked.length === 0 ? brief.cta : ctaOf[territory]);
      if (concept) picked.push({ territory, concept });
    }
    const concepts = picked.map((p) => p.concept);
    if (concepts.length < 3) concepts.push(this.firstPerson(name, brief, claimB ?? claimA, brief.cta));
    const lead = picked[0]!.territory;
    return {
      concepts: concepts.map((c) => withDesign(c, city ? `${name} · ${city}` : null)),
      recommendedIndex: 0,
      recommendationReason: FOOD_REASON[lead],
    };
  }

  /** First-person discovery (never a fake customer: the brand tells its own story). */
  private firstPerson(
    name: string,
    brief: ReturnType<typeof ConceptsStepInputSchema.parse>['brief'],
    claim: string | undefined,
    cta: string,
  ): MockConcept {
    return {
      ...typeDefaults('UGC'),
      audience: brief.audience,
      cta,
      complexity: 'LOW',
      estimatedDurationSec: 20,
      title: 'מאחורי הקלעים',
      hookTechnique: 'FIRST_PERSON',
      hook: `תנו לנו להראות לכם את ${name}`,
      headline: clip(`ככה עובדים ${prefixed('ב', name)}`, 7),
      subheadline: claim ?? null,
      script: `תנו לנו להראות לכם את ${name}.${claim ? ` ${claim}.` : ''} ${cta}.`,
      mainMessage: `האנשים שמאחורי ${name}`,
      visualDirection: 'צילום ידני בגובה העיניים, אנשי הצוות האמיתיים בעבודה.',
      rationale: 'מראה את האנשים שמאחורי העסק; אמון נבנה כשרואים מי עושה את העבודה.',
      objective: `לבנות אמון ${prefixed('ב', name)}`,
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
    // The concept's video treatment plans the scenes: a craving concept is cut differently from a value one.
    const treatment = videoTreatmentFor(concept);
    const beats = treatmentBeats(treatment, Boolean(brief.offer));
    // With a middle scene of its own (demo, benefit, solution) the second claim is said there, not twice.
    const middle = beats.some((b) => b.role === 'DEMO' || b.role === 'BENEFIT' || b.role === 'SOLUTION');
    const line = (role: SceneRole): { voiceover: string; onScreenText: string | null } => {
      switch (role) {
        case 'HOOK':
          // The Copywriter's written headline is the on-screen hook (not the spoken line).
          return {
            voiceover: concept.hook,
            onScreenText:
              concept.copy?.headline ?? (brief.offer ? `מבצע החודש ${prefixed('ב', business.name)}` : concept.title),
          };
        case 'PRODUCT':
          return {
            voiceover: `${prefixed('ב', business.name)} ${claimA}${claimB && !middle ? `, ו${claimB}` : ''}.`,
            onScreenText: middle ? null : (claimB ?? null),
          };
        case 'OFFER': {
          // The card keeps the approved words; past seven words "a + b + c" reads as a list ("a, b וc").
          const card = brief.offer!.replace(/\s+עד\s.+$/, '');
          const long = card.trim().split(/\s+/).length > 7;
          return { voiceover: `עכשיו: ${brief.offer}.`, onScreenText: long ? spokenList(card.replace(/\s+\+\s+/g, ', ')) : card };
        }
        case 'CTA':
          return { voiceover: `${concept.cta}${business.address ? ` – ${business.address}` : ''}.`, onScreenText: concept.cta };
        default:
          return { voiceover: `${claimB ?? brief.keyMessage}.`, onScreenText: null };
      }
    };
    const subjectsFor = (composition: string) =>
      composition === 'ASSORTMENT' ? products : composition === 'ENVIRONMENT' ? [] : heroSubjects;
    return {
      scenes: beats.map((b, i) => {
        const close = b.shot === 'extreme-close-up' || b.shot === 'detail';
        return {
          role: b.role,
          durationSec: b.durationSec,
          visual: b.visual.replace('{product}', brief.productName),
          visualKind: b.visualKind,
          ...line(b.role),
          assetTags: [...b.assetTags],
          motionPreset: b.motion,
          ...flags,
          requiresProductAccuracy: b.requiresProductAccuracy,
          purpose: b.purpose,
          // Several products never fit a macro frame.
          shot: close && heroSubjects.length > 1 ? 'close-up' : b.shot,
          composition: b.composition,
          subjects: b.visualKind === 'GRAPHIC' ? [] : subjectsFor(b.composition),
          editorNote:
            i === 0
              ? treatment.textDelaySec > 0
                ? 'התמונה נוחתת לפני הטקסט; חיתוך מהיר לסצנה הבאה'
                : 'הטקסט נכנס כבר בשנייה הראשונה; חיתוך מהיר לסצנה הבאה'
              : b.role === 'CTA'
                ? 'הלוגו והקריאה לפעולה נשארים על המסך עד הסוף'
                : null,
        };
      }),
    };
  }
}
