'use client';

import { useActionState } from 'react';
import type { CampaignGoal } from '@kampora/shared';
import { Button, Card, ErrorNote, cn } from '@/components/ui';
import { errorMessage, he } from '@/i18n/he';
import { createCampaignAction, type ActionState } from '../../actions';

const GOALS: CampaignGoal[] = ['OFFER', 'SALES', 'LEADS', 'PRODUCT_PROMO', 'AWARENESS'];

const inputClass =
  'mt-2 block w-full rounded-2xl border border-line bg-surface px-4 py-3 text-base outline-none transition placeholder:text-muted/80 focus:border-primary focus:ring-4 focus:ring-primary/15';

export interface AiCostInfo {
  paid: boolean;
  ready: boolean;
  maxUsd: number;
  /** Pre-formatted ₪ ceiling (computed on the server). */
  maxIls: string;
}

export function CampaignForm({ businessId, ai }: { businessId: string; ai: AiCostInfo }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createCampaignAction, {});

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="businessId" value={businessId} />
      <Card>
        <fieldset>
          <legend className="text-lg font-bold">{he.campaign.goalLabel}</legend>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {GOALS.map((goal, i) => (
              <label
                key={goal}
                className={cn(
                  'group relative flex cursor-pointer flex-col gap-1 rounded-2xl border border-line bg-surface p-4 transition',
                  'has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:shadow-[var(--shadow-lift)] hover:border-ink/30',
                )}
              >
                <input
                  type="radio"
                  name="goal"
                  value={goal}
                  defaultChecked={i === 0}
                  className="peer sr-only"
                />
                <span className="font-bold">{he.campaign.goals[goal].title}</span>
                <span className="text-sm text-muted">{he.campaign.goals[goal].hint}</span>
                <span
                  aria-hidden
                  className="absolute left-4 top-4 hidden size-5 place-items-center rounded-full bg-primary text-xs text-white peer-checked:grid"
                >
                  ✓
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      <Card className="space-y-5">
        <label className="block">
          <span className="font-bold">{he.campaign.productLabel}</span>
          <input
            name="productName"
            required
            maxLength={120}
            placeholder={he.campaign.productPlaceholder}
            defaultValue="קפה ומאפה"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="font-bold">{he.campaign.offerLabel}</span>
          <input
            name="offer"
            maxLength={200}
            placeholder={he.campaign.offerPlaceholder}
            defaultValue="קפה + מאפה ב-29.90 ₪ עד סוף החודש"
            className={inputClass}
          />
          <span className="mt-2 block text-sm text-muted">{he.campaign.offerHint}</span>
        </label>
        <label className="block">
          <span className="font-bold">{he.campaign.notesLabel}</span>
          <textarea name="notes" rows={3} maxLength={1000} className={inputClass} />
        </label>
      </Card>

      <Card className={cn(ai.paid && ai.ready && 'border-primary/30 bg-primary-soft/40')}>
        {!ai.ready ? (
          <p className="font-semibold text-warn">{he.campaign.aiUnavailable}</p>
        ) : ai.paid ? (
          <div className="space-y-3">
            <p className="font-bold">{he.campaign.aiCostTitle}</p>
            <p className="text-sm text-ink-soft">{he.campaign.aiCostLine(ai.maxIls)}</p>
            <input type="hidden" name="aiMaxUsd" value={ai.maxUsd} />
            <label className="flex items-center gap-3 font-semibold">
              <input
                type="checkbox"
                name="aiApproved"
                required
                className="size-5 accent-[var(--color-primary)]"
              />
              {he.campaign.aiCostApprove}
            </label>
          </div>
        ) : (
          <p className="text-sm text-muted">{he.campaign.aiDemoMode}</p>
        )}
      </Card>

      {state.error && <ErrorNote message={errorMessage(state.error)} />}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !ai.ready} className="min-w-56">
          {pending ? (
            <>
              <span
                aria-hidden
                className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
              />
              {he.campaign.submitting}
            </>
          ) : (
            <>✦ {he.campaign.submit}</>
          )}
        </Button>
      </div>
    </form>
  );
}
