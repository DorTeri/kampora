import type { CreativeDesignSpec, CreativeDirection, CreativeDirectionSet, DesignMove } from '@kampora/shared';
import { composeDirectionSpecs, directCreative, type DirectionInput } from './art-director-v2';

/**
 * Proof that the references shape the pixels, not just the prompt or the UI. For each direction the trace runs
 * counterfactuals with the real Art Director and layout engine:
 *   - leave one reference out of the moodboard and direct again (does the direction change?),
 *   - remove the moves that reference contributed and recompose (which layers change, and how?),
 *   - direct with no references at all (what the brief alone would have produced).
 * It also measures originality: how close each direction comes to any single reference's set of moves. The
 * references hold no pictures and no words, so nothing else can be copied from them.
 */

export interface LayerChange {
  /** What changed, in words: "headline 132px → 112px", "rule line removed", "background #1f3a3d → #f6f3ee". */
  change: string;
}

export interface ReferenceEffect {
  referenceId: string;
  brand: string;
  analysisBasis: string;
  /** The moves this reference voted for that the direction uses. */
  moves: DesignMove[];
  /** Directing again without this reference: what the same direction becomes. */
  withoutReference: { method: string; moves: DesignMove[]; typeSystem: string; changed: string[] };
  /** Recomposing the direction without this reference's moves, per format. */
  withoutItsMoves: Record<string, LayerChange[]>;
}

export interface DirectionTrace {
  key: CreativeDirection['key'];
  name: string;
  method: string;
  moves: DesignMove[];
  /** Where every move came from: reference votes (by id), the concept, or the approach's own default. */
  moveSources: Record<string, string[]>;
  effects: ReferenceEffect[];
  /** Moves that only the references asked for (not the concept, not the approach's default). */
  referenceOnlyMoves: DesignMove[];
  /** The same direction recomposed without every reference-only move, per format: what the references drew. */
  withoutReferenceMoves: Record<string, LayerChange[]>;
  /** Directing with no references at all. */
  withoutAnyReference: { method: string; moves: DesignMove[]; typeSystem: string; changed: string[] };
  originality: {
    /** Highest overlap (Jaccard) between this direction's moves and one reference's moves. */
    maxOverlap: number;
    closestReference: string | null;
    /** How many references contributed moves: a synthesis, not a single source. */
    referencesCombined: number;
    /** Only the owner's pictures and the approved words appear on the page. */
    ownAssetsOnly: boolean;
  };
}

const jaccard = (a: readonly string[], b: readonly string[]) => {
  const A = new Set(a);
  const inter = b.filter((x) => A.has(x)).length;
  return inter / (A.size + b.length - inter || 1);
};

function compareDirections(a: CreativeDirection, b: CreativeDirection | undefined): string[] {
  if (!b) return ['direction not produced'];
  const out: string[] = [];
  if (a.method !== b.method) out.push(`method ${a.method} → ${b.method}`);
  if (a.typeSystem !== b.typeSystem) out.push(`type ${a.typeSystem} → ${b.typeSystem}`);
  const lost = a.moves.filter((m) => !b.moves.includes(m));
  const gained = b.moves.filter((m) => !a.moves.includes(m));
  if (lost.length) out.push(`loses ${lost.join(', ')}`);
  if (gained.length) out.push(`gains ${gained.join(', ')}`);
  return out;
}

const round = (n: number) => Math.round(n);

/** The differences a viewer would see between two compositions of the same words. */
export function diffSpecs(a: CreativeDesignSpec, b: CreativeDesignSpec): LayerChange[] {
  const out: string[] = [];
  const bg = (s: CreativeDesignSpec) => `${s.background.kind === 'GRADIENT' ? 'gradient ' : ''}${s.background.color}`;
  if (bg(a) !== bg(b)) out.push(`background ${bg(a)} → ${bg(b)}`);
  if (a.background.grain !== b.background.grain) out.push(`grain ${a.background.grain} → ${b.background.grain}`);
  const texts = (s: CreativeDesignSpec) => new Map(s.layers.flatMap((l) => (l.kind === 'text' ? [[l.role, l] as const] : [])));
  const ta = texts(a);
  const tb = texts(b);
  for (const [role, x] of ta) {
    const y = tb.get(role);
    if (!y) {
      out.push(`${role.toLowerCase()} removed`);
      continue;
    }
    if (x.font.family !== y.font.family) out.push(`${role.toLowerCase()} face ${x.font.family} → ${y.font.family}`);
    if (Math.abs(x.font.size - y.font.size) >= 2) out.push(`${role.toLowerCase()} ${round(x.font.size)}px → ${round(y.font.size)}px`);
    if (x.lines.length !== y.lines.length) out.push(`${role.toLowerCase()} ${x.lines.length} → ${y.lines.length} lines`);
    if (x.color !== y.color) out.push(`${role.toLowerCase()} colour ${x.color} → ${y.color}`);
    if (Boolean(x.box) !== Boolean(y.box)) out.push(`${role.toLowerCase()} ${x.box ? 'button/box removed' : 'set in a box'}`);
    if (Math.abs(x.rect.y - y.rect.y) > 40 || Math.abs(x.rect.x - y.rect.x) > 40) out.push(`${role.toLowerCase()} moved (${round(x.rect.x)},${round(x.rect.y)}) → (${round(y.rect.x)},${round(y.rect.y)})`);
  }
  for (const role of tb.keys()) if (!ta.has(role)) out.push(`${role.toLowerCase()} added`);
  const img = (s: CreativeDesignSpec) => s.layers.find((l) => l.kind === 'image');
  const ia = img(a);
  const ib = img(b);
  if (ia && ib && ia.kind === 'image' && ib.kind === 'image') {
    if (ia.treatment !== ib.treatment) out.push(`photo treatment ${ia.treatment} → ${ib.treatment}`);
    if (ia.mask !== ib.mask) out.push(`photo mask ${ia.mask} → ${ib.mask}`);
    if (ia.zoom !== ib.zoom) out.push(`photo crop zoom ${ia.zoom} → ${ib.zoom}`);
    const area = (r: { w: number; h: number }) => r.w * r.h;
    const ratio = area(ib.rect) / area(ia.rect);
    if (Math.abs(1 - ratio) > 0.1) out.push(`photo area ×${ratio.toFixed(2)}`);
  } else if (Boolean(ia) !== Boolean(ib)) out.push(ia ? 'photo removed' : 'photo added');
  const shapes = (s: CreativeDesignSpec) => {
    const m = new Map<string, number>();
    for (const l of s.layers) if (l.kind === 'shape') m.set(l.shape, (m.get(l.shape) ?? 0) + 1);
    return m;
  };
  const sa = shapes(a);
  const sb = shapes(b);
  for (const k of new Set([...sa.keys(), ...sb.keys()])) {
    const n = sa.get(k) ?? 0;
    const m = sb.get(k) ?? 0;
    if (n !== m) out.push(`${k.toLowerCase()} shapes ${n} → ${m}`);
  }
  return out.map((change) => ({ change }));
}

