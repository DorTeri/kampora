import type { CreativeDesignSpec, CreativeDirection, CreativeDirectionSet, DesignMove } from '@kampora/shared';
import { allPictures, composeDirectionSpecs, directCreative, inputForDirection, type DirectionInput } from './art-director-v2';

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
  /** Directing with no references at all (the brief-only baseline); `changed` and `layers` read baseline → this direction. */
  withoutAnyReference: {
    method: string;
    moves: DesignMove[];
    typeSystem: string;
    picture: string | null;
    changed: string[];
    layers: Record<string, LayerChange[]>;
    /** Set when the references changed the plan but the page came out the same: said plainly, never shown as an effect. */
    samePage?: string;
  };
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

/** A plan change with no page change: the baseline reached the same arrangement on its own (often a safety fallback). */
function withSamePage(w: DirectionTrace['withoutAnyReference']): DirectionTrace['withoutAnyReference'] {
  if (!w.changed.length || Object.values(w.layers).some((l) => l.length > 0)) return w;
  return { ...w, samePage: `The references changed the plan (${w.changed.join('; ')}) but not the page: without them the layout engine reaches the same arrangement.` };
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

/** The picture a direction is built on (its first image layer). */
const pictureOf = (d: CreativeDirection | undefined): string | null => {
  const spec = d && Object.values(d.specs)[0];
  const img = spec?.layers.find((l) => l.kind === 'image');
  return img && img.kind === 'image' ? img.assetId : null;
};

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
    else if (x.lines.join('\n') !== y.lines.join('\n')) out.push(`${role.toLowerCase()} line breaks "${x.lines.join(' / ')}" → "${y.lines.join(' / ')}"`);
    if (Math.abs(x.font.lineHeight - y.font.lineHeight) >= 0.05) out.push(`${role.toLowerCase()} line height ${x.font.lineHeight} → ${y.font.lineHeight}`);
    if (x.color !== y.color) out.push(`${role.toLowerCase()} colour ${x.color} → ${y.color}`);
    if (Boolean(x.box) !== Boolean(y.box)) out.push(`${role.toLowerCase()} ${x.box ? 'button/box removed' : 'set in a box'}`);
    if (Math.abs(x.rect.y - y.rect.y) > 40 || Math.abs(x.rect.x - y.rect.x) > 40) out.push(`${role.toLowerCase()} moved (${round(x.rect.x)},${round(x.rect.y)}) → (${round(y.rect.x)},${round(y.rect.y)})`);
  }
  for (const role of tb.keys()) if (!ta.has(role)) out.push(`${role.toLowerCase()} added`);
  const img = (s: CreativeDesignSpec) => s.layers.find((l) => l.kind === 'image');
  const ia = img(a);
  const ib = img(b);
  const count = (s: CreativeDesignSpec) => s.layers.filter((l) => l.kind === 'image').length;
  if (count(a) !== count(b)) out.push(`pictures on the page ${count(a)} → ${count(b)}`);
  if (ia && ib && ia.kind === 'image' && ib.kind === 'image') {
    if (ia.assetId !== ib.assetId) out.push(`picture ${ia.assetId} → ${ib.assetId}`);
    if (Math.abs(ia.rect.y - ib.rect.y) > 40 || Math.abs(ia.rect.x - ib.rect.x) > 40) out.push(`photo moved (${round(ia.rect.x)},${round(ia.rect.y)}) → (${round(ib.rect.x)},${round(ib.rect.y)})`);
    if (Math.abs(ia.focal.x - ib.focal.x) > 0.05 || Math.abs(ia.focal.y - ib.focal.y) > 0.05) out.push(`photo crop focal (${ia.focal.x},${ia.focal.y}) → (${ib.focal.x},${ib.focal.y})`);
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
  const la = a.layers.find((l) => l.kind === 'logo');
  const lb = b.layers.find((l) => l.kind === 'logo');
  if (la && lb && la.kind === 'logo' && lb.kind === 'logo') {
    if (Math.abs(la.rect.y - lb.rect.y) > 40 || Math.abs(la.rect.x - lb.rect.x) > 40) out.push(`brand mark moved (${round(la.rect.x)},${round(la.rect.y)}) → (${round(lb.rect.x)},${round(lb.rect.y)})`);
    if (Math.abs(la.font.size - lb.font.size) >= 2) out.push(`brand mark ${round(la.font.size)}px → ${round(lb.font.size)}px`);
  }
  return out.map((change) => ({ change }));
}

/** Traces how the moodboard shaped each direction of a set produced by `directCreative(input)`. */
export function traceReferenceInfluence(input: DirectionInput, set: CreativeDirectionSet = directCreative(input)): DirectionTrace[] {
  const formats = input.formats ?? ['4:5', '9:16'];
  const bare = directCreative({ ...input, references: [] });
  const leaveOneOut = new Map(input.references.map((r) => [r.reference.id, directCreative({ ...input, references: input.references.filter((x) => x !== r) })]));
  const assetIds = new Set([...allPictures(input).map((p) => p.assetId), input.logoAssetId].filter(Boolean));

  return set.directions.map((d) => {
    const own = inputForDirection(input, d);
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
      const mine = inf.moves.filter((m) => (moveSources[m] ?? []).filter((s) => s !== inf.referenceId).length === 0);
      const reduced = d.moves.filter((m) => !mine.includes(m));
      const recomposed = mine.length ? composeDirectionSpecs(own, d.approach, d.method, reduced, d.typeSystem, formats, d.emphasis) : null;
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
      ? composeDirectionSpecs(own, d.approach, d.method, d.moves.filter((m) => !referenceOnlyMoves.includes(m)), d.typeSystem, formats, d.emphasis)
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
      withoutAnyReference: withSamePage({
        method: noRefs?.method ?? '-',
        moves: (noRefs?.moves ?? []) as DesignMove[],
        typeSystem: noRefs?.typeSystem ?? '-',
        picture: pictureOf(noRefs),
        // Read as "baseline → reference-informed", like `layers`.
        changed: noRefs ? [...compareDirections(noRefs, d), ...(pictureOf(noRefs) !== pictureOf(d) ? [`picture ${pictureOf(noRefs)} → ${pictureOf(d)}`] : [])] : ['no baseline direction'],
        // Read as "baseline → reference-informed": what the references changed on the page.
        layers: Object.fromEntries(formats.map((f) => [f, noRefs?.specs[f] ? diffSpecs(noRefs.specs[f]!, d.specs[f]!) : []])),
      }),
      originality: {
        maxOverlap: Math.round((overlaps[0]?.o ?? 0) * 100) / 100,
        closestReference: overlaps[0]?.id ?? null,
        referencesCombined: d.references.length,
        ownAssetsOnly: pageAssets.every((a) => assetIds.has(a)),
      },
    };
  });
}
