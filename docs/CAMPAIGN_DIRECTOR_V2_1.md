# Campaign Director V2.1: Marketing Decision Intelligence

Status (2026-11-03): implemented, tested offline, pushed to `main`, deployed to the protected demo. No paid AI
calls were made for this work and no infrastructure was provisioned.

## 1. Root cause of the paid-ad bias

The bias was architectural, not a wording problem:

- Every conversation path ended in `createConcepts`. Advice requests, problems and campaign requests all reached the
  same creative pipeline. A paid campaign was the only output the engine knew how to produce.
- `ProposeCampaignStrategy` had a strategy probe that was never wired into the flow, so nothing could argue against
  advertising.
- The workspace's "מה הייתי עושה עכשיו" panel (`recommend()` in `strategy.ts`) always appended a campaign card,
  whatever the conversation had concluded.

V2.1 does not replace "always advertise" with "never advertise". Paid ads are one of ten actions. They are recommended
when the situation supports them and deferred, with the reason and the condition for coming back, when it does not.

## 2. Decision Engine

`packages/creative-engine/src/director/decision.ts` (`decideMarketing`, version `decision@2.1.0`) returns a validated
`MarketingDecision` (`packages/shared/src/director.ts`):

| Field | Meaning |
| --- | --- |
| `action` | One of 10: `PAID_ADVERTISING`, `CONVERSION_PROCESS_FIX`, `ORGANIC_CONTENT`, `LOCAL_VISIBILITY`, `BRAND_AWARENESS`, `CUSTOMER_RETENTION`, `OFFER_OPTIMIZATION`, `BUSINESS_RESEARCH`, `DEFER_SPENDING`, `COMBINED_STRATEGY` |
| `sequence` | 1–5 ordered steps, each with an optional "when" |
| `paid` | `RECOMMENDED` / `LATER` / `NOT_NOW` / `OWNER_CHOICE`, with why, condition and the blocking signal |
| `blocker`, `why`, `evidence` | What stops customers (quoted), the explanation, and the sources: owner / memory / history / model / skill |
| `destination` | Whether customers have somewhere working to go |
| `checklist`, `questions` | Steps the owner does themselves; at most 3 questions, only ones whose answer changes the decision |
| `measurement` | Primary metric, secondary metrics, method. No invented rates or results. |
| `confidence`, `rule`, `skills`, `model` | For audit and evaluation |
| `next` | The workflow: `PAID_CONCEPTS`, `ORGANIC_CONCEPTS`, `CHECKLIST`, `QUESTION`, `NONE` |

Rule order:

1. `OWNER_CHOICE`
2. `BLOCKER_BYPASSED`
3. Hard signals (`CONVERSION_BLOCKER`, `TRAFFIC_NO_SALES`, `FULL_CAPACITY`, `NO_BUDGET`, `NO_DESTINATION`,
   `LOW_ENGAGEMENT`, `LOW_REACH`, `UNDERPERFORMED`, `RETENTION_GOAL`)
4. A grounded model hint
5. Soft signals
6. `NEEDS_DESTINATION`

Paid ads without a known destination are `LATER`, together with the destination question.

**LLM vs code.** The LLM brain may return a `decision` block (action, blocker, evidence, paidAds). `LlmDirectorBrain.hint()`
keeps it only when its evidence quotes the owner's message or confirmed memory. The engine then uses it as one input
below the hard signals: a hint can't push paid ads past a full calendar or a broken ordering path. Code never
overrides a grounded non-paid suggestion with a hard-coded campaign. The reply guard blocks numbers, rates, publishing
and payment claims the owner didn't state.

**Workflows** (existing Kampora tools only; nothing outside Kampora is changed or claimed to be changed):

| Decision | Leads to |
| --- | --- |
| Paid | The existing concepts, storyboard, art direction and approvals flow |
| Organic | The concepts flow with no paid step (an organic brief) |
| Conversion issue | A checklist for the owner plus one diagnostic question |
| Missing information | One targeted question |

