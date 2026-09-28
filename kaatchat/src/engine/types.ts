// The Kaatchat document model. Pure data — no React, no DOM.
//
// Times on a Clip (`in`/`out`) are SOURCE seconds inside its asset.
// Times on the timeline are derived by laying clips end to end.

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

export type AssetKind = 'video' | 'image';

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
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  storage: AssetStorage;
  origin: 'import' | 'generated';
  addedAt: number;
}

export type FitMode = 'fill' | 'fit';

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
}

export type CaptionStyleId = 'minimal' | 'bold' | 'podcast' | 'kinetic' | 'clean';

export interface CaptionSettings {
  enabled: boolean;
  style: CaptionStyleId;
  /** Max words shown at once. */
  maxWords: number;
}

export interface ProjectDoc {
  version: 2;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  aspect: AspectId;
  fps: number;
  assets: Record<string, MediaAsset>;
  clips: Clip[];
  captions: CaptionSettings;
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
