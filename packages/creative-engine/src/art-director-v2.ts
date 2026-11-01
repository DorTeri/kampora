import type { RetrievedReference } from '@kampora/agent-expertise';
import { composeDesign, derivePalette, PICTURE_METHODS, type ComposeCopy } from '@kampora/production-engine';
import {
  CreativeDirectionSetSchema,
  type BrandColors,
  type CampaignGoal,
  type CompositionMethod,
  type CompositionType,
  type ConceptAngle,
  type CreativeDesignSpec,
  type CreativeDirection,
  type CreativeDirectionSet,
  type DesignMove,
  type DirectionApproach,
  type HookTechnique,
  type MediaAuthenticity,
  type ReferenceInfluence,
  type StaticAdFormat,
  type ToneOfVoice,
  type TypeSystemId,
} from '@kampora/shared';

/**
 * Art Director 2.0: composition-first and reference-informed. For one concept it explores three genuinely
 * different directions (image-led, editorial typography, bold graphic). Every decision is derived from:
 *   - the retrieved professional references (their design moves, weighted by relevance, and their principles),
 *   - the concept (angle, hook technique, visual idea), the goal and offer, the brand's tone,
 *   - the picture that actually exists (what it shows, whether it is authentic).
 * The result is a set of CreativeDesignSpecs built by the deterministic layout engine; no model writes layout.
 * Which reference shaped which decision is recorded, so the influence is inspectable and testable.
 */

export interface DirectionInput {
  conceptKey: string;
  goal: CampaignGoal;
  tone: ToneOfVoice;
  industryId: string;
  brand: { name: string; colors: BrandColors };
  concept: {
    title: string;
    angle: ConceptAngle;
    hookTechnique?: HookTechnique;
    /** The Copywriter's visual idea, if any, and the moves it implies. */
    visualIdea?: string;
    visualMoves?: readonly DesignMove[];
  };
  copy: ComposeCopy;
  picture?: {
    assetId: string;
    focal: { x: number; y: number };
    composition?: CompositionType;
    authenticity: MediaAuthenticity;
    negativeSpace?: 'TOP' | 'BOTTOM' | 'START' | 'END' | 'NONE';
  };
  logoAssetId?: string;
  references: readonly RetrievedReference[];
  formats?: readonly StaticAdFormat[];
}

const APPROACH_METHODS: Record<DirectionApproach, readonly CompositionMethod[]> = {
  IMAGE_LED: ['IMAGE_FIRST', 'LIFESTYLE', 'LAYERED', 'PRODUCT_LED', 'SPLIT'],
  EDITORIAL_TYPE: ['EDITORIAL', 'ASYMMETRIC', 'SPLIT'],
  BOLD_GRAPHIC: ['BOLD_TYPE', 'PROMO_PRICE', 'LOCAL_MODERN'],
};

export const APPROACH_NAMES: Record<DirectionApproach, string> = {
  IMAGE_LED: 'תמונה מובילה',
  EDITORIAL_TYPE: 'טיפוגרפיה עריכתית',
  BOLD_GRAPHIC: 'גרפי נועז',
};

