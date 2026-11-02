// Builds the transcripts bundled into the public web demo from the latest scenario run.
//
//   node scripts/build-demo-transcripts.mjs [docs/director/scenario-transcripts.json]
//
// The scenario run uses the synthetic fixtures organization and clearly marked demo links. Before anything is
// bundled, database ids are replaced by stable placeholders, and the run fails if it finds anything that looks like
// private development data (local paths, e-mail addresses, keys, internal hosts).
import { readFileSync, writeFileSync } from 'node:fs';

const source = process.argv[2] ?? 'docs/director/scenario-transcripts.json';
const target = 'apps/web/src/demo/director-transcripts.json';

const ids = new Map();
const placeholder = (uuid) => {
  if (!ids.has(uuid)) ids.set(uuid, `demo-${String(ids.size + 1).padStart(4, '0')}`);
  return ids.get(uuid);
};

const raw = readFileSync(source, 'utf8');
const text = raw.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, placeholder);

const PRIVATE = [
  [/[A-Za-z]:\\\\/, 'Windows path'],
  [/\/(Users|home)\/[a-z]/i, 'home directory'],
  [/[a-z0-9._%+-]+@(?!kampora\.dev)[a-z0-9.-]+\.[a-z]{2,}/i, 'e-mail address'],
  [/\bsk-[A-Za-z0-9_-]{10,}/, 'API key'],
  [/localhost|127\.0\.0\.1|\.internal\b/i, 'internal host'],
  [/X-Amz-|Signature=|token=/i, 'signed URL'],
];
const found = PRIVATE.filter(([re]) => re.test(text)).map(([, what]) => what);
if (found.length) {
  console.error(`Refusing to bundle: found ${found.join(', ')} in ${source}`);
  process.exit(1);
}

const transcripts = JSON.parse(text);
writeFileSync(target, `${JSON.stringify(transcripts, null, 2)}\n`);
console.log(`${Object.keys(transcripts).length} conversations → ${target} (${ids.size} ids replaced)`);
