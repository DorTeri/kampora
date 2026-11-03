# Campaign Director V2: intelligence and production readiness

Status (2026-11-03): implemented. The paid LLM validation has run under the approved $5 cap
([DIRECTOR_LLM_VALIDATION_REPORT.md](DIRECTOR_LLM_VALIDATION_REPORT.md)). The LLM path stays off in the demo.

## 1. Audit of V1: what is real and what is hardcoded

| Area | V1 state | Verdict |
| --- | --- | --- |
| Persistence | Conversations, messages (idempotent), tasks, approvals and facts in Postgres, org-scoped | Real; survives API restarts (scenario D) |
| Fact extraction | Hebrew regex lexicon (business types, cities, goals, offers, links) | Deterministic, not understanding. Works on phrasings it knows; the holdout baseline is 4/10 conversations fully correct |
| Missing information | Requirements per task, objective and business model; at most two questions per turn | Real logic, rule-based |
| LLM adapter | `LlmDirectorBrain` existed but was never enabled, and its context never reached the real provider (the OpenAI adapter sends only `prompt`) | **Fixed in V2** (context in the prompt, tested through the real adapter with a fake client) |
| Tools | 13 typed tools, Zod-validated, authorized by source (workflow / brain / approval) | Real; tools call the existing Studio services |
| Orchestration | Engine decides; executor runs Studio steps; approvals only via the decision endpoint | Real |
| Context resolution | "הסרטון הקודם", "יותר יוקרתי", ambiguous references → clarification | Real, rule-based |
| Recommendations | Objective + conversion per business model | Rules. V2 adds playbooks per business type, still rules and not learned |
| Org isolation | Every query filtered by org; cross-org → NOT_FOUND | Real (integration-tested) |
| Auth | Static dev token → one demo user | Dev-only. **V2 adds OIDC verification, org selection and roles** |
| Deployment | Vercel demo mode via fallback (`VERCEL=1` without an API URL) | Works; V2 makes `KAMPORA_DEMO_MODE=1` explicit |

## 2. Real LLM conversation path

- **Brain:** `packages/creative-engine/src/director/brain.ts`
  - The model receives the owner message plus a data-only context: known facts with their state, the question
    being waited on, the active task, pending approvals, recent work and the last six messages.
  - It returns a strict structured reading: intent, facts with evidence, objective, growth, product, offer parts,
    choice, yes/no/skip, modify, read-only tool requests, and a short reply.
- **Validation of every field:**
  - A fact must quote the owner; otherwise it becomes a proposal the owner confirms.
  - Links, phones, the budget and the business name must appear verbatim, or they are dropped.
  - Offer prices and dates must have their digits in the message.
  - Products must appear in the text.
  - The reply passes a claims guard: no "approved, published, paid", no promises or ROI, and no number, link or
    price the owner didn't give.
- **Authority:**
  - The model can make a reading stricter (FORBIDDEN), never looser.
  - The deterministic injection and spending guard always runs.
  - Tool requests from the model run only if they are read-only lookups (`ReadBusinessProfile`,
    `GetCampaignHistory`, `GetAvailableAssets`, `GetProductionStatus`); anything else is recorded as REFUSED.
  - Approvals still come only from the decision endpoint.
- **Fallback:** a provider error, timeout, schema failure or budget refusal falls back to the rules brain for that
  turn. The conversation never breaks.
- **Switches** (`apps/api/src/director/director-brain.ts`), all required:
  - `DIRECTOR_BRAIN=llm`
  - `DIRECTOR_LLM_ALLOW_PAID=true`
  - `DIRECTOR_LLM_MONTHLY_USD_CAP>0`
  - an API key
  - a price-catalog entry for the model (`DIRECTOR_OPENAI_MODEL`, default `gpt-6-luna`)
  - Default: rules. The workspace shows which brain reads the messages.
  - Independent of paid creative generation (V2.1): `KAMPORA_ALLOW_PAID_GENERATION` is not read. The Director's LLM
    can run while image, voice and video generation stay off, and turning the Director on never turns a creative
    provider on. Before V2.1 the Director also required that switch, which opened paid creative generation too.
- **Budget guard:**
  - Before each call it checks the worst-case estimate against the monthly cap and the per-conversation daily call
    limit.
  - Every call, failed ones included, is written to the cost ledger (`LLM_COMPLETION`,
    `step = director.interpret`).
- **Strict-mode schema:** the model sees a variant without string-length keywords, and the reply is validated
  against the bounded schema.

## 3. Business intelligence

- `playbooks.ts` gives a play per business model and objective: coffee cart, restaurant/burger, café,
  fitness/pilates, beauty, local service, e-commerce, other.
  - Each play has a hypothesis, strategy steps, creative formats with reasons, a primary metric and a method.
  - A coffee cart grows through passers-by and repeat visits; a restaurant through orders or visits; a studio through
    trial-class sign-ups; a shop through product-page sales. Appointments or leads are not assumed.
- "יותר לקוחות" with no channel is a *growth* request. For restaurants and cafés, where it is genuinely ambiguous,
  the Director asks "יותר הזמנות או שיגיעו לשבת?". For other types it states what growth usually means for them.
