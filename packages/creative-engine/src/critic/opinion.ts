import { rubricCriterion } from '@kampora/agent-expertise';
import type { CriterionResult } from '@kampora/shared';
import { z } from 'zod';
import { runReasoningStep } from '../step-runner';
import type { StepContext } from '../steps';

export const CritiqueOpinionInputSchema = z.object({
  kind: z.enum(['CONCEPT_SET', 'STATIC_AD']),
  /** Subjective rubric criteria only (method LLM_OPINION). */
  criteria: z.array(z.string()).min(1).max(6),
  /** The work as plain data: copy, layout family, hierarchy. Never images. */
  work: z.record(z.string(), z.unknown()),
});
export type CritiqueOpinionInput = z.infer<typeof CritiqueOpinionInputSchema>;

export const CritiqueOpinionLlmSchema = z.object({
  opinions: z.array(
    z.object({
      criterion: z.string(),
      /** 1–5, or null when the model cannot judge from the data given. */
      score: z.number().int().min(1).max(5).nullable(),
      explanation: z.string(),
      evidence: z.array(z.string()),
    }),
  ),
});
export type CritiqueOpinionLlm = z.infer<typeof CritiqueOpinionLlmSchema>;

const SYSTEM = [
  'You are a senior creative director reviewing Hebrew ads for small Israeli businesses.',
  'Give an opinion on each listed criterion only, from the data given. Quote the words you judge as evidence.',
  'Return score null when the data is not enough to judge. Do not invent facts about the business or its market.',
].join(' ');

/**
 * The optional opinion pass on the subjective criteria. It is an opinion, never proof of quality: results are
 * labelled LLM_OPINION, can at most be MINOR (they never send work back on their own), and people decide. It
 * runs only on a free provider unless the caller has approval to spend.
 */
export async function critiqueOpinion(
  input: CritiqueOpinionInput,
  ctx: StepContext & { allowPaid?: boolean },
): Promise<CriterionResult[]> {
  if (ctx.provider.paid && !ctx.allowPaid) return [];
  const { output } = await runReasoningStep({
    name: 'creative.critique',
    system: SYSTEM,
    input,
    inputSchema: CritiqueOpinionInputSchema,
    outputSchema: CritiqueOpinionLlmSchema,
    schemaName: 'critique_opinion',
    buildPrompt: (i) =>
      [
        `Kind of work: ${i.kind}.`,
        `Criteria: ${i.criteria.map((c) => `${c} (${rubricCriterion(c).standard})`).join('; ')}.`,
        `<work>${JSON.stringify(i.work)}</work>`,
      ].join('\n'),
    postValidate: (o, i) =>
      o.opinions
        .filter((x) => !i.criteria.includes(x.criterion))
        .map((x) => `Unknown criterion ${x.criterion}.`),
    provider: ctx.provider,
    recorder: ctx.recorder,
  });
  return output.opinions.map((o): CriterionResult => {
    const c = rubricCriterion(o.criterion);
    return {
      criterion: o.criterion,
      dimension: c.dimension,
      score: o.score,
      method: 'LLM_OPINION',
      explanation: `Opinion (${ctx.provider.id}): ${o.explanation}`,
      evidence: o.evidence.slice(0, 6),
      severity: o.score !== null && o.score <= 2 ? 'MINOR' : 'OK',
      component: c.component,
    };
  });
}

/** Puts opinions in place of the "not measured" entries for the same criteria. */
export function withOpinions(results: CriterionResult[], opinions: CriterionResult[]): CriterionResult[] {
  return results.map((r) => {
    const o =
      r.score === null && r.method === 'LLM_OPINION'
        ? opinions.find((x) => x.criterion === r.criterion)
        : undefined;
    return o ? { ...o, target: r.target } : r;
  });
}
