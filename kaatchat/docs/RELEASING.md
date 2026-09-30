# Releasing Kaatchat

Everything below runs in GitHub Actions (`.github/workflows/kaatchat.yml` and
`kaatchat-pages.yml`). What each run proves, and the few things only the owner
can do, are listed here.

## What every run checks

| Job | What it proves |
| --- | --- |
| Web | lint, typecheck, unit tests, build, browser tests with real media (exports checked by ffmpeg), and **real Whisper**: real speech (espeak-ng) is transcribed by the downloaded model |
| Desktop | security-policy tests, and the Electron app launched and driven (import, H.264 + AAC export, local AI through the main process, update check) |
| Windows installer | the NSIS installer is built on Windows, **installed silently**, the installed `Kaatchat.exe` is launched and tested (packaged, per-user data folder, DPAPI key storage, H.264 + AAC export with Windows' own codecs, update check), then **uninstalled** and checked gone |
| macOS app | Apple Silicon and Intel `.dmg` built; each app's architecture and code signature checked; the Apple Silicon app copied into Applications, launched and tested (packaged, per-user data folder, Keychain key storage, H.264 + AAC export, update check) |
| Live AI providers | real requests to OpenAI / Gemini / Claude — only for the providers whose key secrets exist (see below) |

## Publish a new version

1. Bump `version` in `kaatchat/package.json` and `kaatchat/desktop/package.json`
   (and `README.md`). A published version is never rebuilt, so every release
   needs a new number.
2. Merge to `main`.
3. Actions → **Kaatchat** → Run workflow on `main` with **publish** ticked. It
   tests everything, builds and install-tests the installer, then creates the
   release `kaatchat-v<version>` with the `.exe` and `SHA256SUMS.txt`; the macOS
   job then adds both `.dmg` files and `SHA256SUMS-mac.txt`.
4. Put the new `windowsUrl`, `sha256` and `size` in `site/release.json` and
   `public/release.json` and merge. This turns on the website download **and**
   the in-app update: installed copies read this file to find new versions.
   For the macOS card, add a `mac` object with the `.dmg` links from
   `SHA256SUMS-mac.txt`:
   `"mac": { "version": "…", "signed": false, "arm64": { "url": "…", "sha256": "…", "size": … }, "x64": { … } }`.
   On macOS the updater tells people about the new version and opens the
   release page; the Windows build installs it itself.

## One-time settings only the repository owner can change

- **Website on GitHub Pages:** Settings → Pages → Build and deployment →
  Source: **GitHub Actions**. After the next green run on `main`, the site is
  at `https://<owner>.github.io/<repo>/` and the editor at `…/app/`.
- **Live AI tests (optional):** Settings → Secrets and variables → Actions →
  add any of `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`. Use keys
  with a low spending limit; each run makes a few small requests.
- **Code signing (removes the "unknown publisher" warning):** add the secrets
  `WIN_CSC_LINK` (the certificate as base64 `.pfx`) and `WIN_CSC_KEY_PASSWORD`.
  The build signs automatically when they exist. Ways to get a certificate:
  - **SignPath Foundation** — free code signing for open-source projects
    (apply at signpath.org; they sign in their own pipeline, so the workflow
    step changes to their GitHub action).
  - **Azure Trusted Signing** — a low monthly fee, identity-verified; signs
    through Azure instead of a `.pfx` (the workflow step changes to Azure's
    signing action).
  - An **OV/EV code-signing certificate** from a certificate authority —
    works with the existing `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` secrets
    as they are. EV builds SmartScreen reputation fastest.
  Until then, installers are verified by their SHA-256, which the website
  and the in-app updater both check.
- **macOS signing and notarization (removes "Open Anyway"):** with an Apple
  Developer account, add `MAC_CSC_LINK` (Developer ID Application certificate,
  base64 `.p12`), `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. The build then signs and
  notarizes automatically. Until then the apps are ad-hoc signed: macOS refuses
  the first launch, and System Settings → Privacy & Security → **Open Anyway**
  opens it.
