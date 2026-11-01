import demo from '@/demo/studio-demo.json';
import type { ReviewCase } from './review';

/** The recorded Q7 demo: real Q6 pilot copy, deterministic directions, critique and revisions ($0). */
export const DEMO = demo as unknown as { generatedAt: string; costUsd: number; provenance: string; cases: (ReviewCase & { review: ReviewCase['review'] & { input: unknown } })[] };

export function demoCase(id: string) {
  return DEMO.cases.find((c) => c.id === id);
}
