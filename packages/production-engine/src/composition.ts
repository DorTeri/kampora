import type {
  CompositionType,
  SceneComposition,
  ShotType,
  StoryboardScene,
  VisualConflict,
} from '@kampora/shared';
import { stripNiqqud } from '@kampora/shared';

/**
 * What a scene's picture must contain, and how that is reconciled with the requested framing. Generic: it works
 * from the storyboard and the business's own product list, never from knowledge of a particular business.
 *
 * Priority when instructions disagree (highest first):
 *   1. verified business/product constraints (the owner's product photos, the product list)
 *   2. explicit storyboard requirements (composition type, required subjects, quantities)
 *   3. the scene's purpose and message
 *   4. the campaign's shared look
 *   5. generic framing and lens preferences
 */

export interface ResolvedComposition extends SceneComposition {
  /** STORYBOARD: written by the storyboard director. INFERRED: derived from the visual (older storyboards). */
  source: 'STORYBOARD' | 'INFERRED';
}

// ── Hebrew/English word matching ───────────────────────────────────────

/** One-letter Hebrew prefixes (ו, ה, ב, ל, מ, ש, כ) that attach to a noun: "ומאפה" is "and a pastry". */
const PREFIXES = 'והבלמשכ';
const HEBREW = /[א-ת]/;

