import {
  ART_DIRECTION_PLAYBOOK,
  LAYOUT_FAMILY_PROFILES,
  industryById,
  playbookTag,
  retrieveReferences,
} from '@kampora/agent-expertise';
import {
  ArtDirectionPlanSchema,
  designFor,
  type ArtDirectionPlan,
  type BrandColors,
  type CampaignGoal,
  type CompositionType,
  type ConceptAngle,
  type DesignDecision,
  type DesignElement,
  type HookTechnique,
  type LayoutFamily,
  type MediaAuthenticity,
  type StaticAdDesign,
  type ToneOfVoice,
  type VisualStyle,
} from '@kampora/shared';

/**
 * The Art Director: explicit decision rules (no model call) that turn the goal, the copy, the brand and the
 * available picture into an ArtDirectionPlan. Every choice carries its reason, every layout family considered is
 * scored, and the per-format designs are parameters for tested renderer components, never generated code.
 */

export interface ArtDirectionInput {
  goal: CampaignGoal;
  tone: ToneOfVoice;
  industryId?: string;
  /** The ad shows a price (an offer split into amount and label). */
  hasPrice: boolean;
  hasOffer: boolean;
  concept?: { angle: ConceptAngle; hookTechnique?: HookTechnique; headline?: string };
  brandColors: BrandColors;
  /** The best available picture: what it shows and how authentic it is. Absent: no usable picture. */
  picture?: { composition?: CompositionType; authenticity: MediaAuthenticity; busy?: boolean };
  /** The family of this business's previous ad: another family is preferred when it fits almost as well. */
  previousLayout?: LayoutFamily;
  /** Chosen by the owner (or a revision): used as is, the rules only fill in the rest. */
  layoutOverride?: LayoutFamily;
}

const FAMILIES = Object.keys(LAYOUT_FAMILY_PROFILES) as LayoutFamily[];
const REAL: readonly MediaAuthenticity[] = ['VERIFIED_PRODUCT_PHOTO', 'VERIFIED_BUSINESS_PHOTO'];

/** Scores every layout family against the situation; highest first, ties in a fixed order. */
export function scoreLayoutFamilies(input: ArtDirectionInput): ArtDirectionPlan['alternatives'] {
  const industry = input.industryId ? industryById(input.industryId) : undefined;
  const pic = input.picture;
  return FAMILIES.map((family) => {
    const p = LAYOUT_FAMILY_PROFILES[family];
    let score = 0;
    const reasons: string[] = [];
    const add = (points: number, reason: string) => {
      score += points;
      reasons.push(`${points > 0 ? '+' : ''}${points} ${reason}`);
    };
    if (p.goals.includes(input.goal)) add(3, `serves the ${input.goal} goal`);
    if (!pic && p.needsPicture) add(-6, 'needs a picture and there is none');
    if (!pic && !p.needsPicture) add(2, 'works without a picture');
    if (pic?.composition && p.compositions.includes(pic.composition))
      add(2, `shows a ${pic.composition} picture well`);
    if (p.tones.includes(input.tone)) add(1, `fits a ${input.tone} tone`);
    if (input.hasPrice) {
      if (p.carriesPrice) add(2, 'gives the price a strong place');
      else add(-2, 'has no strong place for a price');
    }
    if (industry?.preferredLayouts.includes(family)) add(1, `a convention in ${industry.id}`);
    const a = input.concept?.angle;
    const h = input.concept?.hookTechnique;
    if (family === 'OFFER_RETAIL' && (a === 'OFFER_DRIVEN' || h === 'OFFER_FIRST'))
      add(1, 'the copy leads with the offer');
    if (family === 'LIFESTYLE_PHOTO' && (a === 'LIFESTYLE' || a === 'UGC' || a === 'EMOTIONAL'))
      add(1, 'the copy tells a moment');
    if (family === 'BOLD_TYPOGRAPHIC' && (h === 'BOLD_STATEMENT' || h === 'QUESTION' || h === 'HOW_TO'))
      add(1, 'the headline can carry the ad');
    if (family === 'EDITORIAL_PRODUCT' && (a === 'PRODUCT_DEMO' || h === 'SENSORY_DETAIL'))
      add(1, 'the copy is about the product itself');
    if (pic?.busy && (family === 'LIFESTYLE_PHOTO' || family === 'OFFER_RETAIL'))
      add(-1, 'text over a busy picture');
    // A product hero claims "this is the product": with a generated stand-in, prefer families that do not.
    if (
      pic &&
      !REAL.includes(pic.authenticity) &&
      (family === 'PRODUCT_SHOWCASE' || family === 'PREMIUM_MINIMAL')
    )
      add(-1, 'would present an AI picture as the real product');
    if (input.previousLayout === family) add(-1, 'the previous ad used it');
    return { layoutFamily: family, score, reasons };
  }).sort((x, y) => y.score - x.score || FAMILIES.indexOf(x.layoutFamily) - FAMILIES.indexOf(y.layoutFamily));
}

