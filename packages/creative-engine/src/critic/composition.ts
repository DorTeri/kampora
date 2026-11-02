import { CRITIC_POLICY } from '@kampora/agent-expertise';
import {
  CreativeReviewSchema,
  ReviewHistorySchema,
  contrastRatio,
  mixHex,
  type CreativeDesignSpec,
  type CreativeDirection,
  type CreativeDirectionSet,
  type CreativeReview,
  type CriterionResult,
  type CritiqueSubject,
  type DesignLayer,
  type DesignMove,
  type HumanApproval,
  type Rect,
  type ReviewRound,
  type RevisionRequest,
  type StaticAdFormat,
  type TextLayer,
} from '@kampora/shared';
import { checkClaims } from '../claims';
import { composeDirectionSpecs, inputForDirection, MOVE_GROUPS, type DirectionInput } from '../art-director-v2';
import { measured, notMeasured, type Finding } from './report';

/**
 * Critic 2.0 for composed ads. Technical QA (blocking, measured) and creative analysis (advisory heuristics) are
 * returned separately; human approval is a third, independent state. Revisions are targeted at the component
 * that owns the problem and bounded: free layout/art-direction fixes are applied, copy and picture fixes wait.
 */

export interface CompositionCritiqueContext {
  approvedClaims?: readonly string[];
  /** The other directions of the same concept, to judge whether this one is genuinely different. */
  siblings?: readonly CreativeDesignSpec[];
  target?: string;
}

const texts = (spec: CreativeDesignSpec) => spec.layers.filter((l): l is TextLayer => l.kind === 'text');
const byRole = (spec: CreativeDesignSpec, role: TextLayer['role']) => texts(spec).find((l) => l.role === role);
const area = (r: Rect) => r.w * r.h;
const intersect = (a: Rect, b: Rect): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};
const digits = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((d) => d.replace(',', '.'));
const isLight = (hex: string) => contrastRatio(hex, '#000000') > contrastRatio(hex, '#ffffff');

/** The colour actually behind a text layer: its own box, the topmost shape under it, an image, or the background. */
function backdrop(spec: CreativeDesignSpec, layer: TextLayer): { color: string; overImage: boolean; protectedImage: boolean } {
  if (layer.box?.fill) return { color: layer.box.fill, overImage: false, protectedImage: false };
  const index = spec.layers.indexOf(layer);
  for (let i = index - 1; i >= 0; i--) {
    const l = spec.layers[i]!;
    if (intersect(l.rect, layer.rect) < area(layer.rect) * 0.5) continue;
    if (l.kind === 'shape' && l.fill && l.shape !== 'LINE' && l.shape !== 'RING' && l.opacity >= 0.85) return { color: l.fill, overImage: false, protectedImage: false };
    if (l.kind === 'image') {
      const o = l.overlay;
      // A darkening overlay or DARKEN treatment is what makes type over a photo legible.
      const strength = Math.max(o?.from ?? 0, o?.to ?? 0);
      const protectedImage = l.treatment === 'DARKEN' || (o !== undefined && strength >= 0.35);
      return { color: o ? mixHex('#808080', o.color, strength) : '#808080', overImage: true, protectedImage };
    }
  }
  return { color: spec.background.color, overImage: false, protectedImage: false };
}

const GENERIC_CTA = ['לפרטים נוספים', 'לחצו כאן', 'למידע נוסף', 'צרו קשר', 'לחץ כאן', 'קרא עוד', 'לפרטים'];
const TRANSLATIONESE = ['בואו לגלות', 'אנחנו כאן בשבילכם', 'החוויה האולטימטיבית', 'חוויה בלתי נשכחת', 'איכות ללא פשרות', 'הכי טוב שיש', 'לקחת את זה לשלב הבא', 'פתרון מושלם'];
const GENERIC_OPENERS = /^(הכירו את|מחפשים|רוצים|בואו|הגיע הזמן)/;

