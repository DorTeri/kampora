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

## Price catalog

`packages/cost-engine/src/catalog.ts` holds **planning estimates** only. Every entry carries `basis: "PLANNING_ESTIMATE"`,
`reviewedAt` and a note. Real provider prices change, so they must be verified against official pricing pages and
loaded via `KAMPORA_PRICE_CATALOG_PATH` (JSON). We never hardcode them as facts.

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
