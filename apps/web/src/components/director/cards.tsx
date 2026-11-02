'use client';

import Link from 'next/link';
import type { DirectorCard, ToolCallRecord } from '@kampora/shared';
import { APPROVAL_KIND_LABELS, TOOL_LABELS, type ApprovalItem } from '@/lib/director';
import { Badge, cn } from '../ui';

const OBJECTIVE: Record<string, string> = {
  LOCAL_AWARENESS: 'חשיפה באזור',
  VISITS: 'הגעה אליכם',
  ORDERS: 'יותר הזמנות',
  ONLINE_SALES: 'מכירות באתר',
  LEADS: 'פניות מלקוחות',
  BOOKINGS: 'הרשמות',
  PRODUCT_LAUNCH: 'השקת מוצר',
  RETENTION: 'לקוחות חוזרים',
  BRAND: 'מיתוג',
};

const ACTION: Record<string, string> = {
  WHATSAPP: 'וואטסאפ',
  WEBSITE: 'אתר',
  PRODUCT_PAGE: 'עמוד מוצר',
  BOOKING_PAGE: 'עמוד הרשמה',
  ORDERING_PAGE: 'עמוד הזמנה',
  INSTAGRAM_DM: 'הודעה באינסטגרם',
  LEAD_FORM: 'טופס פרטים במטא',
  PHONE_CALL: 'שיחת טלפון',
  NAVIGATION: 'ניווט אליכם',
};

export interface CardActions {
  /** Sends text as the owner's message. */
  say(text: string): void;
  decide(approvalId: string, decision: 'APPROVED' | 'REJECTED'): void;
  /** Current state of an approval (cards in old messages may already be decided). */
  approval(approvalId: string): ApprovalItem | undefined;
  busy: boolean;
  /** Links to the Studio exist only when a backend is connected. */
  studioLinks: boolean;
  /** A recorded conversation: cards are shown as they were, without buttons. */
  readOnly?: boolean;
}

function Chip({ children, onClick, disabled }: { children: React.ReactNode; onClick(): void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="min-h-9 rounded-full border border-line bg-surface px-3 text-sm font-semibold text-ink-soft transition hover:border-primary hover:text-primary disabled:opacity-50"
    >
      {children}
    </button>
  );
}

const box = 'mt-3 rounded-2xl border border-line bg-surface p-4';

