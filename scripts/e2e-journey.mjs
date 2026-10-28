// End-to-end journey against a running API + worker:
// business → campaign (brief + AI concepts) → select → AI storyboard/plan → approve script → narration
// (normalize → TTS → ffprobe → cues) → approve production (retimed timeline) → render → download → costs.
//
// Usage:
//   node scripts/e2e-journey.mjs [preview|final]                       mock providers, no cost
//   node scripts/e2e-journey.mjs final --approve-paid --voice=<id>     REAL providers: sends the quoted approvals.
//     Only run this after the spend was explicitly approved. It prints every quote before using it and refuses
//     to approve more than --max-usd (default 1.00 USD) in total.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = process.env.KAMPORA_API_URL ?? 'http://localhost:4000';
const TOKEN = process.env.KAMPORA_API_TOKEN ?? 'dev-kampora-token';
const args = process.argv.slice(2);
const quality = args.includes('final') ? 'final' : 'preview';
const approvePaid = args.includes('--approve-paid');
const voiceArg = args.find((a) => a.startsWith('--voice='))?.slice(8);
const maxUsd = Number(args.find((a) => a.startsWith('--max-usd='))?.slice(10) ?? 1);
let approvedTotal = 0;

async function request(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function call(method, path, body) {
  const { status, json } = await request(method, path, body);
  if (status >= 400) throw new Error(`${method} ${path} → ${status} ${JSON.stringify(json)}`);
  return json;
}
const step = (msg) => console.log(`• ${msg}`);
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
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
  let last = '';
  while (!done(value)) {
    if (Date.now() > deadline) fail(`${label} timed out`);
    await new Promise((r) => setTimeout(r, 2000));
    value = await fn();
    const status =
      label === 'render'
        ? `${value.stage} ${Math.round(value.progress * 100)}%`
        : `${value?.status} ${value?.segments?.length ?? 0} segments`;
    if (status !== last) step(`  ${label}: ${(last = status)}`);
  }
  return value;
};

const health = await fetch(`${API}/health`).then((r) => r.json());
if (health.status !== 'ok') fail('API not healthy');
if ((await fetch(`${API}/v1/businesses`)).status !== 401) fail('expected 401 without token');
step('auth: request without token rejected (401)');

const [business] = await call('GET', '/v1/businesses');
if (!business) fail('no business; run npm run db:seed');
step(`business: ${business.name}`);

// ── Creative (concepts + storyboard) ────────────────────────────────
const creative = await call('GET', '/v1/creative/quote');
step(
  `creative provider: ${creative.provider}/${creative.model} (paid=${creative.paid}, ready=${creative.ready}, max $${creative.maxUsd})`,
);
if (!creative.ready) fail(`creative provider not ready: ${creative.reason}`);
const campaignBody = { goal: 'OFFER', productName: 'קפה ומאפה', offer: 'קפה + מאפה ב-29.90 ₪ עד סוף החודש' };
if (creative.paid) {
  const refused = await request('POST', `/v1/businesses/${business.id}/campaigns`, campaignBody);
  if (refused.json?.code !== 'PAID_APPROVAL_REQUIRED' && refused.json?.code !== 'PAID_GENERATION_DISABLED') {
    fail(`paid creative without approval should be refused, got ${refused.status} ${refused.json?.code}`);
  }
  step(`approval enforced: campaign without approval refused (${refused.json.code})`);
}
const campaign = await call('POST', `/v1/businesses/${business.id}/campaigns`, {
  ...campaignBody,
  aiApprovalUsd: creative.paid ? approveSpend('creative AI', creative.maxUsd) : undefined,
});
if (campaign.concepts.length !== 3) fail('expected 3 concepts');
if (new Set(campaign.concepts.map((c) => c.concept.angle)).size !== 3)
  fail('concepts must use different angles');
const recommended = campaign.concepts.find((c) => c.isRecommended);
for (const c of campaign.concepts)
  step(`  concept [${c.concept.angle}] ${c.concept.title}: "${c.concept.hook}"`);

if ((await request('POST', `/v1/businesses/${business.id}/campaigns`, { goal: 'NOPE' })).status !== 400)
  fail('expected 400');
step('validation: invalid campaign request rejected (400)');

const { projectId } = await call('POST', `/v1/campaigns/${campaign.id}/concepts/${recommended.id}/select`);
let project = await call('GET', `/v1/projects/${projectId}`);
step(
  `storyboard: ${project.storyboard.scenes.map((s) => `${s.key}=${project.plan.scenes.find((p) => p.sceneKey === s.key).strategy}`).join(', ')}`,
);
for (const s of project.storyboard.scenes) step(`  [${s.key}] ${s.voiceover}`);

// ── Gates ────────────────────────────────────────────────────────────
if ((await request('POST', `/v1/projects/${projectId}/renders`, { quality })).status !== 409)
  fail('render before approval must be 409');
const earlyApprove = await request('POST', `/v1/projects/${projectId}/approve`);
if (earlyApprove.json?.code !== 'SCRIPT_NOT_APPROVED')
  fail(`approve before script approval must be refused, got ${earlyApprove.json?.code}`);
step('workflow: render/approve before script approval refused (409)');
project = await call('POST', `/v1/projects/${projectId}/approve-script`);
if (!project.scriptApprovedAt) fail('script approval not stored');
step('script approved');

