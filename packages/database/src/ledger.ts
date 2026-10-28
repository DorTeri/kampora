import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { LedgerEntry } from '@kampora/cost-engine';
import type { ChargeType, OperationType } from '@kampora/shared';
import type { Database } from './client';
import { costLedger, usageEvents } from './schema';

export interface RecordUsageInput {
  orgId: string;
  videoProjectId?: string | null;
  campaignBriefId?: string | null;
  operation: OperationType;
  provider: string;
  model: string;
  quantity: number;
  unit: string;
  step?: string;
  chargeType: ChargeType;
  amountMicroUsd: number;
  attempt?: number;
  success: boolean;
  reused?: boolean;
  accepted?: boolean;
  note?: string;
  metadata?: Record<string, unknown>;
}

/** Writes a usage event and its ledger line atomically. Simulated and real charges are never mixed. */
export async function recordUsage(db: Database, input: RecordUsageInput): Promise<void> {
  await db.transaction(async (tx) => {
    const [event] = await tx
      .insert(usageEvents)
      .values({
        orgId: input.orgId,
        videoProjectId: input.videoProjectId ?? null,
        operation: input.operation,
        provider: input.provider,
        model: input.model,
        quantity: input.quantity,
        unit: input.unit,
        step: input.step,
        metadata: input.metadata ?? {},
      })
      .returning({ id: usageEvents.id });
    await tx.insert(costLedger).values({
      orgId: input.orgId,
      videoProjectId: input.videoProjectId ?? null,
      campaignBriefId: input.campaignBriefId ?? null,
      usageEventId: event!.id,
      operation: input.operation,
      provider: input.provider,
      model: input.model,
      chargeType: input.chargeType,
      amountMicroUsd: input.amountMicroUsd,
      attempt: input.attempt ?? 1,
      success: input.success,
      reused: input.reused ?? false,
      accepted: input.accepted,
      note: input.note,
    });
  });
}

/** Ledger lines for a project plus the creative steps of its campaign brief. */
export async function ledgerEntriesFor(
  db: Database,
  orgId: string,
  scope: { projectIds?: string[]; briefIds?: string[] },
): Promise<LedgerEntry[]> {
  const conditions = [
    scope.projectIds?.length ? inArray(costLedger.videoProjectId, scope.projectIds) : undefined,
    scope.briefIds?.length ? inArray(costLedger.campaignBriefId, scope.briefIds) : undefined,
  ].filter((c) => c !== undefined);
  if (!conditions.length) return [];
  const rows = await db
    .select()
    .from(costLedger)
    .where(and(eq(costLedger.orgId, orgId), or(...conditions)));
  return rows.map((r) => ({
    operation: r.operation,
    provider: r.provider,
    model: r.model,
    chargeType: r.chargeType,
    amountMicroUsd: r.amountMicroUsd,
    attempt: r.attempt,
    success: r.success,
    reused: r.reused,
    accepted: r.accepted ?? undefined,
  }));
}

/** Confirmed spend + open estimates for a project, used by the budget guard. */
export async function projectSpend(db: Database, orgId: string, projectId: string) {
  const [row] = await db
    .select({
      confirmed: sql<string>`coalesce(sum(${costLedger.amountMicroUsd}) filter (where ${costLedger.chargeType} = 'CONFIRMED'), 0)`,
      simulated: sql<string>`coalesce(sum(${costLedger.amountMicroUsd}) filter (where ${costLedger.chargeType} = 'SIMULATED'), 0)`,
    })
    .from(costLedger)
    .where(and(eq(costLedger.orgId, orgId), eq(costLedger.videoProjectId, projectId)));
  return { confirmedMicroUsd: Number(row?.confirmed ?? 0), simulatedMicroUsd: Number(row?.simulated ?? 0) };
}
