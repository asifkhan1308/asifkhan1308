# Security

## v0.1 audit: what was found and what changed

These findings come from the shipped v0.1 installer's `main.js` and `preload.js`.

| v0.1 | Risk | Kaatchat 2 |
| --- | --- | --- |
| `resolveInsideRoot` checked `target.startsWith(ROOT)` with no separator | A request could read from sibling folders whose names start with `dist` | Compares against `ROOT + path.sep`, rejects NUL bytes and bad encodings, and serves regular files only. Unit-tested (`desktop/test/policy.test.cjs`) |
| `sandbox: false` | Preload had full Node access, a larger blast radius | `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, `webSecurity: true` |
| No `will-navigate` guard | The window could be navigated to a remote page that inherits the preload bridge | Navigation outside `kaatchat://app/` is blocked; http(s) links open in the system browser. E2E-tested |
| IPC handlers did not check the sender | Any frame could call them | Every handler checks `senderFrame.url` is the app origin |
| No permission handler | Camera, microphone and other prompts were possible | All permission requests and checks are denied |
| DevTools in the production menu | Not a direct risk, but unnecessary | Only when not packaged |
| Installer `.bat` told users to click "Run anyway" | Trains users to bypass SmartScreen | Releases state plainly that a build is unsigned and publish a SHA-256. Signing is used automatically when credentials exist |

## API keys

- **Desktop:** keys are encrypted with Electron `safeStorage` (DPAPI / Keychain / libsecret) in `userData/provider-keys.json` (mode 600). If no OS store is available, keys are **not saved**. The page can ask whether a key exists, but can never read one.
- **AI requests on desktop** are made by the main process. It checks that the URL's host is exactly that provider's host (`api.openai.com`, `generativelanguage.googleapis.com`, `api.anthropic.com`, or localhost for Local). It rejects any credentials in the URL, strips every auth header the page supplied, adds the stored key, and does not follow redirects. A compromised page cannot send your OpenAI key anywhere but OpenAI.
- **Web:** keys stay in this browser (localStorage, or sessionStorage for "this session only") and are sent only to the provider. The settings page says plainly that code on the page could read them.
- No key is shipped in any build, and there is no Kaatchat server.

## AI output

- Models can only return JSON. It is parsed by a bounded extractor and validated against a strict zod schema: a discriminated union of 17 commands, `.strict()` objects (unknown fields are rejected), bounded numbers, and at most 40 commands.
- Execution is a pure function over the document. There is no `eval`, no dynamic code and no shell; ESLint enforces `no-eval`, `no-implied-eval` and `no-new-func`.
- A plan is dry-run before it is shown, it applies atomically (all or nothing), and it can never empty the timeline.
- Search results from a model are validated too, and their times are clamped to the edit.

## Web

- A Content-Security-Policy meta tag limits scripts to `'self'` (plus `wasm-unsafe-eval` for WebCodecs/ONNX) and connections to the provider hosts, localhost:11434 and the model CDN.
- Project files are revived through a validator (`reviveProject`).

## Desktop updates

- The app asks for updates only when it starts (this can be turned off in Settings → Updates) or when the person chooses Check for updates. The request sends no data except the app's version, which is in the User-Agent.
- The update source is the release manifest on the main branch (`site/release.json`, the same file the website's Download button reads). If that manifest can't be read, the app falls back to the GitHub releases API. Only tags named `kaatchat-v<semver>` in this repository count. People on a stable version are offered only stable versions.
- Installers are downloaded only from `https://github.com/asifkhan1308/asifkhan1308/releases/download/kaatchat-v…` (`isAllowedDownload` in `desktop/policy.cjs`, unit-tested). Each installer is hashed while it downloads and must match the SHA-256 in the manifest, or in the release's `SHA256SUMS.txt`. If it doesn't match, the file is deleted and never run.
- Nothing is downloaded or run until the person chooses Install. Only a packaged Windows build runs the installer itself; every other build opens the release page instead.
- Until the installer is code-signed, the checksum proves the file is the one CI published, not who published it. Signing (the `WIN_CSC_LINK` secret) adds that.
