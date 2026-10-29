# Phase 2.5 + Phase 3: plan and findings

Branch: `feature/phase-2.5-3-production-engine`. Everything in this document runs offline with mock providers.
Paid generation stays off (`KAMPORA_ALLOW_PAID_GENERATION=false`). Every paid step needs a new, explicit approval.

## Order

| Milestone                | Scope                                                                                                                                            | Paid calls                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| A. Natural voice         | Investigate the current TTS; continuous narration; Voice Director (6 styles); Hebrew fixes; voice lab                                            | none (comparison plan below waits for approval) |
| B. Creative intelligence | 8 concept types with objective, audience, insight, hypothesis, hook, structure, emotion, CTA, visual style, format; scene roles; grounded claims | none (mock LLM)                                 |
| C. AI images             | OpenAI image adapter (`gpt-image-2` by default, configurable); `VisualScenePlan`; asset library with fingerprints; approve/regenerate            | none (mock image provider)                      |
| D. Hybrid video          | Motion presets from VideoProject JSON; transitions; generated images in the timeline; image-to-video interface plus a mock that only quotes      | none                                            |
| E. Static ads            | 1:1, 4:5, 9:16; PNG/JPEG; editable JSON composition; RTL                                                                                         | none                                            |
| F. End to end            | Mock journey from brief to video and static ads; real-provider validation plan                                                                   | none (plan waits for approval)                  |

Out of scope: Meta Ads, campaign scheduling, multiple video providers, paid video generation, LLM-written React.

## Milestone A: what we found in the Phase 2 narration

These come from reading the code and the Phase 2 run ($0.35 ElevenLabs `eleven_v3`, one voice):

1. **Each line was recorded separately.** Every scene was a separate TTS request, so the voice restarted its intonation on each line. Nothing carried over from one sentence to the next, which is a large part of why the read sounded like separate announcements.
2. **Trailing ellipses.** Every line except the last had "..." appended to "encourage a pause". On `eleven_v3` this produces a trailing, hesitant ending on every sentence.
3. **Formal prices.** "29.90 ₪" was read as "עשרים ותשעה שקלים ותשעים אגורות". A colloquial option existed but was not used.
4. **Fixed settings.** Stability was fixed at 0.5 and audio tags were off, whatever the ad's tone.
5. **Pauses added by the timeline.** Each scene added a 0.2–0.3 s lead-in and a 0.4 s tail, plus up to 0.8 s of planned pause. With separate clips this gave 0.6–1.4 s of silence between lines.
6. **A date read as a number.** "עד ה-15.11" was read as a decimal ("חמש עשרה נקודה אחת עשרה"). This is now fixed and tested.

## Milestone A: what changed

- **Continuous narration (the default for new recordings).**
  - The whole script goes to the provider as one request.
  - The recording's character alignment maps each script line to its time span.
  - Each cut falls in the middle of the natural pause between two lines and is rounded to a video frame (30 fps).
  - The audio is decoded once to 48 kHz PCM and cut sample-exactly into one WAV per scene. No re-encoding happens and no gaps are added.
  - When the provider returns no alignment, cuts fall on pauses found by ffmpeg `silencedetect`, and the subtitles inside a scene are marked "estimated".
- **Timeline.**
  - Slices play back to back: no lead-in, tail or planned pause, except a 0.3 s opening and the closing CTA hold (at least 4 s).
  - The rules version is now `r6`.
- **Re-recording one line.**
  - `POST /v1/projects/:id/narration/segments/:sceneKey` re-records one line with its own quote and approval.
  - The other slices and the master recording are kept. If the re-recording fails, the previous narration is restored.
- **Voice Director.**
  - Six styles with Hebrew labels: natural, energetic, warm, premium, calm and social.
  - Each style sets how prices are read, the provider stability, punctuation pacing (dashes become commas, no ellipses, "!" softened for calm and premium) and one optional opening audio tag.
  - Audio tags stay off until listening tests show they help.
  - Facts, claims and the on-screen text are never changed: subtitles always use the approved line.
- **Legacy rows.** Narrations stored by Phase 2 have no style and keep their exact Phase 2 preparation.
- **Voice lab** (`/studio/voice-lab`, internal).
  - One fixed script that covers a hook, a brand, a price, a percentage, a date, an address and a CTA.
  - Candidates:
    - A: each configured voice as it is used today.
    - B: the same ElevenLabs voice on `eleven_v4`.
    - C: extra voices from `VOICE_LAB_VOICES`.
  - The page shows provider, model, voice id, the exact text sent, duration and estimated cost, and has an audio player.
  - Ratings from 1 to 5 for Israeli accent, naturalness, emotional delivery, pronunciation and commercial suitability, plus notes.
  - Paid readings need the kill switch on and an approval (`VOICE_TEST`) at least as high as the estimate. They also stay under an org cap (`VOICE_LAB_MAX_USD`, default $1). Identical readings are reused, never paid twice.
