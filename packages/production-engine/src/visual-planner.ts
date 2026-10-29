import { createHash } from 'node:crypto';
import type {
  AvailableAsset,
  BusinessProfile,
  ConceptStrategy,
  ImageAspect,
  Product,
  SceneRole,
  ShotType,
  StoryboardScene,
  ToneOfVoice,
  VisualScenePlan,
  VisualStyle,
} from '@kampora/shared';
import { REFERENCE_IMAGE_MIME_TYPES } from '@kampora/shared';
import {
  adaptLook,
  compositionRequirement,
  resolveFraming,
  sceneComposition,
  textInPictureConflict,
} from './composition';

/** Never in a generated image: on-screen text is rendered by Kampora (RTL-correct, editable), not baked in. */
export const IMAGE_ALWAYS_AVOID = [
  'any text, letters, words, numbers or prices',
  'signage, labels with writing, packaging text',
  'logos, brand marks, watermarks',
  'user-interface elements, frames, borders, collage layouts',
] as const;

const STYLE_DIRECTION: Record<VisualStyle, string> = {
  'photoreal-product':
    'Photorealistic commercial product photograph, studio quality, true-to-life materials and colors, crisp focus on the subject',
  'lifestyle-photo':
    'Photorealistic lifestyle photograph, natural candid moment, real people and real places, editorial advertising quality',
  cinematic:
    'Cinematic photorealistic still, film-like color grade, dramatic but natural lighting, shallow depth of field',
  'ugc-handheld':
    'Authentic smartphone photo look, handheld framing, natural available light, unpolished but appealing, realistic',
  'flat-graphic':
    'Clean flat graphic composition with simple shapes and solid color areas, minimal, modern advertising design',
  illustration:
    'Modern editorial illustration, clean shapes, consistent line weight, rich but limited palette',
};

const STYLE_AVOID: Partial<Record<VisualStyle, string[]>> = {
  'photoreal-product': [
    'illustration or cartoon look',
    'plastic CGI look',
    'distorted or melted product shapes',
  ],
  'lifestyle-photo': ['illustration or cartoon look', 'stock-photo posing', 'distorted hands or faces'],
  cinematic: ['illustration or cartoon look', 'oversaturated HDR look'],
  'ugc-handheld': ['illustration or cartoon look', 'studio backdrop look'],
};

const ROLE_SHOT: Record<SceneRole, ShotType> = {
  HOOK: 'extreme-close-up',
  PROBLEM: 'medium',
  SOLUTION: 'medium',
  PRODUCT: 'close-up',
  DEMO: 'medium',
  BENEFIT: 'medium',
  PROOF: 'detail',
  OFFER: 'graphic',
  CTA: 'wide',
};

const TONE_MOOD: Record<ToneOfVoice, string> = {
  friendly: 'friendly, inviting, everyday warmth',
  premium: 'refined, calm, premium',
  energetic: 'energetic, bright, lively',
  professional: 'trustworthy, clean, professional',
  warm: 'warm, cozy, human',
  playful: 'playful, cheerful, light',
};

/** One of these is picked per project, so every scene of one ad shares the same light and grade. */
const LOOKS = [
  'soft warm key light from the left, gentle fill, natural color grade, 50mm lens look, shallow depth of field',
  'bright diffused daylight, airy clean color grade, 35mm lens look, moderate depth of field',
  'golden-hour side light, warm highlights and soft shadows, 85mm lens look, creamy background blur',
  'controlled studio light with soft shadows, neutral true-color grade, 100mm macro lens look',
];

/**
 * A new version of a scene image follows a rejection, so it must be a different take, not a resample of the
 * same prompt: vary the camera and composition, never the product or the shared look.
 */
const ALTERNATIVE_TAKES = [
  'lower camera angle, subject slightly off-center',
  'higher three-quarter angle, tighter crop on the subject',
  'side angle with more calm negative space around the subject',
  'different surface and supporting props, same subject',
  'eye-level straight-on angle, simpler background',
];

