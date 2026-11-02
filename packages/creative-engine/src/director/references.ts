import type { DirectorCampaignSummary, RevisionTarget } from '@kampora/shared';
import { normalize } from './hebrew';

/**
 * Which earlier work the owner means ("הסרטון הקודם", "המודעה של ההמבורגר"). A unique match is used; anything
 * ambiguous becomes a clarification question instead of a guess.
 */

export type ReferenceResult =
  | { kind: 'FOUND'; campaign: DirectorCampaignSummary }
  | { kind: 'AMBIGUOUS'; options: DirectorCampaignSummary[] }
  | { kind: 'NONE'; reason: string };

export function campaignLabel(c: DirectorCampaignSummary): string {
  const day = new Date(c.createdAt).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric', timeZone: 'Asia/Jerusalem' });
  return `${c.title} (${day})`;
}

export function resolveReference(
  text: string,
  history: DirectorCampaignSummary[],
  opts: { target: RevisionTarget; reference: 'LATEST' | 'FIRST' | 'NONE'; focusProjectId?: string },
): ReferenceResult {
  // A video change needs a video; a design change needs static ads (or at least a project to build them on).
  const eligible = history.filter((c) => (opts.target === 'DIRECTION' ? c.staticAds > 0 : c.hasVideo));
  if (!eligible.length)
    return {
      kind: 'NONE',
      reason: opts.target === 'DIRECTION' ? 'עדיין אין מודעות מעוצבות לשנות.' : 'עדיין אין סרטון לשנות.',
    };
  const t = normalize(text);
  const byProduct = eligible.filter((c) => {
    const words = c.product.replace(/^ה/, '').split(' ').filter((w) => w.length > 2);
    return words.some((w) => t.includes(w));
  });
  if (byProduct.length === 1) return { kind: 'FOUND', campaign: byProduct[0]! };
  const pool = byProduct.length > 1 ? byProduct : eligible;
  // history is newest first
  if (opts.reference === 'LATEST') return { kind: 'FOUND', campaign: pool[0]! };
  if (opts.reference === 'FIRST') return { kind: 'FOUND', campaign: pool[pool.length - 1]! };
  if (opts.focusProjectId) {
    const focused = pool.find((c) => c.projectId === opts.focusProjectId);
    if (focused && pool.length > 1 && byProduct.length === 0) return { kind: 'FOUND', campaign: focused };
  }
  if (pool.length === 1) return { kind: 'FOUND', campaign: pool[0]! };
  return { kind: 'AMBIGUOUS', options: pool.slice(0, 4) };
}
