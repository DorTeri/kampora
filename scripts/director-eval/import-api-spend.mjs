// Adds the API's Director LLM calls (cost ledger, step director.interpret) to the validation ledger, once each,
// charged like the harness: reported cost +10%, failed calls at their recorded amount +10%.
//   docker exec <postgres> psql ... -At -c "select json_agg(...)" > api-calls.json
//   node scripts/director-eval/import-api-spend.mjs api-calls.json
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readLedger, root } from './paid.mjs';

const rows = JSON.parse(readFileSync(process.argv[2], 'utf8')) ?? [];
const ledger = readLedger();
const seen = new Set(ledger.calls.map((c) => c.requestId).filter(Boolean));
let added = 0;
for (const r of rows) {
  const id = r.meta?.requestId ?? `api:${r.at}`;
  if (seen.has(id)) continue;
  const usd = (r.micro ?? 0) / 1e6;
  ledger.calls.push({
    at: r.at,
    stage: 'api-scenarios',
    model: r.model,
    task: 'director.interpret',
    ok: !r.note,
    ...(r.note ? { error: String(r.note).slice(0, 200) } : {}),
    inputTokens: r.meta?.inputTokens ?? 0,
    cachedInputTokens: r.meta?.cachedInputTokens ?? 0,
    outputTokens: r.meta?.outputTokens ?? 0,
    reportedUsd: usd,
    chargedUsd: Math.round(usd * 1.1 * 1e6) / 1e6,
    requestId: id,
  });
  added++;
}
writeFileSync(path.join(root, 'docs/director/llm-validation/ledger.json'), `${JSON.stringify(ledger, null, 1)}\n`);
console.log(`Imported ${added} API calls.`);