/** How strongly each move argues for a method. */
const METHOD_AFFINITY: Record<CompositionMethod, Partial<Record<DesignMove, number>>> = {
  IMAGE_FIRST: { FULL_BLEED_IMAGE: 2, SINGLE_FOCAL_POINT: 1, MINIMAL_COPY: 1, GENEROUS_NEGATIVE_SPACE: 1, DETAIL_MACRO_CROP: 1, PRODUCT_AS_HERO: 0.5 },
  LIFESTYLE: { PEOPLE_AS_HERO: 2.5, FULL_BLEED_IMAGE: 1, MUTED_NATURAL_PALETTE: 0.5 },
  LAYERED: { LAYERED_TYPE_OVER_IMAGE: 2.5, TYPE_AS_IMAGE: 1, OVERSIZED_HEADLINE: 1, DARK_MOODY: 1, HIGH_CONTRAST_DUOTONE: 1, TEXTURE_GRAIN: 0.5 },
  PRODUCT_LED: { PRODUCT_AS_HERO: 2, CUTOUT_PRODUCT_ON_COLOR: 2, CENTERED_HERO: 1, BADGE_STAMP: 1, SINGLE_FOCAL_POINT: 0.5 },
  SPLIT: { SPLIT_PANEL: 2.5, COLLAGE_GRID: 1, Z_READING_PATH: 1 },
  EDITORIAL: { SERIF_EDITORIAL: 2, GENEROUS_NEGATIVE_SPACE: 1.5, RULE_LINES: 1, IMAGE_INSET_FRAME: 1.5, FRAME_BORDER: 1, MUTED_NATURAL_PALETTE: 1, PRICE_UNDERSTATED: 1, CTA_AS_TEXT_LINE: 1, MINIMAL_COPY: 0.5 },
  ASYMMETRIC: { ASYMMETRIC_GRID: 2.5, OVERLAPPING_ELEMENTS: 1.5, GEOMETRIC_SHAPES: 1, Z_READING_PATH: 0.5, COLLAGE_GRID: 0.5 },
  BOLD_TYPE: { OVERSIZED_HEADLINE: 2, TYPE_AS_IMAGE: 2, TYPE_ONLY: 2, STACKED_HEADLINE: 1.5, BRAND_COLOR_FLOOD: 1.5, CONDENSED_DISPLAY: 1, BOLD_GEOMETRIC_SANS: 1, GEOMETRIC_SHAPES: 0.5, MINIMAL_COPY: 0.5 },
  PROMO_PRICE: { PRICE_AS_GRAPHIC: 2.5, BADGE_STAMP: 1, VIBRANT_COMPLEMENTARY: 1, OVERSIZED_HEADLINE: 0.5, RULE_LINES: 0.5 },
  LOCAL_MODERN: { LOGO_AS_SIGNOFF: 0.5, FRAME_BORDER: 0.5, BRAND_COLOR_FLOOD: 0.5 },
};

/** Mutually exclusive groups: at most one move from each. */
const GROUPS: readonly (readonly DesignMove[])[] = [
  ['BRAND_COLOR_FLOOD', 'MONOCHROME_PALETTE', 'MUTED_NATURAL_PALETTE', 'VIBRANT_COMPLEMENTARY', 'DARK_MOODY'],
  ['SERIF_EDITORIAL', 'CONDENSED_DISPLAY', 'BOLD_GEOMETRIC_SANS'],
  ['CTA_AS_TEXT_LINE', 'CTA_BUTTON'],
  ['PRICE_AS_GRAPHIC', 'PRICE_UNDERSTATED', 'BADGE_STAMP'],
  ['LOGO_SMALL_CORNER', 'LOGO_AS_SIGNOFF'],
];

/** Moves that make no sense in an approach. */
const EXCLUDED: Record<DirectionApproach, readonly DesignMove[]> = {
  IMAGE_LED: ['TYPE_ONLY', 'TYPE_AS_IMAGE', 'BRAND_COLOR_FLOOD', 'STACKED_HEADLINE', 'CONDENSED_DISPLAY'],
  EDITORIAL_TYPE: ['BRAND_COLOR_FLOOD', 'VIBRANT_COMPLEMENTARY', 'CONDENSED_DISPLAY', 'PRICE_AS_GRAPHIC', 'BADGE_STAMP', 'STACKED_HEADLINE', 'TYPE_ONLY', 'OVERSIZED_HEADLINE', 'DARK_MOODY'],
  BOLD_GRAPHIC: ['PRICE_UNDERSTATED', 'SERIF_EDITORIAL', 'MUTED_NATURAL_PALETTE', 'GENEROUS_NEGATIVE_SPACE', 'FULL_BLEED_IMAGE', 'LAYERED_TYPE_OVER_IMAGE'],
};

