import {
  DirectorSandbox,
  FACT_SPECS,
  decideFacts,
  displayFact,
  factState,
  memoryOf,
  recommend,
} from '@kampora/creative-engine/director';
import type { DirectorMessageDto, DirectorWorkspaceDto } from '@/lib/director';
import type { DirectorPort } from './workspace';

const COST = { creativeUsd: 0, providerPaid: false, paidEnabled: false };

/**
 * The Director running entirely in the browser: the same engine and rule-based understanding as the server, with
 * in-memory tools that make no AI call and store nothing. Used only in the labelled demo.
 */
export function sandboxPort(): { port: DirectorPort; initial: DirectorWorkspaceDto } {
  const sandbox = new DirectorSandbox({ cost: COST });
  const messages: DirectorMessageDto[] = [];
  const push = (role: DirectorMessageDto['role'], text: string, cards: DirectorMessageDto['cards'] = [], tools: DirectorMessageDto['tools'] = []) =>
    messages.push({ id: `${messages.length}-${role}`, role, text, cards, tools, createdAt: new Date().toISOString() });

  async function load(): Promise<DirectorWorkspaceDto> {
    const now = new Date();
    const data = sandbox.executor.data;
    const history = await sandbox.executor.GetCampaignHistory({});
    const memory = memoryOf(data.facts);
    const name = memory['business.name'];
    return {
      id: 'sandbox',
      title: name && typeof name.value === 'string' ? name.value : 'עסק לדוגמה',
      businessId: data.facts.length ? 'sandbox' : null,
      messages: [...messages],
      memory: data.facts.map((f) => ({
        key: f.key,
        label: FACT_SPECS[f.key].label,
        value: displayFact(f.key, f.value),
        source: f.source,
        status: f.status,
        state: factState(f, now),
        updatedAt: f.updatedAt,
      })),
      pending: data.approvals.filter((a) => a.status === 'PENDING').map(({ payload: _p, ...a }) => a),
      decided: data.approvals.filter((a) => a.status !== 'PENDING').map(({ payload: _p, ...a }) => a),
      status: await sandbox.executor.GetProductionStatus({}),
      work: history,
      previews: [],
      recommendations: recommend({ memory, now, history, approvals: data.approvals, cost: COST }),
      paidGenerationEnabled: false,
    };
  }

  const port: DirectorPort = {
    load,
    async send(text) {
      push('OWNER', text);
      const r = await sandbox.send(text);
      push('DIRECTOR', r.text, r.cards, r.tools);
    },
    async decide(approvalId, decision) {
      const a = sandbox.executor.data.approvals.find((x) => x.id === approvalId);
      push('OWNER', `${decision === 'APPROVED' ? '✓ אישרתי' : '✗ לא אישרתי'}: ${a?.title ?? ''}`);
      const r = await sandbox.decide(approvalId, decision);
      push('DIRECTOR', r.text, r.cards, r.tools);
    },
    async decideFact(key, decision) {
      const data = sandbox.executor.data;
      const { changed } = decideFacts(memoryOf(data.facts), [key], decision, new Date());
      for (const f of changed) {
        const i = data.facts.findIndex((x) => x.key === f.key);
        if (i >= 0) data.facts[i] = f;
        else data.facts.push(f);
      }
    },
  };
  return {
    port,
    initial: { id: 'sandbox', title: 'עסק לדוגמה', businessId: null, messages: [], memory: [], pending: [], decided: [], status: [], work: [], previews: [], recommendations: [], paidGenerationEnabled: false },
  };
}
