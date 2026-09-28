# Kaatchat 2

**Shoot once. Edit intelligently. Create more.** A local-first video editor with an AI assistant. Your footage never leaves your device.

| | |
| --- | --- |
| **Owner** | Asif Khan |
| **Version** | 2.0.0-alpha.1 |
| **Licence** | MPL-2.0 (see `LICENSE`). Built on Mediabunny (MPL-2.0), with thanks to WolfCut (MPL-2.0). |
| **Platforms** | Web app and Windows desktop (Electron), one codebase |
| **Status** | The agreed v2 scope is built and tested. See [docs/ROADMAP.md](docs/ROADMAP.md) for exactly what is and is not built. |

> **About this codebase.** Kaatchat 2 is a clean rebuild. The v0.1 TypeScript source was not available, only its built bundle and installer, so the engine was rewritten rather than patched. It keeps v0.1's product rules, fonts, silence presets, −18 dBFS level target, aspects and export presets. The look follows the Main design canvas (monochrome), and the logo is a vector trace of the supplied mark. It also carries forward (and fixes) v0.1's Electron shell: see [docs/SECURITY.md](docs/SECURITY.md).

## Product rules

1. **No fake functionality.** Features that are not built are hidden or shown disabled with the reason ("Generate B-roll: needs an image/video generation provider adapter, not in this build").
2. **Name things honestly.** Auto reframe is a *content-aware crop* (gradient detail + motion), not face tracking. Keyword search is labelled as keyword search.
3. **No invented progress.** Jobs report measured progress (seconds decoded, frames encoded) or an indeterminate state, never a made-up percentage.
4. **Local means local.** Media is decoded, measured, transcribed and encoded on the device. AI providers receive only metadata.
5. **AI proposes; the engine executes.** Models return a JSON edit plan. It is validated against a strict schema, previewed, and applied only when you confirm, in one undo step.

## What it does

- **Editor:** video, image and audio import; filmstrips and waveforms; trim, split, reorder; undo/redo and named versions; 16:9 / 9:16 / 1:1 / 4:5; **multiple sequences per project**.
- **Measured on your machine:** loudness, silence, beats (tempo and grid), content-aware framing and thumbnails, in a cancellable job queue with real progress.
- **Transcripts:** local Whisper, or `.srt`/`.vtt` import. Delete words to cut the video, remove fillers in one click, and captions follow the edit (five styles, word highlight).
- **AI Studio:**
  - **Ask:** a request becomes a validated plan that you preview, then apply in one undo.
  - **Find:** timestamped moments you can keep, cut, or turn into a new sequence.
  - **Repurpose:** N clips → N finished sequences, plus hook suggestions.
  - **Brand, Clip, History:** the Brand Kit, the inspector, and edit history.
- **Magic Edit commands:** remove silence, smart cuts, match levels, reframe, highlights, sync to beat, fades, ducking, looks, transitions, punch-ins, titles, brand. Twenty-six typed commands in all.
- **Music:** a music track with a beat grid, ducking under speech, fades, and mute/solo for each track.
- **Motion:** text, shape and logo layers with keyframes, easing, masks and animation presets. Transitions: dissolve, fade, slide, zoom, blur and whip. Effects and one-click looks.
- **Podcast / talking head:** a one-command clean-up (pauses, fillers, levels, punch-ins, captions). A clip can switch to another camera, lined up by cross-correlating the audio.
- **Brand Kit:** logo, colours, an uploaded font, caption style, lower third, watermark, intro/outro. Apply it to one sequence or all of them.
- **AI providers:** Built-in rules (offline), Local (Ollama-compatible), OpenAI, Google Gemini and Anthropic Claude, each with your own key.
- **Export:** MP4 or WebM with presets. One sequence, or **all sequences** in a batch. Encoded locally, with a streaming mixer for the audio.
- **Projects:** IndexedDB storage, autosave, and crash recovery.
- **Also:** a Privacy Center; light and dark monochrome themes; English, Hindi and Hinglish; accessibility settings.

