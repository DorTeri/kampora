import type { BusinessProfile, ConceptSet, CreativeConcept } from '@kampora/shared';
import { hebrewCopyIssues, type IndustryProfile } from '@kampora/agent-expertise';
import type { CreativeIssue } from './creative-qa';

const tokens = (text: string) =>
  new Set(
    text
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1),
  );

/** Word-set overlap (0 = nothing shared, 1 = the same words). */
export function similarity(a: string, b: string): number {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

/** Industry claims (e.g. "כשר", "24/7") that appear in copy without the business having approved them. */
export function unverifiedIndustryClaims(
  copy: readonly string[],
  business: Pick<BusinessProfile, 'approvedClaims' | 'description'>,
  industry: Pick<IndustryProfile, 'claimsRequiringVerification'>,
): string[] {
  // Guidelines are not a source: they often negate a claim ("we never promise weight loss").
  const allowed = [...business.approvedClaims, business.description].join(' \n ');
  const text = copy.join(' \n ');
  return industry.claimsRequiringVerification
    .filter((c) => new RegExp(c.pattern).test(text) && !new RegExp(c.pattern).test(allowed))
    .map((c) => c.label);
}

const copyOf = (c: CreativeConcept) =>
  [c.hook, c.voiceover, c.mainMessage, c.cta, c.copy?.headline ?? '', c.copy?.subheadline ?? ''].filter(
    Boolean,
  );

/**
 * The Copywriter's quality gate. Errors send the model back with the problems (bounded retries); warnings are
 * kept for the Critic and the owner. These are measurable proxies, not a judgement of whether the copy is good.
 */
export function conceptSetQa(
  set: ConceptSet,
  ctx: { business: BusinessProfile; industry: IndustryProfile },
): CreativeIssue[] {
  const issues: CreativeIssue[] = [];
  const cs = set.concepts;

  // 1. Genuinely different concepts: different technique, different words, different insight.
  const techniques = cs.map((c) => c.copy?.hookTechnique).filter(Boolean);
  if (techniques.length === cs.length && new Set(techniques).size < techniques.length)
    issues.push({
      severity: 'error',
      code: 'SAME_HOOK_TECHNIQUE',
      message: `Concepts repeat a hook technique (${techniques.join(', ')}); each concept must stop the scroll differently.`,
    });
  for (let i = 0; i < cs.length; i++)
    for (let j = i + 1; j < cs.length; j++) {
      const [a, b] = [cs[i]!, cs[j]!];
      if (similarity(a.hook, b.hook) >= 0.5)
        issues.push({
          severity: 'error',
          code: 'SIMILAR_HOOKS',
          message: `The hooks of "${a.title}" and "${b.title}" share most of their words; write a different idea, not a rewording.`,
        });
      if (similarity(a.voiceover, b.voiceover) >= 0.6)
        issues.push({
          severity: 'error',
          code: 'SIMILAR_SCRIPTS',
          message: `The scripts of "${a.title}" and "${b.title}" are near-identical.`,
        });
      if (a.strategy && b.strategy && similarity(a.strategy.insight, b.strategy.insight) >= 0.7)
        issues.push({
          severity: 'error',
          code: 'SAME_INSIGHT',
          message: `"${a.title}" and "${b.title}" are built on the same insight; each concept needs its own hypothesis.`,
        });
    }
  if (new Set(cs.map((c) => c.cta.trim())).size === 1 && cs.length > 1)
    issues.push({
      severity: 'warning',
      code: 'REPEATED_CTA',
      message: 'All concepts end with the same CTA phrase.',
    });

  for (const c of cs) {
    // 2. Natural Hebrew.
    for (const issue of copyOf(c).flatMap(hebrewCopyIssues)) {
      if (issue.code === 'EXCLAMATION') {
        issues.push({
          severity: 'warning',
          code: 'EXCLAMATIONS',
          message: `"${c.title}" uses several exclamation marks.`,
        });
        continue;
      }
      issues.push({
        severity: 'error',
        code:
          issue.code === 'CLICHE' ? 'CLICHE' : issue.code === 'FORMAL' ? 'FORMAL_REGISTER' : 'TRANSLATIONESE',
        message: `"${c.title}" uses "${issue.phrase}"${issue.suggestion ? ` (say "${issue.suggestion}")` : ' (a cliché that fits any business)'}.`,
      });
    }
    // 3. Written copy is short and is not the voice line.
    if (c.copy) {
      if (words(c.copy.headline) > 7)
        issues.push({
          severity: 'error',
          code: 'HEADLINE_TOO_LONG',
          message: `The written headline of "${c.title}" has ${words(c.copy.headline)} words (max 7).`,
        });
      if (similarity(c.copy.headline, c.voiceover) > 0.8)
        issues.push({
          severity: 'warning',
          code: 'HEADLINE_IS_TRANSCRIPT',
          message: `The headline of "${c.title}" repeats the voiceover instead of summarising it.`,
        });
      // 4. Claims used must be the business's own approved claims.
      for (const claim of c.copy.claimsUsed) {
        const known = ctx.business.approvedClaims.some((a) => a.includes(claim) || claim.includes(a));
        if (!known)
          issues.push({
            severity: 'error',
            code: 'UNAPPROVED_CLAIM',
            message: `"${c.title}" lists "${claim}" as a claim, but it is not one of the approved claims.`,
          });
      }
    }
    // 5. Industry claims that need verification.
    for (const label of unverifiedIndustryClaims(copyOf(c), ctx.business, ctx.industry))
      issues.push({
        severity: 'error',
        code: 'NEEDS_VERIFICATION',
        message: `"${c.title}" states "${label}", which the business has not approved.`,
      });
  }
  return issues;
}
