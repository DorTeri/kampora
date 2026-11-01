import {
  VideoProjectSchema,
  type CompositionMethod,
  type CreativeDesignSpec,
  type MediaAsset,
  type TypeSystemId,
  type VideoProject,
} from '@kampora/shared';

/**
 * Carries a chosen design direction into the video: titles use the direction's display face and entrance, and
 * the video closes on the direction's own 9:16 composition (an end card whose layers enter in reading order),
 * so the static ad and the Reel read as one campaign. Nothing about the story, timing or narration changes,
 * except that a too-short final scene is held long enough to read the end card.
 */
export interface VideoDirection {
  spec: CreativeDesignSpec;
  typeSystem: TypeSystemId;
  method: CompositionMethod;
}

const ENTRANCE: Record<CompositionMethod, 'RISE' | 'WIPE' | 'FADE'> = {
  IMAGE_FIRST: 'WIPE',
  LIFESTYLE: 'FADE',
  LAYERED: 'WIPE',
  PRODUCT_LED: 'RISE',
  SPLIT: 'WIPE',
  EDITORIAL: 'FADE',
  ASYMMETRIC: 'WIPE',
  BOLD_TYPE: 'RISE',
  PROMO_PRICE: 'RISE',
  LOCAL_MODERN: 'RISE',
};

/** Seconds a viewer needs to read an end card: ~0.5 s per reading-path element, at least 3 s. */
export function endCardSeconds(spec: CreativeDesignSpec): number {
  return Math.max(3, Math.min(5, 1 + spec.readingPath.length * 0.5));
}

export function artDirectVideo(project: VideoProject, direction: VideoDirection, available: readonly MediaAsset[] = []): VideoProject {
  const { spec } = direction;
  if (spec.width !== project.output.width || spec.height !== project.output.height)
    throw new Error(`The end card is ${spec.width}x${spec.height}; the video is ${project.output.width}x${project.output.height}`);
  const fps = project.output.fps;
  const scenes = project.scenes.map((s, i) => {
    if (i !== project.scenes.length - 1) return s;
    // The end card already sets the price, the action and the brand: no overlays on top of it, no subtitle
    // repeating the words on it. The narration stays.
    return {
      ...s,
      durationInFrames: Math.max(s.durationInFrames, Math.round(endCardSeconds(spec) * fps)),
      visual: { type: 'composed' as const, spec, animation: 'READING_ORDER' as const },
      overlays: [],
      caption: undefined,
      transition: { type: 'fade' as const, durationInFrames: 10 },
    };
  });
  const needed = spec.layers.flatMap((l) => ((l.kind === 'image' || l.kind === 'logo') && l.assetId ? [l.assetId] : []));
  const have = new Set(project.assets.map((a) => a.id));
  const extra = needed.filter((id) => !have.has(id)).map((id) => {
    const a = available.find((x) => x.id === id);
    if (!a) throw new Error(`End card asset "${id}" is not available`);
    return a;
  });
  return VideoProjectSchema.parse({
    ...project,
    artDirection: {
      typeSystem: direction.typeSystem,
      accent: spec.palette.accent,
      ink: spec.palette.ink,
      surface: spec.palette.surface,
      textAnimation: ENTRANCE[direction.method],
    },
    assets: [...project.assets, ...extra],
    scenes,
  });
}

/**
 * What the Visual Planner must deliver for a composition: the picture's aspect, where the subject should sit and
 * which side must stay calm for type. Derived from the spec, so a new picture fits the design it is made for.
 */
export interface PictureBrief {
  aspect: number;
  orientation: 'PORTRAIT' | 'LANDSCAPE' | 'SQUARE';
  mask: string;
  focal: { x: number; y: number };
  /** Side of the picture that text covers or touches: keep it calm (no subject, low detail). */
  calmSide: 'TOP' | 'BOTTOM' | 'START' | 'END' | 'NONE';
  /** Text sits on the picture itself (needs a quiet, darkenable area), or beside it. */
  textOverPicture: boolean;
  guidance: string;
}

export function pictureBriefFromSpec(spec: CreativeDesignSpec): PictureBrief | undefined {
  const img = spec.layers.find((l) => l.kind === 'image');
  if (!img || img.kind !== 'image') return undefined;
  const r = img.rect;
  const aspect = Math.round((r.w / r.h) * 100) / 100;
  const over = spec.layers.filter((l) => l.kind === 'text' && l.rect.x < r.x + r.w && l.rect.x + l.rect.w > r.x && l.rect.y < r.y + r.h && l.rect.y + l.rect.h > r.y && spec.layers.indexOf(l) > spec.layers.indexOf(img));
  let calmSide: PictureBrief['calmSide'] = 'NONE';
  if (over.length) {
    const cy = over.reduce((s, l) => s + l.rect.y + l.rect.h / 2, 0) / over.length;
    const cx = over.reduce((s, l) => s + l.rect.x + l.rect.w / 2, 0) / over.length;
    const dy = (cy - (r.y + r.h / 2)) / r.h;
    const dx = (cx - (r.x + r.w / 2)) / r.w;
    // RTL: START is the right side.
    calmSide = Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? 'TOP' : 'BOTTOM') : dx > 0 ? 'START' : 'END';
  }
  const orientation = aspect > 1.05 ? 'LANDSCAPE' : aspect < 0.95 ? 'PORTRAIT' : 'SQUARE';
  const where = calmSide === 'NONE' ? 'the subject may fill the frame' : `keep the ${calmSide.toLowerCase()} of the frame calm and low-detail for type; the subject sits away from it`;
  return {
    aspect,
    orientation,
    mask: img.mask,
    focal: img.focal,
    calmSide,
    textOverPicture: over.length > 0,
    guidance: `${orientation.toLowerCase()} picture, about ${aspect}:1, ${img.mask === 'RECT' ? 'full frame' : `cropped to a ${img.mask.toLowerCase().replace('_', ' ')}`}; ${where}; subject near (${img.focal.x}, ${img.focal.y}).`,
  };
}
