// Three concepts for one fictional burger restaurant, with the mock provider (no AI, no cost).
// Usage: npx tsc -b tsconfig.packages.json && node scripts/creative-sample.mjs [--goal=OFFER|PRODUCT_PROMO|AWARENESS] [--json]
import { MockCreativeLlmProvider, buildCampaignBrief, generateConcepts } from '@kampora/creative-engine';

/** Fictional: invented for testing, not a real business. */
const business = {
  name: 'בורגר האוס',
  category: 'המבורגריה',
  city: 'ראשון לציון',
  address: 'רוטשילד 40, ראשון לציון',
  description: 'המבורגריה שכונתית עם קציצות שנטחנות במקום ולחמניות בריוש.',
  products: [
    { name: 'דאבל סמאש', description: 'שתי קציצות דקות, צ׳דר, בצל מקורמל' },
    { name: 'צ׳יפס בטטה', description: 'צ׳יפס בטטה בתנור' },
  ],
  targetAudience: 'משפחות וצעירים בראשון לציון שמזמינים אוכל לערב',
  tone: 'friendly',
  brandColors: { primary: '#1F1A17', secondary: '#E0482B', accent: '#F4B63F', background: '#FFF7EC', text: '#1F1A17' },
  approvedClaims: ['טוחנים את הבשר במקום כל יום', 'לחמניית בריוש'],
  guidelines: ['פנייה ברבים'],
  pronunciation: [],
  fieldSources: { name: 'DEMO_SEED' },
};

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const goal = arg('goal', 'OFFER');
const request = {
  goal,
  productName: 'דאבל סמאש',
  ...(goal === 'OFFER' ? { offer: 'דאבל סמאש + צ׳יפס + שתייה ב-59 ₪' } : {}),
};
const brief = buildCampaignBrief({ business, request, defaults: { budgetUsd: 5, qualityTier: 'standard', targetDurationSec: 20 } });
const { conceptSet } = await generateConcepts({ business, brief }, { provider: new MockCreativeLlmProvider() });

if (process.argv.includes('--json')) console.log(JSON.stringify(conceptSet, null, 2));
else
  for (const c of conceptSet.concepts)
    console.log(
      [
        `## ${c.title}${c.key === conceptSet.recommendedKey ? ' (מומלץ)' : ''} · ${c.angle} · ${c.copy?.hookTechnique}`,
        `הוק: ${c.hook}`,
        `כותרת: ${c.copy?.headline}${c.copy?.subheadline ? ` / ${c.copy.subheadline}` : ''}`,
        `קריינות: ${c.voiceover}`,
        `CTA: ${c.cta}`,
        `תובנה: ${c.strategy?.insight}`,
        `המסר: ${c.mainMessage}`,
        '',
      ].join('\n'),
    );
