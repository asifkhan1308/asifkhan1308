import type {
  Composition,
  Effects,
  EllipseLayer,
  ImageLayer,
  Layer,
  MediaLayer,
  NullLayer,
  Project,
  RectangleLayer,
  TextLayer,
  Transform,
} from '../types';
import { anim } from './interp';

export const neutralEffects = (): Effects => ({
  brightness: anim<number>(0),
  contrast: anim<number>(0),
  saturation: anim<number>(0),
  blur: anim<number>(0),
  vignette: anim<number>(0),
  grain: anim<number>(0),
  tintColor: '#ffffff',
  tintAmount: anim<number>(0),
});

const uid = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

export const defaultComposition = (): Composition => ({
  width: 1920,
  height: 1080,
  fps: 30,
  duration: 10,
  background: '#000000',
});

export const defaultProject = (name = 'Untitled Project'): Project => ({
  format: 'motionlab',
  version: 1,
  id: uid('p'),
  name,
  composition: defaultComposition(),
  assets: [],
  layers: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

const centerTransform = (comp: Composition): Transform => ({
  position: anim<[number, number]>([comp.width / 2, comp.height / 2]),
  scale: anim<[number, number]>([1, 1]),
  rotation: anim<number>(0),
  anchor: anim<[number, number]>([0, 0]),
  opacity: anim<number>(1),
});

const baseLayer = (comp: Composition, name: string) => ({
  id: uid('l'),
  name,
  visible: true,
  locked: false,
  solo: false,
  startTime: 0,
  duration: comp.duration,
  transform: centerTransform(comp),
});

export const newTextLayer = (comp: Composition, text = 'TEXT'): TextLayer => ({
  ...baseLayer(comp, text),
  type: 'text',
  text,
  fontFamily: 'Inter, -apple-system, system-ui, sans-serif',
  fontWeight: 700,
  fontSize: anim<number>(Math.round(comp.height * 0.08)),
  letterSpacing: 0,
  lineHeight: 1.2,
  align: 'center',
  fill: '#FFFFFF',
  stroke: null,
  strokeWidth: 0,
});

/* Anchor at the layer's centre so it lands centred on the composition and
 * rotates/scales around its middle — what users expect from Figma/AE. */
const centredBase = (comp: Composition, name: string, w: number, h: number) => {
  const b = baseLayer(comp, name);
  return { ...b, transform: { ...b.transform, anchor: anim<[number, number]>([w / 2, h / 2]) } };
};

export const newRectangleLayer = (comp: Composition): RectangleLayer => ({
  ...centredBase(comp, 'Rectangle', comp.width * 0.3, comp.height * 0.3),
  type: 'rectangle',
  size: anim<[number, number]>([comp.width * 0.3, comp.height * 0.3]),
  cornerRadius: anim<number>(0),
  fill: '#FFFFFF',
  stroke: null,
  strokeWidth: 0,
});

export const newEllipseLayer = (comp: Composition): EllipseLayer => ({
  ...centredBase(comp, 'Ellipse', comp.height * 0.3, comp.height * 0.3),
  type: 'ellipse',
  size: anim<[number, number]>([comp.height * 0.3, comp.height * 0.3]),
  fill: '#FFFFFF',
  stroke: null,
  strokeWidth: 0,
});

export const newNullLayer = (comp: Composition): NullLayer => ({
  ...baseLayer(comp, 'Null'),
  type: 'null',
});

/* Media lands centred and scaled to fit inside the composition. */
const fittedBase = (comp: Composition, name: string, w?: number, h?: number) => {
  const b = baseLayer(comp, name);
  if (!w || !h) return b;
  const fit = Math.min(comp.width / w, comp.height / h);
  return {
    ...b,
    transform: {
      ...b.transform,
      anchor: anim<[number, number]>([w / 2, h / 2]),
      scale: anim<[number, number]>([fit, fit]),
    },
  };
};

export const newMediaLayer = (
  comp: Composition,
  assetId: string,
  name: string,
  sourceDuration: number,
  width?: number,
  height?: number,
): MediaLayer => ({
  ...fittedBase(comp, name, width, height),
  type: 'media',
  assetId,
  sourceIn: 0,
  sourceOut: sourceDuration || comp.duration,
  duration: Math.min(comp.duration, sourceDuration || comp.duration),
});

export const newImageLayer = (
  comp: Composition,
  assetId: string,
  name: string,
  width?: number,
  height?: number,
): ImageLayer => ({
  ...fittedBase(comp, name, width, height),
  type: 'image',
  assetId,
});

export const duplicateLayer = (layer: Layer): Layer => {
  const copy = JSON.parse(JSON.stringify(layer)) as Layer;
  copy.id = uid('l');
  copy.name = `${layer.name} copy`;
  return copy;
};