const FOCAL: Record<CampaignGoal, DesignElement> = {
  OFFER: 'PRICE',
  SALES: 'PRICE',
  PRODUCT_PROMO: 'PRODUCT',
  AWARENESS: 'PEOPLE',
  LEADS: 'HEADLINE',
};

function hierarchy(input: ArtDirectionInput, family: LayoutFamily): DesignElement[] {
  const picture: DesignElement =
    input.picture?.composition === 'LIFESTYLE'
      ? 'PEOPLE'
      : input.picture?.composition === 'ENVIRONMENT'
        ? 'PLACE'
        : 'PRODUCT';
  let first: DesignElement = FOCAL[input.goal];
  if (first === 'PRICE' && !input.hasPrice) first = input.picture ? picture : 'HEADLINE';
  if (first === 'PEOPLE') first = input.picture ? picture : 'HEADLINE';
  if (first === 'PRODUCT' && !input.picture) first = 'HEADLINE';
  if (family === 'BOLD_TYPOGRAPHIC' && first !== 'PRICE') first = 'HEADLINE';
  const order: DesignElement[] = [first];
  const push = (e: DesignElement, when = true) => {
    if (when && !order.includes(e)) order.push(e);
  };
  push(picture, Boolean(input.picture));
  push('HEADLINE');
  push('PRICE', input.hasPrice);
  push('CTA');
  push('ADDRESS', family === 'LOCAL_PROMO');
  push('LOGO');
  return order;
}

const STYLE_FOR: Partial<Record<LayoutFamily, VisualStyle>> = {
  LIFESTYLE_PHOTO: 'lifestyle-photo',
  PREMIUM_MINIMAL: 'photoreal-product',
  EDITORIAL_PRODUCT: 'photoreal-product',
  PRODUCT_SHOWCASE: 'photoreal-product',
};

/** Where the picture must keep calm space, so the text never lands on the subject. */
function negativeSpace(design: StaticAdDesign): ArtDirectionPlan['composition']['negativeSpace'] {
  if (design.image.mode !== 'FULL_BLEED') return 'NONE';
  if (design.textZone === 'BOTTOM') return 'BOTTOM';
  if (design.textZone === 'TOP') return 'TOP';
  return 'NONE';
}

