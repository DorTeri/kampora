# Q6 — Real Professional Agent Evaluation (plan, waiting for budget approval)

Goal: find out whether the Q0–Q5 agents make better commercial ads than the previous workflow when a real model
writes the copy. Q5 used mock copy and V1 pictures, so it shows the pipeline's structure, not quality.
Everything below was prepared at $0. No paid call has been made.

## 1. Production workflow audit (what real requests actually use)

| Component | Used in production? | Where | Gap |
|---|---|---|---|
| Professional Creative Brief | Yes | `studio.service` stores it; concepts step gets its strategy facts | Storyboard step does not get it |
| Industry expertise | Yes | Copywriter prompt, brief, Art Director, Critic | — |
| Copywriter | Yes | `creative.concepts` system prompt = rules + `copywriterExpertise` (≈10k chars) | — |
| Creative Strategist | Partly | Its playbook methods are inside the Copywriter prompt; there is no separate step | Acceptable; not a separate agent |
| Storyboard Director | Yes, but not upgraded | `creative.storyboard` | System prompt is byte-identical to the previous workflow; `VIDEO_DIRECTION_PLAYBOOK` appears only in version tags |
| Art Director | Yes | `ArtDirectionService` → static ads (design per format) and video (motion only) | Computed after the storyboard; the storyboard cannot use it |
| Visual Prompt Planner | Yes | `planSceneVisual` gets the Art Director's photography direction and negative space | — |
| Asset selection | Yes | `rankBackgrounds` in `buildStaticAd`; tag matching in `planProduction` | Owner-picked backgrounds lose their content reasons (see Critic) |
| Creative Critic | Yes | concept sets (after generation), static ads (with free fixes), video (at plan approval) | Video and concept reviews are one round only; nothing is fixed |
| Targeted Revision Router | Partly | Free layout fixes on static ads run | Paid fixes are recorded as `PENDING_APPROVAL` but no endpoint or button runs them; free video fixes are never applied |
| LLM opinion pass | No, in practice | Runs only on a free provider | With OpenAI configured it never runs; subjective criteria stay unmeasured |

## 2. Evaluation design

- **Arms.**
  - **A** is the previous workflow, run from commit `1b15ec7` in a separate worktree (`C:\Users\dor\kampora-baseline`)
    with its own prompts and its own renderer.
  - **B** is the current `main`.
- **Same inputs.** Both arms get the same verified business facts from the fixed evaluation scenarios, the same
  model and limits, the same pictures, and local rendering.
- **Businesses.**
  - Café: offer.
  - Fitness studio: trial-class leads.
  - Premium physical product: olive oil.
  - Local service: plumber.
  - The fifth scenario is the shoe brand (e-commerce). A beauty business would need a new scenario; the beauty
    industry profile exists but has no fixed scenario yet.
