# Campaign Director V1

Status: **implemented locally and tested against the real API and Postgres with mock providers.** The deployed web
build is a labelled demonstration: the API, Postgres and Redis are not hosted yet (see "Deployment").

The Director is the main entry point of the studio (`/studio/director`). The owner talks to it in Hebrew. It
remembers the business, asks only for what is missing, recommends a next step, and drives the existing Studio
services (campaign brief → concepts → script → art direction → local production) through typed tools. Every
action that changes the owner's work waits for an explicit approval card.

## Architecture

```
Web (Next.js, RTL)                API (NestJS)                          Engine (@kampora/creative-engine/director)
/studio/director  ──fetch──▶  /api/director/* proxy ──▶ /v1/director/*  DirectorEngine (pure, no I/O)
  DirectorWorkspace              DirectorController                       ├─ DirectorBrain: interprets a message
  cards / side panel             DirectorService (lock, idempotency,      │    RuleBasedDirectorBrain (default)
                                   transactions, audit)                   │    LlmDirectorBrain (optional, validated)
                                 DirectorStore (org-scoped SQL)            ├─ strategy: objective, conversion plan,
                                 ApiDirectorExecutor ──▶ StudioService     │    recommendations, Meta draft
                                                       ──▶ StaticAdsService├─ requirements: missing-information engine
                                                                           └─ references: "the previous video" etc.
```

- **The brain interprets; the application executes.** A brain returns an `Understanding` (intent, facts with
  evidence, choice, yes/no). It cannot call tools. The engine decides which of the 13 typed tools to run, the
  executor validates ownership and calls the existing services, and approvals are only accepted from the decision
  endpoint.
- **V1 runs the deterministic Hebrew brain.** `LlmDirectorBrain` is implemented and unit-tested with a mock LLM
  (schema-validated output, each fact must quote the owner's words or it stays a proposal, the deterministic
  injection guard always runs on top), but it is not switched on: no paid AI calls were approved for this milestone.
- The engine is browser-safe, which is what lets the demo run the same engine in a sandbox.

### Tools (typed, validated)

`ReadBusinessProfile`, `ProposeBusinessProfileUpdate`, `GetCampaignHistory`, `GetAvailableAssets`,
`CreateCreativeBrief`, `ProposeCampaignStrategy`, `GenerateCreativeConcepts`, `RequestStoryboard`,
`RequestArtDirection`, `RequestProduction`, `GetProductionStatus`, `PresentCreativeForApproval`,
`RequestTargetedRevision`.

Each call is recorded on the message as `DONE`, `FAILED`, `REFUSED` or `WAITING_FOR_APPROVAL`; the UI shows a plain
Hebrew line per call ("מה עשיתי"), never arguments, prompts or provider names. Executor errors become Hebrew messages
per API error code.

## Business memory

Table `business_facts` (one row per org, business and key). 24 keys, from `business.name` to `preferences.style`.

| Field | Meaning |
| --- | --- |
| `value` | Typed value (string, list, boolean, number or an offer object) |
| `source` | `OWNER_STATED`, `OWNER_CONFIRMED`, `OWNER_FORM`, `IMPORTED_PROFILE`, `AI_INFERRED`, `EXTERNAL_RESEARCH`, `SYSTEM_DEFAULT` |
| `status` | `CONFIRMED`, `PROPOSED`, `REJECTED` |
| timestamps | `updatedAt`, `confirmedAt` |

Rules:

- Only owner-stated or owner-confirmed facts are usable. Inferred values are proposals the owner confirms or
  rejects in the side panel.
- Offers are time-limited. An offer past `validUntil` is `EXPIRED`; an offer without an end date becomes `STALE`
  after 14 days (a standing offer after 30) and is asked about again. Expired or stale offers are removed from the
  brand's approved claims.
- Facts project onto the existing business and brand profile (name, category, city, address, website, audience,
  products, approved claims). When no audience was stated, a neutral geographic audience is used and marked
  `INFERRED_UNCONFIRMED`.
- Every query is scoped by organization on the server. Conversations, tasks, approvals and facts of another
  organization return `NOT_FOUND`.

