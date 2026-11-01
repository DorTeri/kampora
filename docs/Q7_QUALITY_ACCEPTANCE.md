# Q7 quality acceptance: evidence pack for human review

Date: 2026-11-01. Status: **ready for human review, not accepted.** Automated checks pass. Professional quality is
the owner's call, and nothing here claims it.

## 1. References (see `Q7_REFERENCE_VERIFICATION.md`)

29 of 30 references were viewed in the work itself (17 HIGH, 12 MEDIUM confidence), with 83 corrections to the
earlier text-only analyses. One (King Koin) could not be viewed and stays text-only, weighted lower. No reference
image is stored or shown; the Studio links to each source.

## 2. Do the references shape the pixels? (`traceReferenceInfluence`)

For every direction the trace reruns the real Art Director and layout engine:
- without each reference;
- without the moves only the references brought (rendered side by side: `out/q7/showcase/<case>-reference-effect.jpg`,
  and in the Studio review page under "איך ההשראות שינו את העיצוב");
- with no references at all.

| Case · direction | What the references drew (4:5) | Without any reference | Single-reference effect (example) |
|---|---|---|---|
| Luz A · IMAGE_FIRST | film grain 0.08 | loses MINIMAL_COPY, TEXTURE_GRAIN, LOGO_SMALL_CORNER | without Burger King: no full-bleed photo, generous negative space instead |
| Luz B · EDITORIAL | grain; two rule lines | serif + text-line CTA + muted palette instead of grain, negative space | without Wim Bakery: no rule lines, a serif face and logo sign-off instead |
| **Luz C · BOLD_TYPE** (recommended) | the whole colour system: dark brand flood instead of cream, white type, accent ring | **becomes PROMO_PRICE** with oversized headline and price-as-graphic | **without Wim Bakery alone: the method flips to PROMO_PRICE** and the type system changes |
| Pilates A · ASYMMETRIC | **nothing drawn** (SPLIT_PANEL, COLLAGE_GRID are recorded but this method does not draw them) | gains OVERSIZED_HEADLINE instead | without Sweaty Betty: centred hero instead of a corner logo |
| Pilates B · EDITORIAL (recommended) | **nothing drawn** (SERIF_EDITORIAL, SPLIT_PANEL are recorded, not drawn) | rule lines and a text-line CTA instead | without Coco: collage grid instead of an understated price |
| **Pilates C · BOLD_TYPE** | brand-colour flood with light type | loses TYPE_AS_IMAGE, CONDENSED_DISPLAY | **without Not A Phase: the condensed face (Karantina) becomes a bold geometric sans** |

Honest reading: for four of the six directions the references cause visible, attributable decisions. For Pilates
A and B, the references' extra moves are not implemented by those two composition methods, so they change the
record but not the page. That is a gap in the composer, not a hidden success. Closing it means adding
SPLIT_PANEL/COLLAGE_GRID behaviour to ASYMMETRIC and EDITORIAL. Not done in Q7.

**Originality:** the highest overlap between a direction's set of moves and any single reference is 0.23–0.57
(Jaccard). Pilates B is closest to Coco Reformer at 0.57. Every direction combines 5 references. Only the owner's
pictures and approved words appear on the page; references carry no images or copy, so there is nothing to copy
beyond abstract moves.

## 3. Showcase (offline, $0)

Full resolution: `out/q7/showcase/{luz,pilates}/{A,B,C}-{4x5,9x16}.png` (1080×1350, 1080×1920).
Sheets: `out/q7/showcase/{luz,pilates}-q6-vs-q7-4x5.jpg`, `…-q7-9x16.jpg`, `…-reference-effect.jpg`.
Motion previews: `luz/motion-preview.mp4` (15.5 s, captions, composed end card), `pilates/motion-preview.mp4`
(9 s, the composed design built up in reading order; no photo exists).

Copy was revised from Q6 offline, from the approved claims only, with no model call. It awaits owner approval.
- Luz: "קפה ומאפה בדרך לעבודה" / "קולים את הפולים בעצמנו. מאפים טריים כל בוקר." / 29.90 ₪ "קפה + מאפה · עד סוף
  החודש" / "קפצו לפני העבודה" / "פלורנטין 12 · פתוח כל יום מ-7:00". The Q6 subheadline repeated the price the
  design already shows, and the Q6 CTA was generic.
- Pilates: "פילאטיס בקצב שלך" / "קבוצות של עד 6 מתאמנות, עם מדריכות מוסמכות." / 49 ₪ "שיעור ניסיון" / "שריינו
  שיעור ניסיון" / "מוריה 40, חיפה". The Q6 CTA "נשימה | השאירו פרטים" repeated the brand name and read like a form.

## 4. What I saw at full resolution (reviewer's notes, not a verdict)

Checked in every render: correct RTL order, no clipped or colliding text (the Critic's technical QA passes in all
12), all approved copy present, price never larger than the headline unless the price leads.

Fixed during this inspection:
- Wide tracking broke Hebrew labels into letters. Hebrew is now clamped to 0.03em.
- Price labels wrapped with a dangling "·".
- The Pilates A no-photo field read as a missing image; it is now a deep brand-ink block.
- A Luz C fit problem caused by a layout bug (headline fill starving the subheadline).
- A CTA collision in ASYMMETRIC 9:16.
- A price-vs-headline conflict after "make the price stand out".

Still open, for the reviewer:
- **Luz photography is an AI stand-in** (cached Q6 picture), labelled in the Studio. It is not the café.
- **Pilates has no photography.** A (asymmetric) is designed around a picture and is the weakest without one.
  B and C are type-led directions that do not need a photo. A 3-photo set is priced at ≈$0.12 (medium) / ≈$0.50
  (high) and is **not** generated: it needs your approval.
- Pilates B's small grey brand name next to the eyebrow is weak; the eyebrow already names the studio.
- Luz C's accent ring is a stylistic decision that could read as decoration; judge it in context.
- Luz C 9:16 reports SHORTER_COPY_SUGGESTED (the headline sits at full size; the engine suggests ≤12-character
  headlines for that layout). The copy was not shortened, because shortening is an owner decision.

## 5. Not validated

- No human or audience has judged these ads. Automated checks measure fit, contrast, collisions and claims, not
  taste or performance.
- Copy is human-style Hebrew written offline; a native copy review is still needed.
- The motion previews are silent local renders; no voiceover was generated.
