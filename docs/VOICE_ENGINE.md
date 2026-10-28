# Kampora — Hebrew Voice Engine (Phase 2)

```
storyboard voiceover lines (customer-approved script)
  │ normalizeHebrewForSpeech      numbers/₪/%/dates/times/phones → spoken Hebrew, abbreviations,
  │                               business pronunciation dictionary (Luz → לוּז), "+" → "ו"
  │ prepareForProvider            provider/model-aware text: no SSML for eleven_v3/v4, punctuation pauses,
  │                               optional audio tags, optional selective niqqud, speed fixed at 1.0
  │ planNarration                 per-scene segments, characters, speaking-time estimate, script-length check
  ▼
narration job (worker, one at a time)
  │ cache lookup                  sha256(provider, model, TTS, {voiceId, text, settings, outputFormat})
  │ paid re-check                 kill switch + NARRATION approval ≥ estimate + project budget
  │ synthesize (bounded retries)  ElevenLabs /with-timestamps → audio + character alignment
  │ store + ffprobe               measured duration (never the estimate) → generated_assets
  │ buildSpeechCues               subtitle chunks timed against the aligned spoken words
  ▼
approve production → buildVideoProject (scenes retimed to speech) → Remotion (voice + cues + ducking) → MP4
```

## Provider facts (official docs, checked 2026-10-28)

| | eleven_v3 | eleven_v4 | multilingual_v2 |
|---|---|---|---|
| Hebrew (`he`) | ✅ (5,000 chars/request) | ✅ (10,000 chars/request) | ❌ not in its language list |
| SSML `<break>` | ❌ | ❌ | ✅ |
| Audio tags (`[excited]`) | ✅ | ✅ | — |
| Pauses | punctuation / ellipses | punctuation / ellipses | break tags |
| `/with-timestamps` | endpoint exists; per-model support **not documented** | same | — |

Because timestamp support per model is undocumented and `alignment` is nullable, the adapter calls
`/with-timestamps` first and, on a 400/422, falls back once to the plain endpoint for that model (remembered per
process). Without alignment, cues are spread over the **measured** audio length, proportionally to spoken
length (`timing: 'estimated'` in the narration state). That fallback is accurate per scene but not per word.

## Decisions

- **One segment per scene.** Cache-friendly (editing one line re-records one line), and scene boundaries are
  exact. Trade-off: prosody does not flow across scenes as naturally as one continuous read. `previous_text` /
  `next_text` are deliberately not sent, because they would make every segment's cache key depend on its neighbors.
- **No speed-up, no stretching.** The scene grows to `lead-in + speech + tail` (0.3 s / 0.2 s lead-in, 0.4 s
  tail, 1.0 s after the final CTA line). Longer planned visuals stay as a natural pause. A script estimated
  well over the target (`TOO_LONG`) is blocked before any paid call: the customer must shorten it.
- **Niqqud.** Never full-text. The pronunciation dictionary may carry niqqud for brand names. Built-in ambiguous
  ad words (מבצע, הנחה, בוקר…) are flagged, and are vocalized only when `HEBREW_SELECTIVE_NIQQUD=true`, which
  should be enabled only after the comparison test shows it improves the chosen model/voice.
- **Delivery.** `ELEVENLABS_AUDIO_TAGS` is off by default: Hebrew text with English audio tags must be listened
  to before use.
- **Ducking.** Music drops from 0.35 to 0.10 while any narration plays (6-frame attack, 12-frame release).

## Quality: what is and isn't verified

Unit and integration tests verify normalization, provider contracts (mocked HTTP), caching, retries, budget and
approval enforcement, ffprobe measurement and subtitle timing. **Natural Israeli pronunciation is not verified
by tests.** It requires generating real audio and listening:

```bash
npm run voices:list                                   # free: Hebrew voices on the account
npm run voice:compare                                 # dry run: shows plan + estimated cost
npm run voice:compare -- --approve-paid --models=eleven_v3,eleven_v4 --max-generations=8
# → out/voice-compare/<timestamp>/index.html: same sentences per voice/model + niqqud A/B, rate each row
```

Next QC steps (Phase 3): STT round-trip (speech → text → compare with the spoken text), silence/clipping
detection, brand-name verification, and a per-business "approved voice" record.
