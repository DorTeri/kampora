# Kampora — Creative Quality (Professional Agent Upgrade)

How Kampora decides what an ad says and how it looks, how it checks the result, and how it measures quality over time.
Everything here is deterministic TypeScript or a bounded, schema-validated model step. No step writes CSS, React or
application code, and none can call tools.

## The chain

```
business + request
  → Professional Creative Brief   (creative-engine/professional-brief.ts, no model call)
  → Copywriter                    (creative.concepts step: 3 concepts, hook technique, headline/sub-headline)
  → Storyboard Director           (creative.storyboard step)
  → Art Director                  (creative-engine/art-director.ts, deterministic: ArtDirectionPlan)
  → Layout engine                 (shared designFor + production-engine buildStaticAd / buildVideoProject)
  → Creative Critic               (creative-engine/critic/*: rubric results, verdict, revision routing)
  → owner                         (accept / reject with reasons: the learning signal)
```

## Expertise (`packages/agent-expertise`)

Versioned, citable knowledge that the steps receive as context. Each entry has an id and a version, and
`expertiseVersion()` names exactly what a run used, so results can be compared between versions.

- **Playbooks:** creative strategy, copywriting (hook techniques), Hebrew advertising (clichés, formal register,
  translationese: `hebrewCopyIssues`), art direction, video direction.
- **Industry profiles:** `cafe-restaurant`, `fitness`, `beauty-wellness`, `local-services`, `ecommerce`, plus a generic
  fallback (`industryFor`). Each profile has its conventions, preferred layouts, facts to ask the owner for, and claims
  that need proof. The profiles describe practice. They do not state market statistics or consumer insights as facts.
- **Reference library** (`creative-references.ts`, v1.0.0): a small set of described patterns (composition, copy
  approach, type, colour, why it works) with source and rights on every entry. All entries are Kampora-original
  principles: no other brand's assets, logos or identifiable designs. `retrieveReferences` ranks them by industry,
  goal, format and layout.
- **Rubric** (`evaluation-rubrics.ts`, `creative-rubric@1.0.0`): 24 criteria in three dimensions (marketing,
  visual, production). Each criterion has a method (DETERMINISTIC or LLM_OPINION) and the component that can fix it. `CRITIC_POLICY` (1.0.0) sets at most 2 revision rounds, which components are free (ART_DIRECTOR,
  LAYOUT_ENGINE) and which are paid (COPYWRITER, VISUAL_PLANNER, VOICE_ENGINE).

## Art Director

`directArt(input)` scores eight layout families against the situation and keeps every reason:

`EDITORIAL_PRODUCT`, `PREMIUM_MINIMAL`, `OFFER_RETAIL`, `LIFESTYLE_PHOTO`, `BOLD_TYPOGRAPHIC`, `PRODUCT_SHOWCASE`,
`SPLIT`, `LOCAL_PROMO`.

The scoring weighs:
- the goal;
- whether there is a picture and its composition;
- the tone;
- whether there is a price;
- the industry's conventions;
- the concept's angle and hook;
- how busy the picture is;
- whether the picture is authentic;
- the business's previous layout (it prefers variety).

`PRODUCT_HERO_FAMILIES` (product showcase, premium minimal, editorial product) lose 3 points when the picture is an AI
stand-in, because the Critic rejects an AI picture framed as the real product. The plan holds:
- the primary focal point and the hierarchy;
- a design per format (1:1, 4:5, 9:16), with palette roles taken from the brand colours;
- the negative space for the picture;
- the video motion: pacing, headline position and transition;
- the decisions with their reasons;
- the scored alternatives.

A family the owner picks is stored as `chosenBy: OWNER` and kept on every rebuild.

## Creative Critic

The Critic reviews three kinds of work:
- **Concept sets** (`critiqueConceptSet`): hook strength, message clarity, differentiation, CTA, offer, factual
  accuracy against approved claims, and Hebrew naturalness.
- **Static ads** (`critiqueStaticAd`): hierarchy against the planned focal point, layout balance, contrast (WCAG
  ratios), type scale, image relevance (offered products shown), product authenticity, safe zones, schema validity,
  and niqqud.
- **Videos** (`critiqueVideo`): pacing, audio sync, scene continuity, motion, safe zones, Hebrew rendering,
  authenticity, and technical validity. Camera moves on still pictures are the only motion the pipeline makes, and the
  Critic never claims subject motion.

