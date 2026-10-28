export interface BudgetPolicy {
  projectMaxUsd: number;
  perGenerationMaxUsd: number;
  maxAttemptsPerAsset: number;
  maxConcurrentPaidGenerations: number;
  requireApprovalForPaid: boolean;
  /** Global kill switch: paid providers are never called unless explicitly enabled. */
  paidGenerationEnabled: boolean;
}

export interface BudgetState {
  confirmedSpendUsd: number;
  /** Open reservations (estimates for in-flight paid generations). */
  reservedUsd: number;
  activePaidGenerations: number;
}

export interface GenerationRequestCheck {
  estimatedUsd: number;
  /** 1-based attempt number for this asset. */
  attempt: number;
  paid: boolean;
  approved: boolean;
}

export type BudgetDenialReason =
  | 'PAID_GENERATION_DISABLED'
  | 'APPROVAL_REQUIRED'
  | 'PER_GENERATION_LIMIT'
  | 'PROJECT_BUDGET_EXCEEDED'
  | 'MAX_ATTEMPTS'
  | 'CONCURRENCY_LIMIT';

export interface BudgetDecision {
  allowed: boolean;
  reasons: BudgetDenialReason[];
  remainingUsd: number;
}

export function budgetPolicyFromEnv(env: NodeJS.ProcessEnv = process.env): BudgetPolicy {
  const num = (name: string, fallback: number) => {
    const raw = env[name];
    const value = raw === undefined || raw === '' ? fallback : Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name}: ${raw}`);
    return value;
  };
  return {
    projectMaxUsd: num('PROJECT_MAX_BUDGET_USD', 5),
    perGenerationMaxUsd: num('PER_GENERATION_MAX_USD', 1),
    maxAttemptsPerAsset: num('MAX_GENERATION_ATTEMPTS', 2),
    maxConcurrentPaidGenerations: num('MAX_CONCURRENT_PAID_GENERATIONS', 2),
    requireApprovalForPaid: true,
    paidGenerationEnabled: env.KAMPORA_ALLOW_PAID_GENERATION === 'true',
  };
}

/**
 * Central budget gate. Every expensive generation passes through here before a provider is called.
 * Pure function: callers load state (ledger totals) and persist the reservation themselves.
 */
export function evaluateGenerationRequest(
  policy: BudgetPolicy,
  state: BudgetState,
  request: GenerationRequestCheck,
): BudgetDecision {
  const reasons: BudgetDenialReason[] = [];
  const remainingUsd = Math.max(0, policy.projectMaxUsd - state.confirmedSpendUsd - state.reservedUsd);

  if (request.attempt > policy.maxAttemptsPerAsset) reasons.push('MAX_ATTEMPTS');

  if (request.paid) {
    if (!policy.paidGenerationEnabled) reasons.push('PAID_GENERATION_DISABLED');
    if (policy.requireApprovalForPaid && !request.approved) reasons.push('APPROVAL_REQUIRED');
    if (request.estimatedUsd > policy.perGenerationMaxUsd) reasons.push('PER_GENERATION_LIMIT');
    if (request.estimatedUsd > remainingUsd) reasons.push('PROJECT_BUDGET_EXCEEDED');
    if (state.activePaidGenerations >= policy.maxConcurrentPaidGenerations) reasons.push('CONCURRENCY_LIMIT');
  }

  return { allowed: reasons.length === 0, reasons, remainingUsd };
}