/** Technical QA: measured, blocking checks on one composed ad. */
export function technicalChecks(spec: CreativeDesignSpec, ctx: CompositionCritiqueContext = {}): CriterionResult[] {
  const target = ctx.target ?? spec.format;
  const results: CriterionResult[] = [];

  // Fit and typography: never silently shrunk, copy that cannot fit is reported to its owner.
  const fit: Finding[] = [];
  if (spec.fit.status === 'UNRESOLVED')
    fit.push({ severity: 'MAJOR', explanation: `The copy does not fit this composition (${spec.fit.notes.join('; ')}).`, correction: 'Try another arrangement of this direction, or shorten the copy.', component: 'LAYOUT_ENGINE', target });
  if (spec.fit.status === 'SHORTER_COPY_SUGGESTED')
    fit.push({ severity: 'MINOR', explanation: 'The copy fits but is longer than this composition wants.', evidence: spec.fit.suggestions.map((s) => `${s.role}: ≤${s.maxChars} chars (${s.reason})`), correction: spec.fit.suggestions.map((s) => `Shorten ${s.role} to about ${s.maxChars} characters.`).join(' '), component: 'COPYWRITER', target });
  if (spec.fit.headlineRatio < 0.88)
    fit.push({ severity: 'MINOR', explanation: `The headline is set at ${Math.round(spec.fit.headlineRatio * 100)}% of its planned size (recorded, within the relaxed layout).`, component: 'LAYOUT_ENGINE', target });
  const families = new Set(spec.layers.flatMap((l) => (l.kind === 'text' || l.kind === 'logo' ? [l.font.family] : [])));
  if (families.size > 3) fit.push({ severity: 'MINOR', explanation: `${families.size} typefaces in one ad.`, evidence: [...families], component: 'ART_DIRECTOR', target });
  results.push(measured('TYPOGRAPHY', fit, `Type fits at ${Math.round(spec.fit.headlineRatio * 100)}% of the planned headline size with ${families.size} typefaces.`, [`fit: ${spec.fit.status}`]));

  // Readability: contrast against what is really behind each text layer.
  const read: Finding[] = [];
  for (const l of texts(spec)) {
    const bg = backdrop(spec, l);
    if (bg.overImage && !bg.protectedImage) {
      read.push({ severity: 'MAJOR', explanation: `${l.role} sits on the photo without an overlay or box.`, correction: 'Darken the image under the text or give the text a box.', component: 'ART_DIRECTOR', target });
      continue;
    }
    const ratio = contrastRatio(l.color, bg.color);
    const min = l.font.size >= 40 ? 3 : 4.5;
    if (ratio < min) read.push({ severity: ratio < min * 0.75 ? 'MAJOR' : 'MINOR', explanation: `${l.role} contrast ${ratio.toFixed(1)}:1 (needs ${min}:1).`, evidence: [`${l.color} on ${bg.color}`], correction: 'Re-derive the palette for contrast.', component: 'ART_DIRECTOR', target });
  }
  results.push(measured('READABILITY', read, 'Every text layer meets contrast on what is actually behind it.'));

  // Layout: text layers must not collide.
  const overlap: Finding[] = [];
  const t = texts(spec);
  for (let i = 0; i < t.length; i++)
    for (let j = i + 1; j < t.length; j++) {
      const shared = intersect(t[i]!.rect, t[j]!.rect);
      if (shared > Math.min(area(t[i]!.rect), area(t[j]!.rect)) * 0.08)
        overlap.push({ severity: 'MAJOR', explanation: `${t[i]!.role} overlaps ${t[j]!.role}.`, component: 'LAYOUT_ENGINE', target });
    }
  results.push(measured('LAYOUT_BALANCE', overlap, 'No text layers collide.'));

  // Hierarchy: the emphasised element is the largest; the reading path starts where the design says.
  const hier: Finding[] = [];
  const headline = byRole(spec, 'HEADLINE');
  const price = byRole(spec, 'PRICE');
  const largestText = [...t].sort((a, b) => b.font.size - a.font.size)[0];
  if (spec.focal === 'PRICE' && price && headline && price.font.size < headline.font.size * 0.9)
    hier.push({ severity: 'MAJOR', explanation: 'The design leads with the price but the headline is set larger.', correction: 'Make the price the largest element or change the emphasis.', component: 'ART_DIRECTOR', target });
  if (spec.focal === 'HEADLINE' && largestText && headline && largestText.role !== 'HEADLINE' && largestText.role !== 'PRICE')
    hier.push({ severity: 'MINOR', explanation: `${largestText.role} is larger than the headline.`, component: 'ART_DIRECTOR', target });
  const cta = byRole(spec, 'CTA');
  if (cta && spec.readingPath.indexOf(cta.id) === 0) hier.push({ severity: 'MAJOR', explanation: 'The reading path starts with the action.', component: 'LAYOUT_ENGINE', target });
  results.push(measured('VISUAL_HIERARCHY', hier, `The eye lands on ${spec.focal.toLowerCase()} first, then follows the reading path.`));

  // Offer: one price, said once.
  const offer: Finding[] = [];
  if (price) {
    const p = digits(price.text);
    for (const role of ['HEADLINE', 'SUBHEADLINE'] as const) {
      const l = byRole(spec, role);
      if (l && p.some((d) => digits(l.text).includes(d)))
        offer.push({ severity: 'MAJOR', explanation: `The price appears twice: in the price element and in the ${role.toLowerCase()}.`, evidence: [l.text], correction: `Rewrite the ${role.toLowerCase()} without the price; the design already sets it.`, component: 'COPYWRITER', target });
    }
  }
  results.push(price ? measured('OFFER_COMMUNICATION', offer, 'The price is said once, as its own element.') : notMeasured('OFFER_COMMUNICATION', 'No price in this ad.'));

  // Facts: claims on the ad must be approved.
  if (ctx.approvedClaims) {
    const flags = checkClaims(t.map((l) => l.text), ctx.approvedClaims);
    results.push(measured('FACTUAL_ACCURACY', flags.map((f) => ({ severity: 'CRITICAL', explanation: `Unapproved claim: "${f.phrase}".`, evidence: [f.source], correction: 'Use only approved claims.', component: 'COPYWRITER', target })), 'No unapproved claims on the ad.'));
  } else results.push(notMeasured('FACTUAL_ACCURACY', 'No approved claims given to check against.'));

  // Copy craft that can be measured.
  const ctaFindings: Finding[] = [];
  if (cta && GENERIC_CTA.some((g) => cta.text.trim().startsWith(g)))
    ctaFindings.push({ severity: 'MINOR', explanation: `The action "${cta.text}" is generic.`, correction: 'Name the specific action in the audience\'s words ("קבעי שיעור ניסיון").', component: 'COPYWRITER', target });
  results.push(measured('CTA_CLARITY', ctaFindings, 'The action is specific.'));
  const hebrew: Finding[] = t.flatMap((l) =>
    TRANSLATIONESE.filter((p) => l.text.includes(p)).map((p) => ({ severity: 'MINOR' as const, explanation: `"${p}" reads as translated or cliché Hebrew.`, evidence: [l.text], correction: 'Say it the way a local owner would.', component: 'COPYWRITER' as const, target })),
  );
  results.push(measured('HEBREW_NATURALNESS', hebrew, 'No known translated-English or cliché phrasing.'));
  return results;
}