export function DirectorCardView({ card, actions, latest }: { card: DirectorCard; actions: CardActions; latest: boolean }) {
  switch (card.kind) {
    case 'QUESTION':
      if (!latest || (!card.suggestions.length && !card.skippable)) return null;
      return (
        <div className="mt-3 flex flex-wrap gap-2">
          {card.suggestions.map((s) => (
            <Chip key={s} onClick={() => actions.say(s)} disabled={actions.busy}>
              {s}
            </Chip>
          ))}
          {card.skippable && (
            <Chip onClick={() => actions.say('דלג')} disabled={actions.busy}>
              דלג על השאלה
            </Chip>
          )}
        </div>
      );

    case 'RECOMMENDATION': {
      const r = card.recommendation;
      return (
        <div className={box}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="primary">המלצה</Badge>
            <span className="font-bold">{r.title}</span>
          </div>
          <dl className="mt-3 grid gap-2 text-sm">
            <Row label="המטרה">{OBJECTIVE[r.objective] ?? r.objective}</Row>
            <Row label="למה">{r.reasoning}</Row>
            {card.conversion && (
              <Row label="לאן הלקוח יגיע">
                {ACTION[card.conversion.action] ?? card.conversion.action}
                {card.conversion.destination && (
                  <bdi className="ms-1 text-muted" dir="ltr">
                    ({card.conversion.destination})
                  </bdi>
                )}
                {!card.conversion.exists && <span className="ms-1 text-warn">· עוד אין יעד כזה</span>}
              </Row>
            )}
            {r.informationUsed.length > 0 && <Row label="על מה התבססתי">{r.informationUsed.join(' · ')}</Row>}
            {r.missingInformation.length > 0 && <Row label="מה חסר">{r.missingInformation.join(' · ')}</Row>}
            <Row label="הצעד הבא">{r.proposedAction}</Row>
            <Row label="עלות">{r.costNote}</Row>
          </dl>
          {r.approvalRequired && <p className="mt-2 text-xs font-semibold text-warn">ידרוש אישור שלך לפני ביצוע</p>}
        </div>
      );
    }

    case 'CONCEPTS':
      return (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {card.concepts.map((c, i) => (
            <div key={c.id} className={cn('flex flex-col rounded-2xl border bg-surface p-4', c.recommended ? 'border-primary' : 'border-line')}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-muted">רעיון {i + 1}</span>
                {c.recommended && <Badge tone="primary">מומלץ</Badge>}
              </div>
              <p className="mt-1 font-bold">{c.title}</p>
              <p className="mt-1 flex-1 text-sm text-ink-soft">{c.hook}</p>
              {latest && (
                <button
                  type="button"
                  disabled={actions.busy}
                  onClick={() => actions.say(`רעיון ${i + 1}`)}
                  className="mt-3 min-h-9 rounded-full bg-primary-soft text-sm font-bold text-primary-ink hover:bg-primary hover:text-white disabled:opacity-50"
                >
                  לבחור ברעיון הזה
                </button>
              )}
            </div>
          ))}
        </div>
      );

    case 'APPROVAL': {
      if (actions.readOnly)
        return (
          <div className={box}>
            <Badge tone="warn">כרטיס אישור: {APPROVAL_KIND_LABELS[card.approvalKind]}</Badge>
            <p className="mt-1 font-bold">{card.title}</p>
            {card.details.length > 0 && <p className="mt-1 text-sm text-ink-soft">{card.details.join(' · ')}</p>}
          </div>
        );
      const current = actions.approval(card.approvalId);
      const status = current?.status ?? 'PENDING';
      return (
        <div className={cn(box, status === 'PENDING' && 'border-warn/50 bg-warn-soft/40')}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status === 'PENDING' ? 'warn' : status === 'EXECUTED' || status === 'APPROVED' ? 'success' : 'neutral'}>
              {status === 'PENDING' ? `מחכה לאישור: ${APPROVAL_KIND_LABELS[card.approvalKind]}` : STATUS_TEXT[status]}
            </Badge>
            <span className="font-bold">{card.title}</span>
          </div>
          {card.details.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-sm text-ink-soft">
              {card.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">{card.estimatedCostUsd > 0 ? `עלות משוערת: $${card.estimatedCostUsd.toFixed(2)}` : 'ללא עלות'} · שום דבר לא מתפרסם</p>
          {status === 'PENDING' && (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={actions.busy}
                onClick={() => actions.decide(card.approvalId, 'APPROVED')}
                className="min-h-10 rounded-full bg-primary px-5 text-sm font-bold text-white hover:bg-primary-ink disabled:opacity-50"
              >
                אישור
              </button>
              <button
                type="button"
                disabled={actions.busy}
                onClick={() => actions.decide(card.approvalId, 'REJECTED')}
                className="min-h-10 rounded-full border border-line px-5 text-sm font-bold text-ink-soft hover:border-ink/30 disabled:opacity-50"
              >
                לא עכשיו
              </button>
            </div>
          )}
        </div>
      );
    }

    case 'CREATIVE':
      return (
        <div className={box}>
          <p className="text-sm font-bold">כיווני עיצוב · {card.title}</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-3">
            {card.directions.map((d) => (
              <li key={d.key} className="rounded-xl bg-canvas p-3 text-sm">
                <span className="font-bold">
                  <bdi>{d.key}</bdi> · {d.name}
                </span>
                <p className="mt-1 text-ink-soft">{d.headline}</p>
              </li>
            ))}
          </ul>
          {actions.studioLinks && (
            <Link href={`/studio/projects/${card.projectId}`} className="mt-2 inline-block text-sm font-bold text-primary hover:underline">
              לראות את המודעות בסטודיו ←
            </Link>
          )}
        </div>
      );

    case 'CLARIFY':
      return (
        <div className="mt-3 flex flex-wrap gap-2">
          {card.options.map((o, i) => (
            <Chip key={o.id} onClick={() => actions.say(String(i + 1))} disabled={!latest || actions.busy}>
              {i + 1}. {o.label}
            </Chip>
          ))}
        </div>
      );

    case 'FACTS':
      return (
        <ul className={cn(box, 'grid gap-1 text-sm')}>
          {card.facts.map((f) => (
            <li key={f.key}>
              <span className="font-semibold">{f.label}:</span> {f.value}
            </li>
          ))}
        </ul>
      );

    case 'STATUS':
      if (!card.items.length) return null;
      return (
        <ul className={cn(box, 'grid gap-2 text-sm')}>
          {card.items.map((i, n) => (
            <li key={`${i.label}-${n}`} className="flex flex-wrap items-center justify-between gap-2">
              {i.href && actions.studioLinks ? (
                <Link href={i.href} className="font-semibold text-primary hover:underline">
                  {i.label}
                </Link>
              ) : (
                <span className="font-semibold">{i.label}</span>
              )}
              <Badge>{i.state}</Badge>
            </li>
          ))}
        </ul>
      );
  }
}

const STATUS_TEXT: Record<ApprovalItem['status'], string> = {
  PENDING: 'ממתין',
  APPROVED: 'אושר',
  EXECUTED: 'אושר ובוצע',
  REJECTED: 'לא אושר / הוחלף',
  FAILED: 'אושר, הביצוע נכשל',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2">
      <dt className="font-semibold text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** What the Director did in this turn, in plain Hebrew (collapsed by default). */
export function ToolActivity({ tools }: { tools: ToolCallRecord[] }) {
  if (!tools.length) return null;
  const notable = tools.filter((t) => t.status !== 'DONE');
  return (
    <details className="mt-2 text-xs text-muted" open={notable.length > 0}>
      <summary className="cursor-pointer select-none">מה עשיתי ({tools.length})</summary>
      <ul className="mt-1 grid gap-0.5">
        {tools.map((t, i) => (
          <li key={i} className={cn(t.status === 'FAILED' && 'text-accent', t.status === 'REFUSED' && 'text-warn')}>
            {t.status === 'DONE' ? '✓' : t.status === 'WAITING_FOR_APPROVAL' ? '⏳' : t.status === 'REFUSED' ? '⛔' : '✗'} {TOOL_LABELS[t.tool]}
            {t.status === 'REFUSED' && ' · נחסם: דורש אישור שלך'}
            {t.status === 'FAILED' && ' · נכשל'}
          </li>
        ))}
      </ul>
    </details>
  );
}
