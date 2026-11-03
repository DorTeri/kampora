// The cumulative spend guard for the approved paid LLM validation (cap: $5.00 for all stages together).
//
// Every paid call of every stage goes through `guardedProvider`, one at a time (no concurrency, no retries: the
// OpenAI SDK's retries are off and the Director falls back to the rules on a failure). Before each call the
// worst-case cost (the full prompt at a pessimistic 1.5 characters per token, plus the full output-token cap, plus
// a 10% margin for regional uplifts) must fit under both the stage cap and what is left of the total cap. Successful
// calls are charged at the provider-reported usage (+10%); failed calls at their worst case, since they may still be
// billed. The ledger is written after every call, so an interrupted run never loses its accounting. OpenAI's own
// billing may lag or differ: this ledger is a conservative internal limit, not the provider's invoice.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (p) => import(pathToFileURL(path.join(root, p)).href);
const { OpenAiLlmProvider, tokenCostUsd } = await load('packages/media-providers/dist/index.js');
const { PriceCatalog } = await load('packages/cost-engine/dist/index.js');

export const TOTAL_CAP_USD = 5;
const MARGIN = 1.1;
const LEDGER = path.join(root, 'docs/director/llm-validation/ledger.json');
export const FROZEN = ['scripts/director-eval/holdout-v2.json', 'scripts/director-eval/marketing.json', 'scripts/director-eval/holdout-v3.json'];

export function sha256(file) {
  return createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex');
}

export function readLedger() {
  if (!existsSync(LEDGER)) return { capUsd: TOTAL_CAP_USD, margin: MARGIN, frozen: null, calls: [] };
  return JSON.parse(readFileSync(LEDGER, 'utf8'));
}

function writeLedger(ledger) {
  mkdirSync(path.dirname(LEDGER), { recursive: true });
  writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 1)}\n`);
}

/** Records the held-out files' hashes once, before the first paid call; later runs refuse if they changed. */
export function freezeHoldout() {
  const ledger = readLedger();
  const now = Object.fromEntries(FROZEN.map((f) => [f, sha256(f)]));
  if (!ledger.frozen) {
    if (ledger.calls.length) throw new Error('Paid calls exist but the held-out set was never frozen.');
    ledger.frozen = { at: new Date().toISOString(), files: now };
    writeLedger(ledger);
    return;
  }
  let added = false;
  for (const f of FROZEN) {
    // A set written later is frozen at its first paid run (its hash and time are recorded then).
    if (!ledger.frozen.files[f]) {
      ledger.frozen.files[f] = now[f];
      (ledger.frozen.added ??= {})[f] = new Date().toISOString();
      added = true;
    } else if (ledger.frozen.files[f] !== now[f]) throw new Error(`${f} changed after it was frozen.`);
  }
  if (added) writeLedger(ledger);
}

export const charged = (calls) => calls.reduce((n, c) => n + c.chargedUsd, 0);

export class BudgetStop extends Error {}

/**
 * An LlmProvider for the Director that spends only within the caps. `stage` labels the ledger rows;
 * `stageCapUsd` bounds this stage. After a refusal `stopped` is set: the harness must stop issuing turns.
 */
export function guardedProvider({ model, stage, stageCapUsd, maxOutputTokens = 1500, effort = 'low' }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set.');
  const price = PriceCatalog.fromEnv().find('openai', model, 'LLM_COMPLETION');
  if (!price?.tokenPricing) throw new Error(`No price entry for ${model}.`);
  const pricing = { ...price.tokenPricing, verified: price.basis === 'VERIFIED' };
  const inner = new OpenAiLlmProvider({ apiKey: process.env.OPENAI_API_KEY, model, maxOutputTokens, timeoutMs: 30_000, reasoningEffort: effort, pricing });
  const worstCase = (req) => MARGIN * tokenCostUsd(pricing, Math.ceil((req.system.length + req.prompt.length + 3_000) / 1.5), 0, maxOutputTokens);
  let consecutiveFailures = 0;

  const guard = {
    id: inner.id,
    model,
    paid: true,
    stopped: null,
    async generateStructured(request) {
      const ledger = readLedger();
      const worst = worstCase(request);
      const total = charged(ledger.calls);
      const inStage = charged(ledger.calls.filter((c) => c.stage === stage));
      if (total + worst > TOTAL_CAP_USD || inStage + worst > stageCapUsd) {
        guard.stopped = `budget: total $${total.toFixed(4)}, stage $${inStage.toFixed(4)}, next call up to $${worst.toFixed(4)}`;
        throw new BudgetStop(guard.stopped);
      }
      if (consecutiveFailures >= 3) {
        guard.stopped = 'three provider failures in a row';
        throw new BudgetStop(guard.stopped);
      }
      const started = Date.now();
      const row = { at: new Date().toISOString(), stage, model, task: request.task ?? request.schemaName, worstUsd: round(worst) };
      try {
        const r = await inner.generateStructured(request);
        consecutiveFailures = 0;
        Object.assign(row, usageRow(r.usage), { ok: true, latencyMs: Date.now() - started, chargedUsd: round(r.usage.costUsd * MARGIN) });
        return r;
      } catch (e) {
        consecutiveFailures++;
        const u = e?.usage;
        Object.assign(row, u ? usageRow(u) : {}, { ok: false, error: String(e?.message ?? e).slice(0, 200), latencyMs: Date.now() - started, chargedUsd: round(worst) });
        throw e;
      } finally {
        const l = readLedger();
        l.calls.push(row);
        writeLedger(l);
      }
    },
  };
  return guard;
}

function usageRow(u) {
  return { inputTokens: u.inputTokens ?? 0, cachedInputTokens: u.cachedInputTokens ?? 0, outputTokens: u.outputTokens ?? 0, reportedUsd: round(u.costUsd ?? 0), requestId: u.requestId };
}

const round = (n) => Math.round(n * 1e6) / 1e6;

export function spendSummary(filter = () => true) {
  const calls = readLedger().calls.filter(filter);
  const lat = calls.filter((c) => c.ok && c.latencyMs != null).map((c) => c.latencyMs).sort((a, b) => a - b);
  return {
    calls: calls.length,
    failures: calls.filter((c) => !c.ok).length,
    inputTokens: calls.reduce((n, c) => n + (c.inputTokens ?? 0), 0),
    cachedInputTokens: calls.reduce((n, c) => n + (c.cachedInputTokens ?? 0), 0),
    outputTokens: calls.reduce((n, c) => n + (c.outputTokens ?? 0), 0),
    reportedUsd: round(calls.reduce((n, c) => n + (c.reportedUsd ?? 0), 0)),
    chargedUsd: round(charged(calls)),
    p50LatencyMs: lat[Math.floor(lat.length * 0.5)] ?? null,
    p95LatencyMs: lat[Math.floor(lat.length * 0.95)] ?? null,
  };
}
