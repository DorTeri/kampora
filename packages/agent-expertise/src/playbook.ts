import type { AgentRole, CampaignGoal } from '@kampora/shared';

/**
 * A professional method an agent may use. Methods are tools, not templates: the agent picks the ones that fit
 * the brief, and `goals` keeps prompts small by sending only the methods relevant to the campaign goal.
 */
export interface Method {
  id: string;
  name: string;
  /** When a professional reaches for it. */
  when: string;
  /** How it is done well. */
  how: string;
  /** The common way it goes wrong. */
  avoid?: string;
  /** Goals it serves; absent = any goal. */
  goals?: readonly CampaignGoal[];
}

export interface PlaybookExample {
  situation: string;
  good: string;
  weak?: string;
  why: string;
}

/**
 * A versioned role skill. The version is recorded on everything the role produces, so a change to the
 * expertise can be evaluated against the fixed evaluation set and rolled back.
 */
export interface Playbook {
  id: string;
  /** Semantic version of the content; bump it whenever methods, rules or wording change. */
  version: string;
  role: AgentRole;
  responsibility: string;
  requiredContext: readonly string[];
  methods: readonly Method[];
  constraints: readonly string[];
  decisionRules: readonly string[];
  outputs: readonly string[];
  examples: readonly PlaybookExample[];
  failureModes: readonly string[];
  /** Rubric criteria (evaluation-rubrics.ts) that judge this role's work. */
  evaluationCriteria: readonly string[];
}

export const playbookTag = (p: Pick<Playbook, 'id' | 'version'>) => `${p.id}@${p.version}`;
