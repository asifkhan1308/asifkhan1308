import { create } from 'zustand';
import type {
  AnimatedProperty,
  Asset,
  Easing,
  Layer,
  Project,
  TransformProp,
  V2,
} from './types';
import { removeKeyframeAt, resolveAnimated, upsertKeyframe } from './engine/interp';
import {
  defaultProject,
  duplicateLayer,
  newEllipseLayer,
  newImageLayer,
  newMediaLayer,
  newNullLayer,
  newRectangleLayer,
  newTextLayer,
} from './engine/defaults';

interface UIState {
  selectedLayerId: string | null;
  currentTime: number;
  isPlaying: boolean;
  activeTool: 'select' | 'text' | 'rectangle' | 'ellipse' | 'media' | 'null';
}

interface MotionLabV1State extends UIState {
  project: Project;

  /* Project */
  newProject: () => void;
  renameProject: (name: string) => void;
  setCompositionSize: (w: number, h: number) => void;
  setCompositionFps: (fps: Project['composition']['fps']) => void;
  setCompositionDuration: (seconds: number) => void;

  /* Layer CRUD */
  addTextLayer: () => string;
  addRectangle: () => string;
  addEllipse: () => string;
  addNull: () => string;
  addMediaLayer: (asset: Asset) => string;
  addImageLayer: (asset: Asset) => string;
  renameLayer: (id: string, name: string) => void;
  duplicate: (id: string) => void;
  removeLayer: (id: string) => void;
  reorderLayer: (id: string, toIndex: number) => void;
  setVisible: (id: string, v: boolean) => void;
  setLocked: (id: string, v: boolean) => void;
  setSolo: (id: string, v: boolean) => void;
  patchLayer: <L extends Layer>(id: string, patch: Partial<L>) => void;

  /* Animated-property writes */
  setPropertyBase: <T>(layerId: string, path: TransformProp | 'size' | 'cornerRadius' | 'fontSize', value: T) => void;
  toggleKeyframe: (layerId: string, path: TransformProp | 'size' | 'cornerRadius' | 'fontSize', easing?: Easing) => void;

  /* Assets */
  addAsset: (a: Asset) => void;

  /* Selection + playhead + playback */
  selectLayer: (id: string | null) => void;
  setCurrentTime: (t: number) => void;
  setIsPlaying: (b: boolean) => void;
  setActiveTool: (t: UIState['activeTool']) => void;
}

const touch = (p: Project): Project => ({ ...p, updatedAt: Date.now() });

/* Locate the AnimatedProperty that a path name refers to on a layer. */
function getAnimated(layer: Layer, path: string): AnimatedProperty<unknown> | null {
  switch (path) {
    case 'position':
    case 'scale':
    case 'rotation':
    case 'anchor':
    case 'opacity':
      return (layer.transform as unknown as Record<string, AnimatedProperty<unknown>>)[path] ?? null;
    case 'size':
      if (layer.type === 'rectangle' || layer.type === 'ellipse') return layer.size;
      return null;
    case 'cornerRadius':
      if (layer.type === 'rectangle') return layer.cornerRadius;
      return null;
    case 'fontSize':
      if (layer.type === 'text') return layer.fontSize;
      return null;
    default:
      return null;
  }
}

function setAnimated(layer: Layer, path: string, next: AnimatedProperty<unknown>): Layer {
  if (['position', 'scale', 'rotation', 'anchor', 'opacity'].includes(path)) {
    return {
      ...layer,
      transform: { ...layer.transform, [path]: next } as Layer['transform'],
    } as Layer;
  }
  if (path === 'size' && (layer.type === 'rectangle' || layer.type === 'ellipse')) {
    return { ...layer, size: next as AnimatedProperty<V2> } as Layer;
  }
  if (path === 'cornerRadius' && layer.type === 'rectangle') {
    return { ...layer, cornerRadius: next as AnimatedProperty<number> };
  }
  if (path === 'fontSize' && layer.type === 'text') {
    return { ...layer, fontSize: next as AnimatedProperty<number> };
  }
  return layer;
}

