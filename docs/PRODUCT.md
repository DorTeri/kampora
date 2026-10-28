# Kampora — Product Scope

Kampora is an AI advertising agency delivered as SaaS for Israeli small and medium-sized businesses.
The customer describes a **business goal**; Kampora handles the strategy, creative work, production and (later) media buying.

> Simple on the surface, sophisticated behind the scenes.

## Principles

1. **Hebrew-first.** The customer-facing UI is native Hebrew and RTL. Prices are shown in ₪. Internal costs are recorded in USD.
2. **No invented facts.** Inferred business facts and advertising claims must be confirmed by the customer before use.
3. **Cost per accepted asset.** We reuse existing media and prefer programmatic motion. Paid generation is the last resort.
4. **The VideoProject is the source of truth.** An MP4 is just a rendered output of it.
5. **Explicit approval.** Nothing paid runs without an approved estimate (enforced in the MVP).

## MVP — Creative Studio

| # | Capability | Status in Increment 1 |
|---|---|---|
| 1 | Business workspace (org + business) | ✅ seeded demo business, tenant-scoped API |
| 2 | Business details and brand profile | ✅ read-only view, seeded |
| 3 | Campaign brief | ✅ generated from goal + offer (mock creative provider) |
| 4 | Three creative concepts | ✅ mock provider, Zod-validated |
| 5 | Choose a concept | ✅ |
| 6 | Editable storyboard | 🟡 structured and reviewable; editing UI is Phase 3 |
| 7 | Production plan + cost estimate | ✅ rule-based router + cost engine |
| 8 | Hybrid video production | 🟡 existing media + programmatic motion + motion graphics; AI generation is Phase 2 |
| 9 | Hebrew voiceover + subtitles | 🟡 Hebrew normalization pipeline, subtitles, supplied-narration support; real TTS is Phase 2 |
| 10 | Preview video | ✅ preview-quality render (540×960) |
| 11 | Render + download MP4 | ✅ 1080×1920, 30 fps, H.264 |
| 12 | Versions + cost tracking | ✅ timeline versions, cost ledger (simulated vs confirmed) |

## Customer journey (Hebrew UI labels)

1. **העסק שלי** — the business profile and brand: colors, tone, approved claims, media.
2. **יצירת קמפיין** — goal, product, offer → campaign brief.
3. **רעיונות לקריאייטיב** — three concepts, one recommended.
4. **תכנון הסרטון** — storyboard plus a production plan with an estimated cost.
5. **הפקת הסרטון** — approve, produce, follow progress.
6. **הסרטונים שלי** — watch, download and, later, revise.

Customers never see FFmpeg, queues, models or routing. Those belong in internal admin and observability.

## Out of scope for the MVP

Meta Ads publishing (interfaces are kept open for it), autonomous budget optimization, cross-campaign ML, Google/TikTok, stock marketplaces, a full timeline editor, self-hosted GPUs and custom models.
