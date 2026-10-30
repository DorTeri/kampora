import { hebrewCopyIssues, type IndustryProfile } from '@kampora/agent-expertise';
import {
  contrastRatio,
  fitStaticAdType,
  hasNiqqud,
  STATIC_AD_FORMATS,
  staticAdLayout,
  StaticAdSchema,
  type ArtDirectionPlan,
  type BusinessProfile,
  type CompositionType,
  type CriterionResult,
  type LayoutFamily,
  type StaticAd,
} from '@kampora/shared';
import { staticAdQa } from '@kampora/production-engine';
import { unverifiedIndustryClaims } from '../copy-qa';
import { measured, notMeasured, type Finding } from './report';

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;
const PRICE = /\d[\d,.]*\s?₪|₪\s?\d|\d+%/g;

export interface StaticAdCritiqueContext {
  /** The Art Director's plan the ad was built from. */
  plan?: Pick<ArtDirectionPlan, 'primaryFocal' | 'composition'>;
  /** Layout family of the business's previous ad (another campaign). */
  previousLayout?: LayoutFamily;
  /** What the background picture shows, when known (from the scene plan). */
  pictureComposition?: CompositionType;
  /** The campaign's offer, when there is one. */
  offer?: string;
  business?: Pick<BusinessProfile, 'approvedClaims' | 'description'>;
  industry?: Pick<IndustryProfile, 'claimsRequiringVerification'>;
}

/** Families that present the picture as the product itself. */
const SHOWS_PRODUCT: readonly LayoutFamily[] = ['PRODUCT_SHOWCASE', 'PREMIUM_MINIMAL', 'EDITORIAL_PRODUCT'];
const PRODUCT_SHOTS: readonly CompositionType[] = ['SINGLE_HERO', 'DETAIL'];

/**
 * The Critic on one static ad (one format): measurable checks of the copy on the ad, the Art Director's layout,
 * readability, the picture and the production rules. Whether the ad looks like agency work is left to people.
 */
