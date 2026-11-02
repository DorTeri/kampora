# Pilot infrastructure proposal

Status: **proposal, nothing provisioned.** The local database stays local and is not exposed. Prices were read from
the official pricing pages on 2026-11-02 (sources at the end). Workload numbers are estimates.

## What has to run

| Piece | Today | Pilot need |
| --- | --- | --- |
| Web (Next.js) | Vercel, demo mode | Same project, pointed at the API |
| API (NestJS) | Local | 1 small always-on instance (≈0.5 vCPU, 0.5–1 GB) |
| Worker (BullMQ: Remotion render, narration) | Local | ≈2 vCPU / 4 GB **while rendering**. Jobs are 1–5 min, 50–300 a month (≈1–25 render-hours) |
| PostgreSQL | Docker, port 5433 | Small (<5 GB), with daily backups |
| Redis | Docker | Persistent TCP connections: BullMQ polls constantly |
| Media storage | Local disk / S3 driver | 20–100 GB, egress to viewers |

Long Remotion jobs need a worker process, not serverless functions. A queue worker has no request timeout, and
renders can run for minutes.

## Recommendation: Railway (Pro) + Cloudflare R2

The simplest reliable setup: one platform runs the API, worker, Postgres and Redis as services in a private network,
and media goes to R2.

- Railway bills actual CPU and RAM use, so an idle worker costs little, while a rendering worker gets its 2 vCPU /
  4 GB.
- Redis runs as a normal service with persistent connections, which BullMQ needs.
- R2 has no egress fees, and the existing S3 storage driver works with it.
- Pro rather than Hobby: Hobby caps volumes at 5 GB per service, which is too tight for Postgres.

| Item | $/month |
| --- | --- |
| Railway Pro workspace (includes $20 of usage) | 20 |
| Usage: API, worker, Postgres, Redis (est. $10–38; the first $20 is covered) | 0–18 |
| Cloudflare R2, 20–100 GB, no egress fees | 0.15–1.35 |
| Vercel Pro, 1 seat (Hobby is "for personal, non-commercial use") | 20 |
| **Infrastructure total** | **≈ $40–60** |
| Director LLM brain, if enabled after validation (cap) | up to 10 |
| Remotion Company License, only if the company has 4+ people (Automators: $0.01/render, $100/mo minimum) | 0 or 100+ |

Gaps to close when provisioning:

- Railway Postgres is a container with a volume, not a managed database. Add a daily `pg_dump` to R2 (a Railway cron
  service) and test a restore.
- Secrets live only in Railway and Vercel environment variables. The web app talks to the API server-to-server.
  `AUTH_MODE=oidc` is required in production (the API refuses to start otherwise).
- `DEV_API_TOKEN` must not be set in production (also enforced).

## Alternatives compared

| Option | Fixed | Usage (this workload) | Total / month | Notes |
| --- | --- | --- | --- | --- |
| **Railway Pro + R2** | $20 | $0–18 above the included $20 | **≈ $20–40** (+ Vercel $20) | One platform. Backups are ours to set up. |
| Fly.io + Neon + Upstash + R2 | $10 (Upstash fixed) | Fly API $4–7, worker $0.40–2.60 (stops when idle), Neon $4–21 | **≈ $18–42** (+ Vercel $20) | Managed Postgres with branching. Three vendors. Upstash says BullMQ polls "even when there is no queue activity", so it needs the fixed $10 plan, not pay-per-command. |
| Render + R2 | $0–25 workspace | API $7–25, worker $85 (always on, no scale-to-zero), Postgres $7.50–20.50, Key Value $10 | **≈ $110–166** (+ Vercel $20) | Simplest console, but a 2 CPU / 4 GB worker is billed 24/7. |

Fly + Neon costs about the same as Railway and gives a managed Postgres, at the price of three accounts and more
moving parts. Choose it if managed backups matter more than one dashboard.

## What I need approved

1. The host: Railway Pro (recommended) or Fly + Neon + Upstash. About $20–40 a month before Vercel.
2. A Cloudflare R2 bucket (likely within the free tier at first).
3. Vercel Pro, $20 a month, before any commercial pilot use.
4. Whether Kampora has 4+ people. If it does, a Remotion Company License is required for server-side rendering
   (Automators, $100/mo minimum). Remotion's page also mentions an Enterprise tier from $500/mo; confirm with
   Remotion which tier applies.
5. An identity provider for `AUTH_MODE=oidc` (any OIDC provider with RS256/ES256 tokens and a JWKS endpoint).

## Sources (read 2026-11-02)

- Railway: railway.com/pricing, docs.railway.com/reference/pricing/plans
- Render: render.com/pricing, render.com/docs/compute-plans
- Fly.io: docs.fly.io/about/pricing
- Neon: neon.com/pricing
- Upstash: upstash.com/pricing/redis, upstash.com/docs/redis/integrations/bullmq
- Cloudflare R2: developers.cloudflare.com/r2/pricing
- Vercel: vercel.com/pricing
- Remotion: remotion.dev/license, remotion.pro/license

Not confirmed: whether Railway's and Render's Hobby plans allow commercial use (their pages don't say), and real
utilization. The Railway and Neon figures depend on it.
