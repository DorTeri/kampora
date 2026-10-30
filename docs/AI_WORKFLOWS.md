# Kampora — AI Workflows and Agent Boundaries

The MVP uses **structured workflows**, not free-running agents. Each AI step is a bounded function:

```ts
runReasoningStep({
  name,            // e.g. "creative.concepts"
  input,           // typed, Zod-validated
  outputSchema,    // Zod: model output is parsed, never trusted
  provider,        // LlmProvider adapter (mock | real)
  maxAttempts,     // bounded retries on invalid output (default 2)
  recorder,        // usage + cost ledger (SIMULATED for mock)
})
```

Steps have no tools, shell, network or code execution. They return JSON. Deterministic TypeScript does everything else
(routing, costing, timeline building, rendering).

## Phase 2: real creative generation (OpenAI)

- `CREATIVE_PROVIDER=openai` uses the official OpenAI Node SDK (v7) Responses API with **Structured Outputs**:
  `responses.parse` + `zodTextFormat(schema)` from strict, provider-facing Zod schemas
  (`packages/creative-engine/src/llm-schemas.ts`). The output is then mapped to, and re-validated by, the domain schemas.
- Strict-schema rules (docs 2026-10-28): every field is required, so "optional" is expressed as nullable. There are
  no string-length keywords, and arrays are bounded with min/max items.
- The **brief is deterministic** (no model call). Only concepts and storyboard use the model, so a campaign makes
  2 calls, plus at most 1 retry each.
- **Grounding checks** run after every response and trigger a retry carrying the problem list. Any number not in
  the business data is rejected, as are discounts or "free" claims not in the offer, testimonials or reviews,
  three concepts sharing an angle, a script too long for the target, and a storyboard that doesn't start with
  HOOK and end with CTA.
- **Cost:** default model `gpt-6.1-terra` ($1 in / $5 out per 1M tokens, official pricing page 2026-10-28);
  `gpt-6-luna` is ~10× cheaper if quality holds. `OPENAI_MAX_OUTPUT_TOKENS` caps the worst case. `store: false`.
- Every paid call goes through `GuardedLlmProvider` (approval ceiling, per-call cap, project budget, concurrency).
  The pre-call estimate is logged as `ESTIMATED`, and the provider-reported usage as `CONFIRMED`.

## Steps in Increment 1

| Future agent role | MVP implementation | Input → Output |
|---|---|---|
| Campaign Director | `creative.brief` step | BusinessProfile + goal/offer → `CampaignBrief` |
| Creative Strategist | `creative.concepts` step | profile + brief → 3 `CreativeConcept` + recommendation |
| Storyboard Director | `creative.storyboard` step | profile + brief + concept + assets → `Storyboard` (4–6 scenes) |
| Production Planner | deterministic `planProduction` | storyboard + assets + budget → `ProductionPlan` |
| Voice Director | deterministic `hebrew-voice` normalizer + provider prep | voiceover text → provider payload |
| Copywriter | `creative.concepts` step with copywriting / Hebrew playbooks | concepts with hook technique, headline, sub-headline |
| Art Director | deterministic `directArt` | goal, picture, tone, price, industry → `ArtDirectionPlan` (layout family, focal point, per-format design, motion) |
| Creative Critic | deterministic `critique*` + optional labelled LLM opinion | concept set / static ad / video → per-criterion results, verdict, routed revisions (max 2 rounds, paid fixes need approval) |
| Quality Control | `checkClaims` guard (unapproved superlatives); STT checks in Phase 2 | concept/storyboard → warnings |
| Business Research, Media Buyer, Performance Analyst | not started | — |

## Guardrails

- **Claims:** the concept and storyboard steps receive `approvedClaims`. `checkClaims` flags superlatives and absolute
  claims that are not in the approved list (e.g. “הכי”, “מספר 1”, “100%”). Flagged items need human confirmation.
- **Untrusted input:** website and customer text is passed as quoted data, never as instructions.
- **No endless loops:** steps do not call each other. The API orchestrates them in a fixed order.

## Providers

`LlmProvider.generateStructured({ task, system, prompt, input, jsonSchema })`.
The mock provider (`MockCreativeLlmProvider`) is deterministic, produces realistic Hebrew output for the demo,
and records `SIMULATED` cost. A real LLM adapter plugs in behind the same interface and is only used when it is configured.
