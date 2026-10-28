# Kampora — Cost Model and Budget Control

Cost is a product requirement. The metric we optimize is **cost per accepted usable asset**, not cost per request.

## Charge types (never mixed)

| `charge_type` | Meaning |
|---|---|
| `SIMULATED` | Mock providers and local compute. Kept for realism, and never billed. |
| `ESTIMATED` | Pre-execution estimate or reservation, taken from the price catalog. |
| `CONFIRMED` | An amount reported or derived from a real provider response after execution. |

Amounts are stored as integer **micro-USD** (`amount_micro_usd`) to avoid float drift.
Customer-facing prices are in ₪ and are a separate billing concern (Phase 4).

## Phase 2 conventions

| Operation | Pre-call line | Post-call line | Counts as spend |
|---|---|---|---|
| OpenAI (LLM) | `ESTIMATED` reservation (worst case: prompt + full output cap) | `CONFIRMED` from reported tokens × verified price | the `CONFIRMED` line |
| ElevenLabs (TTS) | none (the customer approved a quote) | `ESTIMATED` charge: characters × planning price (billed in plan credits) | the `ESTIMATED` TTS line |
| Mock providers | none | `SIMULATED` | never |
| Cache hits | none | amount 0, `reused=true` | no |

Approvals: `CREATIVE_GENERATION` (campaign ceiling, covers concepts + storyboard + retries), `STORYBOARD`
(script approved, free), `NARRATION` (voice + quoted estimate), and `PRODUCTION_PLAN`. The worker re-checks the
narration approval and the budget before calling a paid provider.

## Price catalog

`packages/cost-engine/src/catalog.ts`: entries are `PLANNING_ESTIMATE` unless marked `VERIFIED` with a `sourceUrl`
and a `reviewedAt` date (OpenAI token prices, read from the official pricing page on 2026-10-28). ElevenLabs bills in
plan credits, so its USD per character stays a planning estimate. Prices change: override or refresh them via
`KAMPORA_PRICE_CATALOG_PATH` (JSON) after re-checking the official pages. An OpenAI model without a catalog entry is
disabled, because spend could not be bounded.

## Budget guard (`evaluateGenerationRequest`)

Every paid generation request is evaluated against:

- `projectMaxUsd`: confirmed spend + open reservations + this estimate must fit.
- `perGenerationMaxUsd`: hard ceiling for a single call.
- `maxAttemptsPerAsset`: no unlimited retries.
- `maxConcurrentPaidGenerations`: no unbounded parallel spend.
- `requireApprovalForPaid`: during the MVP, an `approvals` row must exist for the production plan.

A denial returns machine-readable reasons (`PER_GENERATION_LIMIT`, `PROJECT_BUDGET_EXCEEDED`, `MAX_ATTEMPTS`,
`CONCURRENCY_LIMIT`, `APPROVAL_REQUIRED`). Nothing calls a paid provider without going through it.

## Idempotency and caching

`generationIdempotencyKey(provider, model, operation, canonicalInput)` is a SHA-256 over a canonical JSON form.
It is unique on `generation_jobs` and `generated_assets`. An identical request returns the existing asset instead of paying twice.
Scene content hashes mean a revision only invalidates the scenes that actually changed.

## Ledger reporting

`summarizeLedger` returns totals per charge type and per operation, attempts, failures, reuse hits, and
`costPerAcceptedAssetUsd` (confirmed + simulated spend ÷ accepted assets).
