# Roadmap and status

Status is stated plainly: **Built** means the feature is in the app and covered by tests. **Built, unverified here** means the code is complete but could not be run end to end in the environment it was built in. **Not built** means the UI either hides it or shows it disabled with the reason.

## First release scope (spec §82)

| Must have | Status |
| --- | --- |
| Existing editor (import, timeline, trim, split, undo, export) | Built. E2E: import → reel → export, with ffmpeg verifying the file |
| AI command bar | Built (Ctrl+K). E2E covered |
| Transcript | Built: `.srt`/`.vtt` import (E2E). Local Whisper: **built, unverified here**. Hugging Face was blocked from the build sandbox, so the model download and inference path has not been run. The first real run should be on a normal network |
| Ask Your Footage | Built: keyword search on device (E2E), and model search through any provider (unit + E2E with a mocked provider) |
| AI clip selection | Built: `keep_ranges` from search results or plans, and `select_highlights` (loudness-ranked) |
| YouTube → Reel | Built: one command removes silence, selects highlights, switches to 9:16, applies a content-aware crop and adds captions. E2E covered |
| Captions | Built: 5 styles, word highlight, vertical safe zone, burned in on export |
| Smart cuts | Built (`smart_cuts`, `remove_silence`) |
| Auto reframe | Built: content-aware crop (gradient detail + motion), plus a manual focus point |

## Phases (spec §81)

| Phase | Item | Status |
| --- | --- | --- |
| 1 Foundation | Typed command system | Built: 17 commands, zod-validated, pure executor, atomic plans |
| | AI provider abstraction | Built: Built-in, Local (Ollama), OpenAI, Gemini, Claude |
| | AI settings, BYOK storage | Built: OS keychain on desktop (safeStorage), browser storage on web with a warning |
| | AI command bar | Built |
| 2 Understand | Transcript engine | Whisper worker (unverified here) + SRT/VTT |
| | Speaker detection | **Not built** |
| | Timestamp alignment | Built (word timings, mapped through the edit) |
| | Semantic indexing (embeddings) | **Not built**. Meaning-based search goes through the chosen provider |
| | Ask Your Footage + results | Built |
| | Transcript editing | Built |
| 3 AI editing | Planner, JSON schema, validation, preview, apply, undo | Built. One repair round when a model returns invalid JSON |
| 4 Repurposing | YouTube → Reel / Shorts | Built (single output per command) |
| | Highlights / hooks | Loudness-ranked highlights built. **Hook generator not built** |
| | Batch "one shoot → many pieces" | **Not built** (needs multiple sequences per project) |
| 5 Creative AI | Image/video generation, B-roll, motion graphics, effects, transitions, sound design, music | **Not built**. Shown disabled with reasons. The `Capability` type already names the generation interfaces |
| | Captions | Built |
| | Audio AI | Loudness matching + soft limiter built. Noise reduction and voice isolation **not built** |
| 6 Workflows | Podcast / multicam / talking head / product ad / screen recording / brand kit / templates | **Not built** |
| 7 Production | Crash recovery | Built (autosave slot, Restore / Discard) |
| | Security audit | Done for the Electron shell and AI transport. See SECURITY.md |
| | Accessibility, i18n (en/hi/hinglish) | Built (foundations) |
| | E2E, CI/CD, installer, release | Built. Installer built in CI on Windows; unsigned until signing secrets exist |
| | Proxies, workers for analysis | Whisper runs in a worker. Loudness/framing analysis runs on the main thread in async chunks. **Proxies not built** |
| | Marketing website | The v0.1 Magic Edit page exists separately. **The new §64 site is not built yet** |

## Next, in order

1. Run Whisper end to end on a normal network and add a transcription E2E test that uses a cached model.
2. Multiple sequences per project, so one source can produce many outputs (§12), each an editable timeline.
3. Move loudness and framing analysis into a worker.
4. Multi-track timeline (music, B-roll, titles), then the generation adapters on top of it.
5. Speaker detection and multicam for the podcast workflow.