// ── Narration ───────────────────────────────────────────────────────
const voices = await call('GET', '/v1/voices');
step(
  `voice provider: ${voices.provider} (paid=${voices.paid}, ready=${voices.ready}) voices: ${voices.voices.map((v) => `${v.id}/${v.modelId}`).join(', ')}`,
);
if (!voices.ready) fail(`voice provider not ready: ${voices.reason}`);
const voice = voices.voices.find((v) => v.id === voiceArg) ?? voices.voices[0];
const quote = await call(
  'GET',
  `/v1/projects/${projectId}/narration/quote?voiceId=${encodeURIComponent(voice.id)}`,
);
step(
  `narration quote: ${quote.characters} chars, ~${quote.estimatedSec}s, est. $${quote.estimatedUsd} (${quote.scriptCheck.status})`,
);
for (const l of quote.lines) step(`  spoken [${l.sceneKey}] ${l.spoken}`);
if (quote.paid) {
  const refused = await request('POST', `/v1/projects/${projectId}/narration`, { voiceId: voice.id });
  if (!['PAID_APPROVAL_REQUIRED', 'PAID_GENERATION_DISABLED'].includes(refused.json?.code))
    fail('paid narration without approval must be refused');
  step(`approval enforced: narration without approval refused (${refused.json.code})`);
}
await call('POST', `/v1/projects/${projectId}/narration`, {
  voiceId: voice.id,
  approvedUsd: quote.paid ? approveSpend('narration', quote.estimatedUsd) : undefined,
});
const narration = await poll(
  async () => (await call('GET', `/v1/projects/${projectId}`)).narration,
  (n) => n?.status === 'READY' || n?.status === 'FAILED',
  'narration',
);
if (narration.status !== 'READY') fail(`narration failed: ${narration.error}`);
for (const s of narration.segments) {
  step(
    `  [${s.sceneKey}] ${s.durationSec}s · timing=${s.timing} · cues: ${s.cues.map((c) => `${c.text}@${c.startSec}-${c.endSec}`).join(' | ')}`,
  );
}
step(`narration ready: ${narration.totalSec}s total`);

if (!quote.paid) {
  await call('POST', `/v1/projects/${projectId}/narration`, { voiceId: voice.id });
  const again = await poll(
    async () => (await call('GET', `/v1/projects/${projectId}`)).narration,
    (n) => n?.status === 'READY' || n?.status === 'FAILED',
    'narration (re-run)',
  );
  if (!again.segments.every((s) => s.cached)) fail('identical narration request must reuse cached audio');
  step('cache: identical narration request reused every segment');
}

// ── Production + render ─────────────────────────────────────────────
project = await call('POST', `/v1/projects/${projectId}/approve`);
step(
  `approved production → timeline v${project.versions[0].version} (${project.versions[0].reason.slice(0, 40)}…)`,
);
let render = await call('POST', `/v1/projects/${projectId}/renders`, { quality });
if ((await call('POST', `/v1/projects/${projectId}/renders`, { quality })).id !== render.id)
  fail('render request is not idempotent');
render = await poll(
  async () => call('GET', `/v1/renders/${render.id}`),
  (r) => r.status === 'SUCCEEDED' || r.status === 'FAILED',
  'render',
);
if (render.status !== 'SUCCEEDED') fail(`render failed: ${render.error}`);
step(
  `render done: ${render.width}×${render.height}, ${render.durationSec}s, ${(render.outputBytes / 1e6).toFixed(2)} MB`,
);
if (render.durationSec + 0.5 < narration.totalSec) fail('video is shorter than its narration');

const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'kampora-e2e-')), `journey-${quality}.mp4`);
const download = await fetch(render.downloadUrl);
if (!download.headers.get('content-disposition')?.startsWith('attachment'))
  fail('download URL is not an attachment');
writeFileSync(file, Buffer.from(await download.arrayBuffer()));
const probe = JSON.parse(
  execFileSync(process.env.FFPROBE_PATH || 'ffprobe', [
    '-v',
    'error',
    '-show_streams',
    '-show_format',
    '-of',
    'json',
    file,
  ]).toString(),
);
const videoStream = probe.streams.find((s) => s.codec_type === 'video');
const audioStream = probe.streams.find((s) => s.codec_type === 'audio');
if (!videoStream || !audioStream) fail('MP4 must contain video and audio');
step(
  `downloaded MP4 verified with ffprobe: ${videoStream.width}×${videoStream.height} ${videoStream.codec_name} + ${audioStream.codec_name} audio, ${Number(probe.format.duration).toFixed(2)}s → ${file}`,
);
if ((await fetch(render.streamUrl.replace(/sig=[^&]+/, 'sig=AAAA'))).status !== 403)
  fail('tampered signature must be 403');
step('signed URL tampering rejected (403)');

const costs = await call('GET', `/v1/projects/${projectId}/costs`);
step(
  `costs: simulated $${costs.byChargeTypeUsd.SIMULATED.toFixed(4)} · estimated $${costs.byChargeTypeUsd.ESTIMATED.toFixed(4)} · confirmed $${costs.byChargeTypeUsd.CONFIRMED.toFixed(4)} (${costs.entries} ledger lines, ${costs.reuseHits} cache hits)`,
);
if (!creative.paid && !quote.paid && costs.byChargeTypeUsd.CONFIRMED !== 0)
  fail('mock run must not have confirmed charges');
console.log(`\n✓ journey passed — project ${projectId} · ${file}`);
