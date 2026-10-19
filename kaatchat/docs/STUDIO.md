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
| **Toolbar** (left) | Select, Text, Rect, Ellipse, Media (video, image or audio), Null |
| **Canvas** | Click to select, drag to move (snaps), corner/edge handles scale, top knob rotates |
| **Inspector** (right) | Every property of the selected layer, keyframable with the ◆ button |
| **Timeline** | Layers, clips, keyframe diamonds, markers, review feedback, zoom and snapping |

## Layers

- **Text, rectangle, ellipse, null, video, image, audio.**
- **Select several** with Shift/⌘-click (canvas or timeline); **⌘A** selects all, **Esc** clears.
  Dragging moves the whole group; Delete / ⌘D act on all of them.
- **Restack** by dragging a name in the timeline; **rename** by double-clicking it.
- **Copy / paste** with ⌘C / ⌘V. If the selected layer has keyframes at the playhead,
  ⌘C copies those keyframes; otherwise it copies the layers (with the media they use),
  and they can be pasted into another project.
- **Parenting**: Inspector → *Parent*. The child moves, rotates and scales with its parent
  (usually a null). Parenting keeps the layer where it is on screen.
- **Track matte**: Inspector → *Matte*. *Alpha* shows the layer only through another layer's
  shape; *Inverted* shows it everywhere except there. The matte layer itself is hidden.
- **Align**: one layer aligns to the frame; several align to each other.
  **Distribute** spaces 3+ layers evenly.

## Animation

- Click **◆** next to any property to add a keyframe at the playhead. Once a property is
  animated, changing it adds or updates a keyframe automatically.
- **Easing** (into a keyframe): Linear, Ease in, Ease out, Ease in/out, **Hold** (jump),
  **Overshoot**, **Snappy**, **Gentle**, **Anticipate**, or **Custom curve…** with a small graph
  editor (drag the two handles).
- **Text animators** (Text → *Animator*): Typewriter, Letters fade in, Words fade in.
  *Reveal* (0–100 %) is keyframable.
- **Presets** via ✦ Ask: fade in/out, slide in from any side, pop, spin, typewriter,
  letter by letter, word by word.
- Drag keyframe diamonds on the timeline to retime them.

## Look

- **Fill**: solid colour or a two-colour **gradient** with an angle (shapes and text).
- **Stroke** (outline): colour and width for shapes and text.
- **Text**: font (Sans, Rounded, Serif, Mono, Condensed, Display), weight, size, letter spacing,
  line height, alignment.
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

## Audio

- Video clips keep their sound; **audio files** (music, voice-over) import as sound-only layers.
- Per clip: volume (0–200 %), mute, fade in / fade out. Everything is mixed into the export.

## ✦ Ask and Generate

- **No AI connected (default)**: ✦ Ask understands common phrases on your device, for free:
  *add a title "…"*, *fade in over 1s*, *slide in from the left*, *make it red*,
  *gradient from blue to purple*, *trim to 3s*, *start at 2s*, *split*, *rename to …*,
  *parent it to …*, *use … as matte*, *center it*, *align left*, *typewriter over 2s*,
  *add a marker called … at 2s*, *outline it white 4px*, *make it cinematic* (also *vintage*,
  *black and white*, *dreamy*, *punchy*, *neon*; *reset the look*), *delete it*.
  Unknown phrases explain themselves.
- **Local model** (Ollama / LM Studio, on your own machine) or **cloud model** (your key):
  ✦ Ask takes free-form instructions, and **Generate ▸** designs a whole piece from a
  description — layers, copy, colours, timing and animation — as normal editable layers.
  With no model, Generate builds an animated title card from your prompt.
- Every command is **one undo step** (even when several are sent back-to-back). Invalid AI output is skipped with a reason, never applied.
- Honest limit: language models design motion graphics; they do not render photographic video.

## Review links (no server)

1. **Share** → copy the link. The project travels inside the link (imported media doesn't —
   reviewers see a placeholder for it).
2. The reviewer plays it, pins comments to exact moments and clicks **Send feedback**.
3. Opening their link pins the comments to your timeline (markers + a *Feedback* list where
   you can jump, resolve or delete).

## Saving and exporting

- **Save** (⌘S) keeps the project in this browser; autosave runs in the background.
  **Download .kaatchat** for a file you can move; **Import .kaatchat** to open one.
- **Export** renders MP4 (or WebM) at the composition's size and frame rate, with audio.
  **Save frame as PNG** (in the Export dialog) saves the frame at the playhead at full resolution.
- **Background**: the *BG* swatch in the top bar sets the composition's background colour.

## Known limits

- Motion blur doesn't sub-sample imported video frames.
- Review links can't carry imported footage (too big for a link); share an MP4 alongside.
- No multi-user editing or cloud projects yet (see the roadmap).
