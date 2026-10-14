import { create } from 'zustand';
import type {
  AnimatedProperty,
  Asset,
  Easing,
  EffectProp,
  Layer,
  Project,
  TransformProp,
  V2,
} from './types';
import { removeKeyframeAt, resolveAnimated, upsertKeyframe } from './engine/interp';
import {
  defaultProject,
  duplicateLayer,
  neutralEffects,
  newEllipseLayer,
  newImageLayer,
  newMediaLayer,
  newNullLayer,
  newRectangleLayer,
  newTextLayer,
} from './engine/defaults';
import { createHistory } from './engine/history';
import {
  autosave as persistAutosave,
  loadProject as persistLoad,
  rehydrateMedia,
  saveProject as persistSave,
} from './engine/persist';

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

  /* Animated-property writes (works for transform, shape, text and effect paths) */
  setPropertyBase: <T>(layerId: string, path: TransformProp | EffectProp | 'size' | 'cornerRadius' | 'fontSize', value: T) => void;
  toggleKeyframe: (layerId: string, path: TransformProp | EffectProp | 'size' | 'cornerRadius' | 'fontSize', easing?: Easing) => void;

  /* Effects */
  enableEffects: (layerId: string) => void;
  setEffectTintColor: (layerId: string, color: string) => void;

  /* Timeline clip editing (move, trim, split) */
  moveLayerInTime: (id: string, newStartTime: number) => void;
  trimLayerIn: (id: string, newStartTime: number) => void;   // drag the left edge
  trimLayerOut: (id: string, newEndTime: number) => void;    // drag the right edge
  splitLayerAt: (id: string, time: number) => void;

  /* Assets */
  addAsset: (a: Asset) => void;

  /* Selection + playhead + playback */
  selectLayer: (id: string | null) => void;
  setCurrentTime: (t: number) => void;
  setIsPlaying: (b: boolean) => void;
  setActiveTool: (t: UIState['activeTool']) => void;

  /* History */
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  undoLabel: () => string | null;
  redoLabel: () => string | null;

  /* Persistence */
  savedAt: number | null;
  isDirty: boolean;
  saveToStorage: () => Promise<void>;
  loadFromStorage: (id: string) => Promise<void>;
  replaceProject: (project: Project) => void;
}

const touch = (p: Project): Project => ({ ...p, updatedAt: Date.now() });

/* One module-scoped history + autosave timer. Lives outside create() because
 * the state object is only authoritative for persistent fields; the history
 * stack and the autosave debounce are process state, not project state, and
 * resetting them on hot-reload breaks nothing. */
const initialProject = defaultProject();
const history = createHistory(initialProject);
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
const AUTOSAVE_DEBOUNCE = 1200;
const scheduleAutosave = (project: Project) => {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    void persistAutosave(project).catch(() => undefined);
  }, AUTOSAVE_DEBOUNCE);
};

const EFFECT_KEYS: EffectProp[] = ['brightness', 'contrast', 'saturation', 'blur', 'vignette', 'grain', 'tintAmount'];

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
      if (EFFECT_KEYS.includes(path as EffectProp)) {
        if (!layer.effects) return null;
        return (layer.effects as unknown as Record<string, AnimatedProperty<unknown>>)[path] ?? null;
      }
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
  if (EFFECT_KEYS.includes(path as EffectProp)) {
    const effects = layer.effects ?? neutralEffects();
    return {
      ...layer,
      effects: { ...effects, [path]: next } as Layer['effects'],
    } as Layer;
  }
  return layer;
}

