import { emptyDirectorState, type DirectorConversationState, type DirectorTask } from '@kampora/shared';
import { RuleBasedDirectorBrain, type DirectorBrain } from './brain';
import { DirectorEngine, type DecisionResult, type TurnResult } from './engine';
import { SandboxDirectorExecutor, type SandboxState } from './sandbox-executor';
import type { CostContext } from './strategy';

/**
 * A complete Director held in memory: engine + rule-based brain + sandbox tools. Used by tests and by the
 * browser demo (labelled as a sandbox; nothing is stored on a server and no AI is called).
 */
export class DirectorSandbox {
  state: DirectorConversationState = emptyDirectorState();
  tasks: DirectorTask[] = [];
  readonly executor: SandboxDirectorExecutor;
  private readonly engine: DirectorEngine;

  constructor(
    opts: {
      now?: () => Date;
      brain?: DirectorBrain;
      cost?: CostContext & { paidEnabled: boolean };
      data?: SandboxState;
      newId?: () => string;
    } = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.cost = opts.cost ?? { creativeUsd: 0, providerPaid: false, paidEnabled: false };
    const newId = opts.newId ?? (() => crypto.randomUUID());
    this.executor = new SandboxDirectorExecutor(opts.data, newId, this.now);
    this.engine = new DirectorEngine({ brain: opts.brain ?? new RuleBasedDirectorBrain(), tools: this.executor, actions: this.executor, newId });
  }

  private readonly now: () => Date;
  private readonly cost: CostContext & { paidEnabled: boolean };

  private context() {
    return { now: this.now(), state: this.state, facts: this.executor.data.facts, tasks: this.tasks, approvals: this.executor.data.approvals, cost: this.cost };
  }

  private apply(result: TurnResult) {
    this.state = result.state;
    for (const t of result.tasks) {
      const i = this.tasks.findIndex((x) => x.id === t.id);
      if (i >= 0) this.tasks[i] = t;
      else this.tasks.push(t);
    }
    for (const id of result.superseded) {
      const a = this.executor.data.approvals.find((x) => x.id === id);
      if (a && a.status === 'PENDING') a.status = 'REJECTED';
    }
  }

  async send(text: string): Promise<TurnResult> {
    const result = await this.engine.turn(text, this.context());
    this.apply(result);
    return result;
  }

  async decide(approvalId: string, decision: 'APPROVED' | 'REJECTED'): Promise<DecisionResult> {
    const result = await this.engine.decideApproval(approvalId, decision, this.context());
    this.apply(result);
    const a = this.executor.data.approvals.find((x) => x.id === approvalId);
    if (a && a.status === 'PENDING') a.status = result.approvalStatus;
    return result;
  }

  pending() {
    return this.executor.data.approvals.filter((a) => a.status === 'PENDING');
  }
}