- **Consented voice cloning (future).**
  - A cloned voice will be one more `VoiceOption`, with the voice id from the provider.
  - Instant cloning needs the owner's rights confirmation; professional cloning needs the provider's verification.
  - We store the consent record (who, when, the signed text) before the voice can be selected. Nothing is cloned in this phase.

## Paid voice comparison: plan and estimate (waiting for approval)

- **Script.** The lab script is 235 characters after normalization, with tags off.
- **Prices.**
  - Planning price in the catalog: $0.0003 per character (deliberately conservative).
  - ElevenLabs' published API price is $0.08 per 1,000 characters for `eleven_v3` and `eleven_v4`. On a subscription plan this is billed in credits.

| Plan                                                                                                                 | Readings | Characters | Catalog estimate | At the published API price |
| -------------------------------------------------------------------------------------------------------------------- | -------- | ---------- | ---------------- | -------------------------- |
| Minimal: A (current voice, v3) + B (same voice, v4) + C (one other Hebrew voice, v4) × 2 styles (natural, energetic) | 6        | ~1,410     | ~$0.42           | ~$0.11                     |
| With gender balance: add a second C voice so there is at least one male and one female                               | 8        | ~1,880     | ~$0.56           | ~$0.15                     |

Before the run:

1. Choose the C voices. This needs a free shared-library search (`GET /v1/shared-voices?language=he&gender=...`) and a decision on which voices to try.
2. Approve the amount.
3. Turn paid generation on for the session only.

Nothing has been generated. No voice is called "best" until people have listened and rated.

## Milestone C: AI scene images

- **Provider:** OpenAI Images (`gpt-image-2`). The SDK was checked: `images.generate` for text-only prompts, and `images.edit` when the business's product photos are sent as references. `input_fidelity` is not sent, because the SDK says to omit it for gpt-image-2. Output is one JPEG, with SDK retries off. Portrait formats use 1024x1536 and the renderer crops to cover. The default is the free `mock` provider, which makes deterministic brand-coloured placeholders.
- **Planner:** `planSceneVisual` is deterministic, with no LLM. It produces a `VisualScenePlan` covering style, shot, a look shared by all scenes of the ad, brand palette, mood, references, safe zones, an avoid-list that always forbids text, letters, logos and watermarks, the prompt, and a fingerprint. Styles are photographic by default (product or lifestyle photo); illustration only when the concept asks for it.
- **Gating:** API and worker apply the same checks:
  - kill switch
  - an approval for this exact image version at least as high as the estimate
  - per-generation cap
  - project budget: estimated image charges now count toward spend
  - at most 6 versions per scene

  A fingerprint match reuses the existing image and is never paid for twice.

- **Flow:** the image is generated as a new version, and the owner approves or rejects it. Approving re-plans the project: the scene switches to `AI_IMAGE_MOTION` (or parallax) with the image, and the planned generation cost is dropped. The approved images are part of the timeline approval key. Text always stays in Kampora's RTL overlays.
- **Prices** (planning estimates, not re-verified in this session; charges are ESTIMATED): gpt-image-2 at 1024x1536 costs $0.005 (low), $0.041 (medium) and $0.165 (high). Each reference photo adds a planning surcharge of $0.01.

### Real-provider image validation (waiting for approval)

Generate 3 scenes (hook, product with one reference photo, CTA) at `medium` quality, then 1 regeneration. That is 4 calls, about $0.041 × 4 + $0.01 = **about $0.17** (cap of $0.25). People review the images for realism, product fidelity, text-free output and consistency between scenes; passing tests is not enough. This needs `IMAGE_PROVIDER=openai`, `KAMPORA_ALLOW_PAID_GENERATION=true` and your explicit approval.

## Milestone D: hybrid video engine (offline)

