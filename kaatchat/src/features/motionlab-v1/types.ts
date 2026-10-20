/* MOTIONLAB V1 — authoritative project model.
 * Everything the renderer, timeline and inspector read starts here.
 * UI state (selection, hovered keyframe, zoom) lives in the store but is
 * marked separately so it never pollutes the saved project file.
 */

export type Easing = 'linear' | 'ease-in' | 'ease-in-out' | 'ease-out' | 'hold' | 'bezier';
/** cubic-bezier(x1, y1, x2, y2); x in 0..1, y may overshoot (bouncy moves). */
export type Bezier = [number, number, number, number];

export interface Keyframe<T> {
  time: number;       // absolute seconds in the composition
  value: T;
  easing?: Easing;    // easing INTO this keyframe (default ease-in-out)
  bezier?: Bezier;    // the curve when easing is 'bezier'
}

export interface AnimatedProperty<T> {
  default: T;
  keyframes?: Keyframe<T>[];
  /** After Effects-style wiggle on top of the value: smooth random drift of
   *  up to ±amount (property units), `freq` times a second. Deterministic. */
  wiggle?: Wiggle;
}

export interface Wiggle { amount: number; freq: number; seed?: number }

/* ───── Scalar + vector helpers ───── */
export type V2 = [number, number];
export type RGBA = string;

/* ───── Composition ───── */
export interface Composition {
  width: number;
  height: number;
  fps: 24 | 25 | 30 | 60;
  duration: number;      // seconds
  background: RGBA;      // includes alpha for transparent compositions
  /** Motion blur: each frame averages sub-frames across the shutter.
   *  shutter = fraction of a frame (0.5 = 180°). Absent = off. */
  motionBlur?: { enabled: boolean; shutter: number; samples: number };
  /** Work area (B / N): playback loops inside it; export can use it. */
  workArea?: { start: number; end: number };
}

/* ───── Transform (every visual layer has one) ───── */
export interface Transform {
  position: AnimatedProperty<V2>;   // [x, y] in composition pixels
  scale: AnimatedProperty<V2>;      // [sx, sy], 1 = 100%
  rotation: AnimatedProperty<number>; // degrees
  anchor: AnimatedProperty<V2>;     // [ax, ay] in LAYER pixels; rotation + scale pivot
  opacity: AnimatedProperty<number>; // 0..1
}

/* ───── Quick Effects (per layer; optional, all keyframable) ───── */
export interface Effects {
  brightness: AnimatedProperty<number>; // -1..1, 0 neutral
  contrast: AnimatedProperty<number>;   // -1..1, 0 neutral
  saturation: AnimatedProperty<number>; // -1..1, -1 = greyscale, 0 neutral
  blur: AnimatedProperty<number>;       // 0..1 fraction of max radius
  vignette: AnimatedProperty<number>;   // 0..1
  grain: AnimatedProperty<number>;      // 0..1
  tintColor: RGBA;
  tintAmount: AnimatedProperty<number>; // 0..1 mix
  /* Optional (added later; older saved effects simply lack them = 0). */
  shadow?: AnimatedProperty<number>;    // 0..1 drop-shadow strength
  shadowColor?: RGBA;
  glow?: AnimatedProperty<number>;      // 0..1 outer-glow strength
  glowColor?: RGBA;
}
export const EFFECT_PROPS = [
  'brightness',
  'contrast',
  'saturation',
  'blur',
  'vignette',
  'grain',
  'tintAmount',
  'shadow',
  'glow',
] as const;
export type EffectProp = (typeof EFFECT_PROPS)[number];

/* ───── Layer kinds ───── */
export type LayerType = 'media' | 'image' | 'text' | 'rectangle' | 'ellipse' | 'null';

interface LayerBase {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  locked: boolean;
  solo: boolean;
  startTime: number;   // composition seconds where the layer becomes active
  duration: number;    // seconds; layer disappears after startTime + duration
  transform: Transform;
  /** Optional per-layer effects. Absent = neutral (no cost at render). */
  effects?: Effects;
  /** Parent layer (usually a null): this layer's transform is applied inside
   *  the parent's, like After Effects parenting. Absent = no parent. */
  parentId?: string;
  /** Track matte (After Effects style): show this layer only through
   *  ('alpha') or outside ('alpha-inverted') another layer's pixels. The
   *  matte layer itself is not drawn. Absent = no matte. */
  matte?: { layerId: string; mode: MatteMode };
}

