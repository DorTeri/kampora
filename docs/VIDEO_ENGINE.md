# Kampora — Hybrid Video Production Engine

## Pipeline

```
Storyboard (what each scene must show)
   │  Production Router (rule-based, per scene)
   ▼
ProductionPlan (strategy, assets, planned generations, estimated cost, warnings)
   │  approval ─ budget guard ─ generation jobs (Phase 2)
   ▼
VideoProject JSON (source of truth, versioned as TimelineVersion)
   │  Remotion compositions (fixed, tested component set)
   ▼
MP4 (preview 540×960, or final 1080×1920 @ 30 fps, H.264)
```

## Production strategies

| Strategy | When | Cost |
|---|---|---|
| `EXISTING_VIDEO` | Usable customer or stock footage exists | render only |
| `EXISTING_IMAGE_MOTION` | Usable image exists; motion is camera-like (zoom, pan, reveal) | render only |
| `LAYERED_PARALLAX` | Image exists and the scene calls for depth | render only |
| `MOTION_GRAPHICS` | Text, offer or CTA-led scenes, or as a budget fallback | render only |
| `AI_IMAGE_MOTION` | No suitable image; one is generated, then animated programmatically | image generation |
| `AI_IMAGE_TO_VIDEO` | **Real** subject motion is required (people, physical action) | i2v seconds (+ image) |
| `AI_TEXT_TO_VIDEO` | Only if explicitly enabled as a premium option and nothing else fits | t2v seconds |

**The hard limit:** FFmpeg and Remotion animate *existing* pixels: camera moves, layers, typography.
They cannot invent unseen human movement from a still. When a scene sets `requiresHumanMotion` or `requiresComplexAction`,
the router either finds real footage, plans `AI_IMAGE_TO_VIDEO` within budget, or **downgrades with an explicit warning**.
It never pretends a Ken Burns move is a person walking.

Router inputs: scene requirements, available commercial-use assets, the quality tier, the remaining budget, per-generation limits,
and whether premium text-to-video is allowed. The output is deterministic, so the same input always produces the same plan.
Historical acceptance rates can tune it later.

## VideoProject model (`@kampora/shared/video-project`)

- `output`: 1080×1920, 30 fps, h264, crf.
- `safeArea`: Reels safe zones. Text and captions are kept inside them.
- `branding`: colors, font (Heebo), logo.
- `assets[]`: storage keys + **provenance** (source, license, commercial use).
- `scenes[]`: duration in frames, a `visual` (image-motion / video / motion-graphics), `overlays` (headline, price tag, CTA, logo),
  a `caption` (readable Hebrew without niqqud), an optional `voiceover` asset, and a `transition`.
- `audio.music`: an optional music bed with fades.

Text is **never** baked into generated images. Headlines, prices and CTAs are live text layers, so revisions are cheap.

## Composition library (`packages/video-renderer/src/remotion`)

`KamporaAd` → `SceneView` → {`ImageMotionScene`, `VideoScene`, `MotionGraphicsScene`} + {`HeadlineOverlay`, `PriceTag`,
`CtaOverlay`, `LogoBadge`} + `AnimatedCaption` + per-scene voiceover `Audio` + music bed.
Motion presets: `ken-burns-in`, `ken-burns-out`, `pan-left`, `pan-right`, `cinematic-zoom`, `product-reveal`, `parallax`, `static`.
Images that are not 9:16 get a blurred cover backdrop, with the sharp image fitted on top (aspect-ratio handling).

## Revisions

Each scene's content hash covers its spec. A revision diffs the storyboards, invalidates only the scenes whose
visual, voice or text layers changed, and writes a new TimelineVersion. Unchanged assets are reused.

## Rendering in the worker

1. Load the TimelineVersion and validate it with Zod.
2. Download the referenced assets into a temp dir (MIME and size checked), and serve them on `127.0.0.1:<random>`.
   This needs no API dependency, and long renders can't hit expiring URLs.
3. `bundle()` once per worker process, then `selectComposition` → `renderMedia`.
4. Upload the MP4, update `render_jobs`, and record the render compute cost as `SIMULATED` (local compute).
