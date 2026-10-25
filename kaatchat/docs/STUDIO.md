# MOTIONLAB Studio — user guide

Studio is Kaatchat's layer-based motion editor: After Effects-style power with a
Figma-simple, black-and-white interface. Open it from the home screen (**Studio**)
or go to `#/studio`. Everything runs in your browser; nothing is uploaded unless
you choose a cloud AI engine.

Press **?** in the editor for every shortcut and gesture.

---

## The workspace

| Area | What it does |
|---|---|
| **Top bar** | File menu (new, save, download/import `.kaatchat`, recent projects), size, fps, duration, motion blur, undo/redo, shortcuts **?**, **Share**, **Export** |
| **✦ Ask bar** | Type what you want ("add a title "Hello" and pop it in"). **Generate ▸** builds a whole video from a description |
| **Toolbar** (left) | Select, Text, Rect, Ellipse, Polygon, Star, Media (video, image or audio), Null |
| **Canvas** | Click to select, drag to move (snaps), corner/edge handles scale, top knob rotates |
| **Inspector** (right) | Every property of the selected layer, keyframable with the ◆ button |
| **Timeline** | Layers, clips, keyframe diamonds, markers, review feedback, zoom and snapping |

## Layers

- **Text, rectangle, ellipse, polygon, star, null, video, image, audio.** Polygons (3–12 sides) and
  stars (3–12 points, adjustable inner radius) switch kind in Inspector → *Shape*; ✦ Ask: *add a hexagon*,
  *add a 6-point star*, *add a triangle*.
- **Select several** with Shift/⌘-click (canvas or timeline); **⌘A** selects all, **Esc** clears.
  Dragging moves the whole group; Delete / ⌘D act on all of them.
- **Nudge** with Alt + arrow keys (1 px; add Shift for 10 px). Plain ← / → step frames
  (Shift: 10 frames).
- **Restack** by dragging a name in the timeline; **rename** by double-clicking it.
- **Copy / paste** with ⌘C / ⌘V. If the selected layer has keyframes at the playhead,
  ⌘C copies those keyframes; otherwise it copies the layers (with the media they use),
  and they can be pasted into another project.
- **Parenting**: Inspector → *Parent*. The child moves, rotates and scales with its parent
  (usually a null). Parenting keeps the layer where it is on screen.
- **Track matte**: Inspector → *Matte*. *Alpha* shows the layer only through another layer's
  shape; *Inverted* shows it everywhere except there. The matte layer itself is hidden.
- **Blend mode**: Inspector → *Blend* — Multiply, Screen, Overlay, Add, Darken, Lighten, Difference,
  Soft / Hard light, Colour dodge / burn, Hue, Saturation, Colour, Luminosity. ✦ Ask: *blend multiply*.
- **Align**: one layer aligns to the frame; several align to each other.
  **Distribute** spaces 3+ layers evenly.

## Animation

- Click **◆** next to any property to add a keyframe at the playhead. Once a property is
  animated, changing it adds or updates a keyframe automatically.
- **Easing** (into a keyframe): Linear, Ease in, Ease out, Ease in/out, **Hold** (jump),
  **Overshoot**, **Snappy**, **Gentle**, **Anticipate**, or **Custom curve…** with a small graph
  editor (drag the two handles).
- **Text animators** (Text → *Animator*): Typewriter, Letters fade in, Words fade in.
  They reveal whole syllables, so Hindi (Devanagari) titles stay correctly shaped while animating.
  *Reveal* (0–100 %) is keyframable.
- **Presets** via ✦ Ask: fade in/out, slide in from any side, pop, spin, typewriter,
  letter by letter, word by word.
