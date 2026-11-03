// One burger video preview (Creative 3.0 / Phase 3): the craving concept cut by its own video treatment.
// Mock providers only: no AI, voice or video cost. The business has no photos, so photographic scenes get the
// mock image provider's stand-ins (as if the owner approved them, like the studio with IMAGE_PROVIDER=mock); they are
// labelled on screen. Narration is a SILENT placeholder at the estimated Hebrew speech length (no paid speech).
// Usage: npx tsc -b tsconfig.packages.json && node scripts/creative-video-sample.mjs [--concept=APPETITE] [--out=dir]
import { createServer } from 'node:http';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_PRICE_CATALOG, PriceCatalog } from '@kampora/cost-engine';
import { MockCreativeLlmProvider, buildCampaignBrief, generateConcepts, generateStoryboard } from '@kampora/creative-engine';
import { generateDemoMusicWav } from '@kampora/database';
import { estimateSpeechSec, normalizeHebrewForSpeech } from '@kampora/hebrew-voice';
import { MockImageProvider } from '@kampora/media-providers';
import { buildVideoProject, planProduction } from '@kampora/production-engine';
import { chunkCaption } from '@kampora/shared';
import { renderVideoProject } from '@kampora/video-renderer';

/** Fictional: invented for testing, not a real business (same facts as scripts/creative-art-sample.mjs). */
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
const request = { goal: 'OFFER', productName: 'דאבל סמאש', offer: 'דאבל סמאש + צ׳יפס + שתייה ב-59 ₪' };
const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const out = path.resolve(arg('out', '.data/creative-video-sample'));
const wanted = arg('concept', 'APPETITE');
mkdirSync(out, { recursive: true });

const provider = new MockCreativeLlmProvider();
const brief = buildCampaignBrief({ business, request, defaults: { budgetUsd: 5, qualityTier: 'standard', targetDurationSec: 20 } });
const { conceptSet } = await generateConcepts({ business, brief }, { provider });
const catalog = new PriceCatalog(DEFAULT_PRICE_CATALOG);
const fps = 30;

