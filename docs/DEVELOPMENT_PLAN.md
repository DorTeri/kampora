# Kampora — Development Plan

## Phase 0 — Foundation ✅ (Increment 1)
Monorepo, docs, Zod contracts, provider interfaces, workflow states, cost design, Docker Compose.

## Phase 1 — First working video pipeline ✅ (Increment 1)
Demo business → brief → 3 concepts → storyboard → production plan → approval → timeline → Remotion render → MP4 → download.
Mock creative provider, demo assets, music bed, Hebrew captions, cost ledger with simulated costs.

## Phase 2a — Real AI creative + Hebrew narration ✅ (Increment 2)
OpenAI structured creative (concepts, script, storyboard) with grounding checks; ElevenLabs Hebrew narration
(per-scene, cached, approval-gated); ffprobe-measured retiming; speech-timed subtitles; music ducking; Hebrew UI
for AI approval, script approval, voice choice, narration preview and production approval.
Mock providers produce the same shapes (and real audio) for paid-free development and tests.

## Phase 2b — Remaining real AI media (next)
1. Listening-test results → choose default voice/model; decide selective niqqud and audio tags.
2. Voice QC: STT round-trip, silence/clipping detection, brand-name verification.
3. One image-generation provider with reference images. One image-to-video provider.
4. Image/video `generation_jobs` worker queue: timeouts, bounded retries, budget guard, idempotent cache.

## Phase 3 — Creative Studio experience
Onboarding (website extraction with confirmation), brand profile editing, uploads, storyboard editing,
`@remotion/player` live preview, revision requests in Hebrew → scene diff → partial regeneration, real auth, admin views.

## Phase 4 — Commercial readiness
Billing in ₪, quotas, automated QA, monitoring and alerting, support tools, production deployment (ECS/Fargate + RDS + ElastiCache + S3;
Remotion Lambda evaluated for render bursts).

## Then
The autonomous layer: Meta Ads publishing, performance analysis, creative iteration loop.
