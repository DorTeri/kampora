# Kampora

AI advertising agency for Israeli SMBs: Hebrew-first Creative Studio that turns a business goal into a
ready-to-post 9:16 video ad. This is **Increment 1** (Phase 0 + Phase 1): a working local pipeline.

```
business → brief → 3 concepts → storyboard → production plan → approval → VideoProject → Remotion → MP4
```

Docs: [Product](docs/PRODUCT.md) · [Architecture](docs/ARCHITECTURE.md) · [Video engine](docs/VIDEO_ENGINE.md) ·
[Cost model](docs/COST_MODEL.md) · [AI workflows](docs/AI_WORKFLOWS.md) · [Plan](docs/DEVELOPMENT_PLAN.md)

## Prerequisites

- Node.js ≥ 22 (developed on 24), npm ≥ 10
- Docker (Postgres 17 + Redis 7 via `docker compose`)
- Network access on first render (Remotion downloads Chrome Headless Shell; fonts come from Google Fonts)

## Quick start

```bash
npm install
cp .env.example .env            # defaults work for local dev
npm run infra:up                # postgres on :5433, redis on :6379
npm run build:packages
npm run db:migrate
npm run db:seed                 # demo business "Luz" + demo media
npm run build -w @kampora/api -w @kampora/production-worker -w @kampora/web
```

Run each in its own terminal:

```bash
npm run start -w @kampora/api              # http://localhost:4000  (OpenAPI: /docs)
npm run start -w @kampora/production-worker
npm run start -w @kampora/web              # http://localhost:3000  (Hebrew RTL studio)
```

### Just render a video (no DB, Redis or API)

```bash
npm run build:packages && npm run build -w @kampora/production-worker
npm run render:demo             # → out/kampora-demo-final.mp4   (add `-- preview` for 540×960)
```

### Verify

```bash
npm test                        # unit tests (Hebrew voice, cost, router, timeline, storage, assets, ...)
npm run lint
npm run typecheck
npm run e2e:journey             # full API journey against running api + worker (preview render)
node scripts/e2e-journey.mjs final
```

## What's real vs simulated (Increment 1)

| Area | Status |
|---|---|
| Rendering (Remotion, H.264/AAC, 1080×1920@30) | **Real** |
| Hebrew RTL subtitles, motion presets, parallax, motion graphics, price/CTA overlays | **Real** |
| Hebrew speech normalization (numbers, ₪, %, dates, times, phones, abbreviations, gender agreement) | **Real**, unit-tested; not yet fed to a TTS call |
| Production router, planner, budget guard, ledger, idempotency | **Real** |
| Postgres schema + migrations, BullMQ jobs, signed media URLs, tenant scoping | **Real** |
| Creative steps (brief / concepts / storyboard) | **Simulated**: deterministic mock LLM, `SIMULATED` costs |
| ElevenLabs TTS adapter | Implemented against current docs, **never invoked** (no key; paid calls gated) |
| Music | Synthesized demo bed (labeled `PROGRAMMATIC`) |
| Images | Original demo illustrations (labeled `DEMO`) |
| Auth | **Dev-only** bearer token mapped to the seeded user (refused in production) |
| Image / image-to-video generation, real LLM | Not implemented (Phase 2) |

## Windows notes

- If a native Postgres already uses 5432, compose maps Kampora's to **5433** (default in `.env`).
- Use `127.0.0.1` (not `localhost`) for Docker services: some Docker Desktop setups reset IPv6 forwarded connections.
- If the repo lives in a very deep path, Chrome Headless Shell can exceed the 260-char process path limit. Copy
  `node_modules/.remotion/chrome-headless-shell/<platform>/…` to a short path and set `REMOTION_BROWSER_EXECUTABLE`.
- MinIO's public images now require registry auth, so local dev uses `STORAGE_DRIVER=local` (HMAC-signed URLs served
  by the API). `STORAGE_DRIVER=s3` works against AWS S3 or any S3-compatible endpoint.

## License note

Remotion requires a company license for for-profit organizations with more than 3 people. Review before launch.
