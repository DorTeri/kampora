# Q7 reference library: visual verification

Date: 2026-11-01 · Library version `2026-11-01.2` · Source of truth: `out/q7/refs/*.json` (gitignored research
files) → `scripts/apply-visual-verification.mjs` → `scripts/build-reference-library.mjs` →
`packages/agent-expertise/src/references/data.generated.ts`.

## What changed

Until this pass every reference was written from text: articles, award write-ups and image captions. Nobody had
looked at the work. In this pass each reference's public page (or another legitimate public page showing the same
work: the agency's site, Ads of the World, D&AD, Behance, It's Nice That, the V&A) was opened and the images were
looked at in a browser. No image was downloaded, stored or redistributed. The library keeps only the source URL,
the pages actually used (`visualAnalysis.viewedUrls`), and an authored analysis of what was seen.

| | Count |
|---|---|
| References in the library | 30 |
| Visually verified (`IMAGES_VIEWED`) | **29** (17 HIGH confidence, 12 MEDIUM) |
| Not verifiable (`SOURCE_TEXT`, with a recorded `visualCheck`) | 1: King Koin Launderette. Neither Applied Arts page shows an image, and no other public source was found |
| Corrections to the earlier text-only analyses | 83 |

Confidence: HIGH means several executions were seen large and legible. MEDIUM means the work was seen, but only some
executions, or small (for example a billboard in an in-situ photo). A finding with LOW confidence, or one where only a
text description was available, is not counted as verified.

## Rules the schema now enforces

- `analysisBasis: IMAGES_VIEWED` requires a `visualAnalysis` block. It covers composition, hierarchy, typography,
  grid and spacing, photography, colour relationships, product placement, negative space, brand expression,
  distinctive decisions, what was seen, and confidence. A `visualAnalysis` without `IMAGES_VIEWED` is rejected.
- `corrections[]` keeps the old claim next to what was actually seen, so the record shows where the text analysis
  was wrong.
- A failed attempt is recorded as `visualCheck { attemptedAt, outcome }`, so "not seen" never reads as "never tried".
- Evidence weighting in the Art Director (`EVIDENCE_WEIGHT` in `art-director-v2.ts`): moves seen in the work count
  ×1; moves inferred from image descriptions count ×0.6, and from text alone ×0.4. Retrieval scores carry the same
  distinction (×1.15 seen, ×0.92 / ×0.85 otherwise), and the reason appears in `reasons`.

## Representative corrections (claimed → seen)

- **KFC "FCK"**: "a white text block below the bucket" → there is no white block; white type sits directly on the
  red photographed tabletop. The bucket is a real overhead photograph, not a cut-out (`CUTOUT_PRODUCT_ON_COLOR`
  removed).
- **Burger King "Moldy Whopper"**: "the whole burger as the subject" → most executions are extreme macro crops that
  bleed off the frame (`DETAIL_MACRO_CROP` confirmed).
- **Wim Bakery**: "the wordmark is shaped like a croissant" → the lettering is a regular heavy grotesque; the
  croissant is a separate mark.
- **Roladin sufganiyot (2017)**: "red is prominent" → backdrops vary per poster (burgundy, mauve, grey, indigo, teal,
  slate).
- **Equinox "Commit to Something"**: "large white capitals" → a thin, wide, generously tracked monoline sans: large
  in width, light in weight.
- **The Ordinary**: "bold, heavy headlines (`OVERSIZED_HEADLINE`)" → bold but small, label-scale headlines in a
  narrow column; oversized type removed.
- **Sweaty Betty**: "large headline type" → sentence case in a medium grotesk; `OVERSIZED_HEADLINE` and
  `FRAME_BORDER` removed.
- **Patek Philippe "Generations"**: the photo fills only the top ~75%; a black band below holds the packshot and a
  serif line; the logo sits top-right, so it is not a sign-off.
- **Thorntons**: not macro cross-sections; a 2×2 checkerboard of turquoise and off-white panels with small captions,
  where the copper script logo reads first.
- **Carrefour "Flasher Flood"**: not a grid and not complementary colours; an edge-to-edge field of tiny products
  whose only copy is one corner starburst.
- **PENNY "Price Packs"**: the price runs huge and rotated up each pack, and the yellow dot is the decimal point. No
  badges.

The full list (83 entries) is in each reference's `corrections` field.

## Effect on the Art Director (measured, not asserted)

The design moves seen in the work replaced the moves inferred from text, and that changed the output:

- The café moodboard, now built on moves seen in the work, no longer favours price-as-graphic (only Snap Fitness, a
  cross-industry reference, does). Luz's bold direction became BOLD_TYPE with a price lead instead of PROMO_PRICE.
- References seen in the Pilates moodboard (Le Club, Not A Phase) brought `TYPE_AS_IMAGE` and `CONDENSED_DISPLAY`
  into Pilates C. That exposed a real hierarchy defect: "make the price stand out" left a 239px headline over a
  175px price. It is fixed (see below).
- `traceReferenceInfluence` (`packages/creative-engine/src/reference-trace.ts`) runs the counterfactuals: direct
  again without each reference, recompose without the moves only the references brought, and direct with no
  references. See `docs/Q7_QUALITY_ACCEPTANCE.md` for the per-direction results.

## Engine defects the new references exposed (fixed, with regression tests)

1. **Fill blocks starved the lines under them.** A headline that grows to fill its region (`fillText`) took all
   the remaining height, pushed the subheadline out, and the layout then reported "copy too long". Fill blocks
   now reserve the measured height of the blocks after them. Regression test: `composer.test.ts`, "a headline
   that grows to fill its space…". It fails without the fix.
2. **Stacking cost type size.** `STACKED_HEADLINE` is now the first thing given up under space pressure, before
   any type gets smaller.
3. **Two heroes.** When the price leads, the headline is planned to stop short of the price numeral. "Make the
   price stand out" also steps back `OVERSIZED_HEADLINE` and `TYPE_AS_IMAGE`.
4. **ASYMMETRIC 9:16 CTA collision.** The copy region ended below the CTA's top edge, so a large price ran into
   the button. The CTA is now placed first and the copy ends above it.
5. **Hebrew tracking.** Accent faces asked for 0.08–0.24em tracking, which breaks Hebrew words apart. Hebrew lines
   are clamped to 0.03em. A dangling `·` at a line break is dropped.