/** A silent mono 16-bit WAV: the narration placeholder (timing only). */
const silence = (sec) => {
  const n = Math.round(sec * 22_050);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(22_050, 24); b.writeUInt32LE(44_100, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
};

const files = new Map();
const report = [];
let chosen;
for (const concept of conceptSet.concepts) {
  const { storyboard } = await generateStoryboard({ business, brief, concept, assets: [] }, { provider });
  // The owner's stand-ins: one mock picture per photographic scene, approved for the preview only.
  const stills = storyboard.scenes.filter((s) => s.visualKind !== 'GRAPHIC');
  const standIns = [];
  for (const s of stills) {
    const pic = await new MockImageProvider().generate({ prompt: `${concept.key} ${s.key} ${s.visual}`, aspectRatio: '9:16' });
    const id = `standin-${concept.key}-${s.key}`;
    files.set(id, { data: pic.data, type: 'image/png' });
    standIns.push({ id, kind: 'image', description: `stand-in: ${s.visual}`, tags: [], width: pic.width, height: pic.height, mimeType: 'image/png', source: 'AI_GENERATED', commercialUse: true });
  }
  const approvedImages = Object.fromEntries(stills.map((s, i) => [s.key, standIns[i].id]));
  const plan = planProduction({ storyboard, assets: standIns, budgetUsd: 5, perGenerationMaxUsd: 1, qualityTier: 'standard', catalog, approvedImages });
  // Narration timing: the estimated length of each line as spoken (normalized Hebrew), not a recording.
  const voiceovers = {};
  const timing = [];
  for (const s of storyboard.scenes) {
    const spoken = normalizeHebrewForSpeech(s.voiceover, { pronunciation: business.pronunciation }).spoken;
    const sec = Math.round(estimateSpeechSec(spoken) * 100) / 100;
    const id = `voice-${concept.key}-${s.key}`;
    files.set(id, { data: silence(sec), type: 'audio/wav' });
    voiceovers[s.key] = { assetId: id, durationSec: sec };
    timing.push({ scene: s.key, plannedSec: s.durationSec, speechSec: sec });
  }
  const media = [...standIns, ...Object.values(voiceovers).map((v) => ({ id: v.assetId, kind: 'audio' }))].map((a) => ({
    id: a.id,
    kind: a.kind,
    storageKey: a.id,
    mimeType: a.kind === 'audio' ? 'audio/wav' : 'image/png',
    provenance: { source: a.kind === 'audio' ? 'PROGRAMMATIC' : 'AI_GENERATED', license: 'mock', commercialUse: true },
  }));
  media.push({ id: 'music-bed', kind: 'audio', storageKey: 'music-bed', mimeType: 'audio/wav', provenance: { source: 'PROGRAMMATIC', license: 'Synthesized by Kampora', commercialUse: true } });
  const project = buildVideoProject({ projectId: `burger-${concept.key}`, title: `${business.name} — ${concept.title}`, business, brief, storyboard, plan, assets: media, voiceovers, musicAssetId: 'music-bed', fps });
  const scenes = project.scenes.map((sc, i) => {
    const words = sc.caption?.text.split(/\s+/).filter(Boolean).length ?? 0;
    const secs = sc.durationInFrames / fps;
    const headline = sc.overlays.find((o) => o.type === 'headline');
    return {
      scene: sc.sourceSceneKey,
      role: storyboard.scenes[i].role,
      shot: storyboard.scenes[i].direction?.shot,
      visual: sc.visual.type === 'image-motion' ? `${sc.visual.motion.preset}@${sc.visual.motion.intensity}` : sc.visual.type,
      cutIn: `${sc.transition.type}/${sc.transition.durationInFrames}f`,
      sec: Math.round(secs * 10) / 10,
      ...timing[i],
      captionChunks: sc.caption ? chunkCaption(sc.caption.text, sc.durationInFrames, 4).length : 0,
      captionWordsPerSec: Math.round((words / secs) * 10) / 10,
      textEntersSec: headline ? Math.round((headline.delayFrames ?? 4) / fps * 100) / 100 : null,
      notice: sc.overlays.find((o) => o.type === 'notice')?.text ?? null,
    };
  });
  const row = {
    concept: concept.title,
    angle: concept.angle,
    treatment: storyboard.treatment,
    totalSec: Math.round((project.scenes.reduce((s, x) => s + x.durationInFrames, 0) / fps) * 10) / 10,
    scenes,
    shotList: plan.shotList,
    paidUsd: plan.estimatedPaidCostUsd,
  };
  report.push(row);
  if (storyboard.treatment?.idea === wanted) chosen = { project, row };
}
writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
for (const r of report) {
  console.log(`\n${r.concept} (${r.angle} → ${r.treatment.idea}): ${r.totalSec}s, paid $${r.paidUsd}`);
  for (const s of r.scenes) console.log(`  ${s.scene.padEnd(8)} ${String(s.shot).padEnd(17)} ${s.visual.padEnd(24)} in:${s.cutIn.padEnd(12)} ${s.sec}s (plan ${s.plannedSec}, speech ${s.speechSec}) ${s.captionWordsPerSec} w/s`);
}
if (!chosen) throw new Error(`No concept with treatment ${wanted}`);

files.set('music-bed', { data: generateDemoMusicWav(Math.ceil(chosen.row.totalSec) + 2), type: 'audio/wav' });
const server = createServer((req, res) => {
  const f = files.get(decodeURIComponent(req.url.slice(1)));
  if (!f) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': f.type, 'Access-Control-Allow-Origin': '*' }).end(f.data);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${server.address().port}/`;
const assetUrls = Object.fromEntries(chosen.project.assets.map((a) => [a.id, base + encodeURIComponent(a.id)]));
const outputPath = path.join(out, `burger-${wanted.toLowerCase()}-preview.mp4`);
try {
  const result = await renderVideoProject({ input: { project: chosen.project, assetUrls, scale: 1 }, outputPath, quality: 'preview' });
  console.log(`\n✓ ${outputPath} ${result.width}×${result.height}, ${result.durationSec.toFixed(1)}s, ${(statSync(outputPath).size / 1e6).toFixed(2)} MB`);
} finally {
  server.close();
}
