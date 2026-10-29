# Campaign Director — Roadmap

Status: **vision only.** Nothing in this document is implemented. No chat UI, agent memory framework, autonomous
publishing, scheduling or Meta Ads integration exists, and none starts without a separate approval.

## What it is

A persistent, Hebrew-speaking campaign manager for each business. The owner talks to it ("תכין לי מבצע לחג",
"מה עבד בחודש שעבר?") instead of filling forms. It remembers the business, plans and produces campaigns, explains
its choices, asks before spending or publishing, and later runs recurring work on a schedule.

It is an **orchestrator, not a generator**. It decides what to do next and calls Kampora's existing typed services
as tools. Every fact, price, render and charge still comes from deterministic code with the same validation, budget
guard and approval records as the form-based studio. The Director can propose; it cannot bypass.

## Principles

1. **Tools, not free text.** Each action is a typed tool whose input and output are the existing Zod contracts
   (`CampaignBrief`, `Storyboard`, `VisualScenePlan`, `StaticAd`, quotes). LLM output that does not validate does
   nothing.
2. **Spend and publishing need the owner.** A tool that costs money returns a quote. Only an approval record from the
   owner (in any channel: studio, chat or notification) for that quote lets it run. Publishing is the same. Approvals
   are per action and never carry over.
3. **Memory has provenance.** Every remembered fact records its source, when it was learned and whether the owner
   confirmed it. Unconfirmed facts are never stated as fact in an ad.
4. **Explain from data.** The Director's explanations come from the reasons the services already return:
   background-ranking reasons, planning conflicts, QA issues and cost lines. They are not invented after the fact.
5. **Honest media.** The Director uses the media authenticity labels: it never presents an AI image as the real
   product or place, and it asks for real photos when product fidelity matters.

## Memory model (planned)

| Memory      | Holds                                                                                                                 | Source of truth today                                  |
| ----------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Business    | products, prices, address, hours, tone, approved claims, brand, media and its authenticity                            | `businesses`, `brand_assets`, `fieldSources` per field |
| Campaign    | briefs, concepts chosen and rejected, storyboards, approved images, static ads with their background choices, renders | the studio tables (`campaign_briefs` … `static_ads`)   |
| Decisions   | what the owner approved or rejected, and why (free-text notes)                                                        | `approvals`, `scene_images.decision`, `audit_log`      |
| Performance | spend, reach, clicks and leads per ad (after Meta Ads exists)                                                         | none yet                                               |

Each fact is stored as `{ value, source: OWNER | WEBSITE | INFERRED | PLATFORM, observedAt, confirmation:
CONFIRMED | UNCONFIRMED | REJECTED, confirmedBy? }`. Today only top-level business fields carry a source
(`fieldSources`). Per-fact records are the first memory change.

## Orchestration (planned)

```
owner (Hebrew chat / studio) ─▶ Director (LLM, bounded turns) ─▶ tool registry ─▶ existing services
                                     │                                 │
                                     ├─ reads memory (typed queries)   ├─ quote → approval request → owner
                                     └─ writes notes / proposals       └─ results + reasons → Director → owner
```

- The tool registry is generated from the same Zod schemas as the REST API (`z.toJSONSchema` already produces the
  OpenAPI document).
- Tools are idempotent (fingerprints and job ids already dedupe scene images, narration, renders and static ads).
- The budget guard, `KAMPORA_ALLOW_PAID_GENERATION` and per-project caps apply to the Director exactly as to the
  studio.

## Scheduling (planned)

Recurring work ("כל יום ראשון תכין מודעה למבצע השבוע") runs as **persistent scheduled workflows** in the
business's own timezone (e.g. `Asia/Jerusalem`, DST-aware), stored in the database, not in process memory:

- A schedule row holds the rule (RRULE-style), the timezone, the owner and the action plan to repeat.
- A durable scheduler (BullMQ repeatable jobs or a workflow engine) starts each run. Runs are idempotent per
  `(schedule, occurrence)`.
- A run can prepare (plan, quote, render free previews) without asking. Any spend or publishing in it waits for the
  owner's approval of that run's quote. A missed approval expires; it is never assumed.

## Phases

| Phase | Scope                                                                                                                                              | Prerequisite                       |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| D0    | Director-ready services (this increment and the adjustments below): typed results with reasons, no logic in controllers or UI                      | done in part                       |
| D1    | Fact memory with provenance; a generic approval request (quote hash, expiry, channel); domain events from the audit log                            | approval                           |
| D2    | Read-only Director: answers questions about the business and existing campaigns, explains choices from stored reasons. No tools that change things | D1                                 |
| D3    | Director with studio tools: brief → concepts → storyboard → images → ads, free steps directly, paid steps through approval requests                | D2, V1–V3 validated                |
| D4    | Scheduled workflows in the customer's timezone, preparation only, every spend approved per run                                                     | D3                                 |
| D5    | Publishing and performance memory (Meta Ads), each publish approved by the owner                                                                   | Meta Ads integration (not started) |

## Small adjustments that keep today's code Director-ready

Done in this increment:

- Scene composition, planning conflicts, media authenticity and static-ad background reasons are **typed data** in
  the domain contracts (`SceneComposition`, `VisualConflict`, `MediaAuthenticity`, `BackgroundSelection`), not UI
  strings. A Director can read and explain them. The Hebrew UI only translates codes.
- Background ranking (`rankBackgrounds`) and visual planning (`planSceneVisual`, `sceneComposition`) are pure
  functions in `production-engine`. They can be called as tools without NestJS or the web forms.
- An owner's choice is recorded as the owner's (`chosenBy: OWNER`) and survives rebuilds, so an automated actor
  cannot silently undo a person's decision.

Recommended next (not done):

1. **One approval request shape.** Paid endpoints take an `approvedUsd` field and write `approvals` rows per
   feature. Add a common `ApprovalRequest` (action, quote hash, amount, expiry, requested by: OWNER | DIRECTOR) so
   approvals can be granted outside the form that asked for them.
2. **Per-fact provenance** in place of per-field `fieldSources` (see the memory model).
3. **Domain events.** Emit typed events (image approved, ad rendered, budget reached) next to `audit_log`; the
   Director's memory and the scheduler subscribe to them.
4. **Timezone per business** (none is stored today). Scheduling and "this week's offer" need it.
5. **Service inputs without HTTP.** Keep business rules in services and engines, never in controllers or server
   actions, so the same call works from a tool. This holds today; keep it as a review rule.
