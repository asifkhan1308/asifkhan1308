// The Kaatchat document model. Pure data — no React, no DOM.
//
// Times on a Clip (`in`/`out`) are SOURCE seconds inside its asset.
// Times on the timeline are derived by laying clips end to end.

import type { NoiseProfile } from './denoise';
export type AspectId = '16:9' | '9:16' | '1:1' | '4:5';

export interface AspectSpec {
  id: AspectId;
  name: string;
  width: number;
  height: number;
  for: string;
}

export const ASPECTS: Record<AspectId, AspectSpec> = {
  '16:9': { id: '16:9', name: 'Landscape', width: 1920, height: 1080, for: 'YouTube, web' },
  '9:16': { id: '9:16', name: 'Vertical', width: 1080, height: 1920, for: 'Reels, Shorts, TikTok' },
  '1:1': { id: '1:1', name: 'Square', width: 1080, height: 1080, for: 'Feed posts' },
  '4:5': { id: '4:5', name: 'Portrait', width: 1080, height: 1350, for: 'Instagram feed' },
};

export const ASPECT_IDS = Object.keys(ASPECTS) as AspectId[];

export type AssetKind = 'video' | 'image' | 'audio';

/** Where the bytes of an asset live. */
export type AssetStorage =
  | 'local' // copied into this device's project storage
  | 'session' // too large to copy; available until reload, then needs relinking
  | 'missing'; // needs relinking

export interface MediaAsset {
  id: string;
  name: string;
  kind: AssetKind;
  mime: string;
  size: number;
  duration: number; // seconds (images: default still length)
  width: number; // 0 for audio
  height: number;
  fps: number;
  hasAudio: boolean;
  storage: AssetStorage;
  origin: 'import' | 'generated';
  addedAt: number;
}

export type FitMode = 'fill' | 'fit';

/** Per-clip look. Every value is neutral at its default. */
export interface Effects {
  brightness: number; // -1..1
  contrast: number; // -1..1
  saturation: number; // -1..1 (-1 = black & white)
  exposure: number; // stops, -2..2
  blur: number; // 0..1 (fraction of a max radius)
  sharpen: number; // 0..1
  vignette: number; // 0..1
  grain: number; // 0..1
  tint: string; // #rrggbb
  tintAmount: number; // 0..1
  opacity: number; // 0..1
}

export const NEUTRAL_EFFECTS: Effects = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  exposure: 0,
  blur: 0,
  sharpen: 0,
  vignette: 0,
  grain: 0,
  tint: '#ffffff',
  tintAmount: 0,
  opacity: 1,
};

export type TransitionKind = 'dissolve' | 'fade' | 'slide' | 'zoom' | 'blur' | 'whip';

/** Transition INTO a clip from the one before it (overlaps both). */
export interface Transition {
  kind: TransitionKind;
  duration: number; // seconds
}

export interface Clip {
  id: string;
  assetId: string;
  in: number;
  out: number;
  /** Audio gain in dB applied to this clip. */
  gainDb: number;
  /** Framing centre, 0..1 in source space. 0.5/0.5 = centred. */
  focusX: number;
  focusY: number;
  fit: FitMode;
  /** Punch-in: 1 = none, 1.15 = 15% closer around the focus point. */
  scale?: number;
  effects?: Partial<Effects>;
  transition?: Transition;
  /** Audio fades, seconds. */
  fadeIn?: number;
  fadeOut?: number;
  muted?: boolean;
  /** Background-noise reduction, 0 (off) … 1 (strongest). Uses the asset's measured noise profile. */
  denoise?: number;
  /** Added by the Brand Kit, so re-applying replaces it. */
  brandRole?: 'intro' | 'outro';
}

/** Music / extra audio, placed on its own track at a timeline time. */
export interface AudioClip {
  id: string;
  assetId: string;
  start: number; // timeline seconds
  in: number; // source seconds
  out: number;
  gainDb: number;
  fadeIn: number;
  fadeOut: number;
  /** Lower this clip while the main track has speech. */
  duck: boolean;
}

export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'back-out' | 'elastic-out';

export interface Keyframe {
  /** Seconds from the overlay's start. */
  t: number;
  x?: number; // 0..1 of frame width (centre)
  y?: number;
  scale?: number;
  rotation?: number; // degrees
  opacity?: number;
  blur?: number; // 0..1
  easing?: Easing; // easing INTO this keyframe
}

export type OverlayAnimation =
  | 'none'
  | 'fade'
  | 'slide-up'
  | 'slide-left'
  | 'scale'
  | 'pop'
  | 'typewriter'
  | 'blur'
  | 'tracking'
  | 'kinetic';

export interface Overlay {
  id: string;
  kind: 'text' | 'shape' | 'image';
  name: string;
  start: number; // timeline seconds
  duration: number;
  // Base transform (keyframes override per property).
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  keyframes: Keyframe[];
  animIn: OverlayAnimation;
  animOut: OverlayAnimation;
  animDuration: number;
  // Text
  text?: string;
  font?: string;
  size?: number; // fraction of the frame's short edge
  weight?: number;
  color?: string;
  background?: string | null;
  align?: 'left' | 'center' | 'right';
  // Shape
  shape?: 'rect' | 'ellipse';
  width?: number; // fraction of frame width
  height?: number; // fraction of frame height
  radius?: number; // fraction of the shape's short edge
  fill?: string;
  // Image (e.g. a logo)
  assetId?: string;
  /** Optional rectangular reveal mask, fraction of the element (0..1). */
  mask?: { from: 'left' | 'right' | 'top' | 'bottom'; amount: number } | null;
  /** Where it came from, so "Apply brand" can replace its own items. */
  role?: 'lower-third' | 'watermark' | 'title' | 'user';
}

