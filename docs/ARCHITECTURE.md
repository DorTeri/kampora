# Kampora — Architecture

A **modular monolith** in a TypeScript monorepo: one API process plus one background worker process.
Domain logic lives in framework-free packages, so the API, the worker, seed scripts and tests all share it.

```
apps/
  web/                Next.js 16 (App Router), Hebrew RTL UI. Talks to the API server-side only.
  api/                NestJS 11 REST API (/v1, OpenAPI at /docs). Orchestrates the studio workflow.
  production-worker/  BullMQ worker. Renders VideoProjects with Remotion → MP4 → storage.
packages/
  shared/             Zod contracts: BusinessProfile, CampaignBrief, Concept, Storyboard, VideoProject,
                      ProductionPlan, workflow states. Isomorphic (safe in the browser).
  hebrew-voice/       Hebrew speech normalization, pronunciation dictionary, provider-specific text prep,
                      TTS adapters (ElevenLabs, supplied narration).
  cost-engine/        Price catalog (estimates), budget guard, ledger summaries, idempotency keys.
  production-engine/  Rule-based Production Router, production planner, storyboard → VideoProject builder,
                      scene invalidation (content hashes).
  creative-engine/    Bounded AI reasoning steps (brief, concepts, storyboard) + deterministic mock provider.
  media-providers/    Provider contracts (LLM, image, video) + mocks.
  storage/            Storage drivers: S3 (prod / any S3-compatible) and local disk with HMAC-signed URLs (dev).
  video-renderer/     Remotion compositions (the tested component library) + Node render API.
  database/           Drizzle schema, SQL migrations, tenant-scoped repositories, demo seed.
```

Dependencies flow downward only: `apps → engines → shared`. `shared` depends on nothing but Zod.

## Key decisions

| Decision | Choice | Why / trade-off |
|---|---|---|
| Monorepo tooling | npm workspaces + `tsc -b` project references | Zero extra tooling, and incremental type-safe builds. Turborepo can be added when CI time matters. |
| ORM | **Drizzle** (over Prisma) | The schema is plain TS, so there are no query-engine binaries in workers or render containers. It generates SQL migrations we can review, and gives first-class `jsonb` typing for the VideoProject. Trade-off: relation queries are less magical than Prisma's, and we write slightly more SQL-shaped code. |
| Module format | CommonJS packages compiled to `dist/` | Nest's decorator metadata needs `tsc`. Next and Remotion's webpack consume CJS without friction. |
| Contracts | Zod 4 schemas in `@kampora/shared` | One source for runtime validation, TS types and OpenAPI (`z.toJSONSchema`). |
| Queue | BullMQ on Redis | Persistent jobs, retries with backoff, and `jobId` dedupe give idempotent enqueueing. |
| Rendering | Remotion 4 + FFmpeg | Reusable React compositions driven by JSON. The AI never writes React. |
| Storage | `StorageDriver`: S3 in production, local disk in dev | MinIO's public images now require registry auth, so dev defaults to the local driver (HMAC-signed, expiring URLs served by the API with Range support). The S3 driver (presigned URLs) is implemented but has **not yet run against a live bucket**. |
| Auth (Increment 1) | Dev bearer token → seeded user | Clearly labeled dev-only and refused when `NODE_ENV=production`. Real auth is a Phase 3 item. |

> **Remotion license:** Remotion is free for individuals and for companies of up to 3 people. Larger for-profit companies need a company license. Check this before commercial launch.

## Request and job flow

```
web (server actions) ──Bearer──▶ api ──▶ Postgres (Drizzle, every query scoped by org_id)
                                   │
                                   └─▶ BullMQ "render" (jobId = renderJobId) ──▶ production-worker
                                                                                   ├─ download assets → temp dir (validated)
                                                                                   ├─ serve them on 127.0.0.1:<random>
                                                                                   ├─ Remotion renderMedia → MP4
                                                                                   ├─ upload to S3/MinIO
                                                                                   └─ render_jobs + cost_ledger updated
```

The browser never sees the API token or provider secrets. It gets short-lived signed media URLs only.

## Security baseline

- Every tenant table carries `org_id`. Repositories require an `AuthContext` and always filter by it.
- Request bodies are validated with Zod. Rate limiting uses `@nestjs/throttler`.
- Storage keys are validated: no traversal, and only allowed characters.
- Media URLs are signed and short-lived (S3 presign, or an HMAC for the local driver).
- The worker renders only validated `VideoProject` JSON with a fixed component set. It never evaluates generated code.
- Customer-supplied assets are size-limited and MIME-checked before rendering.
- Paid generation passes through the budget guard and requires an explicit approval record.