export function critiqueStaticAd(ad: StaticAd, ctx: StaticAdCritiqueContext = {}): CriterionResult[] {
  const t = ad.text;
  const d = ad.design;
  const target = ad.format;
  const qa = staticAdQa(ad);
  const has = (code: string) => qa.find((i) => i.code === code);
  const texts = [t.headline, t.subheadline, t.price?.label, t.cta, t.ctaSubtext].filter((x): x is string =>
    Boolean(x),
  );
  const at = (f: Finding): Finding => ({ target, ...f });
  const layout = d ? staticAdLayout({ ...ad, design: d }) : undefined;
  const scale = layout?.scale ?? fitStaticAdType(ad).scale;
  const reasons = ad.background.selection?.reasons ?? [];
  const authenticity = ad.background.selection?.authenticity;
  const hasPicture = Boolean(ad.background.assetId);
  const results: CriterionResult[] = [];

  // Marketing: the copy as it appears on the ad.
  const headlineWords = words(t.headline);
  results.push(
    measured(
      'HOOK_STRENGTH',
      [
        ...(headlineWords > 9
          ? [
              at({
                severity: 'MAJOR',
                explanation: `The headline has ${headlineWords} words; on a static ad it is the hook.`,
                evidence: [t.headline],
                correction: 'Cut the headline to at most 7 words.',
              }),
            ]
          : has('LONG_HEADLINE')
            ? [
                at({
                  severity: 'MINOR',
                  explanation: `Headline: ${has('LONG_HEADLINE')!.detail}.`,
                  evidence: [t.headline],
                }),
              ]
            : []),
        ...hebrewCopyIssues(t.headline)
          .filter((i) => i.code === 'CLICHE')
          .map((i) =>
            at({
              severity: 'MAJOR',
              explanation: `The headline uses the cliché "${i.phrase}".`,
              evidence: [i.phrase],
              correction: 'Lead with a concrete detail of this business.',
            }),
          ),
      ],
      'Short headline without clichés.',
      [`${headlineWords} words`],
    ),
  );
  const prices = new Set(texts.join(' ').match(PRICE) ?? []);
  if (t.price) prices.add(t.price.price.replace(/\s/g, ''));
  results.push(
    measured(
      'MESSAGE_CLARITY',
      [
        ...(prices.size > 1
          ? [
              at({
                severity: 'MAJOR',
                explanation: `The ad shows ${prices.size} prices.`,
                evidence: [...prices],
                correction: 'Keep one price on the ad.',
              }),
            ]
          : []),
        ...(has('REPEATED_TEXT')
          ? [at({ severity: 'MINOR', explanation: 'The same text appears twice.' })]
          : []),
        ...(has('CROWDED')
          ? [at({ severity: 'MINOR', explanation: `Crowded: ${has('CROWDED')!.detail}.` })]
          : []),
        ...(has('LONG_SUBHEADLINE')
          ? [
              at({
                severity: 'MINOR',
                explanation: 'The sub-headline is long for the format.',
                evidence: [t.subheadline!],
              }),
            ]
          : []),
      ],
      'One message, at most one price.',
    ),
    measured(
      'CTA_CLARITY',
      words(t.cta) > 5
        ? [
            at({
              severity: 'MINOR',
              explanation: `The call to action has ${words(t.cta)} words.`,
              evidence: [t.cta],
            }),
          ]
        : [],
      'A short call to action.',
      [t.cta],
    ),
  );

  const offerPriced = ctx.offer && /\d/.test(ctx.offer);
  if (offerPriced)
    results.push(
      measured(
        'OFFER_COMMUNICATION',
        prices.size === 0
          ? [
              at({
                severity: 'MAJOR',
                explanation: 'The campaign has a priced offer but the ad shows no price.',
                evidence: [ctx.offer!],
                correction: 'Show the offer price on the ad.',
              }),
            ]
          : [],
        'The offer price is on the ad.',
        [...prices],
      ),
    );
  else
    results.push({
      ...notMeasured('OFFER_COMMUNICATION', 'No priced offer in this campaign.'),
      method: 'DETERMINISTIC',
      target,
    });

  if (ctx.business && ctx.industry)
    results.push(
      measured(
        'FACTUAL_ACCURACY',
        unverifiedIndustryClaims(texts, ctx.business, ctx.industry).map((label) =>
          at({
            severity: 'CRITICAL',
            explanation: `The ad states "${label}", which the business has not approved.`,
            evidence: [label],
            correction: 'Remove the claim, or approve it in the business memory.',
            component: 'OWNER',
          }),
        ),
        'No unapproved industry claim on the ad.',
      ),
    );
  else results.push(notMeasured('FACTUAL_ACCURACY', 'No business memory given to check claims against.'));

  results.push(
    measured(
      'HEBREW_NATURALNESS',
      texts.flatMap(hebrewCopyIssues).map((i) =>
        at({
          severity: i.code === 'EXCLAMATION' ? 'MINOR' : 'MAJOR',
          explanation:
            i.code === 'EXCLAMATION'
              ? 'Several exclamation marks.'
              : `"${i.phrase}"${i.suggestion ? ` (say "${i.suggestion}")` : ' is a cliché'}.`,
          evidence: [i.phrase],
          correction: i.suggestion ? `Use "${i.suggestion}".` : undefined,
        }),
      ),
      'No cliché, formal register or translated phrasing found by the lint.',
    ),
  );

  // Visual: the Art Director's layout.
  if (!d) {
    for (const c of [
      'VISUAL_HIERARCHY',
      'LAYOUT_BALANCE',
      'READABILITY',
      'BRAND_CONSISTENCY',
      'VISUAL_ORIGINALITY',
    ])
      results.push({ ...notMeasured(c, 'Built with the fixed template, before art direction.'), target });
  } else {
    const focal = ctx.plan?.primaryFocal;
    const hierarchy: Finding[] = [];
    if (focal === 'PRICE') {
      if (!t.price && !prices.size)
        hierarchy.push(
          at({
            severity: 'MAJOR',
            explanation: 'The plan makes the price the focal point, but the ad has no price.',
            correction: 'Choose a layout led by the headline or the picture.',
            component: 'ART_DIRECTOR',
          }),
        );
      else if (d.price === 'INLINE')
        hierarchy.push(
          at({
            severity: 'MAJOR',
            explanation: 'The price is the focal point but it is set as a quiet inline line.',
            evidence: [`price: ${d.price}`],
            correction: 'Use a layout with a stamp, badge or hero price.',
          }),
        );
    } else if (focal === 'PRODUCT' || focal === 'PEOPLE' || focal === 'PLACE') {
      if (!hasPicture)
        hierarchy.push(
          at({
            severity: 'MAJOR',
            explanation: `The plan leads with the ${focal.toLowerCase()}, but the ad has no picture.`,
            correction: 'Add a photo of the business, or lead with the headline.',
            component: 'OWNER',
          }),
        );
      else if (d.image.mode === 'INSET')
        hierarchy.push(
          at({
            severity: 'MINOR',
            explanation: `The ${focal.toLowerCase()} is the focal point but the picture is a small inset.`,
            evidence: [`image: ${d.image.mode}`],
          }),
        );
    }
    results.push(
      measured(
        'VISUAL_HIERARCHY',
        hierarchy,
        focal
          ? `The ${focal.toLowerCase()} leads, as planned.`
          : 'No plan to compare with; layout is consistent.',
        [`focal: ${focal ?? '—'}`, `family: ${d.layoutFamily}`],
      ),
    );

    const balance: Finding[] = [];
    const productShot = ctx.pictureComposition && PRODUCT_SHOTS.includes(ctx.pictureComposition);
    if (hasPicture && d.image.mode === 'FULL_BLEED' && productShot && d.textZone === 'CENTER')
      balance.push(
        at({
          severity: 'MAJOR',
          explanation: `Text sits over the middle of a ${ctx.pictureComposition} picture: it covers the product.`,
          evidence: [`textZone: ${d.textZone}`, `picture: ${ctx.pictureComposition}`],
          correction: 'Use a layout that gives the picture its own panel.',
        }),
      );
    if (layout?.image && d.image.mode === 'PANEL' && layout.text.height < ad.height * 0.3)
      balance.push(
        at({
          severity: 'MINOR',
          explanation: 'The picture panel leaves little room for the text.',
          evidence: [`text column ${Math.round(layout.text.height)}px of ${ad.height}px`],
        }),
      );
    results.push(measured('LAYOUT_BALANCE', balance, 'Text and picture each have their own space.'));

    const readable: Finding[] = [];
    const p = d.palette;
    if (d.surface !== 'SCRIM') {
      const ratio = contrastRatio(p.text, p.field);
      if (ratio < 4.5)
        readable.push(
          at({
            severity: ratio < 3 ? 'CRITICAL' : 'MAJOR',
            explanation: `Text contrast ${ratio}:1 on the ${d.surface.toLowerCase()} (needs 4.5:1).`,
            evidence: [`${p.text} on ${p.field}`],
            correction: 'Re-derive the palette from the brand colors.',
          }),
        );
    } else if (reasons.some((r) => r.code === 'BUSY_PICTURE'))
      readable.push(
        at({
          severity: 'MINOR',
          explanation: 'Text on a scrim over a busy picture; contrast over a photo cannot be measured here.',
          evidence: ['BUSY_PICTURE'],
        }),
      );
    const actionRatio = contrastRatio(p.accentText, p.accent);
    if (d.cta !== 'TEXT' && actionRatio < 3)
      readable.push(
        at({
          severity: 'MAJOR',
          explanation: `The action button text has ${actionRatio}:1 contrast.`,
          evidence: [`${p.accentText} on ${p.accent}`],
          correction: 'Re-derive the palette from the brand colors.',
        }),
      );
    results.push(
      measured(
        'READABILITY',
        readable,
        d.surface === 'SCRIM'
          ? 'Scrim on a calm picture (contrast over a photo is not measured).'
          : `Text contrast ${contrastRatio(p.text, p.field)}:1.`,
        [`surface: ${d.surface}`],
      ),
    );

    const c = ad.branding.colors;
    const brand = [c.primary, c.secondary, c.accent, c.background, c.text]
      .filter((x): x is string => Boolean(x))
      .map((x) => x.toLowerCase());
    const brandFindings: Finding[] = [];
    if (d.surface !== 'SCRIM' && !brand.includes(p.field.toLowerCase()))
      brandFindings.push(
        at({
          severity: 'MINOR',
          explanation: `The field color ${p.field} is not a brand color.`,
          evidence: [p.field],
        }),
      );
    if (d.logo === 'NONE' || !t.showLogo)
      brandFindings.push(at({ severity: 'MINOR', explanation: 'Neither logo nor business name is shown.' }));
    results.push(
      measured('BRAND_CONSISTENCY', brandFindings, 'Brand field color and the business name or logo.', [
        `field ${p.field}`,
        `logo: ${d.logo}`,
      ]),
    );

    results.push(
      measured(
        'VISUAL_ORIGINALITY',
        ctx.previousLayout === d.layoutFamily && d.chosenBy !== 'OWNER'
          ? [
              at({
                severity: 'MINOR',
                explanation: `Same layout family (${d.layoutFamily}) as the business's previous ad.`,
                evidence: [ctx.previousLayout],
              }),
            ]
          : [],
        ctx.previousLayout
          ? `Different from the previous ad (${ctx.previousLayout}).`
          : 'No previous ad to compare.',
      ),
    );
  }

  results.push(
    measured(
      'TYPOGRAPHY',
      scale < 0.62
        ? [
            at({
              severity: 'MAJOR',
              explanation: `The type had to shrink to ${Math.round(scale * 100)}% of its design size to fit.`,
              evidence: [`scale ${scale}`],
              correction: d
                ? 'Use a layout with more room for text, or shorten the copy.'
                : 'Shorten the copy.',
              component: d ? 'ART_DIRECTOR' : 'COPYWRITER',
            }),
          ]
        : scale < 0.8
          ? [
              at({
                severity: 'MINOR',
                explanation: `Type at ${Math.round(scale * 100)}% of its design size.`,
                evidence: [`scale ${scale}`],
              }),
            ]
          : [],
      `Type at ${Math.round(scale * 100)}% of its design size.`,
    ),
  );

  // The picture.
  const picture: Finding[] = [];
  const missing = reasons.find((r) => r.code === 'OFFER_SUBJECTS_MISSING');
  if (missing)
    picture.push(
      at({
        severity: 'MAJOR',
        explanation: 'The picture does not show the products the ad offers.',
        evidence: missing.subjects ?? [missing.detail],
        correction: 'Use a picture of the offered product.',
      }),
    );
  if (has('LOW_RESOLUTION_PHOTO'))
    picture.push(
      at({ severity: 'MINOR', explanation: `Low resolution: ${has('LOW_RESOLUTION_PHOTO')!.detail}.` }),
    );
  if (hasPicture) results.push(measured('IMAGE_RELEVANCE', picture, 'The picture shows what the ad sells.'));
  else
    results.push({
      ...notMeasured('IMAGE_RELEVANCE', 'No picture: a brand-color ad.'),
      method: 'DETERMINISTIC',
      target,
    });

  results.push({
    ...notMeasured('PROFESSIONAL_POLISH', 'Whether it looks like agency work is for people to judge.'),
    target,
  });

  // Production.
  const auth: Finding[] = [];
  if (authenticity === 'SYNTHETIC_AI' || has('SYNTHETIC_PICTURE')) {
    const asProduct = d && SHOWS_PRODUCT.includes(d.layoutFamily);
    auth.push(
      at({
        severity: asProduct ? 'MAJOR' : 'MINOR',
        explanation: asProduct
          ? `An AI picture is framed as the real product (${d!.layoutFamily}).`
          : 'AI picture: labelled for the owner as a stand-in.',
        evidence: ['SYNTHETIC_AI'],
        correction: 'Upload a real photo of the product.',
        component: 'OWNER',
      }),
    );
  } else if (has('REFERENCE_GUIDED_PICTURE'))
    auth.push(
      at({
        severity: 'MINOR',
        explanation: 'AI picture guided by the business’s product photos.',
        evidence: ['REFERENCE_GUIDED_AI'],
      }),
    );
  results.push(
    measured(
      'PRODUCT_AUTHENTICITY',
      auth,
      'The business’s own picture, or none.',
      authenticity ? [authenticity] : [],
    ),
  );

  const niqqud = texts.filter(hasNiqqud);
  results.push(
    measured(
      'HEBREW_RENDERING',
      niqqud.length
        ? [
            at({
              severity: 'MAJOR',
              explanation: 'Text with niqqud on the ad.',
              evidence: niqqud,
              correction: 'Remove the niqqud.',
            }),
          ]
        : [],
      'RTL text without niqqud.',
      [`direction: ${ad.direction}`],
    ),
    measured(
      'SAFE_ZONES',
      scale <= 0.46
        ? [
            at({
              severity: 'CRITICAL',
              explanation: 'The text may not fit the safe area even at the smallest type size.',
              evidence: [`scale ${scale}`],
              correction: 'Shorten the copy.',
              component: 'COPYWRITER',
            }),
          ]
        : [],
      'All text inside the safe area (the layout keeps it there by construction).',
    ),
  );

  const parsed = StaticAdSchema.safeParse(ad);
  const size = STATIC_AD_FORMATS[ad.format];
  results.push(
    measured(
      'TECHNICAL_CORRECTNESS',
      parsed.success
        ? []
        : [
            at({
              severity: 'CRITICAL',
              explanation: parsed.error.issues[0]?.message ?? 'Invalid ad.',
              component: 'LAYOUT_ENGINE',
            }),
          ],
      `${size.width}×${size.height}, valid assets and rights.`,
    ),
  );
  return results.map((r) => (r.target ? r : { ...r, target }));
}
