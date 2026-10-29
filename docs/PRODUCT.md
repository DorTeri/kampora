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
6. **Honest media.** Only the business's own photos represent its real products and premises. AI images are labelled as AI (guided by the owner's product photos, or a generic stand-in) and are never presented as the real thing. When the real product must appear, the owner's own photo wins over a generated one.

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

## Future: the Campaign Director

The long-term interface is a persistent, Hebrew-speaking Campaign Director: the owner talks to it instead of filling forms, and it remembers the business, plans and produces campaigns, explains its choices and later runs recurring work in the business's timezone. It orchestrates the same typed services the studio uses and cannot bypass budget, approval or publishing controls. It is **not built yet**; see [CAMPAIGN_DIRECTOR_ROADMAP.md](CAMPAIGN_DIRECTOR_ROADMAP.md).

## Out of scope for the MVP

Meta Ads publishing (interfaces are kept open for it), autonomous budget optimization, cross-campaign ML, Google/TikTok, stock marketplaces, a full timeline editor, self-hosted GPUs and custom models.
