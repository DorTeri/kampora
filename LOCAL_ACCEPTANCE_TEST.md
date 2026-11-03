# Local acceptance test (owner)

A real, unscripted test on one machine: a new business, a Campaign Director conversation, one finished video. Nothing
here is pre-generated; the conversation and its results are yours.

## 1. Start

Prerequisites: Node 22+, Docker Desktop **running**, ffmpeg/ffprobe on PATH.

```bash
npm install
npm run infra:up            # PostgreSQL :5433 + Redis :6379 (BullMQ)
npm run build:packages
npm run db:migrate
npm run db:seed             # upserts the demo org/business only; other data is untouched
npm run build -w @kampora/api -w @kampora/production-worker -w @kampora/web
```

Then three terminals:

```bash
npm run start -w @kampora/api                # http://localhost:4000  (OpenAPI: /docs)
npm run start -w @kampora/production-worker  # render + narration + image queues
npm run start -w @kampora/web                # http://localhost:3000/studio
```

Smoke check with mock providers only: `npm run e2e:journey` (preview render, $0).

## 2. Required services

| Service | Where | Needed for |
| --- | --- | --- |
| PostgreSQL 17 | docker, `127.0.0.1:5433` | everything (tenant data, ledger, approvals) |
| Redis 7 | docker, `127.0.0.1:6379` | BullMQ jobs (render, narration, images) |
| API (NestJS) | `:4000` | Director, studio, signed media URLs |
| Worker | — | Remotion render, ffmpeg narration, image jobs |
| Web (Next.js) | `:3000` | the studio |

Storage is local disk (`STORAGE_DRIVER=local`, `.data/storage`). Use `127.0.0.1`, not `localhost`, for Docker services.

## 3. Real Director LLM, everything else mock

In `.env` (server-only; never in a `NEXT_PUBLIC_` variable):

```
DIRECTOR_BRAIN=llm
DIRECTOR_LLM_ALLOW_PAID=true
DIRECTOR_LLM_MONTHLY_USD_CAP=1
OPENAI_API_KEY=<key>
KAMPORA_ALLOW_PAID_GENERATION=false   # keeps copy, images, voice and video on mock
CREATIVE_PROVIDER=mock
IMAGE_PROVIDER=mock
TTS_PROVIDER=mock
```

The Director's switches are independent: enabling it never enables paid creative. Restart the API after editing.

Real copy, images and voice (only once you authorize it): `KAMPORA_ALLOW_PAID_GENERATION=true` plus
`CREATIVE_PROVIDER=openai`, `IMAGE_PROVIDER=openai`, `TTS_PROVIDER=elevenlabs` (+ `ELEVENLABS_API_KEY`). Each paid
step still waits for your approval of its quote in the studio. Video rendering is local Remotion: always $0. Restart
the API and the worker after editing.

## 4. Spending caps and switches

| Switch | Effect |
| --- | --- |
| `DIRECTOR_LLM_MONTHLY_USD_CAP`, `DIRECTOR_LLM_MAX_CALLS_PER_CONVERSATION_DAY` | Director spend and call limit |
| `KAMPORA_ALLOW_PAID_GENERATION=true` | master switch for paid copy, images and voice; each still needs your approval in the studio |
| `PROJECT_MAX_BUDGET_USD`, `PER_GENERATION_MAX_USD`, `MAX_GENERATION_ATTEMPTS` | per project / per call / retries |
| `CREATIVE_PROVIDER`, `IMAGE_PROVIDER`, `TTS_PROVIDER` | `mock` (default, $0) or the real provider |

Every call, paid or simulated, is written to the cost ledger (project page → costs).

## 5. Create a new business

Studio → **Director** → **＋ שיחה חדשה**. Describe your business in your own words. The business is created from the
first fact the Director saves; it appears under **Business**. Do not reuse the demo business "Luz".

**Upload your own media before asking for the campaign**: Studio → **Business** (pick your business at the top) →
«העלאת תמונה או סרטון של העסק». JPEG/PNG/WebP up to 20 MB, MP4/MOV up to 100 MB. Choose what it shows (product, place,
people, process); that choice decides which scenes and ads use it. Uploads are marked «שלכם» and the Art and Video
Directors prefer them over stand-ins.

## 6. A real creative-production flow

In the same conversation, ask for a campaign. Approve the Director's proposal in the approvals panel. Then on the
project page: choose a concept → review the storyboard → approve the script → narration (mock, or ElevenLabs after
an explicit quote) → approve → render.

## 7. View and download

- **Studio → Videos** (`/studio/videos`): every render, with a download link (signed URL, served by the API).
- Project page: preview player and costs.
- Missing authentic shots: on the project page, each scene without your own footage shows «📷 צילום אמיתי חסר» with
  the phone instructions and a link to the upload form.
- Files on disk: `.data/storage/`.

## 8. Reset only the test session

Start a new conversation (**＋ שיחה חדשה**): it creates a separate business, and earlier tests stay untouched. There
is no delete endpoint, so nothing can be lost from the UI. Never run `docker compose down -v` (it deletes the
database volume). Don't touch the real-voice projects d30196e6… and f7d1528b….

## 9. Known limitations and blockers

1. **Video uploads are not transcoded.** MP4/MOV must be H.264 (a normal phone recording is; HEVC "high
   efficiency" iPhone clips may not play in the render). Uploads can't be deleted from the UI yet.
2. Mock stand-in images are abstract placeholders, not food. Appetite and craft can't be judged on them.
3. Scene length follows the narration. A short line shortens a planned beat; a craft "process" scene can end up
   about 2.7 s long.
4. Mock narration is silent timing only. Voice quality needs a listening test with real speech.
5. Verified locally on 2026-11-03: Postgres, Redis, API, worker and web start with the steps above, and the DB/Redis
   integration tests pass.

## Proposed real-provider budget (not executed)

| Item | Estimate |
| --- | --- |
| Director LLM (gpt-6-luna), one ~30-turn conversation | ≈ $0.05 |
| Copy LLM (gpt-6.1-terra), brief, concepts and storyboard incl. retries | ≈ $0.35 |
| Narration (ElevenLabs eleven_v3), ~250 chars + 2 retakes | ≈ $0.25 |
| Images (gpt-image-2 medium), 4 scenes, only if no own photos | ≈ $0.35 |
| **Expected total** | **≈ $1.0** |

Suggested caps: `DIRECTOR_LLM_MONTHLY_USD_CAP=1`, `PROJECT_MAX_BUDGET_USD=2`, `PER_GENERATION_MAX_USD=0.5`. Hard
ceiling $3. Image and voice prices are planning estimates; re-check them before approving.