const heuristic = (r: CriterionResult): CriterionResult => (r.severity === 'OK' ? { ...r, method: 'HEURISTIC' } : { ...r, method: 'HEURISTIC', severity: r.severity === 'CRITICAL' || r.severity === 'MAJOR' ? 'MINOR' : r.severity });

/** The generic-template signature Q6 kept producing: centred logo on top, white price card, rounded yellow pill. */
function templateSignals(spec: CreativeDesignSpec): string[] {
  const signals: string[] = [];
  const logo = spec.layers.find((l) => l.kind === 'logo');
  if (logo && Math.abs(logo.rect.x + logo.rect.w / 2 - spec.width / 2) < spec.width * 0.05 && logo.rect.y < spec.height * 0.15) signals.push('logo centred at the top');
  const price = byRole(spec, 'PRICE');
  if (price?.box?.fill && isLight(price.box.fill) && contrastRatio(price.box.fill, '#ffffff') < 1.15) signals.push('price on a white card');
  const cta = byRole(spec, 'CTA');
  if (cta?.box?.fill && cta.box.radius >= cta.rect.h * 0.4) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(cta.box!.fill!.slice(i, i + 2), 16));
    if (r! > 200 && g! > 160 && b! < 110) signals.push('yellow pill button');
  }
  if (texts(spec).every((l) => l.align === 'CENTER')) signals.push('everything centred');
  return signals;
}