/** Moves an approach brings by its nature, before references weigh in (low weight: references can outvote). */
const APPROACH_DEFAULTS: Record<DirectionApproach, Partial<Record<DesignMove, number>>> = {
  IMAGE_LED: { FULL_BLEED_IMAGE: 0.6, SINGLE_FOCAL_POINT: 0.4, CTA_AS_TEXT_LINE: 0.3, LOGO_SMALL_CORNER: 0.3 },
  EDITORIAL_TYPE: { SERIF_EDITORIAL: 0.6, RULE_LINES: 0.5, CTA_AS_TEXT_LINE: 0.5, PRICE_UNDERSTATED: 0.4, MUTED_NATURAL_PALETTE: 0.3 },
  BOLD_GRAPHIC: { OVERSIZED_HEADLINE: 0.6, BRAND_COLOR_FLOOD: 0.5, CTA_BUTTON: 0.4, GEOMETRIC_SHAPES: 0.3 },
};

/** What a concept itself asks for. */
function conceptMoves(input: DirectionInput): Partial<Record<DesignMove, number>> {
  const m: Partial<Record<DesignMove, number>> = {};
  const add = (move: DesignMove, w: number) => (m[move] = (m[move] ?? 0) + w);
  const { angle, hookTechnique } = input.concept;
  if (hookTechnique === 'OFFER_FIRST' || angle === 'OFFER_DRIVEN' || input.goal === 'OFFER') add('PRICE_AS_GRAPHIC', 1.2);
  if (hookTechnique === 'QUESTION' || hookTechnique === 'BOLD_STATEMENT') add('OVERSIZED_HEADLINE', 0.8);
  if (hookTechnique === 'SENSORY_DETAIL') add('DETAIL_MACRO_CROP', 1);
  if (angle === 'LIFESTYLE' || angle === 'EMOTIONAL' || angle === 'UGC') add('PEOPLE_AS_HERO', 0.8);
  if (angle === 'PRODUCT_DEMO') add('PRODUCT_AS_HERO', 1);
  if (input.picture?.composition === 'SINGLE_HERO') add('PRODUCT_AS_HERO', 0.6);
  if (input.picture?.composition === 'LIFESTYLE') add('PEOPLE_AS_HERO', 1);
  if (input.picture?.composition === 'DETAIL') add('DETAIL_MACRO_CROP', 0.8);
  if (input.tone === 'premium') {
    add('GENEROUS_NEGATIVE_SPACE', 0.8);
    add('MINIMAL_COPY', 0.5);
  }
  if (input.tone === 'energetic') add('CONDENSED_DISPLAY', 0.6);
  if (input.tone === 'playful' || input.tone === 'friendly') add('BOLD_GEOMETRIC_SANS', 0.4);
  for (const v of input.concept.visualMoves ?? []) add(v, 1);
  return m;
}

interface MoveVote {
  move: DesignMove;
  weight: number;
  /** Reference id → weight it contributed. */
  from: Map<string, number>;
}

function voteMoves(input: DirectionInput): Map<DesignMove, MoveVote> {
  const votes = new Map<DesignMove, MoveVote>();
  const vote = (move: DesignMove, w: number, ref?: string) => {
    const v = votes.get(move) ?? { move, weight: 0, from: new Map<string, number>() };
    v.weight += w;
    if (ref) v.from.set(ref, (v.from.get(ref) ?? 0) + w);
    votes.set(move, v);
  };
  const top = Math.max(1, ...input.references.map((r) => r.score));
  for (const r of input.references) for (const move of r.reference.designMoves) vote(move, (r.score / top) * 1.5, r.reference.id);
  for (const [move, w] of Object.entries(conceptMoves(input))) vote(move as DesignMove, w!);
  return votes;
}