What is *not* in v2, and why, is in [docs/ROADMAP.md](docs/ROADMAP.md).

## Architecture

```
src/
├── engine/            pure TypeScript — no React
│   ├── types.ts         document model (clips in source time), index data
│   ├── timeline.ts      pure timeline ops (split, trim, ripple, keep/remove ranges)
│   ├── commands/        typed command schema (zod) + pure executor + plan preview
│   ├── store.ts         immutable document, transactions, undo/redo, versions
│   ├── dsp.ts           loudness, silence, framing, crop maths
│   ├── audio.ts         streaming resampler, gain with soft limiter
│   ├── media.ts         import, measurement jobs, Whisper orchestration
│   ├── transcribe.worker.ts  local Whisper
│   ├── transcript.ts    segments, SRT/VTT, caption cues through the edit
│   ├── render.ts        frame + caption composition (shared by preview and export)
│   ├── playback.ts      preview transport
│   ├── export.ts        frame-driven compositor → encode (Mediabunny / WebCodecs)
│   ├── mixer.ts         streaming audio mixer (main + music, fades, ducking, mute/solo)
│   ├── motion.ts        keyframes, easing, overlays, effects, transitions
│   ├── beats.ts         onsets, tempo, beat grid, snapping, ducking envelope
│   ├── repurpose.ts     candidate moments, finished shorts, hooks
│   ├── brand.ts         Brand Kit application
│   ├── multicam.ts      audio-based angle sync
│   ├── jobs.ts          cancellable job queue with measured progress
│   └── persist.ts       IndexedDB projects, autosave, media, index
├── ai/                provider abstraction, BYOK keys, transport, planner
├── app/               session glue, preferences, AI settings state
├── ui/                React shell (Home, Editor, Timeline, Studio, Repurpose, Brand, Settings, Privacy…)
├── brand/mark.ts      the Kaatchat logo mark (vector)
├── i18n/              en / hi / hinglish
└── platform/desktop.ts  the typed Electron bridge
desktop/               Electron main, sandboxed preload, security policy, NSIS config
site/                  static marketing site (no build step, no external requests)
tests/unit/            engine, AI planner, transport (Vitest)
tests/e2e/             real Chromium + real media, exports checked with ffmpeg
tests/desktop/         launches the real Electron app
```

The full walk-through is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
npm run lint
npm run typecheck
npm test             # unit tests
npm run build
npm run e2e          # needs ffmpeg on PATH (or FFMPEG=/path/to/ffmpeg)
```

Desktop:

```bash
npm run build
cd desktop && npm install
npm start            # runs Electron against ../dist
npm test             # security policy tests
npm run dist:win     # NSIS installer in desktop/release/ (Windows or CI)
```

`npx playwright test -c playwright.desktop.config.ts` (with `xvfb-run -a` on Linux) runs the Electron smoke tests.

## Release

CI (`.github/workflows/kaatchat.yml`) runs lint, typecheck, unit, build, web E2E and the desktop smoke tests. Pushing a tag `kaatchat-vX.Y.Z` builds the Windows installer and publishes it to a **GitHub Release** with `SHA256SUMS.txt`, but only if every test passed. Installers are never committed to git. The build is signed automatically when `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` secrets exist. Until then it is published as **unsigned** and says so.

To turn on the download buttons, set `windowsUrl` and `sha256` in `public/release.json` (the app) and in `site/release.json` (the website) to the release asset. Set `appUrl` in `site/config.js` once the web editor is deployed. See [site/README.md](site/README.md).

## Licences

Kaatchat is MPL-2.0. Mediabunny is MPL-2.0. transformers.js and ONNX Runtime Web are Apache-2.0 / MIT. Inter and JetBrains Mono are SIL OFL 1.1, and their licence files ship next to the fonts in `public/fonts/`.