/** Creative analysis: advisory heuristics. They point at likely weaknesses; they never decide quality. */
export function creativeAnalysis(spec: CreativeDesignSpec, ctx: CompositionCritiqueContext = {}): CriterionResult[] {
  const target = ctx.target ?? spec.format;
  const results: CriterionResult[] = [];
  const signals = templateSignals(spec);
  results.push(heuristic(measured('VISUAL_ORIGINALITY', signals.length >= 2 ? [{ severity: 'MINOR', explanation: `Reads as a stock template: ${signals.join(', ')}.`, correction: 'Choose a composition with a clear idea rather than defaults.', component: 'ART_DIRECTOR', target }] : [], signals.length ? `One template signal (${signals[0]}), not a pattern.` : 'No template signature found.')));
  const headline = byRole(spec, 'HEADLINE');
  results.push(heuristic(measured('HOOK_STRENGTH', headline && GENERIC_OPENERS.test(headline.text.trim()) ? [{ severity: 'MINOR', explanation: `The headline opens with a generic phrase ("${headline.text.split(' ').slice(0, 2).join(' ')}").`, correction: 'Open with something only this business could say.', component: 'COPYWRITER', target }] : [], 'The headline does not open with a stock phrase.')));
  if (ctx.siblings?.length) {
    const same = ctx.siblings.filter((s) => s.method === spec.method || (s.typeSystem === spec.typeSystem && s.palette.background === spec.palette.background));
    results.push(heuristic(measured('DIFFERENTIATION', same.map(() => ({ severity: 'MINOR' as const, explanation: 'Another direction uses the same arrangement or the same type and colour.', component: 'ART_DIRECTOR' as const, target })), 'This direction differs from its siblings in arrangement, type and colour.')));
  }
  results.push(notMeasured('PROFESSIONAL_POLISH', 'Whether this looks like agency work is for a person to judge.'));
  return results;
}

const serious = (r: CriterionResult) => r.severity === 'MAJOR' || r.severity === 'CRITICAL';
const isPaid = (c: string) => (CRITIC_POLICY.paidComponents as readonly string[]).includes(c);

function route(results: readonly CriterionResult[]): RevisionRequest[] {
  const by = new Map<string, CriterionResult[]>();
  for (const r of results.filter(serious)) by.set(r.component, [...(by.get(r.component) ?? []), r]);
  return [...by].map(([component, rs]) => ({
    component: component as RevisionRequest['component'],
    criteria: [...new Set(rs.map((r) => r.criterion))],
    instruction: [...new Set(rs.map((r) => r.recommendedCorrection ?? r.explanation))].join(' '),
    cost: isPaid(component) ? ('PAID' as const) : ('FREE' as const),
    status: component === 'OWNER' ? ('NEEDS_OWNER' as const) : isPaid(component) ? ('PENDING_APPROVAL' as const) : ('NOT_POSSIBLE' as const),
  }));
}

/** Moves that cost space; dropping one is the first free fix for crowding. */
const HEAVY: readonly DesignMove[] = ['OVERSIZED_HEADLINE', 'STACKED_HEADLINE', 'BADGE_STAMP', 'OVERLAPPING_ELEMENTS', 'FRAME_BORDER', 'IMAGE_INSET_FRAME'];
const PALETTES = MOVE_GROUPS[0]!;

/**
 * The bounded critique-and-revision loop for one direction. Free fixes, in order: drop a space-hungry move
 * (layout), change the colour move (contrast / art direction), switch to the next arrangement of the same
 * approach. Copy and picture problems are routed to the Copywriter / Visual Planner and wait for approval.
 */
