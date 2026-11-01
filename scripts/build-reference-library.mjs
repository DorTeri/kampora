// Regenerates packages/agent-expertise/src/references/data.generated.ts from the reference research JSON.
// Usage: node scripts/build-reference-library.mjs <dir with *.json research files>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = process.argv[2] ?? 'out/q7/refs';
const all = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .flatMap((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../packages/agent-expertise/src/references/data.generated.ts');
writeFileSync(
  target,
  `// Generated from the Q7 reference research (out/q7/refs/*.json) by scripts/build-reference-library.mjs.\n` +
    `// Every entry: a verified public source URL and Kampora-authored analysis. No third-party image is stored.\n` +
    `// Do not edit by hand; edit the research data and regenerate.\n` +
    `import type { ProfessionalReferenceInput } from './schema';\n\n` +
    `export const PROFESSIONAL_REFERENCE_DATA: readonly ProfessionalReferenceInput[] = ${JSON.stringify(all, null, 1)};\n`,
);
console.log(`${all.length} references → ${target}`);
