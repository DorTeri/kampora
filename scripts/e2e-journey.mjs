// End-to-end journey against a running API + worker, following the Phase 3 production chain:
// brief → creative strategy → approved concept → storyboard → visual planning → asset selection → AI images
// (when approved) → voice direction → Hebrew narration → motion planning → timeline → final render → QA → download,
// plus static image ads (1:1, 4:5, 9:16) from the same approved script.
//
// Usage:
//   node scripts/e2e-journey.mjs [preview|final] [--out=<dir>]          mock providers, no cost
//   node scripts/e2e-journey.mjs final --approve-paid [--max-usd=1]     REAL providers: sends the quoted approvals.
//     Only run this after the spend was explicitly approved. Every quote is printed before it is used, and the
//     script refuses to approve more than --max-usd (default 1.00 USD) in total. The API's kill switch and budget
//     checks still apply on top of this.
//
// Writes a JSON report, the downloaded MP4, one frame per scene and the static ads to --out (default: a temp dir).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = process.env.KAMPORA_API_URL ?? 'http://localhost:4000';
const TOKEN = process.env.KAMPORA_API_TOKEN ?? process.env.DEV_API_TOKEN ?? 'dev-kampora-token';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const quality = args.includes('preview') ? 'preview' : 'final';
const approvePaid = args.includes('--approve-paid');
const voiceArg = flag('voice');
const styleArg = flag('style');
const maxUsd = Number(flag('max-usd') ?? 1);
const out = flag('out') ?? mkdtempSync(path.join(os.tmpdir(), 'kampora-e2e-'));
mkdirSync(out, { recursive: true });
let approvedTotal = 0;
const report = { startedAt: new Date().toISOString(), quality, stages: [] };

