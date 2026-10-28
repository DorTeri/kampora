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