export type MatteMode = 'alpha' | 'alpha-inverted';

export interface MediaLayer extends LayerBase {
  type: 'media';
  assetId: string;
  sourceIn: number;    // offset into the source media (trim-in)
  sourceOut: number;   // end offset into source (trim-out)
  /* Clip audio — all optional; absent = full volume, no fades. */
  volume?: number;     // linear gain, 0..2 (1 = unchanged)
  muted?: boolean;
  fadeIn?: number;     // seconds from clip start
  fadeOut?: number;    // seconds before clip end
}

export interface ImageLayer extends LayerBase {
  type: 'image';
  assetId: string;
}

export interface TextLayer extends LayerBase {
  type: 'text';
  text: string;
  fontFamily: string;
  fontWeight: 400 | 500 | 600 | 700 | 800;
  fontSize: AnimatedProperty<number>; // px in composition space
  letterSpacing: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right';
  fill: RGBA;
  /** Optional linear gradient; when set it replaces the solid fill. */
  gradient?: Gradient;
  stroke: RGBA | null;
  strokeWidth: number;
  /** Text animator: how much of the text is revealed (0..1, keyframable)
   *  and how. Absent = all text shown. */
  revealMode?: RevealMode;
  reveal?: AnimatedProperty<number>;
}

export type RevealMode = 'typewriter' | 'letters' | 'words';

/** Linear gradient across the layer's own box; angle 0° = left → right,
 *  90° = top → bottom. */
export interface Gradient { from: RGBA; to: RGBA; angle: number }

export interface RectangleLayer extends LayerBase {
  type: 'rectangle';
  size: AnimatedProperty<V2>;
  cornerRadius: AnimatedProperty<number>;
  fill: RGBA;
  /** Optional linear gradient; when set it replaces the solid fill. */
  gradient?: Gradient;
  stroke: RGBA | null;
  strokeWidth: number;
}

export interface EllipseLayer extends LayerBase {
  type: 'ellipse';
  size: AnimatedProperty<V2>;
  fill: RGBA;
  /** Optional linear gradient; when set it replaces the solid fill. */
  gradient?: Gradient;
  stroke: RGBA | null;
  strokeWidth: number;
}

export interface NullLayer extends LayerBase {
  type: 'null';
}

export type Layer =
  | MediaLayer
  | ImageLayer
  | TextLayer
  | RectangleLayer
  | EllipseLayer
  | NullLayer;

/* ───── Assets (referenced by media/image layers; one entry per source file) ───── */
/** 'audio' = a music / voice file used by a media layer that has sound
 *  but nothing to draw. */
export type AssetKind = 'video' | 'image' | 'audio';

export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  mime: string;
  width: number;
  height: number;
  duration: number;    // seconds (images: 0)
  url: string;         // blob: URL in browser; serialized separately for save
}

/* ───── Project ───── */
export interface Project {
  format: 'motionlab';
  version: 1;
  id: string;
  name: string;
  composition: Composition;
  assets: Asset[];
  layers: Layer[];
  createdAt: number;
  updatedAt: number;
  /** Review feedback received via a feedback link (V1.5). Optional: older
   *  projects simply have none. */
  comments?: ReviewComment[];
  /** Timeline markers (M at the playhead). Optional: older projects have none. */
  markers?: Marker[];
}

export interface Marker { id: string; time: number; label: string }

/* ───── Review (V1.5) ───── */
export interface ReviewComment {
  id: string;
  time: number;      // seconds on the composition timeline
  text: string;
  author: string;
  createdAt: number;
  resolved?: boolean;
}

/* ───── Transform-property keys that the inspector + keyframe UI iterate over ───── */
export const TRANSFORM_PROPS = [
  'position',
  'scale',
  'rotation',
  'anchor',
  'opacity',
] as const;
export type TransformProp = (typeof TRANSFORM_PROPS)[number];
