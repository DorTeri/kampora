#!/usr/bin/env node
// Marketing decision scenarios, offline: the real engine with the rules brain and the sandbox tools (no API, no
// provider, no cost). Each scenario is a short owner conversation; the deterministic checks look at the decision the
// engine reached (action, paid-ads verdict, workflow, questions, concepts) and at the reply text. Whether the advice is
// professionally right is judged by a person from the transcript: the checks only catch what can be checked.
//
//   node scripts/director-eval/decisions.mjs --set=dev [--out=docs/director/decisions]
//
// Needs the packages built (npx tsc -b tsconfig.packages.json).
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DirectorSandbox } from '../../packages/creative-engine/dist/director/index.js';

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const set = arg('set', 'dev');
const out = arg('out');
const file = resolve(`scripts/director-eval/decision-scenarios.${set}.json`);
const { scenarios } = JSON.parse(readFileSync(file, 'utf8'));
const NOW = new Date('2026-11-02T10:00:00Z');

/** Facts given as [key, value] become confirmed owner facts (a returning owner's memory). */
function facts(list = []) {
  return list.map(([key, value]) => ({ key, value, source: 'OWNER_STATED', status: 'CONFIRMED', evidence: 'מהשיחה הקודמת', updatedAt: '2026-10-20T10:00:00.000Z', confirmedAt: '2026-10-20T10:00:00.000Z' }));
}
function campaigns(list = []) {
  return list.map((c, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`,
    createdAt: c.createdAt ?? '2026-10-10T10:00:00.000Z',
    goal: c.goal ?? 'SALES',
    product: c.product,
    concepts: [],
    projectId: null,
    title: c.title,
    script: [],
    scriptApproved: true,
    directions: [],
    produced: true,
  }));
}

const PAID_PUSH = /נכין קמפיין|בשמחה, נכין|הכנתי \d+ רעיונות/;
const QUESTION_MARKS = (text) => (text.match(/\?/g) ?? []).length;

function check(s, turns) {
  const results = [];
  const add = (name, ok, detail = '') => results.push({ name, ok, detail });
  const decisions = turns.flatMap((t) => t.cards.filter((c) => c.kind === 'DECISION').map((c) => c.decision));
  const final = decisions.at(-1);
  const e = s.expect;
  if (e.action) add(`action ∈ {${e.action.join(', ')}}`, Boolean(final && e.action.includes(final.action)), final?.action ?? 'no decision');
  if (e.paid) add(`paid ∈ {${e.paid.join(', ')}}`, Boolean(final && e.paid.includes(final.paid.verdict)), final?.paid.verdict ?? 'no decision');
  if (e.next) add(`next ∈ {${e.next.join(', ')}}`, Boolean(final && e.next.includes(final.next)), final?.next ?? 'no decision');
  if (e.rule) add(`rule ∈ {${e.rule.join(', ')}}`, Boolean(final && e.rule.includes(final.rule)), final?.rule ?? 'no decision');
  if (e.firstTurnDecision) add('decision on the first turn', turns[0].cards.some((c) => c.kind === 'DECISION'), '');
  const concepts = turns.some((t) => t.cards.some((c) => c.kind === 'CONCEPTS'));
  if (e.concepts === true) add('concepts prepared', concepts);
  if (e.concepts === false) add('no ad concepts', !concepts);
  if (e.noPaidPush) add('no "נכין קמפיין" push when a problem is described', !turns.slice(0, e.noPaidPush).some((t) => PAID_PUSH.test(t.text)));
  for (const re of e.mention ?? []) add(`mentions /${re}/`, new RegExp(re).test(turns.map((t) => t.text).join('\n')));
  for (const re of e.notMention ?? []) add(`never says /${re}/`, !new RegExp(re).test(turns.map((t) => t.text).join('\n')));
  if (e.checklist) add('checklist given', Boolean(final?.checklist.length));
  if (e.question) add('a focused question', Boolean(final?.questions.length));
  // Behaviour, for every scenario.
  add('at most 2 questions per reply', turns.every((t) => QUESTION_MARKS(t.text) <= 2), turns.map((t) => QUESTION_MARKS(t.text)).join(','));
  add('"רשמתי" at most once', turns.filter((t) => /רשמתי/.test(t.text)).length <= 1, String(turns.filter((t) => /רשמתי/.test(t.text)).length));
  add('nothing claimed as published, paid or approved', !turns.some((t) => /פרסמתי|פורסם|שילמתי|חויב|אישרתי בשמך/.test(t.text)));
  add('no invented numbers (₪ or %) beyond the owner\'s', turns.every((t, i) => {
    const said = s.turns.slice(0, i + 1).join(' ') + JSON.stringify(s.memory ?? []);
    return (t.text.match(/\d[\d,.]*\s?(?:₪|%)/g) ?? []).every((n) => said.includes(n.replace(/\s?(?:₪|%)$/, '')));
  }));
  return { results, final };
}

const report = { set, ranAt: new Date().toISOString(), brain: 'rules', providers: 'sandbox', scenarios: [] };
let md = `# Decision scenarios (${set})\n\nOffline: rules brain, sandbox tools, no provider and no cost. Checks are deterministic; the advice itself is for a person to judge.\n`;
for (const s of scenarios) {
  const sandbox = new DirectorSandbox({ now: () => NOW, data: { facts: facts(s.memory), campaigns: campaigns(s.campaigns), approvals: [] } });
  const turns = [];
  for (const text of s.turns) turns.push(await sandbox.send(text));
  const { results, final } = check(s, turns);
  const passed = results.filter((r) => r.ok).length;
  report.scenarios.push({ id: s.id, title: s.title, passed, total: results.length, checks: results, decision: final ?? null });
  md += `\n## ${s.id}. ${s.title}\n\n`;
  s.turns.forEach((text, i) => {
    md += `**בעל העסק:** ${text}\n\n**קמפורה:** ${turns[i].text.replace(/\n+/g, ' ')}\n\n`;
    const d = turns[i].cards.find((c) => c.kind === 'DECISION')?.decision;
    if (d) md += `> החלטה: ${d.action} · פרסום ממומן: ${d.paid.verdict}${d.paid.blockedBy ? ` (${d.paid.blockedBy})` : ''} · המשך: ${d.next} · כלל: ${d.rule} · ביטחון: ${d.confidence}\n> שלבים: ${d.sequence.map((x) => `${x.step}${x.when ? ` (${x.when})` : ''}`).join(' → ')}\n> מדידה: ${d.measurement.primaryMetric}\n\n`;
    const c = turns[i].cards.find((x) => x.kind === 'CONCEPTS');
    if (c) md += `> נוצרו ${c.concepts.length} רעיונות למודעה\n\n`;
  });
  md += `Checks: ${passed}/${results.length}${results.some((r) => !r.ok) ? `. Failed: ${results.filter((r) => !r.ok).map((r) => `${r.name} (${r.detail})`).join('; ')}` : ''}\n`;
  console.log(`${passed === results.length ? 'PASS' : 'FAIL'} ${s.id} ${s.title}: ${passed}/${results.length}${results.some((r) => !r.ok) ? ` — ${results.filter((r) => !r.ok).map((r) => `${r.name} (${r.detail})`).join('; ')}` : ''}`);
}
const all = report.scenarios.reduce((a, s) => a + s.total, 0);
const ok = report.scenarios.reduce((a, s) => a + s.passed, 0);
report.summary = { scenarios: report.scenarios.length, fullyPassed: report.scenarios.filter((s) => s.passed === s.total).length, checks: all, passed: ok };
console.log(`\n${report.summary.fullyPassed}/${report.summary.scenarios} scenarios fully passed, ${ok}/${all} checks`);
if (out) {
  mkdirSync(out, { recursive: true });
  writeFileSync(resolve(out, `${set}.json`), JSON.stringify(report, null, 2));
  writeFileSync(resolve(out, `${set}.md`), md);
}
if (process.argv.includes('--print')) console.log(md);
