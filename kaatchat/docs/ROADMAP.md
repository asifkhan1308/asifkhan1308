# Kaatchat 2.0 — scope and status

**Shoot once. Edit intelligently. Create more.**

The v2 scope is deliberately realistic: the editor does the editing, and AI chooses, plans and explains. Status below uses three labels:

- **Built:** in the app and covered by tests.
- **Built, unverified here:** the code is complete but could not be run end to end in the build environment.
- **Not in v2:** hidden, or shown disabled with the reason.

## Build (v2)

| # | Area | Status |
| --- | --- | --- |
| 1 | Core editor: import video, images and audio; timeline; trim; split; reorder; undo/redo; waveforms; filmstrips; scrubbing; four aspect ratios; local export | Built |
| 2 | Magic Edit: remove silence, smart cuts, loudness matching, auto reframe (content-aware crop), beat sync, punchy/clean/cinematic pacing | Built |
| 3 | Ask Your Footage: timestamped moments → keep, cut, or **new sequence** | Built (keyword search on device; meaning-based with a provider) |
| 4 | Transcript editing: remove words and sentences, fillers, silence; captions | Built. `.srt`/`.vtt` import tested end to end. Local Whisper: **built, unverified here** (Hugging Face was blocked in the build sandbox) |
| 5 | YouTube → Reel | Built (one command; E2E) |
| 6 | YouTube → Shorts | Built (same pipeline, any aspect) |
| 7 | Multiple clips from one video → separate sequences | Built (Repurpose; one undo; E2E) |
| 8 | Hook suggestions (user chooses; nothing called "viral") | Built |
| 9 | AI content search | Built |
| 10 | Auto captions: styles, word highlight, safe zones | Built (captions from any transcript; Whisper as above) |
| 11 | Auto reframe 16:9 → 9:16 / 4:5 / 1:1 | Built |
| 12 | AI editing commands (command bar → validated plan → preview → apply → undo) | Built — 26 typed commands |
| 13 | Gemini, OpenAI, Claude and Local AI (Ollama and OpenAI-compatible servers, auto-detected) providers, plus built-in rules | Built. Providers tested with mocked endpoints; the desktop proxy with the real Electron app |
| 14 | Basic motion: text/shape/logo layers, keyframes, easing, masks, presets (fade, slide, scale, pop, typewriter, blur, tracking, kinetic) | Built |
| 15 | Basic effects: brightness, contrast, saturation, exposure, blur, sharpen, vignette, grain, opacity, tint; one-click looks | Built |
| 16 | Transitions: dissolve, fade, slide, zoom, blur, whip | Built. Export uses media handles; preview uses held frames |
| 17 | Audio: normalization, silence detection, fades, music ducking, gain, mute/solo, background-noise reduction | Built. Noise reduction is spectral gating from a measured noise profile, the same code in preview (AudioWorklet) and export; tested on real exports |
| 18 | Podcast / talking-head: transcript, silence and filler removal, punch-ins, captions, clip extraction, manual camera switching (lined up by sound) | Built. Speaker labels: **not in v2**, because nothing here makes them reliable |
| 19 | Batch repurposing → export queue | Built (Export → All sequences) |
| 20 | Brand Kit: logo, colours, font (including upload), caption style, lower third, watermark, intro/outro, "use my brand" | Built |
| — | Monochrome brand, new logo mark, light/dark themes | Built |
| — | Windows installer, web app, marketing site, docs, security, tests | Built. The installer is built by CI on Windows and published unsigned until signing secrets exist |

## Later (not v2)

AI image generation · AI video generation · generative B-roll · AI music · AI sound effects · full colour grading · object tracking · face and emotion detection · AI multicam director · product-commercial generation · motion-graphics generator · AI thumbnails · templates marketplace · collaboration · cloud projects.

## Not building

AI-generated movies, After Effects / Premiere / DaVinci replacements, fully autonomous editing without review, AI 3D, automatic VFX, a music platform, a stock marketplace, a social network, a team platform, or complicated cloud infrastructure.

## Known limits

- Loudness, beat and framing analysis runs on the main thread in async chunks. Whisper runs in a worker.
- Browser storage keeps media up to 420 MB per file. Larger files work for the session and need relinking after a reload.
- Named versions last while a project is open.
- Transitions in the preview hold the first or last frame. The export renders them fully.