Every decision is recorded as the `ProposeMarketingDecision` tool call. The workspace shows it as a DECISION card
(`apps/web/src/components/director/cards.tsx`) with an expandable "על מה ההחלטה מבוססת". The side panel now uses the
same decision (`recommendNext`).

## 3. Marketing Skills

`packages/agent-expertise/src/marketing-skills.ts` holds 11 versioned skills:

- `paid-ads-economics`
- `conversion-rate`
- `local-restaurant`
- `food-delivery-funnel`
- `coffee-cart-cafe`
- `fitness-membership`
- `beauty-appointments`
- `ecommerce-funnel`
- `retention`
- `organic-social`
- `local-awareness`

Each skill has:

- **Signals:** the situations it recognises.
- **Contraindications:** for example, `PAID_ADVERTISING` is avoided under `CONVERSION_BLOCKER`, `FULL_CAPACITY` or
  `UNDERPERFORMED`, each with an "until" condition.
- **Responses and plays:** per action and business model.
- **Measurement.**

The skills drive the actual decision: contraindications set the paid verdict, and plays set the steps. For the LLM
there is a token-efficient digest: one line per applicable skill, at most 4, carrying principles but no texts. Each
decision lists the `id@version` of the skills it used.

## 4. Examples (offline, rules brain)

Full transcripts are in `docs/director/decisions/dev.md`. The selection below covers both sides.

**Not paid. A: pizzeria, phone not answered in the evening.**
"…לקוחות שכבר רוצים להזמין נתקעים… פרסום עכשיו יביא עוד הזמנות לאותה נקודה, אז קודם סוגרים את זה. לפרסום ממומן
נחזור כשהדרך לקנות עובדת גם בשעות העומס."
→ `CONVERSION_PROCESS_FIX`, paid `LATER`, next `CHECKLIST`, metric "הזמנות שהושלמו בערב, לעומת שיחות שלא נענו".

**Not paid. B: beauty clinic, calendar full.**
→ `OFFER_OPTIMIZATION` (price for new clients, waiting list), paid `NOT_NOW` with no "until".

**Not paid. E: online candle shop, visits but no sales.**
→ `CONVERSION_PROCESS_FIX`. The product is read as "נרות ריחניים בעבודת יד", without "דרך האתר שלי".

**Paid. D: burger place with a Wolt link and a ₪2,000 budget.**
→ `PAID_ADVERTISING`, `RECOMMENDED`, next `PAID_CONCEPTS`: three concepts, the ad sends straight to the Wolt page.

**Owner choice. J: blocker, then "בכל זאת תכין לי קמפיין ממומן".**
→ "בסדר, זו ההחלטה שלך. נכין קמפיין ממומן, ובסוף אזכיר מה כדאי לסדר כדי שהתקציב לא ילך לאיבוד." The verdict is
`OWNER_CHOICE` and the campaign flow continues.

## 5. Defects fixed (each has a regression test in `decision.test.ts` / `llm-brain.test.ts`)

- **"השרון"** is stored as `location.region`, never as a city. A local ad then asks for the city once, optionally,
  and says why.
- **"תזכיר לי מה אתה יודע עליי"** lists confirmed facts separately from uncertain ones and explains how to correct
  them.
- **Long Hebrew dates:** "עד ה-15 בנובמבר" is accepted from the model when the deterministic parser reads the same
  day. An overlong field is cut instead of rejecting the whole reading.
- **"דרך האתר שלי"** is stripped from product names, in both the rules and the model path.
- **Consultative tone:**
  - no automatic "נכין קמפיין" on advice requests;
  - "רשמתי" only on the first turn, after which only new destinations are echoed;
  - no forced 3 concepts;
  - advice requests get a direct answer or one focused question.
- **Found by the blind sets:**
  - unknown business types are kept in the owner's words as `OTHER`;
  - "יש לך רעיונות";
  - "שם המסעדה: X";
  - retention phrasing;
  - cart abandonment, cancellations and one-star reviews treated as blockers;
  - underperformed or low-engagement earlier campaigns.

## 6. Director LLM switch

`apps/api/src/director/director-brain.ts` no longer reads `KAMPORA_ALLOW_PAID_GENERATION`. The Director's LLM needs
only its own switches:

