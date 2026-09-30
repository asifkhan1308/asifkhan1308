# Brag Plan: Kaatchat

## What is this app?
Kaatchat is a free, local-first video editor with an assistant built in: you ask for an edit in plain words, it proposes a plan you can read, then applies it, and your footage never leaves your machine.

## The angle
"Talk to your footage", played straight and premium. The video is itself an edit being asked for: it opens with a request typed into Kaatchat's own command bar, then shows the real app answering it with a readable plan. The site's monochrome, dark-stage look carries the whole film. The payoff is the privacy line, "Local means local", because that is what sets it apart from cloud AI editors.

## Hook (first 2-3 seconds)
A single rounded command bar on the dark stage, like the app's "Ask Kaatchat…" bar. The request `turn this into a 30-second Reel` types itself in, with the eyebrow "Talk to your footage" above it. The viewer reads a real request before they know what the product is.

## Key moments (the middle)
- The real Ask panel: "Clean up this talking head" and a cursor that clicks **Plan it**.
- The plan appears: "Kaatchat wants to:" with its three steps (remove quiet stretches, match loudness to -18 dBFS, punch in 12%), highlighted one by one, with the before/after stats underneath.
- Repurpose: 3 clips, 30s, Reel / Short / TikTok, **Find clips**, then three vertical 9:16 edits fan out.
- "Local means local": what stays on your machine.

## Outro / punchline
Kaatchat mark and wordmark, "Free · MPL-2.0 open source · No account · No uploads", the site URL, then a quiet sign-off from eternl.draft (logo and mascot supplied by the user).

## User flow worth showing
Type a request (Ask panel) → click Plan it → read the proposed plan (the steps, before/after length, clips, aspect). Then Repurpose: choose count, length and format → Find clips → separate vertical edits.

## Tone
- Preset: polished
- Creative direction: quiet premium product film, monochrome, confident
- Interpretation: few scenes, long enough holds to read every line, slow camera pushes into the real UI, one or two soft accents in the sound. No hype words.

## Format: landscape — 1920x1080, 30fps
## Duration: 24s

## Visual identity (from the project)
- Background: #0D0D0F (site dark theme), stage gradient `linear-gradient(160deg, #2A2A2E 0%, #17171A 45%, #0D0D0F 100%)`
- Accent: #F2F2F4 (monochrome ink on dark); success green #5BD39A for "Stay on your machine"
- Text: #F2F2F4, secondary rgba(242,242,244,.66)
- Display font: Inter Variable (weight ~640, tight tracking, as the site's h1)
- Body font: Inter Variable; mono labels in JetBrains Mono
- Strongest visual element: the real editor screenshots (`kaatchat/site/assets/plan.png`, `repurpose.png`, `editor.png`), the Kaatchat logo mark

## Source notes
- The live site URL (kaatchat-website.vercel.app) is blocked by this environment's network proxy, so material comes from the site source in `kaatchat/site/` (same copy, CSS, fonts and screenshots).
- Nothing personal is shown: the support/UPI dialog, social links and names in the footer are left out.

## Share copy (draft)
Kaatchat: shoot once, edit intelligently, create more. Ask your footage for the edit, read the plan before it runs, and keep every file on your own machine.

## Audio direction
- Role: warm, steady bed with sparse professional accents
- Music: `happy-beats-business-moves-vol-12-by-ende-dot-app.mp3` (steady and clean, ~110 BPM)
- Music treatment: starts at 0 at ~0.34 volume, fades out over the last second under the sign-off
- Music cue guidance: preset `assets/music/cues/happy-beats-business-moves-vol-12-by-ende-dot-app.music-cues.json`. Strong cues to use: 8.74s (Plan it click), 17.47s ("Local means local"), 22.93s (eternl.draft sign-off). Beat grid for the three headline lines (3.82, 4.39, 4.91) and the plan rows (every other beat from 10.37).
- Audio-reactive treatment: subtle; the stage glow behind the product breathes with the bass. No waveform or equalizer visuals.
- SFX posture: sparse, motion-matched
- Audio-coupled moments: typed request (a few soft keypresses, not every character), cursor click on Plan it, plan panel reveal (soft drop), cards fanning out (one card slide), Local-means-local heading (soft impact), sign-off (one bell)
- Restraint rule: no stacked hits, nothing bright or repeated loudly; effects sit under the music.

## Storyboard

### Scene 1 — Ask — 0.0–3.7s
Dark stage. Eyebrow "Talk to your footage" (mono) fades up. A command bar with the spark icon draws in; `turn this into a 30-second Reel` types in, then holds.
Sequential/interaction: yes, typing.
Audio intent: music enters softly; a few quiet keypresses.
Audio-coupled idea: typed text.
Transition mood: soft → Scene 2

### Scene 2 — Reveal — 3.6–7.1s
Kaatchat mark, then the site's headline one line at a time: "Shoot once." / "Edit intelligently." / "Create more."
Sequential/interaction: yes, three lines on consecutive beats (3.82, 4.39, 4.91), full set held ~2s.
Audio intent: confidence; no hit, let the music carry it.
Transition mood: soft → Scene 3

### Scene 3 — Ask for the edit — 7.0–9.6s
The real editor (plan.png) on the stage, then a slow push into the Ask panel. Caption: "Ask for the edit." The prompt reads "Clean up this talking head". A cursor glides to **Plan it** and clicks at 8.74s.
Sequential/interaction: yes, simulated click.
Audio intent: a soft click exactly on the press.
Transition mood: continuous camera → Scene 4

### Scene 4 — The plan — 9.3–13.1s
The plan panel reveals under the button: "Kaatchat wants to:" and its three steps, then the Length / Clips / Aspect before-after row. Camera settles on the list. Caption: "Every AI edit is a plan you can read before it runs." Steps highlight one at a time.
Sequential/interaction: yes, three rows highlight on every other beat.
Audio intent: soft drop as the plan lands.
Transition mood: dip through background → Scene 5

### Scene 5 — Repurpose — 12.9–17.0s
Repurpose panel (repurpose.png): How many 3, Length 30s, Reel / Short / TikTok. Caption: "One video, many pieces." Cursor clicks **Find clips**; three vertical 9:16 edits fan out beside it.
Sequential/interaction: yes, click then cards fan out.
Audio intent: click, then one card slide.
Transition mood: dip → Scene 6

### Scene 6 — Local means local — 16.9–20.5s
Heading "Local means local." lands on the strong cue at 17.47s. Three rows from the site's table arrive: Video and audio files → Stay on your machine; Projects, timelines, transcripts → Stay on your machine; Accounts, tracking, telemetry → None.
Sequential/interaction: yes, rows one by one, then held.
Audio intent: one soft impact on the heading.
Transition mood: soft → Scene 7

### Scene 7 — Outro — 20.4–24.0s
Kaatchat mark and wordmark, "Free · MPL-2.0 open source · No account · No uploads", `kaatchat-website.vercel.app`. At 22.93s the eternl.draft mascot and logo settle in below as a sign-off.
Audio intent: bell on the sign-off; music fades out.

**Music mood for this video:** steady, clean, quietly upbeat
**Audio summary:** a clean bed from the first keystroke, a click and a drop around the plan, a card slide on the reels, one soft impact on the privacy line and a bell on the sign-off as the music fades.
