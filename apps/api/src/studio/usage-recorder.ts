import { usdToMicro } from '@kampora/cost-engine';
import type { CallEstimate, StepUsageEvent, UsageRecorder } from '@kampora/creative-engine';
import { recordUsage, type Database } from '@kampora/database';
import type { ChargeType } from '@kampora/shared';

/**
 * Buffers AI step usage until the owning row exists (e.g. the brief is inserted after its own generation step),
 * then writes usage events + ledger lines. Charge types are never mixed:
 *  - pre-call worst-case estimates → ESTIMATED (reservation lines)
 *  - provider-reported usage → CONFIRMED (verified prices) / ESTIMATED / SIMULATED (mock)
 */
export class BufferedUsageRecorder implements UsageRecorder {
  private readonly events: StepUsageEvent[] = [];
  private readonly estimates: CallEstimate[] = [];

  constructor(private readonly fallback: { provider: string; model: string; paid: boolean }) {}

  async record(event: StepUsageEvent): Promise<void> {
    this.events.push(event);
  }

  recordEstimate(estimate: CallEstimate): void {
    this.estimates.push(estimate);
  }

  async flush(
    db: Database,
    scope: { orgId: string; campaignBriefId?: string; videoProjectId?: string },
  ): Promise<void> {
    for (const e of this.estimates.splice(0)) {
      await recordUsage(db, {
        ...scope,
        operation: 'LLM_COMPLETION',
        provider: this.fallback.provider,
        model: this.fallback.model,
        quantity: 1,
        unit: 'request',
        step: e.step,
        chargeType: 'ESTIMATED',
        amountMicroUsd: usdToMicro(e.estimateUsd),
        attempt: e.attempt,
        success: true,
        note: 'reservation: worst-case pre-call estimate',
      });
    }
    for (const e of this.events.splice(0)) {
      // A failed call without reported usage cost nothing we can see; never label paid traffic as SIMULATED.
      const chargeType: ChargeType = e.usage?.chargeType ?? (this.fallback.paid ? 'CONFIRMED' : 'SIMULATED');
      await recordUsage(db, {
        ...scope,
        operation: 'LLM_COMPLETION',
        provider: e.usage?.provider ?? this.fallback.provider,
        model: e.usage?.model ?? this.fallback.model,
        quantity: 1,
        unit: 'request',
        step: e.step,
        chargeType,
        amountMicroUsd: usdToMicro(e.usage?.costUsd ?? 0),
        attempt: e.attempt,
        success: e.success,
        note: e.error?.slice(0, 500),
        metadata: e.usage
          ? {
              inputTokens: e.usage.inputTokens,
              cachedInputTokens: e.usage.cachedInputTokens,
              outputTokens: e.usage.outputTokens,
              requestId: e.usage.requestId,
            }
          : {},
      });
    }
  }
}