- `DIRECTOR_BRAIN=llm`
- `DIRECTOR_LLM_ALLOW_PAID=true`
- `DIRECTOR_LLM_MONTHLY_USD_CAP>0`
- an API key
- a price-catalog entry

Enabling the Director never enables image, voice or video providers. A test proves the LLM path runs while paid
creative stays off. The cap, the per-conversation daily limit, ledger entries and approvals are unchanged. The
defaults (`.env.example`) are rules / $0.

## 7. Scenario results

Offline runner: `node scripts/director-eval/decisions.mjs --set=<set>`. It uses the sandbox, the rules brain and mock
providers.

The automated checks cover:

- the action;
- the paid verdict;
- the workflow;
- the rule;
- concepts created or not;
- no paid push;
- required mentions;
- a checklist or a question.

Checks applied to every reply:

- at most 2 questions;
- one "רשמתי";
- no publish, pay or approval claims;
- no ₪ or % numbers beyond the owner's.

These checks are separate from judging the advice itself, which needs a person reading the transcripts.

| Set | Written by | First run (blind) | After fixes |
| --- | --- | --- | --- |
| dev A–J | me, used for tuning | — | 10/10 scenarios, 86/86 checks |
| held-out v1 HA–HJ | an independent agent, without reading the code | **1/10 scenarios, 49/72 checks (68%)** | 10/10, 72/72 |
| held-out v2 KA–KL | a second independent agent, written after v1 was fixed | **3/12 scenarios, 68/86 checks (79%)** | 12/12, 86/86 |

The blind first-run numbers are the honest measure of generalisation. Once I fixed against a held-out set it stopped
being blind; both reports are kept side by side in `docs/director/decisions/`. Most blind failures came from the rules
brain's Hebrew reading (phrasing it had not seen), not from the decision rules: when the facts were read, the decision
followed them.

## 8. Tests and builds (2026-11-03)

- `npm run typecheck`: clean.
- `npm run lint`: clean.
- `npx vitest run`: 571 passed, 27 skipped. The skipped tests are DB integration tests; Postgres was not running.
- `npm run build -w @kampora/api` and `-w @kampora/web`: succeed.

## 9. Commits (main, fast-forward from `3a2ebbe`)

- `8505b79` MarketingDecision schema and versioned marketing skills
- `e408c96` decision engine replaces the always-a-campaign path
- `1713f6a` LLM switch independent of paid creative generation
- `06ca3f0` decision card in the workspace
- `172c106` offline decision evaluation (dev A–J, two blind held-out sets)
- `f7331bb` the "what I would do now" panel follows the decision
- this report

## 10. Demo

- URL: https://kampora-studio.vercel.app/studio/director
- The deployment is unchanged in kind:
  - labelled demo mode (`KAMPORA_DEMO_MODE`);
  - per-deployment and preview URLs still behind Vercel login;
  - no server, database or AI behind the demo.
- The "נסו בעצמכם" tab runs the V2.1 engine in the browser, with the rules brain and nothing persisted. State lives in
  the browser only and is gone after a refresh; nothing is saved to a cloud database.
- The "הרצה מוקלטת" tab still shows the conversations recorded against the real API and database before V2.1. I
  couldn't re-record them for this release because the local Postgres (Docker) wasn't running, and I didn't substitute
  browser-sandbox output under that label.

## 11. Limitations

- The rules brain is brittle on unseen Hebrew phrasing. The blind first-run results (68% and 79% of checks) are the
  realistic expectation for new owners. The LLM brain is meant to cover this, but:
- The LLM path was **not** evaluated on the decision sets, because no paid calls were authorized. Its decision hint is
  tested only with recorded and unit fixtures.
- Passing automated checks shows the decisions follow the stated situation. It does not show that the advice is
  professionally right; that needs a marketer reading the transcripts.
- The ledger records the base decision's action when the "what kind of business is it?" override (`NEEDS_BUSINESS_TYPE`)
  is shown. This is a minor audit inconsistency.
- Recorded demo transcripts predate V2.1 (see §10).
