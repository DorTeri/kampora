'use client';

import { useMemo, useState } from 'react';
import type { DirectorCard, ToolCallRecord } from '@kampora/shared';
import recorded from '@/demo/director-transcripts.json';
import { Badge, cn } from '../ui';
import { DirectorCardView, ToolActivity, type CardActions } from './cards';
import { sandboxPort } from './sandbox-port';
import { DirectorWorkspace } from './workspace';

type Recorded = Record<string, { role: 'OWNER' | 'DIRECTOR'; text: string; cards: DirectorCard[]; tools: Pick<ToolCallRecord, 'tool' | 'status' | 'summary'>[] }[]>;
const RECORDED = recorded as unknown as Recorded;

const READ_ONLY: CardActions = { say: () => undefined, decide: () => undefined, approval: () => undefined, busy: true, studioLinks: false, readOnly: true };

/**
 * Demo deployment (no Kampora backend): an interactive sandbox in the browser and the transcripts of the scenario
 * run that went through the real API and database with mock creative providers. Both are labelled as such.
 */
export function DirectorDemo() {
  const [tab, setTab] = useState<'try' | 'recorded'>('try');
  const { port, initial } = useMemo(() => sandboxPort(), []);
  const names = Object.keys(RECORDED);
  const [scenario, setScenario] = useState(names[0] ?? '');

  return (
    <div className="animate-rise space-y-4">
      <div className="rounded-[var(--radius-card)] border border-warn/40 bg-warn-soft/60 p-4 text-sm leading-relaxed">
        <p className="font-bold">גרסת הדגמה, בלי שרת</p>
        <p className="text-ink-soft">
          בלשונית &quot;נסו בעצמכם&quot; מנהל הקמפיין רץ בדפדפן: אותו מנוע הבנה וזרימת עבודה כמו בשרת, אבל בלי AI, בלי מסד נתונים ובלי סטודיו. רעיונות ותסריטים
          נבנים רק מהמילים שלכם, ושום דבר לא נשמר אחרי רענון. בלשונית &quot;הרצה מוקלטת&quot; מוצגות שיחות שרצו מול ה-API ומסד הנתונים האמיתיים עם ספקי קריאייטיב
          מדומים (ללא עלות). שום דבר לא מתפרסם ושום הודעה לא נשלחת.
        </p>
      </div>

      <div role="tablist" className="flex gap-2">
        {(
          [
            ['try', 'נסו בעצמכם'],
            ['recorded', 'הרצה מוקלטת (תרחישים A–K)'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            type="button"
            onClick={() => setTab(id)}
            className={cn('min-h-10 rounded-full px-4 text-sm font-bold', tab === id ? 'bg-ink text-white' : 'bg-surface text-ink-soft border border-line')}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'try' ? (
        <DirectorWorkspace
          port={port}
          initial={initial}
          studioLinks={false}
          header={
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-xl font-extrabold">מנהל הקמפיין</h1>
              <Badge tone="warn">סביבת הדגמה</Badge>
            </div>
          }
        />
      ) : (
        <section className="rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-card)]">
          <div className="mb-4 flex flex-wrap gap-2">
            {names.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setScenario(n)}
                className={cn('rounded-full px-3 py-1 text-sm font-semibold', scenario === n ? 'bg-primary text-white' : 'bg-ink/5 text-ink-soft')}
              >
                {n}
              </button>
            ))}
          </div>
          <ol className="space-y-4">
            {(RECORDED[scenario] ?? []).map((m, i) => (
              <li key={i} className={cn('flex', m.role === 'OWNER' ? 'justify-start' : 'justify-end')}>
                <div className={cn('max-w-[min(42rem,92%)]', m.role === 'OWNER' ? 'rounded-3xl rounded-tr-md bg-primary px-4 py-3 text-white' : 'w-full')}>
                  <p className={cn('whitespace-pre-line leading-relaxed', m.role === 'DIRECTOR' && 'rounded-3xl rounded-tl-md bg-canvas px-4 py-3')}>{m.text}</p>
                  {m.cards.map((c, j) => (
                    <DirectorCardView key={j} card={c} actions={READ_ONLY} latest={false} />
                  ))}
                  {m.role === 'DIRECTOR' && <ToolActivity tools={m.tools.map((t) => ({ ...t, summary: t.summary ?? '' }))} />}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
