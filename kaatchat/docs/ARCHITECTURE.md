# Architecture

```
IMPORT ─▶ MEASURE ─▶ ASK ─▶ PLAN (JSON) ─▶ VALIDATE ─▶ PREVIEW ─▶ APPLY (1 undo) ─▶ REFINE ─▶ EXPORT
 local      local    you    provider        zod          dry-run     store            you        local
```

**The model is the brain, the engine is the hands, and the timeline is the source of truth.**

## Document model (`engine/types.ts`)

- `ProjectDoc` holds the assets, an ordered list of `Clip`s, the aspect, fps and caption settings.
- A clip's `in`/`out` are **source** seconds. Timeline time comes from laying the clips end to end, so ripple edits are simply array operations.
- Derived data such as loudness, framing, thumbnails and transcripts lives in a separate `ProjectIndex`. It is not undoable and is stored per asset, which keeps undo snapshots small.

## Commands (`engine/commands/`)

- `schema.ts` defines every command as a zod object. The same schema validates buttons, shortcuts and AI output, and `COMMAND_DOCS` is the contract shown to models.
- `execute.ts` is a pure `(doc, command, {index, newId}) → {doc, notes}` function. `previewPlan` dry-runs a whole plan and reports each step's notes or error, plus before/after stats.
- `store.ts` commits a list of commands (or a plan) as one transaction. Undo and redo swap immutable documents.

## Measurement (`engine/dsp.ts`, `engine/media.ts`)

- **Loudness:** RMS at 50 frames per second. Level is the power mean of the loudest 40% of frames, and the 90th percentile is the silence reference.
- **Silence:** a threshold relative to that 90th percentile, a minimum gap, and padding next to speech.
- **Framing:** 64×36 greyscale samples. Gradient magnitude plus 2× frame difference, squared, gives a weighted centroid. A clip's focus is the weighted median over its range.
- **Transcripts:** Whisper in a worker at 16 kHz mono, or SRT/VTT import. Word timings map through the edit (`sourceToTimeline`), so cutting words cuts video and captions follow automatically.

## Rendering (`engine/render.ts`)

`drawClipFrame` and `drawCaption` are shared by the preview (`playback.ts`, one `<video>` per asset) and the exporter (`export.ts`: Mediabunny `CanvasSink` → canvas → `CanvasSource`, with sample-exact audio through a streaming resampler and a soft limiter).

## AI (`src/ai/`)

- `types.ts` defines the `AIProvider` interface and capabilities, including generation capabilities that no adapter claims yet.
- `providers.ts` contains the adapters: OpenAI (fetch), Gemini (fetch), Claude (official Anthropic SDK, with a custom `fetch`), Local (Ollama's own API, or the OpenAI-compatible API used by LM Studio, llama.cpp, Jan, vLLM and KoboldCpp; `detectLocalServers` probes their default ports), and Built-in rules.
- `transport.ts` provides one fetch per provider that adds the key at the last moment: in the page for the web build, or in the Electron main process for desktop.
- `planner.ts` handles context building (metadata only), the planning prompt, JSON extraction, validation and one repair round, the rules planner, and footage search.

## Desktop (`desktop/`)

- `main.cjs` serves `dist/` from a privileged `kaatchat://app` origin, holds the keychain, runs the provider proxy, and applies navigation and permission lockdown.
- `policy.cjs` contains the pure checks (path confinement, provider host allowlist, header sanitising) and is unit-tested.
- `preload.cjs` is a sandboxed, typed bridge.
- The NSIS installer is built by electron-builder in CI.