Every criterion result carries:
- a score: 1–5, or `null` when it was not measured;
- a severity: OK, MINOR, MAJOR or CRITICAL;
- the method;
- an explanation, the evidence and a correction;
- the component that can fix it.

The report's verdict is one of:
- **PASS**: no serious problem found by the checks. It does not mean the ad is good.
- **REVISE**: a serious problem that a component can fix.
- **HUMAN_REVIEW**: a serious problem that only the owner, or an approved paid step, can fix.

**Revision loop** (`reviewStaticAd`):
- At most 2 rounds.
- Free fixes are applied automatically: rebuild the same layout family from its recipe, then try the next-best
  families.
- A candidate is kept only if it has fewer serious problems than the current version.
- Paid fixes are recorded as `PENDING_APPROVAL` and never run on their own.
- An owner-chosen layout is never replaced.

Every review is stored in `creative_reviews` with the rubric, policy and expertise versions.

**LLM opinion** (`critiqueOpinion`) is optional and separate:
- It runs only with a free provider, or with explicit approval for a paid one.
- Results are labelled `LLM_OPINION` and capped at MINOR, so an opinion never changes a verdict.
- The mock provider declines to judge and returns no score.

**Professional polish** (whether it looks like agency work) is never scored. It is left for people.

## Evaluation and regression

- `creative-engine/src/evaluation`: five fixed scenarios (café combo offer, Pilates studio trial-class leads,
  premium olive-oil product promotion, neighbourhood plumber leads, shoe-brand collection launch). `runEvaluation` takes each one through the whole pipeline with the mock provider:
  brief, concepts, storyboard, art direction, three ad formats with Critic review, then the video timeline with Critic
  review.
- `baseline.json` is the reviewed result. `evaluation.test.ts` fails when a change adds a serious problem the
  baseline did not have, changes a creative decision, or drops below three distinct layout families. To record an
  intentional change, regenerate the baseline and review its diff:
  `UPDATE_EVAL_BASELINE=1 npx vitest run packages/creative-engine/src/evaluation`
- The evaluation proves the rules hold. It does not prove the ads persuade, and the run says so in its `note`.

## Owner feedback and metrics

- `POST /v1/projects/:id/feedback` (static ad, scene image, narration, video) and `POST /v1/campaigns/:id/feedback`
  (concept): ACCEPTED, REJECTED or REVISION_REQUESTED, with reasons. The subject must belong to that project or
  campaign. Feedback is stored per business (`creative_feedback`) and audited. It is never shared across businesses.
- `GET /v1/quality/metrics?businessId=` returns:
  - reviews by subject and verdict;
  - average rounds, free fixes applied, fixes waiting for approval, fixes that need the owner;
  - serious problems by criterion;
  - feedback by decision and reason;
  - creative cost from the ledger.

  These are counts, not a quality score.
- The studio's static-ads screen shows the Critic's panel per format and an "מתאים לי / לא מתאים" control with
  reason chips.

## What is measured, and what is not

| Kind | Examples | Proves |
|---|---|---|
| Deterministic checks | contrast, type scale, safe zones, price vs focal point, offered products in the picture, approved claims, niqqud, scene timing | the rules hold, the same way every run |
| LLM opinion | optional notes on hook or originality | nothing on its own; labelled, capped at MINOR |
| People | polish, whether the hook stops a scroll, whether customers respond | the only judge of commercial quality |

## Q5 demo (local, $0)

`out/scripts/q5-demo.mjs` (gitignored) runs the Luz demo café through the chain with the mock provider and the
cached V1 pictures. It renders an offer ad, an awareness ad, a controlled Critic before/after example and a 9:16
preview video locally. The results are in `out/q5/report.json`. Run on 2026-10-30:
- **Offer ad:** OFFER_RETAIL, price-led, PASS.
- **Awareness ad:** LOCAL_PROMO, PASS.
- **Critic example:** a deliberately weak EDITORIAL_PRODUCT draft got REVISE; the free switch to OFFER_RETAIL then
  got PASS.
- **Video:** four scenes (push-in, pan, price card, parallax), PASS.

The run also found that the Art Director and the Critic disagreed about AI pictures in EDITORIAL_PRODUCT. That is
now fixed by the shared `PRODUCT_HERO_FAMILIES` list.
