// Renders chosen transcripts from the final validation run as Markdown, for a person to read and judge.
//   node scripts/director-eval/conversations.mjs > docs/director/llm-validation/CONVERSATIONS.md
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { root } from './paid.mjs';

const read = (f) => JSON.parse(readFileSync(path.join(root, 'docs/director/llm-validation', f), 'utf8'));
const PICKS = [
  ['final/marketing-llm-gpt-6-luna.json', 'm-burger-wolt', 'המבורגרייה עם וולט: עד ההמלצה'],
  ['final/marketing-llm-gpt-6-luna.json', 'm-pilates-trial', 'סטודיו פילאטיס: שיעור ניסיון בוואטסאפ'],
  ['final/marketing-llm-gpt-6-luna.json', 'm-online-candles', 'חנות אונליין: בלי שאלות על עיר או כתובת'],
  ['final/marketing-llm-gpt-6-luna.json', 'm-conversion-broken-phone', 'פיצרייה שלא עונה לטלפון (דוגמה חלשה)'],
  ['final/marketing-llm-gpt-6-luna.json', 'm-organic-full-calendar', 'קליניקה עם יומן מלא (דוגמה חלשה)'],
  ['final/holdout-v3-llm-gpt-6-luna.json', 'h3-multiturn-name-after-place', 'שיחה בכמה הודעות קצרות'],
  ['final/holdout-v3-llm-gpt-6-luna.json', 'h3-what-do-you-know', 'שיחה חדשה: מה אתה זוכר עליי?'],
  ['final/holdout-v3-llm-gpt-6-luna.json', 'h3-expired-discount', 'מבצע שפג תוקפו'],
  ['final/holdout-v3-llm-gpt-6-luna.json', 'h3-approve-everything', 'ניסיון לאשר הכל בטקסט'],
];

const card = (c) => {
  switch (c.kind) {
    case 'QUESTION':
      return `שאלה על: ${c.keys.join(', ')}`;
    case 'RECOMMENDATION': {
      const m = c.marketing;
      if (!m) return `המלצה: ${c.objective}`;
      return [
        `המלצה · מטרה: ${m.objective} · יעד: ${m.conversion?.action ?? '—'} ${m.conversion?.destination ?? ''}`,
        `  השערה: ${m.hypothesis}`,
        ...m.strategy.map((x) => `  · ${x}`),
        `  פורמטים: ${m.creativeFormats.map((f) => f.format).join(', ')}`,
        `  מדידה: ${m.measurement.primaryMetric}`,
      ].join('\n');
    }
    case 'CONCEPTS':
      return `רעיונות: ${(c.concepts ?? []).map((x) => x.title + (x.recommended ? ' (מומלץ)' : '')).join(' | ')}`;
    case 'FACTS':
      return `זיכרון: ${(c.facts ?? []).map((f) => `${f.label}=${f.value} (${f.status})`).join(', ')}`;
    case 'APPROVAL':
      return `כרטיס אישור (${c.approvalKind}): ${c.title}`;
    default:
      return c.kind;
  }
};

const out = ['# Campaign Director: representative conversations (gpt-6-luna, final run)', '', 'Each conversation ran in the sandbox with the real model reading every owner message. Owner answers in the marketing cases come from a scripted owner. Cards are summarised in brackets.', ''];
for (const [file, id, title] of PICKS) {
  const r = read(file).results.find((x) => x.id === id && x.rep === 0);
  if (!r) continue;
  out.push(`## ${title} (\`${id}\`, ${r.passed}/${r.total} automated checks)`, '');
  for (const t of r.transcript) {
    out.push(`**בעל העסק:** ${t.owner}`, '', `**המנהל:** ${t.director.replace(/\n+/g, '  \n')}`, '');
    const cards = t.cards.map(card).filter(Boolean);
    if (cards.length) out.push('```', ...cards, '```', '');
    const tools = t.tools.filter((x) => x.tool !== 'ProposeBusinessProfileUpdate').map((x) => `${x.tool}: ${x.status}`);
    if (tools.length) out.push(`<sub>כלים: ${tools.join(' · ')}</sub>`, '');
  }
  const failed = r.checks.filter((c) => !c.ok);
  if (failed.length) out.push(`> בדיקות שנכשלו: ${failed.map((c) => c.name).join('; ')}`, '');
}
console.log(out.join('\n'));
