import type { BusinessProfile, CampaignRequest } from '@kampora/shared';

/**
 * Fictional demo business used for local development and tests. All facts are DEMO_SEED and invented for
 * the demo; they are not claims about any real business.
 */
export const DEMO_BUSINESS: BusinessProfile = {
  name: 'Luz',
  website: 'https://luz-coffee.example',
  category: 'בית קפה ומאפייה',
  city: 'תל אביב',
  address: 'פלורנטין 12, תל אביב',
  description: 'בית קפה שכונתי עם קלייה במקום ומאפים שנאפים כל בוקר.',
  products: [
    { name: 'קפה', description: 'אספרסו וקפה פילטר מפולים שנקלים במקום' },
    { name: 'מאפים', description: 'קרואסונים ומאפי שמרים טריים', price: { amount: 18, currency: 'ILS' } },
  ],
  targetAudience: 'צעירים ועובדים באזור פלורנטין, 22–40, שמחפשים קפה טוב בבוקר',
  tone: 'warm',
  brandColors: {
    primary: '#2B1B12',
    secondary: '#C8743A',
    accent: '#F2C14E',
    background: '#FBF5EC',
    text: '#1C140F',
  },
  approvedClaims: ['קולים את הפולים בעצמנו', 'מאפים טריים כל בוקר', 'פתוח כל יום מ-7:00'],
  guidelines: ['פנייה ברבים, בגובה העיניים', 'בלי סופרלטיבים שלא אושרו'],
  pronunciation: [{ term: 'Luz', spoken: 'לוּז', caseSensitive: false, note: 'שם המותג' }],
  fieldSources: { name: 'DEMO_SEED', approvedClaims: 'DEMO_SEED' },
};

export const DEMO_CAMPAIGN_REQUEST: CampaignRequest = {
  goal: 'OFFER',
  productName: 'קפה ומאפה',
  offer: 'קפה + מאפה ב-29.90 ₪ עד סוף החודש',
};
