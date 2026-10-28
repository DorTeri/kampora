# Kampora — Development Plan

## Phase 0 — Foundation ✅ (Increment 1)
Monorepo, docs, Zod contracts, provider interfaces, workflow states, cost design, Docker Compose.

## Phase 1 — First working video pipeline ✅ (Increment 1)
Demo business → brief → 3 concepts → storyboard → production plan → approval → timeline → Remotion render → MP4 → download.
Mock creative provider, demo assets, music bed, Hebrew captions, cost ledger with simulated costs.

## Phase 2 — Real AI media (next)
1. Real LLM adapter for the creative steps (behind `LlmProvider`, opt-in via env).
2. ElevenLabs Hebrew TTS end-to-end: normalize → synthesize → probe duration → re-time scenes → render.
   Gated by `KAMPORA_ALLOW_PAID_GENERATION` + approval.
3. One image-generation provider with reference images. One image-to-video provider.
4. `generation_jobs` worker queue: timeouts, bounded retries, budget guard, idempotent cache.
5. Voice QC: STT round-trip, duration and silence checks, brand-name verification.

## Phase 3 — Creative Studio experience
Onboarding (website extraction with confirmation), brand profile editing, uploads, storyboard editing,
`@remotion/player` live preview, revision requests in Hebrew → scene diff → partial regeneration, real auth, admin views.

## Phase 4 — Commercial readiness
Billing in ₪, quotas, automated QA, monitoring and alerting, support tools, production deployment (ECS/Fargate + RDS + ElastiCache + S3;
Remotion Lambda evaluated for render bursts).

## Then
The autonomous layer: Meta Ads publishing, performance analysis, creative iteration loop.