export function reviewDirection(
  input: DirectionInput,
  direction: CreativeDirection,
  opts: {
    approvedClaims?: readonly string[];
    siblings?: readonly CreativeDirection[];
    maxRounds?: number;
    /**
     * Copy already approved in the brief (its key message). When the subheadline only repeats the price, it is
     * replaced by this line: no new words are generated, and the change is recorded for the owner to see.
     */
    approvedSubheadline?: string;
  } = {},
): { direction: CreativeDirection; copy: DirectionInput['copy']; history: NonNullable<CreativeReview['history']> } {
  const maxRounds = opts.maxRounds ?? CRITIC_POLICY.maxRevisionRounds;
  const formats = Object.keys(direction.specs) as StaticAdFormat[];
  const evaluate = (d: CreativeDirection) =>
    Object.entries(d.specs).flatMap(([f, s]) => technicalChecks(s, { approvedClaims: opts.approvedClaims, target: `${d.key} ${f}` }));
  const problems = (rs: CriterionResult[]) => rs.filter(serious).length;
  const subject: CritiqueSubject = { type: 'STATIC_AD', ref: `direction:${direction.key}` };
  const rounds: ReviewRound[] = [];
  let current = direction;
  let copy = input.copy;
  let stoppedBecause: NonNullable<CreativeReview['history']>['stoppedBecause'] = 'PASSED';

  for (let round = 0; ; round++) {
    const results = evaluate(current);
    const revisions = route(results);
    const rep = {
      subject,
      rubricVersion: 'creative-rubric@critic-2',
      round,
      results,
      verdict: problems(results) ? ('REVISE' as const) : ('PASS' as const),
      summary: Object.fromEntries((['MARKETING', 'VISUAL', 'PRODUCTION'] as const).map((d) => [d, { checked: results.filter((r) => r.dimension === d).length, problems: results.filter((r) => r.dimension === d && serious(r)).length }])) as Record<'MARKETING' | 'VISUAL' | 'PRODUCTION', { checked: number; problems: number }>,
    };
    if (!problems(results)) {
      rounds.push({ round, report: rep, revisions });
      stoppedBecause = 'PASSED';
      break;
    }
    // The one copy fix that needs no new words: a subheadline that only repeats the price gives way to the brief's
    // approved key message.
    const dupSub = results.some((r) => r.criterion === 'OFFER_COMMUNICATION' && serious(r) && r.evidence.includes(copy.subheadline ?? ' '));
    const copyFix = dupSub && opts.approvedSubheadline && opts.approvedSubheadline !== copy.subheadline ? { ...copy, subheadline: opts.approvedSubheadline } : undefined;
    if (copyFix) {
      for (const r of revisions) if (r.component === 'COPYWRITER' && r.criteria.length === 1 && r.criteria[0] === 'OFFER_COMMUNICATION') r.cost = 'FREE';
    }
    const free = revisions.filter((r) => r.cost === 'FREE');
    if (!free.length) {
      rounds.push({ round, report: rep, revisions });
      stoppedBecause = 'NO_AUTOMATIC_FIX';
      break;
    }
    if (round >= maxRounds) {
      rounds.push({ round, report: rep, revisions });
      stoppedBecause = 'MAX_ROUNDS';
      break;
    }
    const candidates: { label: string; method: CreativeDirection['method']; moves: DesignMove[]; copy?: DirectionInput['copy'] }[] = [];
    if (copyFix) candidates.push({ label: 'replaced the subheadline that repeated the price with the key message approved in the brief', method: current.method, moves: current.moves, copy: copyFix });
    const heavy = current.moves.find((m) => HEAVY.includes(m));
    if (heavy) candidates.push({ label: `dropped ${heavy} to give the copy room`, method: current.method, moves: current.moves.filter((m) => m !== heavy) });
    const palette = current.moves.find((m) => PALETTES.includes(m));
    for (const alt of PALETTES.filter((p) => p !== palette && p !== 'VIBRANT_COMPLEMENTARY'))
      candidates.push({ label: `changed the colour move to ${alt}`, method: current.method, moves: [...current.moves.filter((m) => !PALETTES.includes(m)), alt] });
    for (const m of APPROACH_ORDER[current.approach].filter((x) => x !== current.method))
      candidates.push({ label: `switched the arrangement to ${m}`, method: m, moves: current.moves });
    let next: { d: CreativeDirection; label: string; copy?: DirectionInput['copy'] } | undefined;
    for (const c of candidates) {
      let specs: CreativeDirection['specs'];
      try {
        specs = composeDirectionSpecs({ ...input, copy: c.copy ?? copy }, current.approach, c.method, c.moves, current.typeSystem, formats);
      } catch {
        continue;
      }
      const d: CreativeDirection = { ...current, method: c.method, moves: c.moves, specs: Object.fromEntries(Object.entries(specs).map(([f, s]) => [f, { ...s, rationale: { decisions: [...current.rationale, ...s.rationale.decisions], references: current.references } }])) };
      if (problems(evaluate(d)) < problems(results)) {
        next = { d, label: c.label, ...(c.copy ? { copy: c.copy } : {}) };
        break;
      }
    }
    if (!next) {
      for (const r of free) r.change = 'No free change removes the problem; a person should look.';
      rounds.push({ round, report: rep, revisions });
      stoppedBecause = 'NO_IMPROVEMENT';
      break;
    }
    for (const r of free) {
      r.status = 'APPLIED';
      r.change = next.copy ? `Kampora ${next.label} (no new words were written; the owner can undo it).` : `The Art Director ${next.label}.`;
    }
    if (next.copy) copy = next.copy;
    rounds.push({ round, report: rep, revisions });
    current = { ...next.d, rationale: [...current.rationale, { topic: 'revision', decision: next.label, because: free.map((r) => r.criteria.join(', ')).join('; ') }] };
  }
  return { direction: current, copy, history: ReviewHistorySchema.parse({ rounds, maxRounds, stoppedBecause }) };
}