const SAFE_ZONES: Record<ImageAspect, string> = {
  '9:16':
    'Vertical 9:16 frame. Keep the main subject in the central band; leave the top 15% and bottom 25% calm and uncluttered (captions and call-to-action are overlaid there).',
  '4:5':
    'Portrait 4:5 frame. Keep the main subject centered; leave the bottom 20% calm and uncluttered for overlays.',
  '1:1':
    'Square frame. Keep the main subject centered; leave the bottom 20% calm and uncluttered for overlays.',
};

export interface PlanSceneVisualInput {
  scene: StoryboardScene;
  business: Pick<BusinessProfile, 'name' | 'category' | 'tone' | 'brandColors'> & {
    /** The business's product list: names the subjects of scenes whose storyboard does not list them. */
    products?: readonly Pick<Product, 'name'>[];
  };
  strategy?: Pick<ConceptStrategy, 'visualStyle' | 'emotionalDirection'>;
  /** Customer photos to send as references (product accuracy). */
  references: readonly Pick<AvailableAsset, 'id' | 'description'>[];
  /** Stable per ad (e.g. the project id): selects the shared look. */
  lookSeed: string;
  aspect: ImageAspect;
  variant: number;
  /** Provider identity is part of the fingerprint: a different model is a different image. */
  provider: { id: string; model: string; quality: string };
}

/**
 * Default style when the concept does not set one: photographic, never illustration by default. Product-led
 * scenes get product photography; the rest lifestyle photography.
 */
export function defaultVisualStyle(role: SceneRole): VisualStyle {
  return role === 'PRODUCT' || role === 'DEMO' || role === 'PROOF' || role === 'OFFER'
    ? 'photoreal-product'
    : 'lifestyle-photo';
}

/**
 * Deterministic: same input ⇒ same plan, prompt and fingerprint. No LLM involved.
 *
 * The prompt is ordered by priority (see composition.ts): the business's own product photos first, then what the
 * storyboard requires in frame, the scene's purpose, the campaign look, and the generic framing last, adapted
 * where it contradicts the requirements. Every contradiction found is recorded in `conflicts`.
 */
