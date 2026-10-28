import { usdToMicro } from '@kampora/cost-engine';
import type { StepUsageEvent, UsageRecorder } from '@kampora/creative-engine';
import { recordUsage, type Database } from '@kampora/database';

/**
 * Buffers AI step usage until the owning row exists (e.g. the brief is inserted after its own generation step),
 * then writes usage events + ledger lines. Mock providers report SIMULATED charges; real providers ESTIMATED or
 * CONFIRMED, never mixed.
 */
export class BufferedUsageRecorder implements UsageRecorder {
  private readonly events: StepUsageEvent[] = [];

  async record(event: StepUsageEvent): Promise<void> {
    this.events.push(event);
  }

  async flush(
    db: Database,
    scope: { orgId: string; campaignBriefId?: string; videoProjectId?: string },
  ): Promise<void> {
    for (const e of this.events.splice(0)) {
      await recordUsage(db, {
        orgId: scope.orgId,
        campaignBriefId: scope.campaignBriefId,
        videoProjectId: scope.videoProjectId,
        operation: 'LLM_COMPLETION',
        provider: e.usage?.provider ?? 'unknown',
        model: e.usage?.model ?? 'unknown',
        quantity: 1,
        unit: 'request',
        step: e.step,
        chargeType: e.usage?.chargeType ?? 'SIMULATED',
        amountMicroUsd: usdToMicro(e.usage?.costUsd ?? 0),
        attempt: e.attempt,
        success: e.success,
        note: e.error,
      });
    }
  }
}
