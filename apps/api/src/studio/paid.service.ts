import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  BudgetDeniedError,
  ConcurrencyGate,
  evaluateGenerationRequest,
  type BudgetPolicy,
} from '@kampora/cost-engine';
import { GuardedLlmProvider, type PaidCallAuthorizer } from '@kampora/creative-engine';
import { approvals, spentUsdFor, type Database } from '@kampora/database';
import type { LlmProvider } from '@kampora/media-providers';
import type { AuthContext } from '../common/auth';
import { ApiError } from '../common/errors';
import type { CreativeProviderInfo } from '../infra/creative-provider';
import { BUDGET_POLICY, CREATIVE_PROVIDER, DATABASE } from '../infra/tokens';
import { BufferedUsageRecorder } from './usage-recorder';

/** Typical prompt size of a concepts/storyboard call (system + business + brief JSON), in characters. */
const TYPICAL_PROMPT_CHARS = 7_000;
const CREATIVE_CALLS = 2; // concepts + storyboard

export interface CreativeQuote {
  provider: string;
  model: string;
  paid: boolean;
  ready: boolean;
  reason?: string;
  /** Expected cost of the normal flow (one concepts call + one storyboard call, worst-case output). */
  expectedUsd: number;
  /** Ceiling the customer approves: includes bounded retries. Spend can never exceed it. */
  maxUsd: number;
}

const roundUp = (usd: number) => Math.ceil(usd * 100) / 100;

/**
 * Central gate for paid creative generation. A paid call runs only if the provider is enabled AND configured,
 * the global kill switch is on, the customer approved a ceiling for this campaign, and the call fits
 * per-call / approved / project limits and the concurrency cap.
 */
@Injectable()
export class PaidOperationsService {
  private readonly gate = new ConcurrencyGate();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(BUDGET_POLICY) private readonly policy: BudgetPolicy,
    @Inject(CREATIVE_PROVIDER) private readonly creative: CreativeProviderInfo,
  ) {}

  creativeQuote(): CreativeQuote {
    const perCall = this.creative.estimateCallUsd({ system: '', prompt: 'x'.repeat(TYPICAL_PROMPT_CHARS) });
    const expectedUsd = roundUp(perCall * CREATIVE_CALLS);
    return {
      provider: this.creative.id,
      model: this.creative.model,
      paid: this.creative.paid,
      ready: this.creative.ready,
      reason: this.creative.reason,
      expectedUsd,
      maxUsd: roundUp(perCall * CREATIVE_CALLS * this.policy.maxAttemptsPerAsset),
    };
  }

  /** Validates the customer's approval before a campaign is created with a paid provider. */
  assertCreativeApproval(approvedMaxUsd: number | undefined): CreativeQuote {
    const quote = this.creativeQuote();
    if (!this.creative.ready || !this.creative.provider) {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'PROVIDER_NOT_CONFIGURED',
        'Creative AI provider is not configured',
        {
          reason: quote.reason,
        },
      );
    }
    if (!quote.paid) return quote;
    if (!this.policy.paidGenerationEnabled) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'PAID_GENERATION_DISABLED',
        'Paid generation is disabled (KAMPORA_ALLOW_PAID_GENERATION)',
      );
    }
    if (approvedMaxUsd === undefined || approvedMaxUsd + 1e-9 < quote.maxUsd) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'PAID_APPROVAL_REQUIRED',
        'Approve the AI generation cost first',
        { quote },
      );
    }
    if (approvedMaxUsd > this.policy.projectMaxUsd) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        'BUDGET_EXCEEDED',
        'Approved amount exceeds the project budget',
      );
    }
    return quote;
  }

  async recordCreativeApproval(ctx: AuthContext, briefId: string, approvedMaxUsd: number) {
    await this.db.insert(approvals).values({
      orgId: ctx.orgId,
      campaignBriefId: briefId,
      subject: 'CREATIVE_GENERATION',
      subjectRef: `${this.creative.id}:${this.creative.model}`,
      decision: 'APPROVED',
      approvedEstimateMicroUsd: Math.round(approvedMaxUsd * 1_000_000),
      decidedBy: ctx.userId,
    });
  }

  private async approvedCreativeUsd(ctx: AuthContext, briefId: string): Promise<number> {
    const rows = await this.db
      .select({ amount: approvals.approvedEstimateMicroUsd })
      .from(approvals)
      .where(
        and(
          eq(approvals.orgId, ctx.orgId),
          eq(approvals.campaignBriefId, briefId),
          eq(approvals.subject, 'CREATIVE_GENERATION'),
          eq(approvals.decision, 'APPROVED'),
        ),
      );
    return rows.reduce((sum, r) => sum + r.amount, 0) / 1_000_000;
  }

  /**
   * The provider to use for one campaign's creative steps, plus its usage recorder. Paid providers are wrapped
   * so that every call (retries included) is authorized against the campaign's approved ceiling.
   */
  creativeProviderFor(
    ctx: AuthContext,
    briefId: string,
  ): { provider: LlmProvider; recorder: BufferedUsageRecorder } {
    const info = this.creative;
    if (!info.ready || !info.provider) {
      throw new ApiError(
        HttpStatus.SERVICE_UNAVAILABLE,
        'PROVIDER_NOT_CONFIGURED',
        'Creative AI provider is not configured',
        {
          reason: info.reason,
        },
      );
    }
    const recorder = new BufferedUsageRecorder({ provider: info.id, model: info.model, paid: info.paid });
    if (!info.paid) return { provider: info.provider, recorder };

    let inFlight = 0;
    let settledHere = 0;
    const releases: Array<() => void> = [];
    const authorizer: PaidCallAuthorizer = {
      authorize: async (estimateUsd, attempt) => {
        const [approved, spent] = await Promise.all([
          this.approvedCreativeUsd(ctx, briefId),
          spentUsdFor(this.db, ctx.orgId, { briefIds: [briefId] }),
        ]);
        const decision = evaluateGenerationRequest(
          {
            ...this.policy,
            projectMaxUsd: Math.min(approved, this.policy.projectMaxUsd),
            requireApprovalForPaid: true,
          },
          {
            confirmedSpendUsd: spent + settledHere,
            reservedUsd: inFlight,
            activePaidGenerations: this.gate.count,
          },
          // Second line of defense besides the step runner: calls per task beyond MAX_GENERATION_ATTEMPTS are refused.
          { estimatedUsd: estimateUsd, attempt, paid: true, approved: approved > 0 },
        );
        if (!decision.allowed) throw new BudgetDeniedError(decision.reasons);
        inFlight += estimateUsd;
        releases.push(this.gate.acquire());
      },
      settle: (estimateUsd, usage) => {
        inFlight = Math.max(0, inFlight - estimateUsd);
        settledHere += usage?.costUsd ?? 0;
        releases.shift()?.();
      },
    };
    const provider = new GuardedLlmProvider(
      info.provider,
      (request) => info.estimateCallUsd(request),
      authorizer,
      (estimate) => recorder.recordEstimate(estimate),
    );
    return { provider, recorder };
  }
}
