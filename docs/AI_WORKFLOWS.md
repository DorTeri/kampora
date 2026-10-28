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

## Steps in Increment 1

| Future agent role | MVP implementation | Input → Output |
|---|---|---|
| Campaign Director | `creative.brief` step | BusinessProfile + goal/offer → `CampaignBrief` |
| Creative Strategist | `creative.concepts` step | profile + brief → 3 `CreativeConcept` + recommendation |
| Storyboard Director | `creative.storyboard` step | profile + brief + concept + assets → `Storyboard` (4–6 scenes) |
| Production Planner | deterministic `planProduction` | storyboard + assets + budget → `ProductionPlan` |
| Voice Director | deterministic `hebrew-voice` normalizer + provider prep | voiceover text → provider payload |
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
