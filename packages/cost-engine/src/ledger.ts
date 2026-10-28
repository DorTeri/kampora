import { createHash } from 'node:crypto';
import type { ChargeType, OperationType } from '@kampora/shared';
import { microToUsd } from './catalog';

export interface LedgerEntry {
  operation: OperationType;
  provider: string;
  model: string;
  chargeType: ChargeType;
  amountMicroUsd: number;
  attempt: number;
  success: boolean;
  /** True when an existing asset was reused instead of generating (amount is 0). */
  reused?: boolean;
  /** True when the produced asset was accepted for use in the ad. */
  accepted?: boolean;
}

export interface LedgerSummary {
  byChargeTypeUsd: Record<ChargeType, number>;
  byOperationUsd: Partial<Record<OperationType, number>>;
  entries: number;
  attempts: number;
  failures: number;
  reuseHits: number;
  acceptedAssets: number;
  /** (confirmed + simulated) / accepted assets. Estimates are excluded: they are not spend. */
  costPerAcceptedAssetUsd: number | null;
}

export function summarizeLedger(entries: readonly LedgerEntry[]): LedgerSummary {
  const byChargeType: Record<ChargeType, number> = { SIMULATED: 0, ESTIMATED: 0, CONFIRMED: 0 };
  const byOperation: Partial<Record<OperationType, number>> = {};
  let failures = 0;
  let reuseHits = 0;
  let accepted = 0;

  for (const e of entries) {
    byChargeType[e.chargeType] += e.amountMicroUsd;
    if (e.chargeType !== 'ESTIMATED') {
      byOperation[e.operation] = (byOperation[e.operation] ?? 0) + e.amountMicroUsd;
    }
    if (!e.success) failures++;
    if (e.reused) reuseHits++;
    if (e.accepted) accepted++;
  }

  const spentMicro = byChargeType.CONFIRMED + byChargeType.SIMULATED;
  return {
    byChargeTypeUsd: {
      SIMULATED: microToUsd(byChargeType.SIMULATED),
      ESTIMATED: microToUsd(byChargeType.ESTIMATED),
      CONFIRMED: microToUsd(byChargeType.CONFIRMED),
    },
    byOperationUsd: Object.fromEntries(Object.entries(byOperation).map(([k, v]) => [k, microToUsd(v)])),
    entries: entries.length,
    attempts: entries.filter((e) => e.chargeType !== 'ESTIMATED').length,
    failures,
    reuseHits,
    acceptedAssets: accepted,
    costPerAcceptedAssetUsd: accepted ? microToUsd(spentMicro) / accepted : null,
  };
}

/** Canonical JSON: object keys sorted recursively, so equal inputs always hash equally. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Same provider + model + operation + input ⇒ same key ⇒ reuse instead of paying twice. */
export function generationIdempotencyKey(
  provider: string,
  model: string,
  operation: OperationType,
  input: unknown,
): string {
  return sha256(`${provider}|${model}|${operation}|${canonicalJson(input)}`);
}
