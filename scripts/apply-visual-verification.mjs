// Folds a visual verification pass into the reference research files (out/q7/refs/*.json), then regenerate the
// library with scripts/build-reference-library.mjs.
// Usage: node scripts/apply-visual-verification.mjs <findings.json> [<findings.json> ...] [--refs out/q7/refs]
//
// A finding counts as visual verification only if the work itself was seen with HIGH or MEDIUM confidence. Then:
// analysisBasis → IMAGES_VIEWED, visualAnalysis recorded, the design moves become the ones seen (moves the
// images contradict are dropped), visually derived principles lead, corrections are kept next to the old claims.
// Anything else stays text-only with a note of the attempt. No image or image URL is stored.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const refsIdx = args.indexOf('--refs');
const refsDir = refsIdx >= 0 ? args[refsIdx + 1] : 'out/q7/refs';
const inputs = args.filter((_, i) => refsIdx < 0 || (i !== refsIdx && i !== refsIdx + 1));
const today = new Date().toISOString().slice(0, 10);

const findings = new Map(inputs.flatMap((f) => JSON.parse(readFileSync(f, 'utf8'))).map((f) => [f.id, f]));
const stats = { verified: 0, partial: 0, notVerified: 0, untouched: 0, corrections: 0 };

for (const file of readdirSync(refsDir).filter((f) => f.endsWith('.json'))) {
  const full = path.join(refsDir, file);
  const refs = JSON.parse(readFileSync(full, 'utf8'));
  for (const r of refs) {
    const f = findings.get(r.id);
    if (!f) {
      stats.untouched++;
      continue;
    }
    const seen = f.visuallyVerified && f.visual && ['HIGH', 'MEDIUM'].includes(f.confidence);
    if (!seen) {
      r.visualCheck = {
        attemptedAt: today,
        outcome: f.visuallyVerified ? `seen only partially (${f.confidence} confidence): ${f.whatWasSeen}` : f.reasonIfNot || 'the work could not be viewed',
      };
      delete r.visualAnalysis;
      if (f.visuallyVerified) stats.partial++;
      else stats.notVerified++;
      continue;
    }
    const v = f.visual;
    r.analysisBasis = 'IMAGES_VIEWED';
    r.visualAnalysis = {
      viewedAt: today,
      viewedUrls: f.verifiedUrls,
      whatWasSeen: f.whatWasSeen,
      confidence: f.confidence,
      composition: v.composition,
      hierarchy: v.hierarchy,
      typography: v.typography,
      gridAndSpacing: v.gridAndSpacing,
      photography: v.photography,
      colorRelationships: v.colorRelationships,
      productPlacement: v.productPlacement,
      negativeSpace: v.negativeSpace,
      brandExpression: v.brandExpression,
      distinctiveDecisions: v.distinctiveDecisions,
    };
    r.corrections = f.corrections ?? [];
    stats.corrections += r.corrections.length;
    // The descriptive fields now say what the work shows; the old claims survive in `corrections` where wrong.
    r.composition = v.composition;
    r.typography = v.typography;
    r.colorSystem = v.colorRelationships;
    r.hierarchy = v.hierarchy;
    r.imageTreatment = v.photography;
    r.balance = v.gridAndSpacing;
    const contradicted = new Set(f.designMovesContradicted ?? []);
    r.designMoves = f.designMovesSeen?.length ? [...new Set(f.designMovesSeen)] : r.designMoves.filter((m) => !contradicted.has(m));
    const visualPrinciples = (f.visualPrinciples ?? []).filter((p) => p.text?.length >= 10 && p.when);
    r.principles = [...visualPrinciples, ...r.principles.filter((p) => !visualPrinciples.some((q) => q.text === p.text))];
    delete r.visualCheck;
    stats.verified++;
  }
  writeFileSync(full, JSON.stringify(refs, null, 1) + '\n');
}
console.log(JSON.stringify(stats));