- Drag keyframe diamonds on the timeline to retime them.
- **Wiggle** (∿ next to a property's ◆): smooth random motion on top of the value — set how far
  (±px, °, %) and how fast (times a second). It renders the same in the preview and the export,
  and editing the property still edits the value underneath. ✦ Ask: *wiggle it*, *shake it 40px*,
  *wiggle the rotation 10 degrees 3 times a second*, *stop wiggling*.

## Look

- **Fill**: solid colour or a two-colour **gradient** with an angle (shapes and text).
- **Stroke** (outline): colour and width for shapes and text.
- **Text**: font (Sans, Rounded, Serif, Mono, Condensed, Display), weight, size, letter spacing,
  line height, alignment.
  Hindi text uses the bundled Noto Sans Devanagari, so it looks the same on every device and in
  exports.
- **Effects** (Inspector → + Enable), all keyframable: brightness, contrast, saturation,
  blur, vignette, grain, tint, **drop shadow**, **glow**.
- **Motion blur** (top bar): averages sub-frames across a 90–360° shutter. Shown on paused
  frames and always in exports.

## Timeline

- **Zoom** with ⌘/Ctrl + scroll, the slider or **Fit**.
- **Snap**: clips, trims and keyframes snap to the playhead, clip edges, keyframes and markers
  (hold Alt to drag freely; the *Snap* button turns it off).
- **Markers**: **M** at the playhead; click to jump, double-click to rename, right-click to delete.
- **Work area**: **B** / **N** set its start / end at the playhead. Playback loops inside it, and
  Export renders just that range by default (untick *Work area only* for the whole comp).
  Double-click the band to clear it.
- **K** splits the selected clip at the playhead; drag clip edges to trim.
- **Speed** (Inspector → *Time*): 0.25× – 4× presets or any value 0.1–8×. The clip keeps the same
  footage, so it gets shorter or longer on the timeline. Sound follows the speed (pitch changes, like
  tape). A badge on the clip shows the speed.
- **Freeze frame at playhead** splits the clip and holds that frame for the rest of it (silent);
  *Freeze clip* holds a whole clip's first frame. ✦ Ask: *slow motion*, *2x speed*, *speed it up 4x*,
  *freeze frame at 2s*, *unfreeze*.

## Audio

- Video clips keep their sound; **audio files** (music, voice-over) import as sound-only layers.
- Per clip: volume (0–200 %), mute, fade in / fade out. Everything is mixed into the export.

## ✦ Ask and Generate

- **No AI connected (default)**: ✦ Ask understands common phrases on your device, for free:
  *add a title "…"*, *fade in over 1s*, *slide in from the left*, *make it red*,
  *gradient from blue to purple*, *trim to 3s*, *start at 2s*, *split*, *rename to …*,
  *parent it to …*, *use … as matte*, *center it*, *align left*, *typewriter over 2s*,
  *add a marker called … at 2s*, *wiggle it*, *outline it white 4px*, *make it cinematic* (also *vintage*,
  *black and white*, *dreamy*, *punchy*, *neon*; *reset the look*), *delete it*.
  Unknown phrases explain themselves.
- **Hinglish and Hindi** work offline too: *isko laal karo*, *"Sale" title jodo*, *ek tara jodo aur
  isko beech mein rakho*, *hilao*, *dheema karo*, *3 second ka karo*, *इसे लाल करो*. Chain with
  *aur* / *phir*.
- **Local model** (Ollama / LM Studio, on your own machine) or **cloud model** (your key):
  ✦ Ask takes free-form instructions, and **Generate ▸** designs a whole piece from a
  description — layers, copy, colours, timing and animation — as normal editable layers.
  With no model, Generate builds one of its offline templates from your prompt: title card, lower
  third, quote, countdown, call to action, list (tips / steps), big number, or sale badge — pick a
  chip or just describe it.
- Every command is **one undo step** (even when several are sent back-to-back). Invalid AI output is skipped with a reason, never applied.
- Honest limit: language models design motion graphics; they do not render photographic video.

## Review links (no server)

1. **Share** → copy the link. The project travels inside the link (imported media doesn't —
   reviewers see a placeholder for it).
2. The reviewer plays it, pins comments to exact moments and clicks **Send feedback**.
3. Opening their link pins the comments to your timeline (markers + a *Feedback* list where
   you can jump, resolve or delete).

## Cloud and working together (V2)

- **Cloud** (top bar): sign in with an email link or Google, **Save to cloud**, open your cloud
  projects and ones shared with you, share by email (*can edit* / *can view*). Saves show up
  live for everyone with the project open; a save never silently overwrites someone else's.
- Media files stay on each device. Setup and limits: [CLOUD.md](CLOUD.md).

## Saving and exporting

- **Save** (⌘S) keeps the project in this browser; autosave runs in the background.
  **Download .kaatchat** for a file you can move; **Import .kaatchat** to open one.
- **Export** renders MP4 (or WebM) at the composition's size and frame rate, with audio.
  **Save frame as PNG** (in the Export dialog) saves the frame at the playhead at full resolution.
- **GIF**: Export → Format *GIF* — a looping animation without sound, 320–800 px wide (or full
  size) at 10–25 fps; honours the work area. Good for chat, docs and social posts.
- **Background**: the *BG* swatch in the top bar sets the composition's background colour.

## Known limits

- Motion blur doesn't sub-sample imported video frames.
- Review links can't carry imported footage (too big for a link); share an MP4 alongside.
- Cloud projects don't carry imported media; collaborators add the same files on their device.