Other tables: `director_conversations` (state, focus, business), `director_messages` (idempotent on
`conversationId + clientMessageId`), `director_tasks` (pending and finished work, survives restarts),
`director_approvals` (explicit approval state).

## Conversation behaviour

- Onboarding is conversational: one question at a time, with suggestion chips and "skip". Facts the owner already
  gave in passing are not asked again.
- The missing-information engine lists what a task still needs, asks for it, then resumes the original task.
- Conversion strategy depends on the business: a WhatsApp or ordering-app link, a booking page, a phone call or
  navigation. A landing page is never assumed, and no URL or phone number is invented: the Director asks for the
  real one or offers another channel.
- Photo requirements are explained: real photos are recommended; without them the ads use typography or labelled
  demonstration imagery that is never presented as the real product.
- Follow-ups resolve against stored work: "תשנה את הפתיחה של הסרטון הקודם" (latest video, or a clarifying list
  when it is ambiguous), "יותר יוקרתי" (revises the shown art direction), "בוא נקדם השבוע את ההמבורגר החדש",
  "מה נשאר לאישור?", "איזה פרסומות כבר הכנו?".
- Recommendations always carry objective, reasoning, information used, missing information, proposed action,
  cost note and whether approval is required. No ROI or growth claims.

## Approvals and cost safety

- Approval kinds: `SCRIPT`, `CREATIVE_DIRECTION`, `PRODUCTION` (plus `PAID_GENERATION`, `PUBLISH`, `AD_BUDGET`,
  which V1 never creates as executable).
- Text in the chat is never an approval. "תאשר הכל ותעלה לאוויר" is refused with an explanation.
- A decision claims the approval atomically (`PENDING → decision`); a double click or a resent request is recorded
  once. A newer revision supersedes older pending approvals.
- Paid generation stays disabled (`KAMPORA_ALLOW_PAID_GENERATION=false`). Production uses the local renderer at $0.
  Nothing is published to Meta and no WhatsApp message is sent; a Meta campaign draft is prepared as metadata only.

## Tests and scenarios

- `packages/creative-engine/src/director/director.test.ts` — engine, memory states, clarification and resumption,
  references, injection, LLM brain grounding (mock provider).
- `apps/api/src/director/director.integration.test.ts` — against Postgres: business creation and projection,
  idempotent replay, restart persistence, org isolation, double decision, offer expiry.
- `scripts/director-scenarios.mjs` — starts its own API with mock providers and runs scenarios A–E over HTTP,
  including an API restart in the middle of D. Output: `docs/director/scenario-report.json` and
  `scenario-transcripts.json` (latest run: 32 checks passed, 0 failed).

| Scenario | What it covers |
| --- | --- |
| A | Burger restaurant, orders via Wolt link, concepts → script → art direction → production, each approved by card |
| B | Coffee cart, local awareness, no landing page asked for |
| C | Pilates studio, registrations via WhatsApp, booking goal |
| E | Offer with missing price and validity: asked for, never invented |
| D | Returning customer after API restart: memory kept, "the video" clarified, opening revised, "more premium", status, history, injection refusal, idempotency |

Run them with the database up:

```bash
node scripts/director-scenarios.mjs --out docs/director
```

## Deployment

The Vercel deployment runs the web app in demo mode (`KAMPORA_DEMO_MODE=1`). `/studio/director` then shows a clearly
labelled demonstration with two tabs: a sandbox running the same engine in the browser (nothing is stored), and the
recorded scenario transcripts from the real API run. No secrets are bundled.

Persistent conversations online need a hosted API, Postgres and Redis. Those are not provisioned: doing so is new
spending and needs approval.

## Limitations

- The conversational understanding is rule-based Hebrew. Phrasings outside its lexicon fall back to a clarifying
  question. The LLM brain is ready behind the same interface but not enabled.
- No Meta Ads publishing, budgets or WhatsApp messaging (by design for V1).
- Turn serialization uses an in-process lock; running several API instances needs a shared lock.
- Recommendations are rules from the business model and objective, not learned from campaign results.