/** Traces how the moodboard shaped each direction of a set produced by `directCreative(input)`. */
export function traceReferenceInfluence(input: DirectionInput, set: CreativeDirectionSet = directCreative(input)): DirectionTrace[] {
  const formats = input.formats ?? ['4:5', '9:16'];
  const bare = directCreative({ ...input, references: [] });
  const leaveOneOut = new Map(input.references.map((r) => [r.reference.id, directCreative({ ...input, references: input.references.filter((x) => x !== r) })]));
  const assetIds = new Set([input.picture?.assetId, input.logoAssetId].filter(Boolean));

  return set.directions.map((d) => {
    const moveSources: Record<string, string[]> = {};
    for (const m of d.moves) {
      const refs = input.references.filter((r) => r.reference.designMoves.includes(m)).map((r) => r.reference.id);
      const concept = input.concept.visualMoves?.includes(m) ? ['concept'] : [];
      moveSources[m] = refs.length || concept.length ? [...refs, ...concept] : ['approach default'];
    }
    const effects: ReferenceEffect[] = d.references.map((inf) => {
      const r = input.references.find((x) => x.reference.id === inf.referenceId)!.reference;
      const other = leaveOneOut.get(inf.referenceId)!.directions.find((x) => x.key === d.key);
      // A move another reference also voted for stays: only what this reference alone brought is taken out.
      const own = inf.moves.filter((m) => (moveSources[m] ?? []).filter((s) => s !== inf.referenceId).length === 0);
      const reduced = d.moves.filter((m) => !own.includes(m));
      const recomposed = own.length ? composeDirectionSpecs(input, d.approach, d.method, reduced, d.typeSystem, formats, d.emphasis) : null;
      return {
        referenceId: inf.referenceId,
        brand: r.brand,
        analysisBasis: r.analysisBasis,
        moves: inf.moves as DesignMove[],
        withoutReference: { method: other?.method ?? '-', moves: (other?.moves ?? []) as DesignMove[], typeSystem: other?.typeSystem ?? '-', changed: compareDirections(d, other) },
        withoutItsMoves: Object.fromEntries(formats.map((f) => [f, recomposed ? diffSpecs(d.specs[f]!, recomposed[f]!) : []])),
      };
    });
    const referenceOnlyMoves = d.moves.filter((m) => moveSources[m]!.every((src) => src !== 'concept' && src !== 'approach default'));
    const withoutRefMoves = referenceOnlyMoves.length
      ? composeDirectionSpecs(input, d.approach, d.method, d.moves.filter((m) => !referenceOnlyMoves.includes(m)), d.typeSystem, formats, d.emphasis)
      : null;
    const noRefs = bare.directions.find((x) => x.key === d.key);
    const overlaps = input.references.map((r) => ({ id: r.reference.id, o: jaccard(d.moves, r.reference.designMoves) })).sort((a, b) => b.o - a.o);
    const pageAssets = Object.values(d.specs).flatMap((s) => s.layers.flatMap((l) => (l.kind === 'image' || (l.kind === 'logo' && l.assetId) ? [l.assetId!] : [])));
    return {
      key: d.key,
      name: d.name,
      method: d.method,
      moves: d.moves as DesignMove[],
      moveSources,
      effects,
      referenceOnlyMoves: referenceOnlyMoves as DesignMove[],
      withoutReferenceMoves: Object.fromEntries(formats.map((f) => [f, withoutRefMoves ? diffSpecs(d.specs[f]!, withoutRefMoves[f]!) : []])),
      withoutAnyReference: { method: noRefs?.method ?? '-', moves: (noRefs?.moves ?? []) as DesignMove[], typeSystem: noRefs?.typeSystem ?? '-', changed: compareDirections(d, noRefs) },
      originality: {
        maxOverlap: Math.round((overlaps[0]?.o ?? 0) * 100) / 100,
        closestReference: overlaps[0]?.id ?? null,
        referencesCombined: d.references.length,
        ownAssetsOnly: pageAssets.every((a) => assetIds.has(a)),
      },
    };
  });
}
