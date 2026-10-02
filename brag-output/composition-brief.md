# Hyperframes Composition Brief: Kaatchat

## Objective
Create a short launch-style brag video for Kaatchat.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080, 30fps
- Duration: 24s

## Source Material
- Project root: `kaatchat/` (site source: `kaatchat/site/`)
- Primary files read: `site/index.html`, `site/site.css`, `site/README.md`, `package.json`, the three screenshots in `site/assets/`
- Product name: Kaatchat
- Tagline / strongest claim: "Shoot once. Edit intelligently. Create more." / "Local means local"
- Key UI moment: the Ask panel prompt → Plan it → "Kaatchat wants to:" plan; the Repurpose panel → Find clips
- Copy that must appear verbatim:
  - Talk to your footage
  - Shoot once. / Edit intelligently. / Create more.
  - Ask for the edit
  - Every AI edit is a plan you can read before it runs.
  - One video, many pieces
  - Local means local
  - Free · MPL-2.0 open source · No account · No uploads
- User-supplied brand assets: eternl.draft logo and mascot (white on transparent), shown as the sign-off.

## Creative Direction
- Tone preset: polished
- Creative direction: quiet premium product film, monochrome, confident
- Interpretation: long holds, slow pushes into real UI, minimal sound accents
- Angle: the video is an edit being asked for; the real app answers with a plan; the payoff is that it all stays on your machine.
- Hook: a request typing itself into Kaatchat's command bar
- Outro / punchline: Kaatchat lockup, the free/open-source line, the URL, then the eternl.draft sign-off
- Avoid: generic SaaS language, abstract filler, restyling the product UI

## Visual Identity
- Background: #0D0D0F with the site's stage gradient
- Text: #F2F2F4; secondary rgba(242,242,244,.66)
- Accent: monochrome #F2F2F4; success #5BD39A
- Display font: Inter Variable (local woff2 from the project)
- Body font: Inter Variable; mono: JetBrains Mono (local woff2)
- Visual references: real screenshots, logo mark SVG

## Storyboard
Use `brag-output/brag-plan.md` as the creative contract.

1. Ask — 0.0–3.7s — command bar, typed request
2. Reveal — 3.6–7.1s — mark + three headline lines
3. Ask for the edit — 7.0–9.6s — push into Ask panel, click Plan it at 8.74s
4. The plan — 9.3–13.1s — plan reveals, rows highlight
5. Repurpose — 12.9–17.0s — Find clips, three 9:16 edits fan out
6. Local means local — 16.9–20.5s — heading + three rows
7. Outro — 20.4–24.0s — lockup, URL, eternl.draft sign-off

## Audio
- Audio role: warm bed with sparse accents
- Audio arc: soft entry, click/drop around the plan, card slide, one impact, bell and fade
- Music: `assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` at ~0.34
- Music cue guidance: `.claude/skills/brag/assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`; strong cues 8.74, 17.47, 22.93
- Audio-reactive treatment: subtle stage glow on bass (pre-extracted `assets/audio-data.js`)
- SFX: chosen after animation; Kenney CC0 files copied into `assets/sfx/`

## Environment notes
- CDN access (jsdelivr) is blocked here, so GSAP 3.14.2 is vendored at `assets/gsap.min.js` from npm.
