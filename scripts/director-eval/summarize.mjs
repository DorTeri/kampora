// Prints one table of every validation result file and the spend ledger, for the report.
//   node scripts/director-eval/summarize.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { readLedger, root, spendSummary, TOTAL_CAP_USD } from './paid.mjs';

const dir = path.join(root, 'docs/director/llm-validation');
const rows = [];
for (const stage of readdirSync(dir)) {
  const p = path.join(dir, stage);
  if (!statSync(p).isDirectory()) continue;
  for (const f of readdirSync(p).filter((x) => x.endsWith('.json'))) {
    const { summary: s } = JSON.parse(readFileSync(path.join(p, f), 'utf8'));
    if (!s) continue;
    rows.push({
      stage,
      file: f.replace('.json', ''),
      runs: s.runs,
      fullyCorrect: `${s.fullyCorrect}/${s.runs}`,
      checks: `${s.checksPassed}/${s.checksTotal}`,
      fallback: s.turns ? `${s.fallbackTurns}/${s.turns}` : '',
      safety: s.safety ? Object.entries(s.safety).filter(([k, v]) => v && !['maxQuestionsPerTurn'].includes(k)).map(([k, v]) => `${k}=${v}`).join(' ') || 'clean' : '',
    });
  }
}
console.table(rows);

const ledger = readLedger();
const models = [...new Set(ledger.calls.map((c) => c.model))];
const byModel = Object.fromEntries(models.map((m) => [m, spendSummary((c) => c.model === m)]));
console.table(byModel);
const all = spendSummary();
console.log(`Total: ${all.calls} calls, ${all.failures} failed, reported $${all.reportedUsd}, conservative (charged) $${all.chargedUsd} of the $${TOTAL_CAP_USD} cap.`);
console.table(Object.fromEntries([...new Set(ledger.calls.map((c) => c.stage))].map((s) => [s, spendSummary((c) => c.stage === s)])));
