// Prints the model's raw reading and the merged understanding for each message of one conversation (paid, tiny).
//   node --env-file-if-exists=.env scripts/director-eval/debug-turns.mjs --approved-paid-run "msg 1" "msg 2" ...
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { freezeHoldout, guardedProvider, root } from './paid.mjs';

const { DirectorSandbox, LlmDirectorBrain } = await import(pathToFileURL(path.join(root, 'packages/creative-engine/dist/director/index.js')).href);
if (!process.argv.includes('--approved-paid-run')) throw new Error('Paid run: pass --approved-paid-run.');
freezeHoldout();
const inner = guardedProvider({ model: process.env.MODEL ?? 'gpt-6-luna', stage: 'debug', stageCapUsd: 0.05 });
const provider = { ...inner, generateStructured: async (r) => { const out = await inner.generateStructured(r); console.log('  raw:', JSON.stringify({ facts: out.data.facts, intent: out.data.intent, choice: out.data.choice, rec: out.data.recommendedChoice, objective: out.data.objective, growth: out.data.growth })); return out; } };
const brain = new LlmDirectorBrain(provider);
const s = new DirectorSandbox({ now: () => new Date('2026-11-02T10:00:00Z'), brain: { id: 'dbg', interpret: async (i) => { const u = await brain.interpret(i); console.log('  merged:', u.intent, u.choice, JSON.stringify(u.facts.map((f) => [f.key, f.value, f.source]))); return u; } } });
for (const m of process.argv.slice(2).filter((a) => !a.startsWith('--'))) {
  console.log('O:', m);
  const r = await s.send(m);
  console.log('D:', r.text.replace(/\n+/g, ' / ').slice(0, 200));
}
console.log('stored:', JSON.stringify(s.executor.data.facts.filter((f) => f.key === 'conversion.ordering')));