- **Pilot.** Café and fitness. They need no new pictures: the café uses cached V1 images, and fitness is type-led.
- **Blind rating.** [Blind creative review](https://claude.ai/artifact/5xVEJ4w22qVEPw34ybi3vw) shows X/Y per case,
  with the order mixed across cases. You score both versions 1–5 on:
  - marketing insight;
  - concept diversity;
  - hook;
  - copy;
  - art direction and hierarchy;
  - industry and brand fit;
  - factual grounding;
  - "would publish".

  You also mark any factual problem and pick a preference. Only after you save does the page reveal the arms, art
  direction, the Critic's findings, revisions and cost. Ratings are stored in the page's own database, where Claude
  reads them.
- **Measures.** Measured checks, LLM opinion and human ratings are reported separately. Cost per accepted creative
  is the arm's confirmed spend divided by the number of its ads rated "would publish" 4 or higher.
- **Current state of the page.** It holds a dry run with mock copy, which tests the flow only.

## 3. Art Director: findings

- **Ties.** The top score is tied in 305 of 825 situations (37%), and 3 or more ways in 82 (10%). A fixed family
  order decides every tie.
- **Type fit is ignored.**
  - Café offer: OFFER_RETAIL won a 3-way tie at 9 points with type at 72%. LOCAL_PROMO, tied, keeps 98%.
  - E-commerce: OFFER_RETAIL scores 70% against LOCAL_PROMO and LIFESTYLE_PHOTO at 100%.
  - The layout engine computes the scale, but the choice never sees it.
- **Proposed fixes** (deterministic, validated rendering, no AI-written CSS):
  1. Detect ties and record them.
  2. Break ties by type fit, measured with the real copy for each candidate family.
  3. Then break ties by creative intent: concept angle and hook technique, offer type, text density, picture
     composition.
  4. Then by variety against the previous ad. Fixed order only last.
  5. Penalise families that shrink type below 80% (and more below 62%). When every candidate shrinks, drop the
     sub-headline first (free), and only then ask the Copywriter to shorten (paid, approval).
  6. Optional: a model tie-breaker that picks from the tied families only (a closed list), with a reason. It is
     labelled as an opinion and costs about $0.002 per tie.

## 4. Creative Critic: findings on weak examples it was not built around

| Weak example | Caught? |
|---|---|
| Generic opener as headline ("הכירו את Luz") | No |
| Cliché and unapproved superlative ("הקפה הכי טוב בעיר") | No. `checkClaims` flags it, but the static-ad Critic never calls it |
| Same layout as the previous ad | Yes, MINOR |
| Offer for coffee and pastry over a storefront picture | No. Owner-picked backgrounds keep only `OWNER_CHOICE`, so the fit evidence is gone |
| Price dominates although the plan leads with people | No check exists |
| Overcrowded copy (type at 62%) | MINOR only. The MAJOR threshold sits just below |
| Formal Hebrew ("אנו") | Yes, MAJOR, with a correction |
| Translationese ("לרמה הבאה") | No |
| Vague CTA ("לחצו כאן", "למידע נוסף") | No. Only CTA length is checked; across concepts only "same phrase" (MINOR) |
| Premium brand in a loud retail layout | No tone-fit check |
| Generic hooks in all three concepts | No, although the Copywriter prompt forbids them |
| Same hook technique / same insight | Yes, MAJOR, routed to the Copywriter |
| Hook scene 6 s | Yes, MAJOR, routed to the Video Planner |
| Same camera move on every photo scene, separated by a graphic card | No. Only three consecutive scenes are checked |

Old template ads have no design data, so 5 visual criteria are not measured on them. "Not measured" must never be
read as "fine".

Proposed fixes:
- Phrase lists for generic openers, weak CTAs and translationese, used at both concept and ad level.
- Run `checkClaims` on ad text.
- Keep the content reasons of an owner-picked picture.
- An emphasis check: whatever is visually dominant must match the planned focal point.
- A tone-fit check (layout family profile against brand tone).
- A run-wide motion check.

Subjective judgement stays with people, or with a labelled opinion.

## 5. Budget (estimates; nothing spent)

Model `gpt-6.1-terra`, $1 per 1M input tokens and $5 per 1M output tokens (catalog). Measured request sizes ($0, mock):

| Call | Previous | Upgraded |
|---|---|---|
| Concepts, input | ~7.4–7.6k chars | ~14.1–15.0k chars (expertise + strategy) |
| Storyboard, input | ~6.9–7.2k chars | identical to previous |

Assumptions, both conservative:
- 3.5 characters per token. The V1 calls measured 5–10.
- Output tokens = the largest V1 output × the size ratio × 1.5.
- Worst case = every call retried once.

For calibration, the real V1 cost was $0.0125 per campaign.

| Run | Expected | Worst case | With optional Critic opinion (worst) |
|---|---|---|---|
| Per scenario, previous | $0.021 | $0.042 | — |
| Per scenario, upgraded | $0.024 | $0.048 | +$0.028 |
| **Pilot: 2 businesses × 2 arms** | **$0.09** | **$0.18** | **$0.24** |
| Full: 5 businesses × 2 arms | $0.22 | $0.45 | $0.59 |

- **Pictures.** $0 for the pilot. The full run needs real photos for the olive oil and shoe scenarios: either you
  provide 2 photos ($0), or 2 AI stand-ins at the V1 price of $0.041 each ($0.08). Stand-ins would change those
  scenarios from customer photos to AI.
- **Proposed caps.** Pilot $0.25; full run $0.60 (+$0.10 only if AI stand-in pictures are approved). The guard checks
  confirmed spend plus each call's pre-call estimate (~$0.032) against the cap. Estimated and confirmed amounts are
  recorded separately in the ledger.

## 6. Voice comparison (V2), prepared

Free discovery, using ElevenLabs model list and voice-library search (metadata only, no credits):
- **Hebrew models:** `eleven_v4`, `eleven_v3`, `eleven_v4_turbo` (0.5× cost), `eleven_v3_conversational` (0.5×).
  `eleven_multilingual_v2` has no Hebrew.
- **Voices, all verified for Hebrew on v4:**
  - Male: Nimrod (warm, confident), Itamar (narrator), Herzl Ben (clear), Dorian (young, expressive),
    Viktor M (friendly).
  - Female: Danit (natural, conversational), Zina (young, soulful; listed for characters).
- **Current production voice.** `mi2oKx8Xw4tealbjsgRS` is a Voice Design voice named "test ttt" on `eleven_v3`.

Proposed 8 readings (2 styles each: natural, energetic):
1. The current voice on v3.
2. The current voice on v4.
3. Nimrod on v4.
4. Danit on v4.

That is ~1,880 characters: about $0.15 at the published API price, $0.56 at the conservative catalog price. Cap
$0.60. Adding Itamar and Zina makes 12 readings, ~2,820 characters, about $0.23 published and $0.85 catalog.
Library voices must first be added to the account (free; uses a voice slot).

## 7. Recommended order

1. **Pilot** (2 businesses, cap $0.25), then your blind rating.
2. **Free fixes** from sections 3 and 4, plus giving the Storyboard Director its expertise. Check them with the
   $0 evaluation and tests.
3. **Full run** (5 businesses, cap $0.60), then your blind rating.
4. **Voice V2** (cap $0.60). It is independent and can run whenever approved.

Out of scope: Meta Ads, Campaign Director, scheduled publishing.
