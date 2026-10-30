import type { AvailableAsset, BusinessProfile, CampaignRequest } from '@kampora/shared';
import { DEMO_BUSINESS, DEMO_CAMPAIGN_REQUEST } from '../demo';

/**
 * The fixed evaluation set: fictional businesses (all facts invented for evaluation, not claims about real
 * businesses) covering the initial industries and goals. Inputs never change between runs, so results of two
 * expertise versions are comparable. Assets are metadata only (no pixels).
 */
export interface EvalScenario {
  id: string;
  label: string;
  business: BusinessProfile;
  request: CampaignRequest;
  assets: AvailableAsset[];
  /** What a professional would expect; checked deterministically by the evaluation. */
  expect: {
    industryId: string;
    /** The ad's primary focal element for an Art Director. */
    focal: Array<'PRICE' | 'PRODUCT' | 'HEADLINE' | 'PEOPLE' | 'PLACE' | 'CTA'>;
    /** Words the offer subjects must contain (product relevance). */
    offerSubjects?: string[];
  };
}

const img = (
  id: string,
  description: string,
  tags: string[],
  source: AvailableAsset['source'] = 'CUSTOMER_UPLOAD',
): AvailableAsset => ({
  id,
  kind: 'image',
  description,
  tags,
  width: 1600,
  height: 1200,
  mimeType: 'image/jpeg',
  source,
  commercialUse: true,
});

export const EVAL_SCENARIOS: readonly EvalScenario[] = [
  {
    id: 'cafe-offer',
    label: 'בית קפה – מבצע קפה ומאפה',
    business: DEMO_BUSINESS,
    request: DEMO_CAMPAIGN_REQUEST,
    assets: [
      img('cafe-ai-hook', 'קפה ומאפה על השולחן באור בוקר', ['hero', 'coffee', 'pastry'], 'AI_GENERATED'),
      img('cafe-ai-product', 'מגוון מאפים על הדלפק', ['product'], 'AI_GENERATED'),
    ],
    expect: { industryId: 'cafe-restaurant', focal: ['PRICE'], offerSubjects: ['קפה', 'מאפה'] },
  },
  {
    id: 'fitness-leads',
    label: 'סטודיו פילאטיס – לידים לשיעור ניסיון',
    business: {
      name: 'נשימה',
      category: 'סטודיו פילאטיס',
      city: 'חיפה',
      address: 'מוריה 40, חיפה',
      description: 'סטודיו פילאטיס מכשירים לנשים בכרמל, קבוצות קטנות ומדריכות מוסמכות.',
      products: [
        { name: 'שיעור פילאטיס מכשירים', description: 'שיעור קבוצתי של 55 דקות' },
        { name: 'שיעור ניסיון', description: 'שיעור ראשון להיכרות', price: { amount: 49, currency: 'ILS' } },
      ],
      targetAudience: 'נשים 30–55 בכרמל שרוצות להתחיל להתאמן בקצב שלהן',
      tone: 'friendly',
      brandColors: {
        primary: '#1F3A3D',
        secondary: '#7FB7A4',
        accent: '#F4B860',
        background: '#F6F3EE',
        text: '#14211F',
      },
      approvedClaims: ['קבוצות של עד 6 מתאמנות', 'מדריכות מוסמכות'],
      guidelines: ['לא מבטיחים ירידה במשקל', 'פנייה בלשון נקבה ברבים'],
      pronunciation: [],
      fieldSources: {},
    },
    request: { goal: 'LEADS', productName: 'שיעור ניסיון', offer: 'שיעור ניסיון ב-49 ₪' },
    assets: [],
    expect: { industryId: 'fitness', focal: ['HEADLINE', 'PRICE'] },
  },
  {
    id: 'premium-product',
    label: 'שמן זית בוטיק – קידום מוצר פרימיום',
    business: {
      name: 'זית הגליל',
      category: 'מותג שמן זית – חנות אונליין',
      description: 'שמן זית כתית מעולה מכרם משפחתי בגליל, נמסק ונכבש באותו יום.',
      products: [
        {
          name: 'שמן זית כתית מעולה 500 מ"ל',
          description: 'בקבוק זכוכית כהה',
          price: { amount: 89, currency: 'ILS' },
        },
      ],
      targetAudience: 'אוהבי בישול ומתנות איכותיות, 30–60',
      tone: 'premium',
      brandColors: {
        primary: '#2F3B1E',
        secondary: '#8A9A5B',
        accent: '#C9A227',
        background: '#F4F1E8',
        text: '#1E2414',
      },
      approvedClaims: ['נמסק ונכבש באותו יום', 'מכרם משפחתי בגליל'],
      guidelines: ['שפה מאופקת, בלי צעקות'],
      pronunciation: [],
      fieldSources: { description: 'INFERRED_UNCONFIRMED' },
    },
    request: { goal: 'PRODUCT_PROMO', productName: 'שמן זית כתית מעולה' },
    assets: [img('olive-photo', 'בקבוק שמן זית על שולחן עץ', ['product', 'bottle'])],
    expect: { industryId: 'ecommerce', focal: ['PRODUCT'] },
  },
  {
    id: 'local-service',
    label: 'אינסטלטור שכונתי – פניות',
    business: {
      name: 'יוסי אינסטלציה',
      category: 'אינסטלטור',
      city: 'רמת גן',
      description: 'אינסטלטור מוסמך ברמת גן וגבעתיים, תיקוני נזילות וסתימות.',
      products: [{ name: 'תיקון נזילה', description: 'איתור ותיקון נזילות בבית' }],
      targetAudience: 'משפחות ודיירים ברמת גן וגבעתיים',
      tone: 'professional',
      brandColors: {
        primary: '#0F2A4A',
        secondary: '#3D7DCA',
        accent: '#FFC845',
        background: '#F2F5F9',
        text: '#0B1726',
      },
      approvedClaims: ['אינסטלטור מוסמך', 'מגיעים באותו יום ברמת גן וגבעתיים'],
      guidelines: [],
      pronunciation: [],
      fieldSources: {},
    },
    request: { goal: 'LEADS', productName: 'תיקון נזילה' },
    assets: [],
    expect: { industryId: 'local-services', focal: ['HEADLINE'] },
  },
  {
    id: 'ecommerce-launch',
    label: 'מותג נעליים – השקת קולקציה',
    business: {
      name: 'קו',
      category: 'מותג נעליים – חנות אונליין',
      description: 'נעלי סניקרס מעור טבעי בעיצוב מינימליסטי, משלוח עד הבית.',
      products: [
        {
          name: 'סניקרס קו לבן',
          description: 'עור טבעי, סוליית גומי',
          price: { amount: 420, currency: 'ILS' },
        },
      ],
      targetAudience: 'אנשים 25–45 שאוהבים עיצוב נקי',
      tone: 'energetic',
      brandColors: {
        primary: '#111111',
        secondary: '#E8E2D6',
        accent: '#FF5A36',
        background: '#FAFAF7',
        text: '#111111',
      },
      approvedClaims: ['עור טבעי', 'משלוח עד הבית'],
      guidelines: [],
      pronunciation: [],
      fieldSources: {},
    },
    request: { goal: 'SALES', productName: 'סניקרס קו לבן', offer: '15% הנחה על הקולקציה החדשה עד 30.11' },
    assets: [img('sneaker-photo', 'נעל סניקרס לבנה על רקע נקי', ['product', 'sneaker'])],
    expect: { industryId: 'ecommerce', focal: ['PRICE', 'PRODUCT'], offerSubjects: ['סניקרס'] },
  },
];
