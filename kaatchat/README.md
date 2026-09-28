# Kaatchat 2

**Talk to your footage.** A local-first, AI-native video editor. Your footage never leaves your device.

| | |
| --- | --- |
| **Owner** | Asif Khan |
| **Version** | 2.0.0-alpha.1 |
| **Licence** | MPL-2.0 (see `LICENSE`). Built on Mediabunny (MPL-2.0), with thanks to WolfCut (MPL-2.0). |
| **Platforms** | Web app and Windows desktop (Electron), one codebase |
| **Status** | Phase 1 foundation plus the §82 first-release scope. See [docs/ROADMAP.md](docs/ROADMAP.md) for exactly what is and is not built. |

> **About this codebase.** Kaatchat 2 is a clean rebuild. The v0.1 TypeScript source was not available, only its built bundle and installer, so the engine was rewritten rather than patched. It keeps v0.1's product rules, design tokens, logo, fonts, silence presets, −18 dBFS level target, aspects and export presets. It also carries forward (and fixes) v0.1's Electron shell: see [docs/SECURITY.md](docs/SECURITY.md).

## Product rules

1. **No fake functionality.** Features that are not built are hidden or shown disabled with the reason ("Generate B-roll: needs an image/video generation provider adapter, not in this build").
2. **Name things honestly.** Auto reframe is a *content-aware crop* (gradient detail + motion), not face tracking. Keyword search is labelled as keyword search.
3. **No invented progress.** Jobs report measured progress (seconds decoded, frames encoded) or an indeterminate state, never a made-up percentage.
4. **Local means local.** Media is decoded, measured, transcribed and encoded on the device. AI providers receive only metadata.
5. **AI proposes; the engine executes.** Models return a JSON edit plan. It is validated against a strict schema, previewed, and applied only when you confirm, in one undo step.

## What works today

- **Editor:** import (video and images), filmstrips and waveforms, drag to reorder, trim handles, split, delete, frame stepping, undo/redo, named versions, 16:9 / 9:16 / 1:1 / 4:5.
- **Measurement (local):** loudness envelope, silence detection (Natural / Balanced / Aggressive), clip levels, content-aware framing, thumbnails. All run in a cancellable job queue.
- **Transcripts:** local Whisper (transformers.js + ONNX Runtime Web, in a worker), or import `.srt` / `.vtt`.
- **Transcript editing:** click a word to jump, shift-click to select, delete to cut the video. One click removes filler words.
- **Captions:** Minimal, Clean, Podcast, Bold and Kinetic styles, derived live from the transcript through the edit and burned in on export. Vertical safe zone.
- **AI Studio:**
  - The ✦ command bar (Ctrl+K), plus Ask, Find, Clip and History tabs.
  - Plan preview ("Kaatchat wants to: …", before/after length, clips and aspect), then Apply, Cancel, Modify or Regenerate. Simple setting changes apply in one click with Undo.
- **Ask your footage:** keyword search on the device, or meaning-based search with an AI provider. Results are timestamped; keep them (builds the edit) or cut them.
- **One-command reels:** "Turn this into a 30 second Reel" removes silence, keeps the most energetic moments, switches to 9:16, applies a content-aware crop and turns on captions.
- **AI providers:**
  - Built-in rules (offline, no model).
  - Local, any Ollama-compatible server.
  - OpenAI, Google Gemini and Anthropic Claude, all with your own key. Each has a connection test and a privacy description.
- **Export:** MP4 (H.264/AAC where the platform has them) or WebM (VP9/Opus). Instagram / YouTube / TikTok presets, project size or a custom size. Quality, fps and framing settings. Encoded locally.
- **Projects:** stored in IndexedDB, with an autosave slot and crash recovery ("Recovered project — Restore / Discard"). Media over 420 MB is used for the session and relinked on reopen.
- **Privacy Center:** exactly what stays and what leaves, for the current settings.
- **Accessibility and languages:** keyboard shortcuts, focus states, labelled controls, accessible dialogs, high contrast, reduced motion, UI scale. English, Hindi and Hinglish strings.

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
│   ├── export.ts        decode → compose → encode (Mediabunny / WebCodecs)
│   ├── jobs.ts          cancellable job queue with measured progress
│   └── persist.ts       IndexedDB projects, autosave, media, index
├── ai/                provider abstraction, BYOK keys, transport, planner
├── app/               session glue, preferences, AI settings state
├── ui/                React shell (Home, Editor, Timeline, Studio, Settings, Privacy…)
├── i18n/              en / hi / hinglish
└── platform/desktop.ts  the typed Electron bridge
desktop/               Electron main, sandboxed preload, security policy, NSIS config
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

To turn on the web download button, set `windowsUrl` and `sha256` in `public/release.json` to the release asset.

## Licences

Kaatchat is MPL-2.0. Mediabunny is MPL-2.0. transformers.js and ONNX Runtime Web are Apache-2.0 / MIT. Inter and JetBrains Mono are SIL OFL 1.1, and their licence files ship next to the fonts in `public/fonts/`.
