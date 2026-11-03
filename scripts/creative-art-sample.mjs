// The three burger concepts (Phase 1) as composed 4:5 statics, with mock providers only (no AI, no cost).
// All three share ONE stand-in picture, so the differences come from art direction, not from imagery.
// Usage: npx tsc -b tsconfig.packages.json && node scripts/creative-art-sample.mjs [--out=dir]
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  MockCreativeLlmProvider,
  buildCampaignBrief,
  directCreative,
  directionInputFor,
  generateConcepts,
  reviewConceptSpread,
  reviewDirectionSet,
  withComposition,
} from '@kampora/creative-engine';
import { MockImageProvider } from '@kampora/media-providers';
import { STATIC_AD_FORMATS } from '@kampora/shared';
import { renderStaticAd } from '@kampora/video-renderer';

/** Fictional: invented for testing, not a real business (same facts as scripts/creative-sample.mjs). */
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
  brandColors: {
    primary: '#1F1A17',
    secondary: '#E0482B',
    accent: '#F4B63F',
    background: '#FFF7EC',
    text: '#1F1A17',
  },
  approvedClaims: ['טוחנים את הבשר במקום כל יום', 'לחמניית בריוש'],
  guidelines: ['פנייה ברבים'],
  pronunciation: [],
  fieldSources: { name: 'DEMO_SEED' },
};
const request = { goal: 'OFFER', productName: 'דאבל סמאש', offer: 'דאבל סמאש + צ׳יפס + שתייה ב-59 ₪' };
const out = path.resolve(
  process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? '.data/creative-art-sample',
);
mkdirSync(out, { recursive: true });

const brief = buildCampaignBrief({
  business,
  request,
  defaults: { budgetUsd: 5, qualityTier: 'standard', targetDurationSec: 20 },
});
const { conceptSet } = await generateConcepts(
  { business, brief },
  { provider: new MockCreativeLlmProvider() },
);

// One stand-in picture for all three concepts. Its subject box is the mock's disc, measured from the same seed.
const prompt = 'stand-in product photo #E0482B #F4B63F';
const pic = await new MockImageProvider().generate({ prompt, aspectRatio: '4:5' });
const [w, h] = [pic.width, pic.height];
const seed = createHash('sha256').update(prompt).digest();
const cx = 0.35 + (seed[6] / 255) * 0.3;
const cy = 0.45 + (seed[7] / 255) * 0.15;
const r = (Math.min(w, h) * (0.18 + (seed[8] / 255) * 0.08)) / w;
const ry = (r * w) / 0.9 / h;
const layout = {
  subject: { x: cx - r, y: cy - ry, w: 2 * r, h: 2 * ry },
  calm: cy - ry > 0.3 ? 'TOP' : 'NONE',
  focal: { x: cx, y: cy },
  composition: 'SINGLE_HERO',
  people: 'NONE',
  source: 'MANUAL',
};
const asset = {
  id: 'standin',
  kind: 'image',
  description: 'stand-in (mock)',
  tags: [],
  width: w,
  height: h,
  mimeType: 'image/png',
  source: 'AI_GENERATED',
  commercialUse: true,
  layout,
};

const server = createServer((_req, res) =>
  res.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' }).end(pic.data),
);
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const url = `http://127.0.0.1:${server.address().port}/standin.png`;

const size = STATIC_AD_FORMATS['4:5'];
const [priceText, label] = ['59 ₪', 'דאבל סמאש + צ׳יפס + שתייה'];
const report = [];
const chosenSpecs = [];
for (const concept of conceptSet.concepts) {
  const ad = {
    schemaVersion: 1,
    id: `burger-${concept.key}`,
    format: '4:5',
    width: size.width,
    height: size.height,
    locale: 'he-IL',
    direction: 'rtl',
    safeArea: size.safeArea,
    branding: { businessName: business.name, colors: business.brandColors, fontFamily: 'Heebo' },
    background: {
      assetId: asset.id,
      focalPoint: layout.focal,
      selection: { chosenBy: 'AUTO', authenticity: 'SYNTHETIC_AI', reasons: [] },
    },
    text: {
      headline: concept.copy.headline,
      ...(concept.copy.subheadline ? { subheadline: concept.copy.subheadline } : {}),
      price: { price: priceText, label },
      cta: concept.cta,
      ctaSubtext: business.address,
      showLogo: true,
    },
    assets: [
      {
        id: asset.id,
        kind: 'image',
        storageKey: 'standin.png',
        mimeType: 'image/png',
        provenance: { source: 'AI_GENERATED', license: 'mock', commercialUse: true },
      },
    ],
  };
  const ctx = { business, brief, concept, assets: [asset], formats: ['4:5'] };
  const input = directionInputFor(ad, ctx);
  const { set, reviews } = reviewDirectionSet(input, directCreative(input), {
    approvedClaims: business.approvedClaims,
  });
  const chosen = set.directions.find((d) => d.key === set.recommended) ?? set.directions[0];
  chosenSpecs.push({ concept: concept.title, spec: chosen.specs['4:5'] });
  const file = path.join(out, `${concept.key}.png`);
  await renderStaticAd({
    input: { ad: withComposition(ad, chosen.specs['4:5']), assetUrls: { [asset.id]: url } },
    outputPath: file,
    fileType: 'png',
  });
  report.push({
    concept: concept.title,
    hook: concept.copy.hookTechnique,
    direction: chosen.key,
    approach: chosen.approach,
    method: chosen.method,
    emphasis: chosen.emphasis,
    typeSystem: chosen.typeSystem,
    moves: chosen.moves,
    idea: chosen.idea,
    recommendedBecause: set.recommendedBecause,
    findings: [
      ...reviews[chosen.key]['4:5'].technical.results,
      ...reviews[chosen.key]['4:5'].creative.results,
    ]
      .filter((r) => r.severity !== 'OK')
      .map((r) => `${r.criterion} ${r.severity} (${r.method}): ${r.explanation}`),
    revisions: (reviews[chosen.key]['4:5'].history?.rounds ?? []).flatMap((r) =>
      r.revisions.filter((v) => v.status === 'APPLIED').map((v) => v.change),
    ),
    file,
  });
}
server.close();
const spread = reviewConceptSpread(chosenSpecs);
writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
writeFileSync(path.join(out, 'spread.json'), JSON.stringify(spread, null, 2));
console.log('concept spread:', spread.severity, spread.explanation, spread.evidence);
console.log(JSON.stringify(report, null, 2));