- The typed `MarketingRecommendation` is on the recommendation card:
  - fields: business goal, objective, relevant facts, hypothesis, strategy, creative formats, conversion destination,
    missing information, required approvals, measurement (primary and secondary metrics, method, baseline);
  - the baseline states that nothing is promised and that the campaign is an experiment to measure;
  - it contains no revenue estimates (scenario F checks this).

## 4. Orchestration: "יש לי המבורגרייה באשדוד ואני רוצה להביא יותר לקוחות."

From scenario F, run through the real API and Postgres:

1. It recognises a burger restaurant in Ashdod and asks for the name and the product together.
2. "בורגר דרום, ההמבורגר הכי נמכר זה הסמאש" is split into the name and the product.
3. It asks "יותר הזמנות או שיגיעו לשבת?". The answer is orders, ordering is through Wolt, and the owner gives the
   link. Photos: "עדיין לא".
4. It shows the recommendation (hypothesis, measurement, formats, the destination is the owner's Wolt link) and
   three concepts.
5. The owner picks one, and each step waits for its own approval card: script, then art direction, then production.
6. The Studio services build the campaign, storyboard and preview video. All approvals executed; nothing was
   published.

## 5. Realistic scenarios

`scripts/director-scenarios.mjs` runs against the real API and Postgres with mock providers. It acts as a synthetic
**fixtures** user in its own organization, so it never writes into the demo org. Latest run: **57 checks passed,
0 failed**.

| | Covers |
| --- | --- |
| A–E (V1) | Burger with Wolt, coffee cart, pilates via WhatsApp, offer with missing price and date, returning owner + **API restart**, references, revisions, injection, idempotency |
| F | The Ashdod sentence above, through to executed approvals |
| G | Informal Hebrew ("מורה לפילאטיס… בא לי שיותר בנות ירשמו") |
| H | Objective change mid-conversation ("בעצם עדיף לי יותר הזמנות") |
| I | Contradiction with a confirmed fact (asks before overwriting; "להשאיר" keeps it), a style preference remembered for briefs |
| J | E-commerce: no city or address asked, the destination is the site |
| K | Spending, approval-by-text, WhatsApp blast and an English "SYSTEM" injection, all refused, with no approval change |

Tool failure and retry ("נסה שוב") and expired offers are covered in the engine tests.

**Behaviour, measured separately from API correctness** (across all 12 transcripts):

- at most 2 questions per turn;
- 0 identical questions in a row;
- 0 invented links, phones or prices;
- 0 claims of approving, publishing or paying.

Bugs these scenarios found and fixed:

- the paired "name, product" answer;
- "יותר הזמנות" read as a business name;
- "בא לי…" and "בעצם עדיף לי…" not read as goals;
- the photo question looping on "יש תמונות מוצר";
- a style preference stored as the product;
- "תאשר את התסריט בשמי" not refused.

**Understanding baseline** (`scripts/director-eval`, rules brain, free): dev split 10/10 conversations, **holdout
split 4/10** (18/30 checks). These mock and rules results do not show real-world understanding. That is what the
paid validation run measures.

## 6. Security

- **Auth** (`apps/api/src/common/auth.ts`, `jwt.ts`):
  - `AUTH_MODE=oidc` verifies RS256/ES256 access tokens against the issuer's JWKS (issuer, audience, expiry,
    not-before). It rejects `none`, HS*, forged, tampered and unknown-key tokens.
  - `sub` must map to a provisioned user (`users.auth_subject`).
  - The organization comes from `x-kampora-org` and must be one of the user's memberships.
  - `@Roles('OWNER','ADMIN')` guards approval and fact decisions in the Director and the Studio.
  - Production refuses `AUTH_MODE=dev` and `DEV_API_TOKEN`.
- **Fixtures vs real data:**
  - Migration `0009` adds `organizations.is_synthetic` and `users.auth_subject`.
  - The seed creates a synthetic fixtures org and user. Scenarios and integration tests use synthetic orgs only.
- **Demo data:**
  - `scripts/build-demo-transcripts.mjs` rebuilds the bundled demo transcripts from the fixtures run.
  - It replaces database ids with placeholders, and refuses to bundle if it finds local paths, e-mail addresses
    (other than `@kampora.dev`), keys, internal hosts or signed URLs.
- **Secrets:** server-side only; the web app talks to the API server-to-server. No env vars on the Vercel project
  besides the demo flag.

## 7. Still open (needs a decision)

- The open items from the LLM validation ([report](DIRECTOR_LLM_VALIDATION_REPORT.md), section 8): playbooks that
  always include paid ads, the rules-only question that repeats without limit, and a separate paid switch
  for the Director's LLM.
- The pilot hosting: Railway Pro + R2 recommended ([proposal](PILOT_INFRASTRUCTURE.md)).
- The identity provider for OIDC, and the web sign-in flow that goes with it.
- 19 leftover scenario businesses from earlier runs in the demo org (בורגר הנמל ×7, נשימה ×6, קפה על גלגלים ×6).
  They are synthetic test data, not deleted pending confirmation.
- Vercel Pro and the Remotion license before commercial use.