/** Moves that suit any approach (they say little about the arrangement). */
const UNIVERSAL: readonly DesignMove[] = ['SINGLE_FOCAL_POINT', 'MINIMAL_COPY', 'LOGO_SMALL_CORNER', 'LOGO_AS_SIGNOFF', 'CTA_AS_TEXT_LINE', 'CTA_BUTTON', 'TEXTURE_GRAIN', ...GROUPS[0]!];

/** Moves native to an approach: the ones its methods and defaults are built from. */
const nativeMoves = (approach: DirectionApproach): Set<DesignMove> =>
  new Set<DesignMove>([...APPROACH_METHODS[approach].flatMap((m) => Object.keys(METHOD_AFFINITY[m]) as DesignMove[]), ...(Object.keys(APPROACH_DEFAULTS[approach]) as DesignMove[]), ...UNIVERSAL]);

/** Moves a tone of voice rules out (a premium brand does not shout in complementary colours). */
const TONE_EXCLUDED: Record<ToneOfVoice, readonly DesignMove[]> = {
  premium: ['VIBRANT_COMPLEMENTARY', 'BADGE_STAMP', 'ILLUSTRATIVE_ELEMENTS', 'HANDWRITTEN_ACCENT'],
  professional: ['HANDWRITTEN_ACCENT', 'ILLUSTRATIVE_ELEMENTS'],
  energetic: ['MUTED_NATURAL_PALETTE'],
  friendly: [],
  warm: ['HIGH_CONTRAST_DUOTONE'],
  playful: ['MONOCHROME_PALETTE'],
};

const MAX_MOVES = 5;

function pickMoves(approach: DirectionApproach, method: CompositionMethod, votes: Map<DesignMove, MoveVote>, hasPicture: boolean, taken: Set<DesignMove>, input?: DirectionInput): DesignMove[] {
  const scores = new Map<DesignMove, number>();
  for (const [move, v] of votes) scores.set(move, v.weight);
  for (const [move, w] of Object.entries(APPROACH_DEFAULTS[approach])) scores.set(move as DesignMove, (scores.get(move as DesignMove) ?? 0) + w!);
  for (const [move, w] of Object.entries(METHOD_AFFINITY[method])) if (scores.has(move as DesignMove)) scores.set(move as DesignMove, scores.get(move as DesignMove)! + w! * 0.3);
  const pictureMoves: DesignMove[] = ['FULL_BLEED_IMAGE', 'LAYERED_TYPE_OVER_IMAGE', 'CUTOUT_PRODUCT_ON_COLOR', 'DETAIL_MACRO_CROP', 'HIGH_CONTRAST_DUOTONE', 'IMAGE_INSET_FRAME', 'PEOPLE_AS_HERO', 'PRODUCT_AS_HERO'];
  const native = nativeMoves(approach);
  const realProduct = input?.picture && ['VERIFIED_PRODUCT_PHOTO', 'REFERENCE_GUIDED_AI'].includes(input.picture.authenticity);
  const ranked = [...scores.entries()]
    .filter(([m]) => !EXCLUDED[approach].includes(m) && (hasPicture || !pictureMoves.includes(m)))
    .filter(([m]) => !input || !TONE_EXCLUDED[input.tone].includes(m))
    // A stand-in picture is never presented as the product itself.
    .filter(([m]) => realProduct || !['PRODUCT_AS_HERO', 'CUTOUT_PRODUCT_ON_COLOR'].includes(m) || !hasPicture)
    // Foreign moves count for little: an editorial direction is not built from image-overlay moves.
    .map(([m, s]) => [m, native.has(m) ? s : s * 0.35] as const)
    // What another direction already uses scores lower: three directions, three ideas, three moods.
    .map(([m, s]) => [m, taken.has(m) && !['SINGLE_FOCAL_POINT', 'MINIMAL_COPY'].includes(m) ? s * (GROUPS[0]!.includes(m) ? 0.3 : 0.5) : s] as const)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const chosen: DesignMove[] = [];
  for (const [m, s] of ranked) {
    if (s < 0.45 || chosen.length >= MAX_MOVES) break;
    if (GROUPS.some((g) => g.includes(m) && g.some((x) => chosen.includes(x)))) continue;
    chosen.push(m);
  }
  return chosen;
}

