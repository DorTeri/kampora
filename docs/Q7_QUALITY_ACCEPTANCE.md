# Q7 quality acceptance: evidence pack for human review

Date: 2026-11-02 (final integration pass; first pass 2026-11-01). Status: **ready for human review, not accepted.**
Automated checks pass. Professional quality is the owner's call, and nothing here claims it.

## 1. References (see `Q7_REFERENCE_VERIFICATION.md`)

29 of 30 references were viewed in the work itself (17 HIGH, 12 MEDIUM confidence), with 83 corrections to the
earlier text-only analyses. One (King Koin) could not be viewed and stays text-only, weighted lower. No reference
image is stored or shown; the Studio links to each source.

## 2. Do the references shape the pixels? (`traceReferenceInfluence`)

### Root causes found in the final pass

| Where the decision was lost | Cause | Fix (design-system rule, not a per-case patch) |
|---|---|---|
| Layout engine | SPLIT_PANEL / COLLAGE_GRID / PEOPLE_AS_HERO were recorded but no method drew them | `picturePanel` (text measured first, picture takes the rest, bleeds through the larger safe band); collage tile from the ad's other pictures; people-as-hero weighs subject size and allows a 1.12 zoom |
| Layout engine | LOGO_SMALL_CORNER never applied: free-spot checks used each text layer's full column, not its ink | `inkRect` (widest measured line on its alignment side); corner mark ≥ 26 px so it stays readable |
| Layout engine | TYPE_AS_IMAGE had no effect on a short headline that fit one line | the headline is set as two balanced lines (≤ 2) with closed line height, dropped first when the copy needs room |
| Layout engine | RULE_LINES / IMAGE_INSET_FRAME were ignored by EDITORIAL with a picture | `EDITORIAL_WITH_PICTURE` draws both |
| Picture choice | every direction got the ranker's single top picture; the ranker matched Hebrew product names against English descriptions, so all candidates scored the same | per-direction picture choice (below); showcase pictures described in Hebrew so relevance is real |
| Comparison | "without references" was an ablation of single moves, not a baseline | the Art Director and Critic rerun with **no references** (the brief-only baseline), rendered beside every direction and format |

### Baseline (brief only) → reference-informed, as measured on the composed pages

Sheets: `out/q7/showcase/<case>-reference-effect-4x5.jpg` and `-9x16.jpg` (pairs: baseline, then informed). Also in
the Studio review page, "איך ההשראות שינו את העיצוב".

| Case · direction | Plan change | Visible change (4:5 unless noted) | Judgement for review |
|---|---|---|---|
| Luz A · IMAGE_FIRST | + MINIMAL_COPY, TEXTURE_GRAIN, LOGO_SMALL_CORNER | grain 0 → 0.08; brand mark moves to the corner, 33 → 26 px | **Small.** The references agree with the brief here; the full-bleed move cannot keep text off the coffee and pastry, so both fall back to the same picture panel. |
| Luz B · EDITORIAL | − serif, text-line CTA, understated price, muted palette; + negative space, grain | lighter page, price 42 → 60 px in Frank Ruhl Libre, CTA becomes a button, photo treatment natural, whole block rises 55–65 px | Clear change. The price is easier to find; judge whether the serif baseline was the more elegant one. |
| Luz C · BOLD_TYPE | PROMO_PRICE → BOLD_TYPE; − price-as-graphic; + stacked headline, shapes | headline 96 → 111 px, price 222 → 161 px, photo becomes an arch beside the type, ring replaces rule | Large change. The baseline sells the price; the informed design sells the moment and keeps the price. Owner's call. |
| Pilates A · IMAGE_FIRST | LIFESTYLE → IMAGE_FIRST; + split panel, collage | group photo shares the top with a detail tile (2 pictures), headline 106 → 94 px | Clear change; the detail tile is a close crop of hands on straps: judge whether it adds or distracts. |
| Pilates B · EDITORIAL | − text-line CTA, rule lines; + small-corner logo | CTA becomes a button, two rules removed, brand mark to the bottom corner | Modest change. |
| Pilates C · BOLD_TYPE | + TYPE_AS_IMAGE, CONDENSED_DISPLAY | 9:16: headline 1 → 2 lines, supporting line beside the arch, photo ×0.84; **4:5: headline 190 → 194 px only** | **4:5 is nearly identical**: the brief-only layout already breaks this headline into the same two lines. Reported as convergence, not as an effect. |

When the references change the plan but not the page, the trace now says so (`withoutAnyReference.samePage`) and the
Studio prints it, instead of showing an empty or decorative diff. Regression tests:
`packages/creative-engine/src/picture-choice.test.ts` (references reach the page; reference-only moves are drawn;
convergence is labelled).

Moves still not drawn by any method (they only steer choices or are recorded): FULL_BLEED_IMAGE (the default of the
image methods), LAYERED_TYPE_OVER_IMAGE, SINGLE_FOCAL_POINT, Z_READING_PATH, PRODUCT_AS_HERO, ILLUSTRATIVE_ELEMENTS,
TYPE_ONLY. SERIF_EDITORIAL, CONDENSED_DISPLAY and BOLD_GEOMETRIC_SANS act through the type system.