/** Builds the full plan: chosen family, explainable alternatives, hierarchy, per-format designs. */
export function directArt(input: ArtDirectionInput): ArtDirectionPlan {
  const alternatives = scoreLayoutFamilies(input);
  const family = input.layoutOverride ?? alternatives[0]!.layoutFamily;
  const hasPicture = Boolean(input.picture);
  // The owner's family stays marked as theirs, so every later rebuild keeps it too.
  const chosenBy = input.layoutOverride ? ('OWNER' as const) : ('ART_DIRECTOR' as const);
  const formats = {
    '1:1': { ...designFor(family, '1:1', input.brandColors, hasPicture), chosenBy },
    '4:5': { ...designFor(family, '4:5', input.brandColors, hasPicture), chosenBy },
    '9:16': { ...designFor(family, '9:16', input.brandColors, hasPicture), chosenBy },
  };
  const main = formats['4:5'];
  const order = hierarchy(input, family);
  const premium = input.tone === 'premium';
  const profile = LAYOUT_FAMILY_PROFILES[family];
  const chosen = alternatives.find((a) => a.layoutFamily === family)!;
  const decisions: DesignDecision[] = [
    {
      topic: 'layout',
      decision: `${family} (${profile.label})`,
      because: input.layoutOverride
        ? 'chosen by the owner or by a revision'
        : chosen.reasons.filter((r) => r.startsWith('+')).join('; ') || 'highest score',
    },
    {
      topic: 'focal point',
      decision: order[0]!,
      because:
        order[0] === 'PRICE'
          ? 'an offer ad is read for its price first'
          : order[0] === 'HEADLINE'
            ? hasPicture
              ? 'the message carries this ad'
              : 'no usable picture: type is the image'
            : 'the picture carries this ad; text stays quiet',
    },
    {
      topic: 'contrast',
      decision: main.surface,
      because:
        main.surface === 'SCRIM'
          ? 'text over the photograph, darkened only where the text sits'
          : main.surface === 'PANEL'
            ? 'a solid panel keeps text readable over a busy picture'
            : 'a solid brand-color field: full contrast, the picture stays uncovered',
    },
    {
      topic: 'price',
      decision: input.hasPrice ? main.price : 'NONE',
      because: input.hasPrice
        ? main.price === 'STAMP' || main.price === 'HERO'
          ? 'the price is the hook: large and separate from the product'
          : 'the price supports the message without covering the product'
        : 'no price in this ad',
    },
    {
      topic: 'call to action',
      decision: main.cta,
      because:
        main.cta === 'TEXT'
          ? 'a quiet text link keeps the premium calm'
          : main.cta === 'BAR'
            ? 'a full-width bar makes the next step unmistakable'
            : 'a button that stands out without dominating',
    },
  ];
  if (input.picture && !REAL.includes(input.picture.authenticity))
    decisions.push({
      topic: 'picture',
      decision: 'AI picture shown as atmosphere, not as the real product',
      because: 'no verified photo of the product; ask the owner for one',
    });

  const industry = input.industryId ? industryById(input.industryId) : undefined;
  const references = retrieveReferences({
    industryId: input.industryId ?? 'generic',
    goal: input.goal,
    format: 'STATIC',
    layoutFamily: family,
  });
  const style =
    STYLE_FOR[family] ??
    (input.picture?.composition === 'LIFESTYLE' ? 'lifestyle-photo' : 'photoreal-product');
  const space = negativeSpace(main);
  const plan: ArtDirectionPlan = {
    version: 1,
    playbookVersion: playbookTag(ART_DIRECTION_PLAYBOOK),
    visualConcept: `${profile.label}: ${order[0] === 'PRICE' ? 'the price leads' : order[0] === 'HEADLINE' ? 'the words lead' : 'the picture leads'}, ${order.slice(1, 3).join(' then ').toLowerCase()} follow`,
    decisions,
    layoutFamily: family,
    alternatives,
    hierarchy: order,
    primaryFocal: order[0]!,
    composition: {
      imageRole: !hasPicture
        ? 'NONE'
        : family === 'BOLD_TYPOGRAPHIC' || family === 'PREMIUM_MINIMAL'
          ? 'SUPPORTING'
          : 'HERO',
      subject: input.picture?.composition ?? 'SINGLE_HERO',
      negativeSpace: space,
    },
    typography: {
      headlineScale: main.headlineScale,
      weight: main.headlineWeight,
      treatment:
        premium || family === 'PREMIUM_MINIMAL' ? 'ELEGANT' : main.headlineWeight === 900 ? 'HEAVY' : 'CLEAN',
      alignment: main.align,
      maxHeadlineWords: family === 'BOLD_TYPOGRAPHIC' ? 5 : 7,
    },
    contrastStrategy: main.surface,
    photography: {
      style,
      direction: [
        style === 'lifestyle-photo'
          ? 'a real everyday moment, natural light'
          : 'the product as the clear hero, natural light, true colors',
        space !== 'NONE'
          ? `keep the ${space.toLowerCase()} third calm and uncluttered for text`
          : 'subject centered with a little room around it',
        ...(industry ? [industry.visual.style] : []),
      ].join('; '),
      avoid: [
        'text or letters in the picture',
        'logos or brands of others',
        ...(industry?.visual.avoid ?? []),
      ],
    },
    priceTreatment: input.hasPrice ? main.price : 'NONE',
    ctaTreatment: main.cta,
    motion: {
      pacing:
        premium || family === 'PREMIUM_MINIMAL'
          ? 'CALM'
          : input.goal === 'OFFER' || input.goal === 'SALES'
            ? 'FAST'
            : 'BALANCED',
      headlinePosition: family === 'BOLD_TYPOGRAPHIC' || family === 'PREMIUM_MINIMAL' ? 'center' : 'top',
      transition:
        premium || family === 'PREMIUM_MINIMAL' ? 'fade' : input.goal === 'OFFER' ? 'zoom' : 'slide-up',
    },
    brandConstraints: [
      'brand colors only; text contrast checked against its surface',
      ...(input.picture && !REAL.includes(input.picture.authenticity)
        ? ['AI pictures are atmosphere, never the real product']
        : []),
    ],
    layoutConstraints: [
      'all text inside the format safe area',
      'no text block over the product',
      ...ART_DIRECTION_PLAYBOOK.constraints.slice(0, 1),
    ],
    referenceIds: references.map((r) => r.id),
    formats,
  };
  return ArtDirectionPlanSchema.parse(plan);
}