function chooseMethod(approach: DirectionApproach, votes: Map<DesignMove, MoveVote>, input: DirectionInput, used: Set<CompositionMethod>): { method: CompositionMethod; because: string } {
  // An AI stand-in must never be framed as "this is the product".
  const realProduct = input.picture && ['VERIFIED_PRODUCT_PHOTO', 'REFERENCE_GUIDED_AI'].includes(input.picture.authenticity);
  const candidates = APPROACH_METHODS[approach].filter(
    (m) => (input.picture ? true : !PICTURE_METHODS.includes(m)) && !used.has(m) && (m !== 'PRODUCT_LED' || realProduct),
  );
  const scored = candidates.map((method) => {
    let s = 0;
    for (const [move, w] of Object.entries(METHOD_AFFINITY[method])) s += (votes.get(move as DesignMove)?.weight ?? 0) * w!;
    if (method === 'PROMO_PRICE' && input.copy.price && (input.goal === 'OFFER' || input.goal === 'SALES')) s += 3;
    if (method === 'PROMO_PRICE' && !input.copy.price) s -= 10;
    if (method === 'LOCAL_MODERN' && input.industryId === 'local-services') s += 3;
    if (method === 'PRODUCT_LED' && input.picture?.composition === 'SINGLE_HERO') s += 1.5;
    if (method === 'LIFESTYLE' && input.picture?.composition !== 'LIFESTYLE') s -= 1.5;
    return { method, s };
  });
  scored.sort((a, b) => b.s - a.s || APPROACH_METHODS[approach].indexOf(a.method) - APPROACH_METHODS[approach].indexOf(b.method));
  const best = scored[0] ?? { method: APPROACH_METHODS[approach].find((m) => !PICTURE_METHODS.includes(m))!, s: 0 };
  const runnerUp = scored[1];
  const because =
    runnerUp && Math.abs(best.s - runnerUp.s) < 0.25
      ? `${best.method} and ${runnerUp.method} scored alike (${best.s.toFixed(1)}); ${best.method} is the approach's primary arrangement`
      : `${best.method} scored ${best.s.toFixed(1)} from the moves the references and the concept favour${runnerUp ? ` (next: ${runnerUp.method} ${runnerUp.s.toFixed(1)})` : ''}`;
  return { method: best.method, because };
}

function chooseTypeSystem(approach: DirectionApproach, moves: readonly DesignMove[], tone: ToneOfVoice, taken: Set<TypeSystemId>): TypeSystemId {
  const prefs: TypeSystemId[] = [];
  if (moves.includes('SERIF_EDITORIAL')) prefs.push(tone === 'premium' ? 'LUXURY_SERIF' : 'EDITORIAL_SERIF');
  if (moves.includes('CONDENSED_DISPLAY')) prefs.push('CONDENSED_IMPACT');
  if (moves.includes('BOLD_GEOMETRIC_SANS')) prefs.push('BOLD_DISPLAY');
  const byTone: Record<ToneOfVoice, Record<DirectionApproach, TypeSystemId[]>> = {
    premium: { IMAGE_LED: ['MODERN_SANS', 'PRECISE_CLEAN'], EDITORIAL_TYPE: ['LUXURY_SERIF', 'EDITORIAL_SERIF'], BOLD_GRAPHIC: ['CONDENSED_IMPACT', 'MODERN_SANS'] },
    energetic: { IMAGE_LED: ['MODERN_SANS', 'FRIENDLY_ROUND'], EDITORIAL_TYPE: ['EDITORIAL_SERIF', 'PRECISE_CLEAN'], BOLD_GRAPHIC: ['CONDENSED_IMPACT', 'BOLD_DISPLAY'] },
    professional: { IMAGE_LED: ['PRECISE_CLEAN', 'MODERN_SANS'], EDITORIAL_TYPE: ['EDITORIAL_SERIF', 'LUXURY_SERIF'], BOLD_GRAPHIC: ['MODERN_SANS', 'CONDENSED_IMPACT'] },
    friendly: { IMAGE_LED: ['FRIENDLY_ROUND', 'MODERN_SANS'], EDITORIAL_TYPE: ['EDITORIAL_SERIF', 'CLASSIC_WARM'], BOLD_GRAPHIC: ['BOLD_DISPLAY', 'FRIENDLY_ROUND'] },
    warm: { IMAGE_LED: ['MODERN_SANS', 'FRIENDLY_ROUND'], EDITORIAL_TYPE: ['EDITORIAL_SERIF', 'CLASSIC_WARM'], BOLD_GRAPHIC: ['CLASSIC_WARM', 'BOLD_DISPLAY'] },
    playful: { IMAGE_LED: ['FRIENDLY_ROUND', 'MODERN_SANS'], EDITORIAL_TYPE: ['CLASSIC_WARM', 'EDITORIAL_SERIF'], BOLD_GRAPHIC: ['BOLD_DISPLAY', 'CONDENSED_IMPACT'] },
  };
  prefs.push(...byTone[tone][approach]);
  return prefs.find((p) => !taken.has(p)) ?? prefs[0]!;
}