export const useV1 = create<MotionLabV1State>((set, get) => ({
  project: initialProject,
  selectedLayerId: null,
  currentTime: 0,
  isPlaying: false,
  activeTool: 'select',
  savedAt: null,
  isDirty: false,

  newProject: () => {
    const fresh = defaultProject();
    history.clear(fresh);
    set({ project: fresh, selectedLayerId: null, currentTime: 0, isPlaying: false, savedAt: null, isDirty: false });
  },
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

  enableEffects: (layerId) =>
    set((s) => ({
      project: touch({
        ...s.project,
        layers: s.project.layers.map((l) =>
          l.id === layerId && !l.effects ? ({ ...l, effects: neutralEffects() } as Layer) : l,
        ),
      }),
    })),

  setEffectTintColor: (layerId, color) =>
    set((s) => ({
      project: touch({
        ...s.project,
        layers: s.project.layers.map((l) => {
          if (l.id !== layerId) return l;
          const effects = l.effects ?? neutralEffects();
          return { ...l, effects: { ...effects, tintColor: color } } as Layer;
        }),
      }),
    })),

  /* ───── Timeline clip editing ──────────────────────────────────────────
   * Three operations drive timeline interaction:
   *   moveLayerInTime  — slide the clip left/right, duration unchanged.
   *                      For media, sourceIn/sourceOut stay as-is (source
   *                      playback window follows the clip, not real time).
   *   trimLayerIn      — pull the left edge; startTime moves right, duration
   *                      shrinks. For media, sourceIn advances by the same
   *                      delta so the frame visible at the new start matches
   *                      what was previously visible at that composition
   *                      time (Avid/Premiere "ripple-less trim-in" feel).
   *   trimLayerOut     — pull the right edge; duration shrinks. For media,
   *                      sourceOut moves back by the same delta.
   *   splitLayerAt     — produce two layers at `time`: left keeps the
   *                      original id, right is a fresh id. For media,
   *                      sourceIn/Out split proportionally so continuous
   *                      playback is preserved.
   *
   * All four stay within [0, composition.duration] and never allow a clip
   * shorter than 1/fps so there's always at least one frame to render.
   */
  moveLayerInTime: (id, newStartTime) =>
    set((s) => {
      const compDur = s.project.composition.duration;
      return {
        project: touch({
          ...s.project,
          layers: s.project.layers.map((l) => {
            if (l.id !== id) return l;
            const maxStart = Math.max(0, compDur - l.duration);
            const start = Math.max(0, Math.min(maxStart, newStartTime));
            return { ...l, startTime: start } as Layer;
          }),
        }),
      };
    }),

  trimLayerIn: (id, newStartTime) =>
    set((s) => {
      const comp = s.project.composition;
      const minClip = Math.max(0.01, 1 / comp.fps);
      return {
        project: touch({
          ...s.project,
          layers: s.project.layers.map((l) => {
            if (l.id !== id) return l;
            const oldStart = l.startTime;
            const oldEnd = l.startTime + l.duration;
            // New start can't go earlier than 0, nor past (oldEnd - minClip).
            const start = Math.max(0, Math.min(oldEnd - minClip, newStartTime));
            const delta = start - oldStart;
            const dur = l.duration - delta;
            if (l.type === 'media') {
              // Advance sourceIn by the trimmed amount so the frame visible
              // at the new start is the same frame that WAS visible at that
              // composition time before the trim.
              const sourceIn = Math.max(0, l.sourceIn + delta);
              const sourceOut = Math.max(sourceIn + minClip, l.sourceOut);
              return { ...l, startTime: start, duration: dur, sourceIn, sourceOut } as Layer;
            }
            return { ...l, startTime: start, duration: dur } as Layer;
          }),
        }),
      };
    }),

  trimLayerOut: (id, newEndTime) =>
    set((s) => {
      const comp = s.project.composition;
      const minClip = Math.max(0.01, 1 / comp.fps);
      return {
        project: touch({
          ...s.project,
          layers: s.project.layers.map((l) => {
            if (l.id !== id) return l;
            const start = l.startTime;
            const end = Math.max(start + minClip, Math.min(comp.duration, newEndTime));
            const dur = end - start;
            if (l.type === 'media') {
              const delta = dur - l.duration;
              const sourceOut = Math.max(l.sourceIn + minClip, l.sourceOut + delta);
              return { ...l, duration: dur, sourceOut } as Layer;
            }
            return { ...l, duration: dur } as Layer;
          }),
        }),
      };
    }),

  splitLayerAt: (id, time) =>
    set((s) => {
      const idx = s.project.layers.findIndex((l) => l.id === id);
      if (idx < 0) return s;
      const l = s.project.layers[idx];
      const comp = s.project.composition;
      const minClip = Math.max(0.01, 1 / comp.fps);
      // The split time must land strictly inside the clip, with room for
      // minClip on either side.
      const splitWithin = time - l.startTime;
      if (splitWithin <= minClip || splitWithin >= l.duration - minClip) return s;

      // Left half keeps the id (so handles / selection don't jump).
      const leftDuration = splitWithin;
      const rightDuration = l.duration - splitWithin;

      const left: Layer = { ...l, duration: leftDuration } as Layer;
      // Right half is a fresh id + a copy name, placed immediately after the
      // left in draw order (next in layers[]).
      const rightCopy = JSON.parse(JSON.stringify(l)) as Layer;
      rightCopy.id = `l_${Math.random().toString(36).slice(2, 9)}`;
      rightCopy.name = `${l.name} (split)`;
      rightCopy.startTime = l.startTime + splitWithin;
      rightCopy.duration = rightDuration;
      if (l.type === 'media') {
        // Divide the source window proportionally so playback stays
        // seamless across the cut.
        const sourceSpan = l.sourceOut - l.sourceIn;
        const sourceMid = l.sourceIn + (sourceSpan * splitWithin) / l.duration;
        (left as Layer & { sourceOut: number }).sourceOut = sourceMid;
        (rightCopy as Layer & { sourceIn: number; sourceOut: number }).sourceIn = sourceMid;
      }
      const layers = [...s.project.layers];
      layers.splice(idx, 1, left);
      layers.splice(idx + 1, 0, rightCopy);
      return { project: touch({ ...s.project, layers }) };
    }),

  selectLayer: (id) => set({ selectedLayerId: id }),
  setCurrentTime: (t) => {
    const comp = get().project.composition;
    set({ currentTime: Math.max(0, Math.min(comp.duration, t)) });
  },
  setIsPlaying: (b) => set({ isPlaying: b }),
  setActiveTool: (t) => set({ activeTool: t }),

  undo: () => {
    const prev = history.undo();
    if (prev) history.silence(() => set({ project: prev, isDirty: true }));
  },
  redo: () => {
    const next = history.redo();
    if (next) history.silence(() => set({ project: next, isDirty: true }));
  },
  canUndo: () => history.canUndo(),
  canRedo: () => history.canRedo(),
  undoLabel: () => history.state().undoLabel,
  redoLabel: () => history.state().redoLabel,

  saveToStorage: async () => {
    const p = get().project;
    await persistSave(p);
    set({ savedAt: Date.now(), isDirty: false });
  },

  loadFromStorage: async (id: string) => {
    const { saved, autosave } = await persistLoad(id);
    const pick = autosave && (!saved || autosave.savedAt > saved.savedAt) ? autosave : saved;
    if (!pick) throw new Error('Project not found in local storage.');
    const rehydrated = await rehydrateMedia(pick.project);
    history.clear(rehydrated);
    set({
      project: rehydrated,
      selectedLayerId: null,
      currentTime: 0,
      isPlaying: false,
      savedAt: saved?.savedAt ?? null,
      isDirty: !!autosave && (!saved || autosave.savedAt > saved.savedAt),
    });
  },

  replaceProject: (project: Project) => {
    history.clear(project);
    set({ project, selectedLayerId: null, currentTime: 0, isPlaying: false, savedAt: null, isDirty: true });
  },
}));

/* Wire history + autosave: every time the project reference changes, append
 * a snapshot to the history ring and (debounced) write an autosave. Changes
 * made by undo/redo themselves are silenced via history.silence() so they
 * don't re-enter the stack. */
useV1.subscribe((state, prev) => {
  if (state.project !== prev.project) {
    history.push(state.project);
    scheduleAutosave(state.project);
    if (!state.isDirty) useV1.setState({ isDirty: true });
  }
});