export const useV1 = create<MotionLabV1State>((set, get) => ({
  project: defaultProject(),
  selectedLayerId: null,
  currentTime: 0,
  isPlaying: false,
  activeTool: 'select',

  newProject: () => set({ project: defaultProject(), selectedLayerId: null, currentTime: 0, isPlaying: false }),
  renameProject: (name) => set((s) => ({ project: touch({ ...s.project, name }) })),

  setCompositionSize: (width, height) =>
    set((s) => ({ project: touch({ ...s.project, composition: { ...s.project.composition, width, height } }) })),
  setCompositionFps: (fps) =>
    set((s) => ({ project: touch({ ...s.project, composition: { ...s.project.composition, fps } }) })),
  setCompositionDuration: (duration) =>
    set((s) => ({ project: touch({ ...s.project, composition: { ...s.project.composition, duration } }) })),

  addTextLayer: () => {
    const l = newTextLayer(get().project.composition);
    set((s) => ({
      project: touch({ ...s.project, layers: [...s.project.layers, l] }),
      selectedLayerId: l.id,
    }));
    return l.id;
  },
  addRectangle: () => {
    const l = newRectangleLayer(get().project.composition);
    set((s) => ({
      project: touch({ ...s.project, layers: [...s.project.layers, l] }),
      selectedLayerId: l.id,
    }));
    return l.id;
  },
  addEllipse: () => {
    const l = newEllipseLayer(get().project.composition);
    set((s) => ({
      project: touch({ ...s.project, layers: [...s.project.layers, l] }),
      selectedLayerId: l.id,
    }));
    return l.id;
  },
  addNull: () => {
    const l = newNullLayer(get().project.composition);
    set((s) => ({
      project: touch({ ...s.project, layers: [...s.project.layers, l] }),
      selectedLayerId: l.id,
    }));
    return l.id;
  },
  addMediaLayer: (asset) => {
    const l = newMediaLayer(get().project.composition, asset.id, asset.name, asset.duration);
    set((s) => ({
      project: touch({ ...s.project, layers: [...s.project.layers, l] }),
      selectedLayerId: l.id,
    }));
    return l.id;
  },
  addImageLayer: (asset) => {
    const l = newImageLayer(get().project.composition, asset.id, asset.name);
    set((s) => ({
      project: touch({ ...s.project, layers: [...s.project.layers, l] }),
      selectedLayerId: l.id,
    }));
    return l.id;
  },

  renameLayer: (id, name) =>
    set((s) => ({
      project: touch({ ...s.project, layers: s.project.layers.map((l) => (l.id === id ? { ...l, name } : l)) }),
    })),

  duplicate: (id) =>
    set((s) => {
      const src = s.project.layers.find((l) => l.id === id);
      if (!src) return s;
      const copy = duplicateLayer(src);
      const idx = s.project.layers.findIndex((l) => l.id === id);
      const layers = [...s.project.layers];
      layers.splice(idx + 1, 0, copy);
      return { project: touch({ ...s.project, layers }), selectedLayerId: copy.id };
    }),

  removeLayer: (id) =>
    set((s) => ({
      project: touch({ ...s.project, layers: s.project.layers.filter((l) => l.id !== id) }),
      selectedLayerId: s.selectedLayerId === id ? null : s.selectedLayerId,
    })),

  reorderLayer: (id, toIndex) =>
    set((s) => {
      const from = s.project.layers.findIndex((l) => l.id === id);
      if (from < 0) return s;
      const layers = [...s.project.layers];
      const [item] = layers.splice(from, 1);
      layers.splice(Math.max(0, Math.min(layers.length, toIndex)), 0, item);
      return { project: touch({ ...s.project, layers }) };
    }),

  setVisible: (id, visible) =>
    set((s) => ({
      project: touch({ ...s.project, layers: s.project.layers.map((l) => (l.id === id ? { ...l, visible } : l)) }),
    })),
  setLocked: (id, locked) =>
    set((s) => ({
      project: touch({ ...s.project, layers: s.project.layers.map((l) => (l.id === id ? { ...l, locked } : l)) }),
    })),
  setSolo: (id, solo) =>
    set((s) => ({
      project: touch({ ...s.project, layers: s.project.layers.map((l) => (l.id === id ? { ...l, solo } : l)) }),
    })),

  patchLayer: (id, patch) =>
    set((s) => ({
      project: touch({
        ...s.project,
        layers: s.project.layers.map((l) =>
          l.id === id ? ({ ...(l as unknown as object), ...(patch as unknown as object) } as Layer) : l,
        ),
      }),
    })),

  setPropertyBase: (layerId, path, value) =>
    set((s) => ({
      project: touch({
        ...s.project,
        layers: s.project.layers.map((l) => {
          if (l.id !== layerId) return l;
          const ap = getAnimated(l, path);
          if (!ap) return l;
          const next: AnimatedProperty<unknown> = { ...ap, default: value };
          return setAnimated(l, path, next);
        }),
      }),
    })),

  toggleKeyframe: (layerId, path, easing) =>
    set((s) => {
      const time = s.currentTime;
      return {
        project: touch({
          ...s.project,
          layers: s.project.layers.map((l) => {
            if (l.id !== layerId) return l;
            const ap = getAnimated(l, path);
            if (!ap) return l;
            const existing = ap.keyframes ?? [];
            const match = existing.find((k) => Math.abs(k.time - time) < 0.01);
            const nextProp = match
              ? removeKeyframeAt(ap, time)
              : upsertKeyframe(ap, time, resolveAnimated(ap, time), easing);
            return setAnimated(l, path, nextProp);
          }),
        }),
      };
    }),

  addAsset: (a) =>
    set((s) => ({ project: touch({ ...s.project, assets: [...s.project.assets, a] }) })),

  selectLayer: (id) => set({ selectedLayerId: id }),
  setCurrentTime: (t) => {
    const comp = get().project.composition;
    set({ currentTime: Math.max(0, Math.min(comp.duration, t)) });
  },
  setIsPlaying: (b) => set({ isPlaying: b }),
  setActiveTool: (t) => set({ activeTool: t }),
}));
