/* MOTIONLAB V1 — authoritative project model.
 * Everything the renderer, timeline and inspector read starts here.
 * UI state (selection, hovered keyframe, zoom) lives in the store but is
 * marked separately so it never pollutes the saved project file.
 */

export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

export interface Keyframe<T> {
  time: number;       // absolute seconds in the composition
  value: T;
  easing?: Easing;    // easing INTO this keyframe (default ease-in-out)
}

export interface AnimatedProperty<T> {
  default: T;
  keyframes?: Keyframe<T>[];
}

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
}

/* ───── Transform (every visual layer has one) ───── */
export interface Transform {
  position: AnimatedProperty<V2>;   // [x, y] in composition pixels
  scale: AnimatedProperty<V2>;      // [sx, sy], 1 = 100%
  rotation: AnimatedProperty<number>; // degrees
  anchor: AnimatedProperty<V2>;     // [ax, ay] in LAYER pixels; rotation + scale pivot
  opacity: AnimatedProperty<number>; // 0..1
}

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
}

export interface MediaLayer extends LayerBase {
  type: 'media';
  assetId: string;
  sourceIn: number;    // offset into the source media (trim-in)
  sourceOut: number;   // end offset into source (trim-out)
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
  stroke: RGBA | null;
  strokeWidth: number;
}

export interface RectangleLayer extends LayerBase {
  type: 'rectangle';
  size: AnimatedProperty<V2>;
  cornerRadius: AnimatedProperty<number>;
  fill: RGBA;
  stroke: RGBA | null;
  strokeWidth: number;
}

export interface EllipseLayer extends LayerBase {
  type: 'ellipse';
  size: AnimatedProperty<V2>;
  fill: RGBA;
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
export type AssetKind = 'video' | 'image';

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