**Originality:** the highest overlap between a direction's set of moves and any single reference stays below 0.75
(Jaccard; tested). Every direction combines several references. Only the owner's pictures and approved words appear
on the page; references carry no images or copy.

## 3. Composition rules (deterministic, measured)

- **Subject-safe text.** Pictures can carry layout metadata (`PictureLayoutSchema`: subject box, calm side,
  composition, people; source MANUAL or ANALYSIS). `pictureBoxOnPage` mirrors the renderer's cover + focal point +
  zoom, so the engine knows where the subject lands on the page. Text over a picture is planned by sweeping crop and
  zoom: one band above or below the subject, or a split (message above, action on a brand band below), keeping
  ≥ 72% of the subject in frame. If no plan fits, the text moves to a panel. **No coordinates are invented:**
  without metadata the old calm-side behaviour is kept and the design is flagged for review. Coverage ≥ 3% of a
  subject is flagged.
- **Price with the action.** EDITORIAL groups label, price and button under the message when they fit; otherwise
  a baseline-aligned row. A quiet (understated) price is set as strong text, not as a display numeral.
- **No empty bands.** EDITORIAL sizes the picture from the measured copy (34–60% of the page), and 9:16 puts the
  picture in the lower band so it bleeds through the platform UI zone instead of leaving it empty.
- **Picture scale in bold type.** The picture takes the height the type leaves (≥ 24% of a tall page, 30% otherwise);
  the action goes beside it only when a picture at least half the frame wide still fits, and the supporting line
  then opens that column level with the picture's top, so the column is held at both ends.
- **Responsive crops** use the subject's centre (`subjectFocal`), clamped to what the frame allows.
- Tests: `packages/production-engine/src/picture-layout.test.ts` (geometry, coverage = 0 with metadata, the
  review flag without it, collage, editorial 9:16 grouping and gaps, bold-type scale, two-line type, corner logo).

## 4. Per-direction picture choice

Each direction composes with every approved picture that has recorded layout and commercial rights, and keeps the
best by a measured score: no text on the subject, subject large enough for its kind (a group needs ~30% of the
page), crop keeps the subject, fit status, relevance to the offer (from the ranker), the method's needs, and a
penalty for a picture another direction already uses. One picture can still win everywhere if it is clearly best.
The owner's choice (`selection.chosenBy = OWNER`) is kept by every direction. Authenticity labels travel with each
picture; a stand-in is never presented as the product.

Result: Luz A coffee + pastry, B pastry close-up, C coffee + pastry (it scored best for the arch). Pilates A group
(+ detail tile), B hero, C hero (the group shot scored 3.4 vs 3.6 in the arch).

## 5. Showcase (offline, $0, no paid calls in this pass)

Full resolution: `out/q7/showcase/{luz,pilates}/{A,B,C}-{4x5,9x16}.png` and the brief-only baselines `…-base.png`.
Sheets: `{luz,pilates}-q6-vs-q7-4x5.jpg`, `…-q7-9x16.jpg`, `…-reference-effect-{4x5,9x16}.jpg`.
Motion previews: `luz/motion-preview.mp4` (15.5 s), `pilates/motion-preview.mp4` (14.6 s). Silent local renders.

Photography: Luz uses cached Q6 AI stand-ins. Pilates uses 3 AI demonstration photos approved on 2026-11-01
(≈$0.123 estimated). Neither is the real business; both are labelled in the Studio.

## 6. What I saw at full resolution (reviewer's notes, not a verdict)

Checked in every render: RTL order, no clipped or colliding text, all approved copy present.

Fixed in this pass, from the Q7 review notes:
- Pilates A: the headline no longer crosses the class. The group photo is not cropped under text; with the
  references it is a split panel with a detail tile.
- Pilates B 9:16: the photo now fills the lower band, with no empty fifth under the CTA. Price, label and button read as
  one group under the message.
- Pilates C: the arch is larger and the column beside it holds the supporting line at the top and the action at
  the bottom. In 9:16 a calm stretch remains between them (about 300 px); judge it.
- The corner brand mark was 22 px and hard to read; it is now ≥ 26 px.

Still open, for the reviewer:
- Luz C 9:16 reports SHORTER_COPY_SUGGESTED (headline at 89% of its plan, recorded). Not shortened: copy is the owner's.
- Luz A's reference effect is small (grain, corner logo). The references agree with the brief.
- Pilates C 4:5's reference effect is negligible (convergence, above).
- The Pilates A detail tile crops to hands and a forearm: judge it.
- The Luz C ring crosses near the price in 9:16: decorative; judge it.
- 9:16 bold-type keeps the lower platform-UI band as plain brand colour (by safe-area design).

## 7. Not validated

- No human or audience has judged these ads. Automated checks measure fit, contrast, collisions, coverage and
  claims, not taste or performance.
- The subject boxes for the 6 showcase photos were recorded by hand after viewing them (MANUAL). There is no image
  analysis in the product yet; uploaded pictures without metadata get the review flag.
- Copy is Hebrew written offline from the approved claims; a native copy review is still needed.