async function request(method, p, body) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function call(method, p, body) {
  const { status, json } = await request(method, p, body);
  if (status >= 400) throw new Error(`${method} ${p} → ${status} ${JSON.stringify(json)}`);
  return json;
}
const get = (p) => call('GET', `/v1${p}`);
const post = (p, body) => call('POST', `/v1${p}`, body);
const step = (msg) => console.log(`  • ${msg}`);
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  writeFileSync(path.join(out, 'journey-report.json'), JSON.stringify({ ...report, failed: msg }, null, 2));
  process.exit(1);
};
const expect = (ok, msg) => ok || fail(msg);
let stageNo = 0;
const stage = (name, facts = {}) => {
  console.log(`\n${++stageNo}. ${name}`);
  report.stages.push({ stage: name, ...facts });
  return report.stages.at(-1);
};
const approveSpend = (label, usd) => {
  if (!approvePaid)
    fail(`${label} costs ~$${usd} — rerun with --approve-paid only after the spend was approved`);
  if (approvedTotal + usd > maxUsd) fail(`${label}: approving $${usd} would exceed --max-usd=${maxUsd}`);
  approvedTotal += usd;
  step(`APPROVED paid ${label}: up to $${usd.toFixed(2)} (running total $${approvedTotal.toFixed(2)})`);
  return usd;
};
const poll = async (fn, done, label, timeoutMs = 10 * 60_000) => {
  const deadline = Date.now() + timeoutMs;
  let value = await fn();
  while (!done(value)) {
    if (Date.now() > deadline) fail(`${label} timed out`);
    await new Promise((r) => setTimeout(r, 1500));
    value = await fn();
  }
  return value;
};
const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const download = async (url, file) => {
  const res = await fetch(url);
  expect(res.ok, `download ${url} → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (file) writeFileSync(file, buf);
  return { buf, disposition: res.headers.get('content-disposition') ?? '' };
};
const probe = (file) =>
  JSON.parse(
    execFileSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString(),
  );

// ── Platform guards ────────────────────────────────────────────────
const health = await fetch(`${API}/health`).then((r) => r.json());
expect(health.status === 'ok', 'API not healthy');
expect((await fetch(`${API}/v1/businesses`)).status === 401, 'expected 401 without token');
const [business] = await get('/businesses');
expect(business, 'no business; run npm run db:seed');
console.log(`Journey for "${business.name}" (${quality}) → ${out}`);

// ── 1. Business brief ──────────────────────────────────────────────
const creative = await get('/creative/quote');
expect(creative.ready, `creative provider not ready: ${creative.reason}`);
const campaignBody = { goal: 'OFFER', productName: 'קפה ומאפה', offer: 'קפה + מאפה ב-29.90 ₪ עד סוף החודש' };
stage('Business brief', { provider: `${creative.provider}/${creative.model}`, paid: creative.paid });
const invalid = await request('POST', `/v1/businesses/${business.id}/campaigns`, { goal: 'NOPE' });
expect(invalid.status === 400, 'invalid brief must be 400');
step('invalid brief rejected (400)');
if (creative.paid) {
  const refused = await request('POST', `/v1/businesses/${business.id}/campaigns`, campaignBody);
  expect(
    ['PAID_APPROVAL_REQUIRED', 'PAID_GENERATION_DISABLED'].includes(refused.json?.code),
    'paid creative without approval must be refused',
  );
  step(`paid creative without approval refused (${refused.json.code})`);
}
const campaign = await post(`/businesses/${business.id}/campaigns`, {
  ...campaignBody,
  aiApprovalUsd: creative.paid ? approveSpend('creative AI', creative.maxUsd) : undefined,
});
step(`brief: goal ${campaign.brief.goal}, key message "${campaign.brief.keyMessage}"`);

// ── 2. Creative strategy ───────────────────────────────────────────
const concepts = campaign.concepts;
const strategyStage = stage('Creative strategy', { concepts: concepts.length });
expect(concepts.length === 3, 'expected 3 concepts');
expect(new Set(concepts.map((c) => c.concept.angle)).size === 3, 'concepts must use different angles');
for (const c of concepts) {
  const st = c.concept.strategy;
  expect(st, `concept ${c.concept.key} has no strategy`);
  step(
    `[${c.concept.angle}] ${c.concept.title} · ${st.productionFormat} · voice ${st.voiceStyle}: "${c.concept.hook}"`,
  );
}
strategyStage.angles = concepts.map((c) => c.concept.angle);

// ── 3. Approved concept ────────────────────────────────────────────
const recommended = concepts.find((c) => c.isRecommended);
stage('Approved concept', { angle: recommended.concept.angle, reason: recommended.recommendationReason });
const { projectId } = await post(`/campaigns/${campaign.id}/concepts/${recommended.id}/select`);
const again = await post(`/campaigns/${campaign.id}/concepts/${recommended.id}/select`);
expect(again.projectId === projectId, 'selecting the same concept twice must return the same project');
step(`selected "${recommended.concept.title}" → project ${projectId} (idempotent)`);
report.projectId = projectId;

// ── 4. Storyboard ──────────────────────────────────────────────────
let project = await get(`/projects/${projectId}`);
const scenes = [...project.storyboard.scenes].sort((a, b) => a.order - b.order);
stage('Storyboard', { scenes: scenes.map((s) => `${s.key}:${s.role}`) });
for (const s of scenes)
  step(`[${s.key}/${s.role}] ${s.durationSec}s ${s.direction?.shot ?? ''} — ${s.voiceover}`);
expect(
  scenes[0].role === 'HOOK' && scenes.at(-1).role === 'CTA',
  'storyboard must open with a hook and close with a CTA',
);

// ── 5. Visual planning + 6. Asset selection ───────────────────────
const planned = Object.fromEntries(project.plan.scenes.map((p) => [p.sceneKey, p.strategy]));
stage('Visual planning', { strategies: planned });
for (const s of scenes) step(`${s.key}: ${planned[s.key]}`);
const reused = project.plan.scenes.filter((p) => p.assetIds.length > 0).map((p) => p.sceneKey);
const needImage = project.plan.scenes
  .filter((p) => p.strategy === 'AI_IMAGE_MOTION' && p.assetIds.length === 0)
  .map((p) => p.sceneKey);
stage('Asset selection', { reusedScenes: reused, needImage });
step(`existing business media reused in ${reused.length} scene(s): ${reused.join(', ') || '—'}`);
step(`scenes still needing an AI image: ${needImage.join(', ') || '—'}`);
expect(project.plan.withinBudget, 'plan exceeds the project budget');

// Script approval gate: nothing is recorded or produced before it.
const early = await request('POST', `/v1/projects/${projectId}/renders`, { quality });
expect(early.status === 409, 'render before approval must be 409');
const earlyApprove = await request('POST', `/v1/projects/${projectId}/approve`);
expect(earlyApprove.json?.code === 'SCRIPT_NOT_APPROVED', 'approve before script approval must be refused');
project = await post(`/projects/${projectId}/approve-script`);
expect(project.scriptApprovedAt, 'script approval not stored');
step('script approved (render and production approval before it were refused)');

// ── 7. AI image generation (when approved) ────────────────────────
const images = await get(`/projects/${projectId}/images`);
const imageStage = stage('AI image generation', {
  provider: images.provider,
  paid: images.paid,
  generated: [],
});
if (needImage.length && !images.ready)
  step(`image provider not ready — ${needImage.length} scene(s) fall back to graphics`);
const waitImage = (id) =>
  poll(
    async () => (await get(`/projects/${projectId}/images`)).images.find((i) => i.id === id),
    (i) => i && !['QUEUED', 'RUNNING'].includes(i.status),
    `image ${id}`,
  );
const generate = async (sceneKey) => {
  const quote = (await get(`/projects/${projectId}/images`)).scenes.find((q) => q.sceneKey === sceneKey);
  step(
    `${sceneKey}: quote $${quote.estimatedUsd} (paid=${quote.paid}, uses ${quote.referenceCount} photo(s))`,
  );
  if (quote.paid) {
    const refused = await request('POST', `/v1/projects/${projectId}/scenes/${sceneKey}/image`, {});
    expect(
      ['APPROVAL_REQUIRED', 'PAID_DISABLED'].includes(refused.json?.code),
      'paid image without approval must be refused',
    );
    step(`paid image without approval refused (${refused.json.code})`);
  }
  const started = await post(`/projects/${projectId}/scenes/${sceneKey}/image`, {
    approvedUsd: quote.paid ? approveSpend(`image ${sceneKey}`, quote.estimatedUsd) : undefined,
  });
  const done = await waitImage(started.id);
  expect(done.status === 'SUCCEEDED', `image ${sceneKey} failed: ${done.error}`);
  const { buf } = await download(done.url);
  imageStage.generated.push({ sceneKey, version: done.version, sha: sha(buf), chargeType: done.chargeType });
  return { ...done, sha: sha(buf) };
};
// Scenes that need a picture get one; when the business's own media covers every scene, one eligible scene gets an
// optional AI image anyway, the way an owner would try one, so this stage is always exercised.
const optional = images.scenes.find((q) => q.eligible)?.sceneKey;
const imageScenes = needImage.length ? needImage : optional ? [optional] : [];
if (images.ready && !needImage.length && optional)
  step(`no scene needs an image; trying an optional one for ${optional}`);
if (images.ready) {
  for (const [i, sceneKey] of imageScenes.entries()) {
    let img = await generate(sceneKey);
    if (i === 0) {
      // Selective regeneration: reject the first take and ask for another; it must be a different picture.
      await post(`/projects/${projectId}/images/${img.id}/decision`, { decision: 'REJECTED' });
      const next = await generate(sceneKey);
      expect(next.sha !== img.sha, `regenerated ${sceneKey} image is identical to the rejected one`);
      step(`${sceneKey}: v${img.version} rejected → v${next.version} is a different take`);
      img = next;
    }
    await post(`/projects/${projectId}/images/${img.id}/decision`, { decision: 'APPROVED' });
    step(`${sceneKey}: v${img.version} approved`);
  }
  project = await get(`/projects/${projectId}`);
  const missing = project.plan.scenes.filter(
    (p) => p.strategy === 'AI_IMAGE_MOTION' && p.assetIds.length === 0,
  );
  expect(missing.length === 0, `scenes still without an image: ${missing.map((p) => p.sceneKey)}`);
}

// ── 8. Voice direction ─────────────────────────────────────────────
const voices = await get('/voices');
expect(voices.ready, `voice provider not ready: ${voices.reason}`);
const voice = voices.voices.find((v) => v.id === voiceArg) ?? voices.voices[0];
const style = styleArg ?? project.concept.strategy?.voiceStyle ?? 'natural';
const quote = await get(
  `/projects/${projectId}/narration/quote?voiceId=${encodeURIComponent(voice.id)}&mode=continuous&style=${style}`,
);
stage('Voice direction', { voice: voice.id, style, mode: 'continuous', estimatedUsd: quote.estimatedUsd });
step(`voice ${voice.id} (${voices.provider}), style "${style}" from the concept, one continuous take`);
step(
  `quote: ${quote.characters} chars, ~${quote.estimatedSec}s, $${quote.estimatedUsd} (${quote.scriptCheck.status})`,
);
for (const l of quote.lines) step(`  spoken [${l.sceneKey}] ${l.spoken}`);

// ── 9. Hebrew narration ────────────────────────────────────────────
const narrationStage = stage('Hebrew narration');
const narrationBody = { voiceId: voice.id, mode: 'continuous', style };
if (quote.paid) {
  const refused = await request('POST', `/v1/projects/${projectId}/narration`, narrationBody);
  expect(
    ['PAID_APPROVAL_REQUIRED', 'PAID_GENERATION_DISABLED'].includes(refused.json?.code),
    'paid narration without approval must be refused',
  );
  step(`paid narration without approval refused (${refused.json.code})`);
}
await post(`/projects/${projectId}/narration`, {
  ...narrationBody,
  approvedUsd: quote.paid ? approveSpend('narration', quote.estimatedUsd) : undefined,
});
const narrationDone = (n) => n?.status === 'READY' || n?.status === 'FAILED';
const readNarration = async () => (await get(`/projects/${projectId}`)).narration;
const narration = await poll(readNarration, narrationDone, 'narration');
expect(narration.status === 'READY', `narration failed: ${narration.error}`);
for (const s of narration.segments)
  step(`[${s.sceneKey}] ${s.durationSec}s · ${s.cues.length} caption cue(s) · timing=${s.timing}`);
step(`narration ready: ${narration.totalSec}s`);
narrationStage.totalSec = narration.totalSec;
if (!quote.paid) {
  await post(`/projects/${projectId}/narration`, narrationBody);
  const repeat = await poll(readNarration, narrationDone, 'narration (repeat)');
  expect(
    repeat.segments.every((s) => s.cached),
    'an identical narration request must reuse the recorded audio',
  );
  step('identical request reused the recorded audio');
}

// ── 10. Motion planning + 11. Timeline ─────────────────────────────
await post(`/projects/${projectId}/approve`);
project = await get(`/projects/${projectId}`);
const timeline = project.timeline;
expect(timeline, 'approved project has no timeline summary');
stage('Motion planning', {
  scenes: timeline.scenes.map((s) => ({
    scene: s.sceneKey,
    visual: s.visual,
    motion: s.motion,
    in: s.transition,
  })),
});
for (const s of timeline.scenes)
  step(
    `${s.sceneKey}: ${s.visual}${s.motion ? ` · ${s.motion}` : ''} · ${s.transition} in · picture ${s.pictureSource ?? '—'}`,
  );
const motions = timeline.scenes.filter((s) => s.motion).map((s) => s.motion);
expect(motions.length < 3 || new Set(motions).size > 1, 'every picture scene got the same camera move');
stage('Timeline', { version: project.versions[0].version, totalSec: timeline.totalSec });
step(
  `timeline v${project.versions[0].version}: ${timeline.totalSec}s for ${narration.totalSec}s of narration`,
);
expect(timeline.totalSec + 0.05 >= narration.totalSec, 'timeline is shorter than its narration');
// A narrated scene always has captions, except the CTA scene when its card already shows what is said.
for (const s of timeline.scenes)
  expect(
    !s.narrated || s.captionCues > 0 || s.overlays.includes('cta'),
    `scene ${s.sceneKey} is narrated but has no captions`,
  );
const reapproved = await post(`/projects/${projectId}/approve`);
expect(
  reapproved.versions[0].version === project.versions[0].version,
  're-approving an unchanged project must not create a new timeline version',
);
step('re-approval with nothing changed kept the same timeline version');

// ── 12. Final render ───────────────────────────────────────────────
stage('Final render', { quality });
let render = await post(`/projects/${projectId}/renders`, { quality });
const repeatRender = await post(`/projects/${projectId}/renders`, { quality });
expect(repeatRender.id === render.id, 'render request is not idempotent');
render = await poll(
  () => get(`/renders/${render.id}`),
  (r) => r.status === 'SUCCEEDED' || r.status === 'FAILED',
  'render',
);
expect(render.status === 'SUCCEEDED', `render failed: ${render.error}`);
step(
  `render: ${render.width}×${render.height}, ${render.durationSec}s, ${(render.outputBytes / 1e6).toFixed(2)} MB`,
);

// ── 13. QA ─────────────────────────────────────────────────────────
project = await get(`/projects/${projectId}`);
const qa = project.timelineQa;
stage('QA', { timeline: qa.map((i) => `${i.severity}:${i.code}`) });
const qaErrors = qa.filter((i) => i.severity === 'error');
expect(qaErrors.length === 0, `timeline QA errors: ${qaErrors.map((i) => i.code)}`);
step(`timeline QA: ${qa.length ? qa.map((i) => `${i.severity} ${i.code}`).join(', ') : 'clean'}`);
expect(render.durationSec + 0.5 >= narration.totalSec, 'video is shorter than its narration');

// ── 14. Download ───────────────────────────────────────────────────
const mp4 = path.join(out, `journey-${quality}.mp4`);
const video = await download(render.downloadUrl, mp4);
expect(video.disposition.startsWith('attachment'), 'download URL is not an attachment');
const info = probe(mp4);
const v = info.streams.find((s) => s.codec_type === 'video');
const a = info.streams.find((s) => s.codec_type === 'audio');
expect(v && a, 'MP4 must contain video and audio');
const duration = Number(info.format.duration);
stage('Download', {
  file: mp4,
  width: v.width,
  height: v.height,
  codec: v.codec_name,
  durationSec: duration,
});
step(`MP4 ${v.width}×${v.height} ${v.codec_name} + ${a.codec_name}, ${duration.toFixed(2)}s → ${mp4}`);
const tampered = await fetch(render.streamUrl.replace(/sig=[^&]+/, 'sig=AAAA'));
expect(tampered.status === 403, 'tampered signature must be 403');
step('signed URL tampering rejected (403)');
// One frame from the middle of each scene, for people to look at: tests cannot judge the picture.
let at = 0;
const frames = [];
for (const s of timeline.scenes) {
  const file = path.join(out, `frame-${String(frames.length + 1).padStart(2, '0')}-${s.sceneKey}.png`);
  const seek = String(Math.min(at + s.seconds / 2, duration - 0.1));
  execFileSync(FFMPEG, ['-loglevel', 'error', '-y', '-ss', seek, '-i', mp4, '-frames:v', '1', file]);
  frames.push(file);
  at += s.seconds;
}
step(`${frames.length} scene frames saved for review`);

// ── Static image ads from the same script ──────────────────────────
const staticStage = stage('Static image ads');
await post(`/projects/${projectId}/static-ads`, {});
const ads = await poll(
  () => get(`/projects/${projectId}/static-ads`),
  (r) => r.ads.length === 3 && r.ads.every((ad) => !['QUEUED', 'RUNNING'].includes(ad.status)),
  'static ads',
);
staticStage.ads = [];
for (const ad of ads.ads) {
  expect(ad.status === 'SUCCEEDED', `static ad ${ad.format} failed: ${ad.error}`);
  const base = path.join(out, `ad-${ad.format.replace(':', 'x')}`);
  for (const [ext, url] of [
    ['png', ad.pngDownloadUrl],
    ['jpg', ad.jpegDownloadUrl],
  ]) {
    const file = await download(url, `${base}.${ext}`);
    expect(file.disposition.startsWith('attachment'), `${ad.format} ${ext} is not an attachment`);
    const s = probe(`${base}.${ext}`).streams[0];
    expect(
      s.width === ad.width && s.height === ad.height,
      `${ad.format} ${ext} is ${s.width}×${s.height}, expected ${ad.width}×${ad.height}`,
    );
  }
  const codes = ad.qa.map((q) => q.code);
  staticStage.ads.push({
    format: ad.format,
    size: `${ad.width}x${ad.height}`,
    headline: ad.text.headline,
    qa: codes,
  });
  step(
    `${ad.format} ${ad.width}×${ad.height} PNG+JPEG · "${ad.text.headline}" · QA: ${codes.join(', ') || 'clean'}`,
  );
}
const rebuilt = await post(`/projects/${projectId}/static-ads`, {});
expect(
  rebuilt.ads.every((ad) => ad.version === 1),
  'rebuilding unchanged static ads must reuse version 1',
);
step('rebuilding with nothing changed reused every version');

// ── Costs ──────────────────────────────────────────────────────────
const costs = await get(`/projects/${projectId}/costs`);
const usd = costs.byChargeTypeUsd;
report.costs = {
  ...usd,
  entries: costs.entries,
  reuseHits: costs.reuseHits,
  approvedByThisRun: approvedTotal,
};
console.log(
  `\nCosts: simulated $${usd.SIMULATED.toFixed(4)} · estimated $${usd.ESTIMATED.toFixed(4)} · confirmed $${usd.CONFIRMED.toFixed(4)} (${costs.entries} ledger lines, ${costs.reuseHits} reuse hits)`,
);
if (!approvePaid)
  expect(
    usd.CONFIRMED === 0 && usd.ESTIMATED === 0,
    'a run without --approve-paid must not record real charges',
  );

report.finishedAt = new Date().toISOString();
writeFileSync(path.join(out, 'journey-report.json'), JSON.stringify(report, null, 2));
console.log(`\n✓ journey passed — project ${projectId}\n  outputs: ${out}`);
