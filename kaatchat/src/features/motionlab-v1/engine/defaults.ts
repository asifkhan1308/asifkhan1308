import type {
  Composition,
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

export const newRectangleLayer = (comp: Composition): RectangleLayer => ({
  ...baseLayer(comp, 'Rectangle'),
  type: 'rectangle',
  size: anim<[number, number]>([comp.width * 0.3, comp.height * 0.3]),
  cornerRadius: anim<number>(0),
  fill: '#FFFFFF',
  stroke: null,
  strokeWidth: 0,
});

export const newEllipseLayer = (comp: Composition): EllipseLayer => ({
  ...baseLayer(comp, 'Ellipse'),
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

export const newMediaLayer = (
  comp: Composition,
  assetId: string,
  name: string,
  sourceDuration: number,
): MediaLayer => ({
  ...baseLayer(comp, name),
  type: 'media',
  assetId,
  sourceIn: 0,
  sourceOut: sourceDuration,
  duration: Math.min(comp.duration, sourceDuration || comp.duration),
});

export const newImageLayer = (
  comp: Composition,
  assetId: string,
  name: string,
): ImageLayer => ({
  ...baseLayer(comp, name),
  type: 'image',
  assetId,
});

export const duplicateLayer = (layer: Layer): Layer => {
  const copy = JSON.parse(JSON.stringify(layer)) as Layer;
  copy.id = uid('l');
  copy.name = `${layer.name} copy`;
  return copy;
};