function stem(word: string): string {
  if (HEBREW.test(word)) {
    for (const suffix of ['ים', 'ות'])
      if (word.length - suffix.length >= 2 && word.endsWith(suffix)) return word.slice(0, -suffix.length);
    if (word.length >= 3 && /[היתץ]$/.test(word)) return word.slice(0, -1);
    return word;
  }
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function words(text: string): string[] {
  return stripNiqqud(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Every form a written word may be: as written, and without up to two attached prefixes. */
function forms(word: string): string[] {
  const out = [stem(word)];
  let w = word;
  for (let i = 0; i < 2 && w.length > 2 && PREFIXES.includes(w[0]!); i++) {
    w = w.slice(1);
    out.push(stem(w));
  }
  return out;
}

/** Position of the first word of `text` that is `name` (its head word), or -1. */
function position(text: string, name: string): number {
  const head = words(name)[0];
  if (!head) return -1;
  const target = stem(head);
  return words(text).findIndex((w) => forms(w).includes(target));
}

/** Does the text name this subject? Tolerates Hebrew prefixes and singular/plural ("ומאפה" ↔ "מאפים"). */
export function mentions(text: string, name: string): boolean {
  return position(text, name) >= 0;
}

/** The products a text names, in the order it names them. */
export function subjectsIn(text: string, products: readonly { name: string }[]): string[] {
  return products
    .map((p) => ({ name: p.name, at: position(text, p.name) }))
    .filter((p) => p.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((p) => p.name);
}

const anyOf = (text: string, cues: readonly string[]) => cues.some((c) => mentions(text, c));

// ── Composition inference (older storyboards) ──────────────────────────

const CUES: [CompositionType, readonly string[]][] = [
  [
    'DEMONSTRATION',
    [
      'הכנה',
      'מכינים',
      'מכין',
      'מוזגים',
      'מזיגה',
      'אופים',
      'אפייה',
      'לישה',
      'הדגמה',
      'תהליך',
      'preparing',
      'making',
      'pouring',
      'baking',
      'demo',
      'process',
    ],
  ],
  [
    'ASSORTMENT',
    [
      'מגוון',
      'מבחר',
      'פריסה',
      'מגש',
      'שלל',
      'סלסלה',
      'ויטרינה',
      'מדף',
      'assortment',
      'variety',
      'selection',
      'spread',
      'range',
      'tray',
      'platter',
      'display',
      'several',
      'lineup',
    ],
  ],
  [
    'LIFESTYLE',
    [
      'אנשים',
      'לקוח',
      'לקוחה',
      'חברים',
      'משפחה',
      'זוג',
      'ילדים',
      'נהנים',
      'people',
      'customer',
      'friend',
      'family',
      'couple',
      'person',
      'enjoying',
    ],
  ],
  [
    'ENVIRONMENT',
    [
      'חזית',
      'פנים העסק',
      'עסק',
      'חלל',
      'אווירה',
      'מקום',
      'סניף',
      'חנות',
      'storefront',
      'interior',
      'exterior',
      'venue',
      'shop',
      'store',
      'atmosphere',
      'place',
    ],
  ],
  ['DETAIL', ['מרקם', 'טקסטורה', 'פירורים', 'חתך', 'texture', 'crumb', 'macro']],
];

/** Composition type a picture description implies (keyword cues, Hebrew or English); SINGLE_HERO by default. */
export function inferCompositionType(text: string): CompositionType {
  for (const [type, cues] of CUES) if (anyOf(text, cues)) return type;
  return 'SINGLE_HERO';
}

function inferType(scene: StoryboardScene): CompositionType {
  return scene.role === 'DEMO' ? 'DEMONSTRATION' : inferCompositionType(scene.visual);
}

/**
 * The scene's composition: the storyboard's when it has one, otherwise inferred from the visual text and the
 * business's product list (so an older storyboard's "spread of fresh products" is still an assortment).
 */
export function sceneComposition(
  scene: StoryboardScene,
  products: readonly { name: string }[] = [],
): ResolvedComposition {
  const explicit = scene.direction?.composition;
  if (explicit) return { ...explicit, source: 'STORYBOARD' };
  const type = inferType(scene);
  const named = subjectsIn(scene.visual, products);
  const subjects =
    type === 'SINGLE_HERO'
      ? named.map((name) => ({ name, quantity: 1 }))
      : type === 'DETAIL'
        ? named.slice(0, 1).map((name) => ({ name, quantity: 1 }))
        : type === 'ASSORTMENT'
          ? (named.length ? named : products.slice(0, 4).map((p) => p.name)).map((name) => ({ name }))
          : type === 'ENVIRONMENT'
            ? []
            : named.map((name) => ({ name }));
  return { type, subjects: subjects.slice(0, 6), source: 'INFERRED' };
}

// ── Framing reconciliation ─────────────────────────────────────────────

const SHOT_DIRECTION: Record<ShotType, string> = {
  'extreme-close-up': 'extreme close-up, texture and detail fill the frame',
  'close-up': 'close-up, subject fills most of the frame',
  medium: 'medium shot, subject and some surroundings',
  wide: 'wide shot establishing the place and atmosphere',
  overhead: 'top-down overhead shot',
  detail: 'macro detail shot of one meaningful element',
  graphic: 'clean, uncluttered background composition with generous empty space',
};

const TIGHT: readonly ShotType[] = ['extreme-close-up', 'detail'];

const list = (c: SceneComposition) =>
  c.subjects.map((s) => (s.quantity ? `${s.name} (${s.quantity})` : s.name)).join(', ');

/** The non-negotiable content line of the prompt. */
export function compositionRequirement(c: SceneComposition): string {
  const names = list(c);
  switch (c.type) {
    case 'SINGLE_HERO':
      return c.subjects.length > 1
        ? `Required in frame: ${names}. Every listed subject clearly visible and recognisable; the first one is the hero.`
        : `Required in frame: ${names || 'the product'} as the single clear hero.`;
    case 'ASSORTMENT':
      return `Required in frame: an assortment of at least 3 distinct items${names ? ` (from: ${names})` : ''}, side by side, every item recognisable; no single item dominates.`;
    case 'LIFESTYLE':
      return `Required in frame: people in a genuine moment with ${names || 'the product'}; natural faces and correct hands.`;
    case 'DETAIL':
      return `Required in frame: one meaningful detail of ${names || 'the product'} (texture, cut or finish).`;
    case 'ENVIRONMENT':
      return `Required in frame: the place itself, interior or storefront, and its atmosphere${names ? `, with ${names} visible` : ''}; products are secondary.`;
    case 'DEMONSTRATION':
      return `Required in frame: ${names || 'the product'} being prepared or used, the step clearly readable.`;
  }
}

/**
 * The framing actually asked of the provider. The requested shot is kept when it can show what the composition
 * requires; otherwise it is adapted (the composition wins) and the contradiction is recorded.
 */
export function resolveFraming(
  shot: ShotType,
  c: SceneComposition,
): { direction: string; conflicts: VisualConflict[] } {
  const conflicts: VisualConflict[] = [];
  const tooTight = (detail: string, direction: string) => {
    conflicts.push({
      code: 'SHOT_TOO_TIGHT',
      detail,
      resolution: `Framing widened: ${direction}`,
    });
    return { direction, conflicts };
  };
  if (shot === 'graphic') return { direction: SHOT_DIRECTION.graphic, conflicts };
  const tight = TIGHT.includes(shot);
  switch (c.type) {
    case 'ASSORTMENT':
      if (tight)
        return tooTight(
          `A ${shot} shot shows one element, but the scene requires an assortment.`,
          'close enough to feel the texture, wide enough that the whole assortment is in frame',
        );
      if (shot === 'close-up')
        return { direction: 'close-up across the assortment, several items filling the frame', conflicts };
      break;
    case 'ENVIRONMENT':
      if (tight || shot === 'close-up')
        return tooTight(
          `A ${shot} shot cannot establish the place the scene requires.`,
          'wide shot establishing the place and atmosphere',
        );
      break;
    case 'LIFESTYLE':
      if (tight)
        return tooTight(
          `A ${shot} shot cannot show people and the product together.`,
          'medium close shot, people and product both readable',
        );
      break;
    case 'SINGLE_HERO':
      if (c.subjects.length > 1 && tight)
        return tooTight(
          `A ${shot} shot cannot keep all ${c.subjects.length} required subjects in frame.`,
          `close-up with all ${c.subjects.length} required subjects in frame, the first one in sharpest focus`,
        );
      if (shot === 'wide')
        return { direction: 'wide shot with the product as the clear focal point', conflicts };
      break;
    case 'DETAIL':
      if (shot === 'wide' || shot === 'medium') {
        conflicts.push({
          code: 'SHOT_TOO_WIDE',
          detail: `A ${shot} shot makes the required detail too small to read.`,
          resolution: 'Framing tightened: close-up on the detail',
        });
        return { direction: 'close-up on the detail, texture filling most of the frame', conflicts };
      }
      break;
    case 'DEMONSTRATION':
      return { direction: `${SHOT_DIRECTION[shot]}, focused on the action`, conflicts };
  }
  return { direction: SHOT_DIRECTION[shot], conflicts };
}

/** A macro lens and a scene that must show a place, people or several items contradict each other. */
export function adaptLook(
  look: string,
  shot: ShotType,
  c: SceneComposition,
): { look: string; conflict?: VisualConflict } {
  const needsRoom =
    shot === 'wide' || c.type === 'ENVIRONMENT' || c.type === 'LIFESTYLE' || c.type === 'ASSORTMENT';
  if (!needsRoom || !/macro/i.test(look)) return { look };
  return {
    look: look.replace(/,?\s*\d+mm macro lens look/i, ', lens wide enough for the framing'),
    conflict: {
      code: 'LENS_CONTRADICTS_FRAMING',
      detail: 'The campaign look uses a macro lens, which cannot show this scene.',
      resolution: 'Same light and grade; lens chosen for the framing.',
    },
  };
}

/** The scene asks for something the picture must never contain (logos, signs, written words). */
const TEXT_CUES = [
  'לוגו',
  'כתובת',
  'שלט',
  'כיתוב',
  'טקסט',
  'מחיר',
  'logo',
  'sign',
  'signage',
  'address',
  'text',
  'price',
  'caption',
];

export function textInPictureConflict(scene: Pick<StoryboardScene, 'visual'>): VisualConflict | undefined {
  if (!anyOf(scene.visual, TEXT_CUES)) return undefined;
  return {
    code: 'TEXT_IN_PICTURE',
    detail: 'The scene describes a logo, sign, address or other writing inside the picture.',
    resolution: 'Writing is added by Kampora as an editable overlay; the picture shows none.',
  };
}