function influences(moves: readonly DesignMove[], votes: Map<DesignMove, MoveVote>, input: DirectionInput): ReferenceInfluence[] {
  const byRef = new Map<string, DesignMove[]>();
  for (const m of moves)
    for (const [ref, w] of votes.get(m)?.from ?? []) if (w > 0) byRef.set(ref, [...(byRef.get(ref) ?? []), m]);
  return [...byRef.entries()]
    .map(([id, ms]) => {
      const r = input.references.find((x) => x.reference.id === id)!.reference;
      const principle = r.principles[0]!.text;
      return { referenceId: id, moves: ms, influence: `${r.brand}: ${principle} → ${ms.join(', ')}` };
    })
    .sort((a, b) => b.moves.length - a.moves.length || a.referenceId.localeCompare(b.referenceId));
}

export function emphasisFor(approach: DirectionApproach, method: CompositionMethod, input: DirectionInput): CreativeDirection['emphasis'] {
  if (method === 'PROMO_PRICE' || (approach === 'BOLD_GRAPHIC' && input.copy.price && input.goal === 'OFFER')) return 'PRICE';
  if (method === 'LOCAL_MODERN') return 'BRAND';
  if (approach === 'IMAGE_LED' && input.picture) return 'IMAGE';
  return 'HEADLINE';
}

function idea(approach: DirectionApproach, method: CompositionMethod, input: DirectionInput): string {
  const subject = input.picture ? 'התמונה' : 'הטיפוגרפיה';
  switch (approach) {
    case 'IMAGE_LED':
      return method === 'PRODUCT_LED' ? 'המוצר במרכז, על רקע שקט, והמחיר צמוד אליו.' : `${subject} מספרת את הסיפור; הטקסט יושב באזור השקט שלה ולא מסתיר את הנושא.`;
    case 'EDITORIAL_TYPE':
      return method === 'ASYMMETRIC' ? 'גריד לא סימטרי: עמודת טקסט מיושרת לימין מול שטח צבע או תמונה הגולשת מהקצה.' : 'מבנה עריכתי רגוע: כותרת סריפית, שורת פתיח קטנה, קווים דקים ופעולה כשורת טקסט.';
    case 'BOLD_GRAPHIC':
      return method === 'PROMO_PRICE' ? 'המחיר הוא הגרפיקה: מספר גדול בין קווים, בלי מדבקה זולה.' : method === 'LOCAL_MODERN' ? 'שם העסק והמקום מובילים, התמונה ממוסגרת.' : 'הכותרת היא התמונה: טיפוגרפיה ענקית על שדה צבע של המותג.';
  }
}