export type CaptionStyleId = 'minimal' | 'bold' | 'podcast' | 'kinetic' | 'clean';

export interface CaptionSettings {
  enabled: boolean;
  style: CaptionStyleId;
  /** Max words shown at once. */
  maxWords: number;
  /** Highlight colour for styles that mark the active word. */
  accent?: string;
}

export interface TrackMix {
  mainMuted: boolean;
  mainSolo: boolean;
  musicMuted: boolean;
  musicSolo: boolean;
  /** How far ducked music drops under speech. */
  duckDb: number;
}

export const DEFAULT_MIX: TrackMix = { mainMuted: false, mainSolo: false, musicMuted: false, musicSolo: false, duckDb: -12 };

/** One edit (timeline). A project can hold many — e.g. one per Reel. */
export interface Sequence {
  id: string;
  name: string;
  createdAt: number;
  aspect: AspectId;
  fps: number;
  clips: Clip[];
  audio: AudioClip[];
  overlays: Overlay[];
  captions: CaptionSettings;
  mix: TrackMix;
  /** Set when this sequence was cut from another one. */
  sourceSequenceId?: string;
  note?: string;
}

export interface BrandKit {
  name: string;
  logoAssetId: string | null;
  colors: { ink: string; paper: string; accent: string };
  /** One of the built-in fonts, or the family name of an uploaded brand font. */
  font: string;
  captionStyle: CaptionStyleId;
  lowerThird: { enabled: boolean; name: string; title: string };
  watermark: { enabled: boolean; position: 'tl' | 'tr' | 'bl' | 'br'; opacity: number };
  introAssetId: string | null;
  outroAssetId: string | null;
}

export interface ProjectDoc {
  version: 3;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  assets: Record<string, MediaAsset>;
  sequences: Sequence[];
  activeSequenceId: string;
  brand: BrandKit | null;
}

/**
 * What editing code works on: the active sequence, plus the project's
 * assets and name. Commands take and return this.
 */
export interface EditView extends Sequence {
  assets: Record<string, MediaAsset>;
  projectName: string;
  brand: BrandKit | null;
}

// ---------------------------------------------------------------------------
// Derived, non-undoable index data (the "ai-index/"): measurements and
// transcripts computed from the footage itself.
// ---------------------------------------------------------------------------

/** Loudness envelope at a fixed frame rate. */
export interface AudioAnalysis {
  /** Frames per second of `rmsDb`. */
  rate: number;
  /** RMS level in dBFS per frame (-100 = digital silence). */
  rmsDb: number[];
  /** Mean of the loudest 40% of frames — "how loud is this clip". */
  levelDb: number;
  /** 90th percentile frame level; silence thresholds are relative to it. */
  p90Db: number;
}

/** Content-aware framing: where the visual detail/motion is, over time. */
export interface FramingAnalysis {
  samples: { t: number; x: number; y: number; weight: number }[];
}

export interface Word {
  t0: number; // source seconds
  t1: number;
  text: string;
}

export interface TranscriptSegment {
  t0: number;
  t1: number;
  text: string;
  words: Word[];
}

export interface Transcript {
  model: string;
  language: string;
  createdAt: number;
  segments: TranscriptSegment[];
}

export interface AssetIndex {
  audio?: AudioAnalysis;
  /** Steady background noise, measured with the loudness (for noise reduction). null = measured, too little sound. */
  noise?: NoiseProfile | null;
  /** Tempo and beat grid (music files). */
  beats?: { bpm: number; beats: number[]; confidence: number };
  framing?: FramingAnalysis;
  /** Small JPEG data URLs, evenly spaced, for filmstrips and the bin. */
  thumbs?: { t: number; url: string }[];
  transcript?: Transcript;
}

export type ProjectIndex = Record<string, AssetIndex>;

export interface TimeRange {
  start: number;
  end: number;
}

/** The preset closest to a source's shape (log-ratio distance), or null for audio / unknown sizes. */
export function nearestAspect(width: number, height: number): AspectId | null {
  if (!(width > 0 && height > 0)) return null;
  const r = Math.log(width / height);
  let best: AspectId = '16:9';
  for (const id of ASPECT_IDS) {
    const a = ASPECTS[id];
    if (Math.abs(r - Math.log(a.width / a.height)) < Math.abs(r - Math.log(ASPECTS[best].width / ASPECTS[best].height))) best = id;
  }
  return best;
}

/** True when a source's shape differs from the canvas enough that filling it would crop noticeably (> ~8%). */
export function shapeDiffers(width: number, height: number, aspect: AspectId): boolean {
  if (!(width > 0 && height > 0)) return false;
  const a = ASPECTS[aspect];
  return Math.abs(Math.log(width / height) - Math.log(a.width / a.height)) > 0.08;
}
