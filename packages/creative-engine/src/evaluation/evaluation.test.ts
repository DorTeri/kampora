import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { MockCreativeLlmProvider } from '../mock-provider';
import { compactRun, runEvaluation, type CompactRun, type EvaluationRun } from './runner';

/**
 * Quality regression on the fixed evaluation set (mock provider: deterministic, no cost). The baseline is the
 * reviewed result of the current expertise; a change that adds a serious problem fails here. Intentional changes
 * are recorded by regenerating it: UPDATE_EVAL_BASELINE=1 npx vitest run packages/creative-engine/src/evaluation
 */
const BASELINE = join(__dirname, 'baseline.json');
let run: EvaluationRun;
let baseline: CompactRun;

beforeAll(async () => {
  run = await runEvaluation(new MockCreativeLlmProvider());
  if (process.env.UPDATE_EVAL_BASELINE)
    writeFileSync(BASELINE, `${JSON.stringify(compactRun(run), null, 2)}\n`);
  baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as CompactRun;
});

describe('evaluation set', () => {
  it('meets every scenario expectation (industry, focal point, offer subjects, no serious static-ad problem)', () => {
    const failed = run.scenarios.flatMap((s) =>
      s.checks.filter((c) => !c.pass).map((c) => `${s.id}/${c.id}: ${c.observed}`),
    );
    expect(failed).toEqual([]);
  });

  it('adds no serious problem the baseline did not have', () => {
    const now = compactRun(run);
    for (const s of now.scenarios) {
      const before = baseline.scenarios.find((b) => b.id === s.id);
      expect(before, `scenario ${s.id} missing from the baseline`).toBeDefined();
      for (const [review, serious] of Object.entries(s.serious))
        for (const criterion of serious)
          expect(
            before!.serious[review] ?? [],
            `${s.id}/${review}: new serious problem ${criterion}`,
          ).toContain(criterion);
    }
  });

  it('keeps the reviewed creative decisions unless the baseline is updated on purpose', () => {
    const now = compactRun(run);
    expect(now.scenarios.map((s) => [s.id, s.layoutFamily, s.primaryFocal, s.formats])).toEqual(
      baseline.scenarios.map((s) => [s.id, s.layoutFamily, s.primaryFocal, s.formats]),
    );
    expect(now.versions).toEqual(baseline.versions);
  });

  it('varies composition across businesses and goals, and costs nothing with the mock', () => {
    expect(run.aggregate.distinctLayoutFamilies).toBeGreaterThanOrEqual(3);
    for (const s of run.scenarios) expect(s.chargeTypes).toEqual(['SIMULATED']);
    expect(run.note).toMatch(/not that the ads persuade/);
  });

  it('builds a video for every scenario (mock pictures stand in for generated ones)', () => {
    for (const s of run.scenarios) expect(s.reviews.video).not.toHaveProperty('error');
  });
});