- **Fixed renderer, JSON-driven:** every ad is rendered by one tested Remotion composition from the validated VideoProject JSON. No per-ad React is ever generated.
- **Motion router** (`chooseMotion`): deterministic camera moves per framing. It keeps the storyboard's move when it suits the shot, never repeats the previous scene's move, scales intensity with time on screen (gentle on short scenes) and aims the focal point by framing. Camera moves are labelled as camera moves; they never fake subject motion.
- **Transitions** (`chooseTransition`): chosen by role (hook fade, offer zoom, CTA slide-up, crossfade otherwise) and capped at 20% of the scene.
- **Image-to-video:** a new `ImageToVideoProvider` contract (quote → submit with approval → poll). The only implementation is quote-only: it prices real motion with the planning estimate ($0.12/s, billed in 5 s or 10 s clips) and refuses to generate, after first checking the approval. The router never plans generated motion while no provider can generate; those scenes fall back to camera motion with an explicit warning. The Studio shows the quote and says plainly that it is not available yet.
- **Technical timeline QA** (`timelineQa`):
  - **Errors, which block approval:** narration cut off, captions outside their scene.
  - **Warnings:** slow hook, scene too short, transition too long, dead air, silent gaps between lines, same shot repeated, missing or short CTA, total length out of range, music not ducked.

  It does not judge whether the ad is good. Run over the saved timelines, it flags 1.1–2.2 s gaps between lines in the two older line-by-line ElevenLabs projects. The continuous-narration projects are clean.

- Timeline rules are now `r7`, so existing productions show "update production" and are rebuilt with the new motion rules.

### Tests before Milestone E

A full mock run through the API (campaign → concept → images → script → narration → approval → preview and final render) passed, and every guardrail held, including paid-image refusals with the kill switch off. Two fixes came out of it:

- A regenerated scene image now asks for a different camera angle and composition. Before, it reused the rejected prompt, so the mock returned the identical image and a real provider would just have resampled it.
- In the closing scene, the caption is dropped when the CTA card already shows what is said; it was covering the picture and splitting the address into fragments. Narration that adds something new keeps its caption. Timeline rules are now `r8`.

## Milestone E: static image ads

- **Formats:** 1:1 (1080x1080, feed), 4:5 (1080x1350, feed) and 9:16 (1080x1920, Stories), exported as PNG and JPEG (quality 90). Feed formats keep 64 px clear on every side. 9:16 uses the Stories safe area (270 px top, 384 px bottom, 65 px sides), which is stricter than the Reels one, so the same file works in both.
- **Editable representation:** a validated `StaticAd` JSON document per format (shared schema), not pixels. It holds the background image and its focal point, the text layers (headline, sub-headline, price and label, CTA and address, logo on/off) and the brand. Layout comes from one fixed, tested template; free-form positioning is not offered, so text cannot be pushed out of the safe area. Every edit (`StaticAdEdit`, strict and partial) creates a new version, and older versions are kept (up to 20 per format). The same content twice reuses the existing version (content fingerprint).
- **Type scale:** `fitStaticAdType` estimates every block's height conservatively and scales all type together (down to 50%) until the top and bottom blocks fit the safe height with room left for the picture. Prices never wrap away from the ₪, and a short Hebrew prefix never wraps away from its word ("ב-Luz").
- **Builder** (`buildStaticAd`, deterministic, no LLM): it takes the texts from the approved storyboard and brief (hook text as the headline, the offer price as a price tag, CTA plus address, as on the video's CTA card). The background is the approved AI image for the product or hook scene, then the business's own planned photo, otherwise a brand gradient. Only commercially usable images can be used, also when the owner picks a background.
- **Renderer:** one fixed Remotion still composition (`KamporaStaticAd`) rendered with `renderStill` by the worker (`static-ad` job on the render queue), using the same Heebo font and RTL text rules as the video.
- **QA** (`staticAdQa`, warnings shown to the owner in Hebrew): long headline or sub-headline, a crowded square, no photo, a photo enlarged too much for the format (would look soft), repeated text. Missing headline or CTA and backgrounds without commercial rights are rejected by the schema.
- **API and Studio:** `GET/POST /v1/projects/:id/static-ads` (build or rebuild from the approved script) and `PATCH /v1/projects/:id/static-ads/:adId` (edit). The project page shows the three formats with status, version, QA notes, PNG/JPEG downloads and an edit form (texts, logo, background from the business's photos and approved AI images, or the brand colour).
- **Tests:** builder and edit rules (8), layout in headless Chrome for every format with typical and worst-case texts (every glyph inside the safe area, no collision between the blocks) plus RTL reading order, worker job integration (render, store, idempotency, failure handling).
- **Cost:** rendering is local, so it is $0 and nothing paid is involved. Static ads reuse approved images; they never trigger new image generation.
- **Limits:** one layout template; no free positioning or font choice; the focal point can be set through the API but not yet in the UI; the layout tests run without the Heebo font (system fallback), so the real renders were also checked by eye.
