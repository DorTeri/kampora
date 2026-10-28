// End-to-end journey against a running API + worker:
// business → campaign (brief + 3 concepts) → select → storyboard/plan → approve → render → download → costs.
// Usage: node scripts/e2e-journey.mjs [preview|final]
const API = process.env.KAMPORA_API_URL ?? 'http://localhost:4000';
const TOKEN = process.env.KAMPORA_API_TOKEN ?? 'dev-kampora-token';
const quality = process.argv[2] === 'final' ? 'final' : 'preview';

async function call(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const step = (msg) => console.log(`• ${msg}`);
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

const health = await fetch(`${API}/health`).then((r) => r.json());
if (health.status !== 'ok') fail('API not healthy');

const unauth = await fetch(`${API}/v1/businesses`);
if (unauth.status !== 401) fail(`expected 401 without token, got ${unauth.status}`);
step('auth: request without token rejected (401)');

const [business] = await call('GET', '/v1/businesses');
if (!business) fail('no business; run npm run db:seed');
step(`business: ${business.name}`);

const campaign = await call('POST', `/v1/businesses/${business.id}/campaigns`, {
  goal: 'OFFER',
  productName: 'קפה ומאפה',
  offer: 'קפה + מאפה ב-29.90 ₪ עד סוף החודש',
});
if (campaign.concepts.length !== 3) fail('expected 3 concepts');
const recommended = campaign.concepts.find((c) => c.isRecommended);
step(
  `campaign ${campaign.id}: ${campaign.concepts.map((c) => c.concept.title).join(' | ')} (recommended: ${recommended.concept.title})`,
);

const invalid = await fetch(`${API}/v1/businesses/${business.id}/campaigns`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ goal: 'NOPE' }),
});
if (invalid.status !== 400) fail(`expected 400 for invalid body, got ${invalid.status}`);
step('validation: invalid campaign request rejected (400)');

const { projectId } = await call('POST', `/v1/campaigns/${campaign.id}/concepts/${recommended.id}/select`);
const again = await call('POST', `/v1/campaigns/${campaign.id}/concepts/${recommended.id}/select`);
if (again.projectId !== projectId) fail('select is not idempotent');
let project = await call('GET', `/v1/projects/${projectId}`);
step(
  `plan: ${project.plan.scenes.map((s) => `${s.sceneKey}=${s.strategy}`).join(', ')} · paid $${project.plan.estimatedPaidCostUsd}`,
);

const early = await fetch(`${API}/v1/projects/${projectId}/renders`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ quality }),
});
if (early.status !== 409) fail(`expected 409 rendering before approval, got ${early.status}`);
step('workflow: render before approval rejected (409)');

project = await call('POST', `/v1/projects/${projectId}/approve`);
step(`approved → timeline v${project.versions[0].version}`);

let render = await call('POST', `/v1/projects/${projectId}/renders`, { quality });
const dup = await call('POST', `/v1/projects/${projectId}/renders`, { quality });
if (dup.id !== render.id) fail('render request is not idempotent');
step(`render ${render.id} queued (${quality})`);

const deadline = Date.now() + 10 * 60_000;
let lastStage = '';
while (render.status !== 'SUCCEEDED') {
  if (render.status === 'FAILED') fail(`render failed: ${render.error}`);
  if (Date.now() > deadline) fail('render timed out');
  await new Promise((r) => setTimeout(r, 2000));
  render = await call('GET', `/v1/renders/${render.id}`);
  const stage = `${render.stage} ${Math.round(render.progress * 100)}%`;
  if (stage !== lastStage) {
    lastStage = stage;
    step(`  ${stage}`);
  }
}
step(
  `render done: ${render.width}×${render.height}, ${render.durationSec}s, ${(render.outputBytes / 1e6).toFixed(2)} MB`,
);

const video = await fetch(render.streamUrl, { headers: { Range: 'bytes=0-1023' } });
if (video.status !== 206 || video.headers.get('content-type') !== 'video/mp4') {
  fail(`stream URL returned ${video.status} ${video.headers.get('content-type')}`);
}
const head = Buffer.from(await video.arrayBuffer());
if (head.subarray(4, 8).toString('latin1') !== 'ftyp') fail('stream is not an MP4');
step('stream URL: signed, supports Range, serves MP4');

const download = await fetch(render.downloadUrl, { method: 'GET' });
if (!download.headers.get('content-disposition')?.startsWith('attachment'))
  fail('download URL is not an attachment');
await download.arrayBuffer();
const tampered = await fetch(render.streamUrl.replace(/sig=[^&]+/, 'sig=AAAA'));
if (tampered.status !== 403) fail(`tampered signature should be 403, got ${tampered.status}`);
step('download URL: attachment; tampered signature rejected (403)');

const costs = await call('GET', `/v1/projects/${projectId}/costs`);
step(
  `costs: simulated $${costs.byChargeTypeUsd.SIMULATED.toFixed(4)}, estimated $${costs.byChargeTypeUsd.ESTIMATED}, confirmed $${costs.byChargeTypeUsd.CONFIRMED} (${costs.entries} ledger lines)`,
);
if (costs.byChargeTypeUsd.CONFIRMED !== 0) fail('no real provider should have been charged');

const videos = await call('GET', '/v1/videos');
if (!videos.some((v) => v.id === render.id)) fail('render missing from "my videos"');
console.log(`\n✓ journey passed — project ${projectId}`);