/** Composes one direction's decisions for each format with the deterministic layout engine. */
export function composeDirectionSpecs(
  input: DirectionInput,
  approach: DirectionApproach,
  method: CompositionMethod,
  moves: readonly DesignMove[],
  typeSystem: TypeSystemId,
  formats: readonly StaticAdFormat[],
  emphasis: CreativeDirection['emphasis'] = emphasisFor(approach, method, input),
): Record<string, CreativeDesignSpec> {
  return Object.fromEntries(
    formats.map((format) => [
      format,
      composeDesign({
        format,
        method,
        moves,
        typeSystem,
        palette: derivePalette(input.brand.colors, moves),
        copy: input.copy,
        ...(input.picture ? { picture: input.picture } : {}),
        ...(input.logoAssetId ? { logoAssetId: input.logoAssetId } : {}),
        emphasis,
      }),
    ]),
  );
}

export { APPROACH_METHODS, GROUPS as MOVE_GROUPS, EXCLUDED as APPROACH_EXCLUDED_MOVES };

/**
 * Three directions for one concept, each composed for every requested format. If a composition cannot fit the
 * copy (UNRESOLVED), the next method of the same approach is tried ("use another arrangement") before reporting.
 */
export function directCreative(input: DirectionInput): CreativeDirectionSet {
  const formats = input.formats ?? ['4:5', '9:16'];
  const votes = voteMoves(input);
  const usedMethods = new Set<CompositionMethod>();
  /** Every move an earlier direction used: later directions lean elsewhere. */
  const usedPalettes = new Set<DesignMove>();
  const usedTypes = new Set<TypeSystemId>();
  const keys = ['A', 'B', 'C'] as const;
  const approaches: DirectionApproach[] = ['IMAGE_LED', 'EDITORIAL_TYPE', 'BOLD_GRAPHIC'];
  const directions: CreativeDirection[] = approaches.map((approach, i) => {
    const decisions: CreativeDirection['rationale'] = [];
    let { method, because } = chooseMethod(approach, votes, input, usedMethods);
    if (approach === 'IMAGE_LED' && !input.picture) decisions.push({ topic: 'picture', decision: 'No usable picture: the image-led direction is built from shapes and type', because: 'Kampora never invents a product photo silently; a picture can be added later.' });
    let moves = pickMoves(approach, method, votes, Boolean(input.picture), usedPalettes, input);
    let typeSystem = chooseTypeSystem(approach, moves, input.tone, usedTypes);
    const palette = derivePalette(input.brand.colors, moves);
    const compose = (m: CompositionMethod, mv: DesignMove[]) => composeDirectionSpecs(input, approach, m, mv, typeSystem, formats);
    let specs = compose(method, moves);
    if (Object.values(specs).some((s) => s.fit.status === 'UNRESOLVED')) {
      const alt = chooseMethod(approach, votes, input, new Set([...usedMethods, method]));
      if (alt.method !== method) {
        const altMoves = pickMoves(approach, alt.method, votes, Boolean(input.picture), usedPalettes, input);
        const altSpecs = compose(alt.method, altMoves);
        const unresolved = (x: Record<string, CreativeDesignSpec>) => Object.values(x).filter((s) => s.fit.status === 'UNRESOLVED').length;
        if (unresolved(altSpecs) < unresolved(specs)) {
          decisions.push({ topic: 'fit', decision: `Changed the arrangement from ${method} to ${alt.method}`, because: 'The copy did not fit the first arrangement; a different composition beats shrinking the type.' });
          method = alt.method;
          moves = altMoves;
          specs = altSpecs;
          because = alt.because;
          typeSystem = chooseTypeSystem(approach, moves, input.tone, usedTypes);
          specs = compose(method, moves);
        }
      }
    }
    usedMethods.add(method);
    usedTypes.add(typeSystem);
    for (const m of moves) usedPalettes.add(m);
    const refs = influences(moves, votes, input);
    decisions.unshift(
      { topic: 'composition method', decision: method, because },
      { topic: 'type system', decision: typeSystem, because: `Matches the ${input.tone} tone${moves.some((m) => ['SERIF_EDITORIAL', 'CONDENSED_DISPLAY', 'BOLD_GEOMETRIC_SANS'].includes(m)) ? ' and the typographic move the references favour' : ''}; each direction uses a different voice.` },
      { topic: 'palette', decision: `background ${palette.background}, accent ${palette.accent}`, because: moves.find((m) => ['BRAND_COLOR_FLOOD', 'MONOCHROME_PALETTE', 'MUTED_NATURAL_PALETTE', 'VIBRANT_COMPLEMENTARY', 'DARK_MOODY'].includes(m)) ? `Colour move ${moves.find((m) => ['BRAND_COLOR_FLOOD', 'MONOCHROME_PALETTE', 'MUTED_NATURAL_PALETTE', 'VIBRANT_COMPLEMENTARY', 'DARK_MOODY'].includes(m))} applied to the brand colours, contrast enforced` : 'Brand colours as they are, contrast enforced' },
    );
    const finalSpecs = Object.fromEntries(Object.entries(specs).map(([f, s]) => [f, { ...s, rationale: { decisions: [...decisions, ...s.rationale.decisions], references: refs } }]));
    const copyRequests = Object.values(finalSpecs).flatMap((s) => s.fit.suggestions);
    return {
      key: keys[i]!,
      approach,
      name: APPROACH_NAMES[approach],
      idea: idea(approach, method, input),
      method,
      moves,
      typeSystem,
      emphasis: emphasisFor(approach, method, input),
      rationale: decisions,
      references: refs,
      specs: finalSpecs,
      copyRequests: copyRequests.filter((r, j) => copyRequests.findIndex((x) => x.role === r.role) === j),
    };
  });

  // Recommend the direction that serves the goal with the fewest fit compromises.
  const goalFit = (d: CreativeDirection) =>
    (input.goal === 'OFFER' && d.emphasis === 'PRICE' ? 2 : 0) +
    (input.goal === 'AWARENESS' && d.approach !== 'BOLD_GRAPHIC' ? 1 : 0) +
    (input.goal === 'LEADS' && d.approach === 'EDITORIAL_TYPE' && input.tone === 'premium' ? 1.5 : 0) +
    (input.goal === 'LEADS' && d.approach === 'BOLD_GRAPHIC' && input.tone !== 'premium' ? 1 : 0) +
    (d.approach === 'IMAGE_LED' && input.picture && ['VERIFIED_PRODUCT_PHOTO', 'VERIFIED_BUSINESS_PHOTO'].includes(input.picture.authenticity) ? 1.5 : 0) +
    d.references.length * 0.2 -
    Object.values(d.specs).reduce((n, s) => n + (s.fit.status === 'UNRESOLVED' ? 3 : s.fit.status === 'SHORTER_COPY_SUGGESTED' ? 1 : 0), 0);
  const best = [...directions].sort((a, b) => goalFit(b) - goalFit(a) || a.key.localeCompare(b.key))[0]!;
  const because = `${best.name}: ${input.goal === 'OFFER' && best.emphasis === 'PRICE' ? 'the offer is the news and this direction makes the price the hero' : best.approach === 'EDITORIAL_TYPE' ? 'a calm, considered structure suits the brand and the decision the audience is making' : best.approach === 'IMAGE_LED' ? 'the picture can carry the idea on its own' : 'the message lands at a glance in a fast feed'}${Object.values(best.specs).every((s) => s.fit.status === 'FITS' || s.fit.status === 'REFLOWED') ? ', and the copy fits every format' : ''}.`;

  return CreativeDirectionSetSchema.parse({
    version: 1,
    conceptKey: input.conceptKey,
    moodboard: input.references.map((r) => ({ referenceId: r.reference.id, score: r.score, reasons: r.reasons })),
    directions,
    recommended: best.key,
    recommendedBecause: because,
  });
}