export function planSceneVisual(input: PlanSceneVisualInput): VisualScenePlan {
  const { scene, business } = input;
  const style = input.strategy?.visualStyle ?? defaultVisualStyle(scene.role);
  const shot = scene.direction?.shot ?? ROLE_SHOT[scene.role];
  const look = LOOKS[parseInt(sha256(input.lookSeed).slice(0, 8), 16) % LOOKS.length]!;
  const palette = [business.brandColors.primary, business.brandColors.secondary, business.brandColors.accent];
  const mood = [TONE_MOOD[business.tone], input.strategy?.emotionalDirection].filter(Boolean).join('; ');
  const lighting = look.split(',')[0]!;
  const references = [...input.references].sort((a, b) => a.id.localeCompare(b.id));
  const composition = sceneComposition(scene, business.products);
  const place = composition.type === 'ENVIRONMENT';
  const productLed = !place && composition.type !== 'LIFESTYLE';

  const framing = resolveFraming(shot, composition);
  const lens = adaptLook(look, shot, composition);
  const textConflict = textInPictureConflict(scene);
  const conflicts = [...framing.conflicts, ...(lens.conflict ? [lens.conflict] : [])];
  if (textConflict) conflicts.push(textConflict);
  const standIn = references.length === 0;
  if (standIn && productLed && scene.quality.requiresProductAccuracy)
    conflicts.push({
      code: 'PRODUCT_ACCURACY_WITHOUT_REFERENCE',
      detail:
        'The scene must show the real product, but the business has no product photo to guide the image.',
      resolution:
        'Planned as a generic, unbranded stand-in and labelled as AI; a real product photo is preferred.',
    });
  const avoid = [
    ...IMAGE_ALWAYS_AVOID,
    ...(STYLE_AVOID[style] ?? []),
    ...(standIn && place ? ['storefront names, shop signs, recognisable real landmarks'] : []),
  ];

  // 1. The business's own photos (verified), or an honest statement that the picture is a generic stand-in.
  const authenticityLine = references.length
    ? `The attached photo${references.length > 1 ? 's show' : ' shows'} the real ${place ? 'place' : 'product'}: keep ${place ? 'its layout, materials and colors' : 'its shape, colors and proportions'} exactly; do not invent a different ${place ? 'place' : 'product'}.`
    : place
      ? 'No photo of the real place is available: this is a generic stand-in, not the real venue. No storefront names, signage or recognisable landmarks.'
      : productLed && scene.quality.requiresProductAccuracy
        ? 'No photo of the real product is available: show a generic, unbranded version; do not imitate any specific real product or packaging.'
        : '';

  const lines = [
    `${STYLE_DIRECTION[style]}.`,
    `Advertising image for "${business.name}" (${business.category}).`,
    authenticityLine,
    // 2. What the storyboard requires in frame; it overrides everything after it.
    `Scene (described in Hebrew): ${scene.visual}`,
    `${compositionRequirement(composition)} These requirements override any framing, lens or look guidance below.`,
    // 3. Purpose.
    scene.direction?.purpose ? `What the viewer should feel or understand: ${scene.direction.purpose}` : '',
    // 4. Campaign identity.
    `Campaign look, identical across all scenes of this ad: ${lens.look}.`,
    `Mood: ${mood}.`,
    `Brand colors appear naturally as accents in props, surfaces or light: ${palette.join(', ')}. Never as text.`,
    // 5. Generic framing, already adapted to the requirements.
    `Framing: ${framing.direction}.`,
    input.variant > 0
      ? `Alternative take: earlier versions were not right, so use a clearly different camera angle and composition (${ALTERNATIVE_TAKES[(input.variant - 1) % ALTERNATIVE_TAKES.length]}). Keep the same required subjects, look and mood.`
      : '',
    textConflict
      ? 'Any logo, sign, address or price the scene mentions is added later as an overlay: show none in the picture.'
      : '',
    SAFE_ZONES[input.aspect],
    `Strictly no text of any kind in the image (Hebrew or otherwise): no letters, words, numbers, prices, signs, labels, logos or watermarks.`,
  ].filter(Boolean);
  const prompt = lines.join('\n');

  const fingerprint = sha256(
    JSON.stringify({
      prompt,
      avoid,
      references: references.map((r) => r.id),
      aspect: input.aspect,
      variant: input.variant,
      provider: input.provider,
    }),
  );

  return {
    sceneKey: scene.key,
    aspect: input.aspect,
    style,
    subject: scene.visual,
    shot,
    composition,
    authenticity: references.length ? 'REFERENCE_GUIDED_AI' : 'SYNTHETIC_AI',
    conflicts,
    lighting,
    mood,
    palette,
    look,
    referenceAssetIds: references.map((r) => r.id),
    overlaySafeZones: SAFE_ZONES[input.aspect],
    avoid,
    prompt,
    variant: input.variant,
    fingerprint,
  };
}

/**
 * Which alternative take the next version asks for: the number of earlier versions that produced a picture. A
 * version the provider refused showed the owner nothing, so it does not count as a take that "was not right".
 */
export function regenerationVariant(versions: readonly { status: string }[]): number {
  return versions.filter((v) => v.status === 'SUCCEEDED').length;
}

/**
 * Customer photos to use as references for a scene: commercially usable photos (JPEG, PNG, WebP) whose tags
 * overlap the scene's requirements (the product photos), best match first, at most `max`.
 */
export function pickReferenceImages(
  scene: StoryboardScene,
  assets: readonly AvailableAsset[],
  max = 2,
): AvailableAsset[] {
  const tags = new Set(scene.requiredAssets.flatMap((r) => r.tags));
  const preferred = new Set(scene.requiredAssets.map((r) => r.preferredAssetId).filter(Boolean));
  return assets
    .filter((a) => a.kind === 'image' && a.commercialUse)
    .filter((a) => !a.mimeType || REFERENCE_IMAGE_MIME_TYPES.includes(a.mimeType))
    .map((a) => ({ a, score: (preferred.has(a.id) ? 10 : 0) + a.tags.filter((t) => tags.has(t)).length }))
    .filter(({ score }) => score > 0)
    .sort((x, y) => y.score - x.score || x.a.id.localeCompare(y.a.id))
    .slice(0, max)
    .map(({ a }) => a);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
