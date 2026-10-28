import { describe, expect, it } from 'vitest';
import { DEFAULT_PRICE_CATALOG, PriceCatalog, usdToMicro } from './catalog';
import { evaluateGenerationRequest, type BudgetPolicy } from './budget';
import { canonicalJson, generationIdempotencyKey, summarizeLedger } from './ledger';

const policy: BudgetPolicy = {
  projectMaxUsd: 5,
  perGenerationMaxUsd: 1,
  maxAttemptsPerAsset: 2,
  maxConcurrentPaidGenerations: 2,
  requireApprovalForPaid: true,
  paidGenerationEnabled: true,
};
const idle = { confirmedSpendUsd: 0, reservedUsd: 0, activePaidGenerations: 0 };

describe('evaluateGenerationRequest', () => {
  it('allows an approved paid request within all limits', () => {
    const d = evaluateGenerationRequest(policy, idle, {
      estimatedUsd: 0.5,
      attempt: 1,
      paid: true,
      approved: true,
    });
    expect(d).toEqual({ allowed: true, reasons: [], remainingUsd: 5 });
  });

  it('requires approval for paid generation', () => {
    const d = evaluateGenerationRequest(policy, idle, {
      estimatedUsd: 0.1,
      attempt: 1,
      paid: true,
      approved: false,
    });
    expect(d.reasons).toEqual(['APPROVAL_REQUIRED']);
  });

  it('blocks paid generation when the kill switch is off', () => {
    const d = evaluateGenerationRequest({ ...policy, paidGenerationEnabled: false }, idle, {
      estimatedUsd: 0.1,
      attempt: 1,
      paid: true,
      approved: true,
    });
    expect(d.reasons).toContain('PAID_GENERATION_DISABLED');
  });

  it('enforces per-generation, project budget, attempts and concurrency limits', () => {
    const d = evaluateGenerationRequest(
      policy,
      { confirmedSpendUsd: 4.5, reservedUsd: 0.4, activePaidGenerations: 2 },
      { estimatedUsd: 1.2, attempt: 3, paid: true, approved: true },
    );
    expect(d.allowed).toBe(false);
    expect(d.reasons.sort()).toEqual(
      ['CONCURRENCY_LIMIT', 'MAX_ATTEMPTS', 'PER_GENERATION_LIMIT', 'PROJECT_BUDGET_EXCEEDED'].sort(),
    );
    expect(d.remainingUsd).toBeCloseTo(0.1);
  });

  it('never blocks free work on money, only on attempts', () => {
    const d = evaluateGenerationRequest(
      { ...policy, paidGenerationEnabled: false },
      { confirmedSpendUsd: 99, reservedUsd: 0, activePaidGenerations: 9 },
      { estimatedUsd: 0, attempt: 1, paid: false, approved: false },
    );
    expect(d.allowed).toBe(true);
  });
});

describe('ledger', () => {
  it('keeps simulated, estimated and confirmed apart and computes cost per accepted asset', () => {
    const s = summarizeLedger([
      {
        operation: 'IMAGE_GENERATION',
        provider: 'p',
        model: 'm',
        chargeType: 'ESTIMATED',
        amountMicroUsd: usdToMicro(0.05),
        attempt: 1,
        success: true,
      },
      {
        operation: 'IMAGE_GENERATION',
        provider: 'p',
        model: 'm',
        chargeType: 'CONFIRMED',
        amountMicroUsd: usdToMicro(0.04),
        attempt: 1,
        success: false,
      },
      {
        operation: 'IMAGE_GENERATION',
        provider: 'p',
        model: 'm',
        chargeType: 'CONFIRMED',
        amountMicroUsd: usdToMicro(0.04),
        attempt: 2,
        success: true,
        accepted: true,
      },
      {
        operation: 'RENDER',
        provider: 'local',
        model: 'remotion',
        chargeType: 'SIMULATED',
        amountMicroUsd: usdToMicro(0.01),
        attempt: 1,
        success: true,
        accepted: true,
      },
      {
        operation: 'IMAGE_GENERATION',
        provider: 'cache',
        model: 'm',
        chargeType: 'SIMULATED',
        amountMicroUsd: 0,
        attempt: 1,
        success: true,
        reused: true,
      },
    ]);
    expect(s.byChargeTypeUsd).toEqual({ SIMULATED: 0.01, ESTIMATED: 0.05, CONFIRMED: 0.08 });
    expect(s.byOperationUsd).toEqual({ IMAGE_GENERATION: 0.08, RENDER: 0.01 });
    expect(s.failures).toBe(1);
    expect(s.reuseHits).toBe(1);
    expect(s.costPerAcceptedAssetUsd).toBeCloseTo(0.045);
  });
});

describe('idempotency', () => {
  it('produces equal keys for equal inputs regardless of key order', () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
    const k1 = generationIdempotencyKey('p', 'm', 'IMAGE_GENERATION', { prompt: 'x', size: 1024 });
    const k2 = generationIdempotencyKey('p', 'm', 'IMAGE_GENERATION', { size: 1024, prompt: 'x' });
    expect(k1).toBe(k2);
    expect(k1).not.toBe(generationIdempotencyKey('p', 'm', 'IMAGE_GENERATION', { prompt: 'y', size: 1024 }));
  });
});

describe('catalog', () => {
  it('marks every default entry as a planning estimate', () => {
    expect(DEFAULT_PRICE_CATALOG.every((e) => e.basis === 'PLANNING_ESTIMATE')).toBe(true);
    const c = new PriceCatalog(DEFAULT_PRICE_CATALOG);
    expect(c.estimate(c.defaultFor('IMAGE_TO_VIDEO'), 5)).toBeCloseTo(0.6);
  });
});