const APPROACH_ORDER: Record<CreativeDirection['approach'], CreativeDirection['method'][]> = {
  IMAGE_LED: ['IMAGE_FIRST', 'LIFESTYLE', 'LAYERED', 'PRODUCT_LED', 'SPLIT'],
  EDITORIAL_TYPE: ['EDITORIAL', 'ASYMMETRIC', 'SPLIT'],
  BOLD_GRAPHIC: ['BOLD_TYPE', 'PROMO_PRICE', 'LOCAL_MODERN'],
};

/** The full Critic 2.0 review of one composed ad: technical QA, advisory analysis and the human decision, apart. */
export function creativeReview(
  spec: CreativeDesignSpec,
  ctx: CompositionCritiqueContext & { subjectRef: string; human?: HumanApproval; history?: CreativeReview['history'] },
): CreativeReview {
  const technical = technicalChecks(spec, ctx);
  return CreativeReviewSchema.parse({
    subject: { type: 'STATIC_AD', ref: ctx.subjectRef },
    technical: { verdict: technical.some(serious) ? 'REVISE' : 'PASS', results: technical },
    creative: { advisory: true, results: creativeAnalysis(spec, ctx) },
    human: ctx.human ?? { status: 'PENDING' },
    ...(ctx.history ? { history: ctx.history } : {}),
  });
}

/** Reviews every direction of a set (each against its siblings), applying bounded free fixes. */
export function reviewDirectionSet(
  input: DirectionInput,
  set: CreativeDirectionSet,
  opts: { approvedClaims?: readonly string[]; maxRounds?: number; approvedSubheadline?: string } = {},
): { set: CreativeDirectionSet; reviews: Record<string, Record<string, CreativeReview>>; copy: Record<string, DirectionInput['copy']> } {
  const revised = set.directions.map((d) => reviewDirection(inputForDirection(input, d), d, opts));
  const directions = revised.map((r) => r.direction);
  const reviews: Record<string, Record<string, CreativeReview>> = {};
  for (const [i, d] of directions.entries()) {
    reviews[d.key] = {};
    for (const [format, spec] of Object.entries(d.specs)) {
      const siblings = directions.filter((x) => x.key !== d.key).flatMap((x) => (x.specs[format] ? [x.specs[format]!] : []));
      reviews[d.key]![format] = creativeReview(spec, { approvedClaims: opts.approvedClaims, siblings, target: `${d.key} ${format}`, subjectRef: `${set.conceptKey}:${d.key}:${format}`, history: revised[i]!.history });
    }
  }
  return { set: { ...set, directions }, reviews, copy: Object.fromEntries(revised.map((r) => [r.direction.key, r.copy])) };
}

export type { DesignLayer };
