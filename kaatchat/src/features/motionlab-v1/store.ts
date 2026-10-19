import { create } from 'zustand';
import type {
  AnimatedProperty,
  Asset,
  Bezier,
  Easing,
  MatteMode,
  ReviewComment,
  RevealMode,
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
import { decompose, invert, IDENTITY, mul, worldMatrix, wouldCycle } from './engine/matrix';
import { worldCorners } from './engine/bbox';
import { aabb, alignDelta, type AlignEdge, type Box } from './engine/guides';
import {
  autosave as persistAutosave,
  loadProject as persistLoad,
  rehydrateMedia,
  saveProject as persistSave,
} from './engine/persist';

interface UIState {
  selectedLayerId: string | null;
  /** Multi-selection (Figma-style). The primary layer is selectedLayerId;
   *  read the effective set with selectionOf(state). */
  selectedIds: string[];
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
  /** Motion blur on/off and shutter (fraction of a frame, 0.5 = 180°). */
  setMotionBlur: (mb: { enabled: boolean; shutter?: number; samples?: number }) => void;

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
  setPropertyBase: <T>(layerId: string, path: TransformProp | EffectProp | 'size' | 'cornerRadius' | 'fontSize' | 'reveal', value: T) => void;
  toggleKeyframe: (layerId: string, path: TransformProp | EffectProp | 'size' | 'cornerRadius' | 'fontSize' | 'reveal', easing?: Easing) => void;

  /* Effects */
  enableEffects: (layerId: string) => void;
  setEffectTintColor: (layerId: string, color: string) => void;

  /* Timeline clip editing (move, trim, split) */
  moveLayerInTime: (id: string, newStartTime: number) => void;
  trimLayerIn: (id: string, newStartTime: number) => void;   // drag the left edge
  trimLayerOut: (id: string, newEndTime: number) => void;    // drag the right edge
  splitLayerAt: (id: string, time: number) => void;

  /* Keyframe editing on the timeline (all animated props of a layer at once) */
  moveKeyframesAt: (layerId: string, fromTime: number, toTime: number) => void;
  copyKeyframesAt: (layerId: string, time: number) => number;
  pasteKeyframesAt: (layerId: string, time: number) => number;
  hasKeyframeClipboard: () => boolean;
  /** Layer clipboard: copies layers (+ the media they use); paste works in
   *  any project. Links (parent / matte) inside the copied set are kept. */
  copyLayers: (ids: string[]) => number;
  pasteLayers: () => number;
  hasLayerClipboard: () => boolean;
  /** Which clipboard ⌘V should use: whatever was copied last. */
  lastCopied: () => 'keyframes' | 'layers' | null;
  /** Easing INTO the keyframe at `time` (how the segment arriving there moves). */
  setKeyframeEasing: (layerId: string, path: string, time: number, easing: Easing, bezier?: Bezier) => void;
  /** Insert-or-replace a keyframe with an explicit value (never toggles). */
  setKeyframeAt: (layerId: string, path: string, time: number, value: unknown) => boolean;

  /* Assets */
  addAsset: (a: Asset) => void;

  /* Selection + playhead + playback */
  selectLayer: (id: string | null) => void;
  /** Shift / ⌘-click: add or remove a layer from the selection. */
  toggleSelect: (id: string) => void;
  selectAll: () => void;
  /** Group operations on the current selection — each is one undo step. */
  removeSelected: () => void;
  duplicateSelected: () => void;
  /** Align: 1 layer → to the frame; 2+ → to the selection's bounds. */
  alignSelected: (edge: AlignEdge) => void;
  /** Spread 3+ selected layers evenly between the outermost two. */
  distributeSelected: (axis: 'x' | 'y') => void;
  setCurrentTime: (t: number) => void;
  setIsPlaying: (b: boolean) => void;
  setActiveTool: (t: UIState['activeTool']) => void;

  /* History */
  /* Timeline markers */
  addMarker: (time: number, label?: string) => string;
  renameMarker: (id: string, label: string) => void;
  removeMarker: (id: string) => void;

  /* Review feedback (V1.5) */
  addComments: (list: ReviewComment[]) => number;   // returns how many were new
  setCommentResolved: (id: string, resolved: boolean) => void;
  removeComment: (id: string) => void;

  /** Parent a layer (null = unparent). Keeps it visually in place. Returns
   *  false when the parent would create a loop. */
  setParent: (id: string, parentId: string | null) => boolean;
  /** Track matte (null = none). Returns false for a missing / self source. */
  setMatte: (id: string, matte: { layerId: string; mode: MatteMode } | null) => boolean;
  /** Text animator (null = off). Turning it on with no reveal keys adds a
   *  0 → 100 % reveal over the clip's first ~1.5 s, so it works in one click. */
  setTextAnimator: (id: string, mode: RevealMode | null) => void;
  /** Align a layer's on-screen box to the composition frame (Figma-style). */
  alignToFrame: (id: string, edge: AlignEdge) => void;

  /** Run several edits as ONE undo step (e.g. a whole ✦ Ask command). */
  batch: (fn: () => void, label?: string) => void;
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
/** True while a project is being opened: that swap is not an edit. */
let opening = false;
const AUTOSAVE_DEBOUNCE = 1200;
const scheduleAutosave = (project: Project) => {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    void persistAutosave(project).catch(() => undefined);
  }, AUTOSAVE_DEBOUNCE);
};

const EFFECT_KEYS: EffectProp[] = ['brightness', 'contrast', 'saturation', 'blur', 'vignette', 'grain', 'tintAmount', 'shadow', 'glow'];

/* Every animatable path a layer may carry. Timeline keyframe ops walk this
 * list so a diamond on the track moves/copies all props keyed at that time. */
const ALL_ANIM_PATHS: string[] = [
  'position', 'scale', 'rotation', 'anchor', 'opacity',
  'size', 'cornerRadius', 'fontSize', 'reveal',
  ...EFFECT_KEYS,
];
const KF_EPS = 0.01;
type KfClip = { path: string; value: unknown; easing?: Easing; bezier?: Bezier }[];
let kfClipboard: KfClip | null = null;
let layerClipboard: { layers: Layer[]; assets: Asset[] } | null = null;
let lastCopied: 'keyframes' | 'layers' | null = null;
const newLayerId = () => `l_${Math.random().toString(36).slice(2, 9)}`;

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
    case 'reveal':
      // Absent = fully revealed; materialised on first edit.
      if (layer.type === 'text') return layer.reveal ?? { default: 1 };
      return null;
    default:
      if (EFFECT_KEYS.includes(path as EffectProp)) {
        if (!layer.effects) return null;
        // Effects added later (shadow, glow) may be missing on older saves: 0.
        return (layer.effects as unknown as Record<string, AnimatedProperty<unknown>>)[path] ?? { default: 0 };
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
  if (path === 'reveal' && layer.type === 'text') {
    return { ...layer, reveal: next as AnimatedProperty<number> };
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

/* Re-parent while keeping the layer where it is on screen (at `time`):
 * newLocal = inverse(newParentWorld) · oldWorld, decomposed back into the
 * layer's position / rotation / scale. Only un-animated props are rewritten;
 * keyframed ones keep their keys (they are relative to the new parent now). */
function reparent(layers: Layer[], id: string, parentId: string | null, time: number): Layer[] {
  const layer = layers.find((l) => l.id === id);
  if (!layer) return layers;
  const oldWorld = worldMatrix(layer, layers, time);
  const parent = parentId ? layers.find((l) => l.id === parentId) : undefined;
  const inv = invert(parent ? worldMatrix(parent, layers, time) : IDENTITY);
  const next: Layer = { ...layer, parentId: parent ? parent.id : undefined };
  if (inv) {
    const d = decompose(mul(inv, oldWorld), resolveAnimated(layer.transform.anchor, time));
    const tr = { ...layer.transform };
    const still = (k: 'position' | 'rotation' | 'scale') => !tr[k].keyframes?.length;
    const round = (v: number) => Math.round(v * 1000) / 1000;
    if (still('position')) tr.position = { ...tr.position, default: [round(d.position[0]), round(d.position[1])] };
    if (still('rotation')) tr.rotation = { ...tr.rotation, default: round(d.rotation) };
    if (still('scale')) tr.scale = { ...tr.scale, default: [round(d.scale[0]), round(d.scale[1])] };
    next.transform = tr;
  }
  return layers.map((l) => (l.id === id ? next : l));
}

/** The effective selection: selectedIds when it contains the primary layer
 *  (else just the primary — older code paths set only selectedLayerId),
 *  limited to layers that still exist, in stacking order. */
export function selectionOf(s: Pick<MotionLabV1State, 'selectedIds' | 'selectedLayerId' | 'project'>): string[] {
  const p = s.selectedLayerId;
  const ids = p && s.selectedIds.includes(p) ? s.selectedIds : p ? [p] : [];
  return s.project.layers.filter((l) => ids.includes(l.id)).map((l) => l.id);
}

function boxOf(s: MotionLabV1State, id: string) {
  const layer = s.project.layers.find((l) => l.id === id);
  const world = layer && worldCorners(layer, s.currentTime, s.project.assets, s.project.layers);
  return world ? { id, world } : null;
}

/** Shift a layer's position by a parent-space delta (auto-keys if animated). */
function moveBy(s: MotionLabV1State, id: string, d: V2) {
  const layer = s.project.layers.find((l) => l.id === id);
  if (!layer) return;
  const [x, y] = resolveAnimated(layer.transform.position, s.currentTime);
  const r = (v: number) => Math.round(v * 100) / 100;
  s.setPropertyBase<V2>(id, 'position', [r(x + d[0]), r(y + d[1])]);
}

export const useV1 = create<MotionLabV1State>((set, get) => ({
  project: initialProject,
  selectedLayerId: null,
  selectedIds: [],
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
  setMotionBlur: (mb) =>
    set((s) => {
      const cur = s.project.composition.motionBlur;
      const shutter = Math.max(0.05, Math.min(1, mb.shutter ?? cur?.shutter ?? 0.5));
      const samples = Math.max(2, Math.min(32, Math.round(mb.samples ?? cur?.samples ?? 8)));
      return { project: touch({ ...s.project, composition: { ...s.project.composition, motionBlur: { enabled: mb.enabled, shutter, samples } } }) };
    }),
  setCompositionFps: (fps) =>
    set((s) => ({ project: touch({ ...s.project, composition: { ...s.project.composition, fps } }) })),
  setCompositionDuration: (duration) =>
    set((s) => {
      if (!Number.isFinite(duration) || duration <= 0) return s;
      // Layers past the new end are kept (non-destructive, like AE); only the
      // playhead must stay inside the comp.
      return {
        project: touch({ ...s.project, composition: { ...s.project.composition, duration } }),
        currentTime: Math.min(s.currentTime, duration),
      };
    }),

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
    const l = newMediaLayer(get().project.composition, asset.id, asset.name, asset.duration, asset.width, asset.height);
    set((s) => ({
      project: touch({ ...s.project, layers: [...s.project.layers, l] }),
      selectedLayerId: l.id,
    }));
    return l.id;
  },
  addImageLayer: (asset) => {
    const l = newImageLayer(get().project.composition, asset.id, asset.name, asset.width, asset.height);
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
    set((s) => {
      // Children of a deleted parent are released where they currently are.
      let layers = s.project.layers;
      for (const child of layers.filter((l) => l.parentId === id)) layers = reparent(layers, child.id, null, s.currentTime);
      // …and layers matted by it lose the matte instead of pointing at nothing.
      layers = layers.map((l) => (l.matte?.layerId === id ? { ...l, matte: undefined } : l));
      return {
        project: touch({ ...s.project, layers: layers.filter((l) => l.id !== id) }),
        selectedLayerId: s.selectedLayerId === id ? null : s.selectedLayerId,
      };
    }),

  setTextAnimator: (id, mode) =>
    set((s) => ({
      project: touch({
        ...s.project,
        layers: s.project.layers.map((l) => {
          if (l.id !== id || l.type !== 'text') return l;
          if (!mode) return { ...l, revealMode: undefined, reveal: undefined };
          if (l.reveal?.keyframes?.length) return { ...l, revealMode: mode };
          const t0 = l.startTime;
          const t1 = Math.min(l.startTime + l.duration, t0 + Math.min(1.5, Math.max(0.3, l.duration * 0.5)));
          const ease: Easing = mode === 'typewriter' ? 'linear' : 'ease-out';
          return {
            ...l,
            revealMode: mode,
            reveal: { default: 1, keyframes: [{ time: t0, value: 0 }, { time: +t1.toFixed(3), value: 1, easing: ease }] },
          };
        }),
      }),
    })),

  alignToFrame: (id, edge) => {
    const s = get();
    const layer = s.project.layers.find((l) => l.id === id);
    if (!layer) return;
    const b = worldCorners(layer, s.currentTime, s.project.assets, s.project.layers);
    if (!b) return;
    const d = b.toParent(alignDelta(aabb(b.corners), edge, s.project.composition));
    const [x, y] = resolveAnimated(layer.transform.position, s.currentTime);
    const r = (v: number) => Math.round(v * 100) / 100;
    s.setPropertyBase<V2>(id, 'position', [r(x + d[0]), r(y + d[1])]);
  },

  setMatte: (id, matte) => {
    const layers = get().project.layers;
    if (matte && (matte.layerId === id || !layers.some((l) => l.id === matte.layerId))) return false;
    set((s) => ({
      project: touch({
        ...s.project,
        layers: s.project.layers.map((l) => (l.id === id ? { ...l, matte: matte ? { ...matte } : undefined } : l)),
      }),
    }));
    return true;
  },

  setParent: (id, parentId) => {
    const layers = get().project.layers;
    if (parentId && (wouldCycle(id, parentId, layers) || !layers.some((l) => l.id === parentId))) return false;
    if ((layers.find((l) => l.id === id)?.parentId ?? null) === parentId) return true;
    set((s) => ({ project: touch({ ...s.project, layers: reparent(s.project.layers, id, parentId, s.currentTime) }) }));
    return true;
  },

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
          // After Effects semantics: once a property is animated, editing it
          // writes a keyframe at the playhead (keeping that key's easing).
          // Unanimated properties just change their static value.
          if (ap.keyframes?.length) {
            const at = ap.keyframes.find((k) => Math.abs(k.time - s.currentTime) < KF_EPS);
            return setAnimated(l, path, upsertKeyframe(ap, at ? at.time : s.currentTime, value, at?.easing));
          }
          const next: AnimatedProperty<unknown> = { ...ap, default: value };
          return setAnimated(l, path, next);
        }),
      }),
    })),

  setKeyframeEasing: (layerId, path, time, easing, bezier) =>
    set((s) => ({
      project: touch({
        ...s.project,
        layers: s.project.layers.map((l) => {
          if (l.id !== layerId) return l;
          const ap = getAnimated(l, path);
          if (!ap?.keyframes?.length) return l;
          // A curve is kept only for 'bezier'; switching away drops it.
          const kfs = ap.keyframes.map((k) =>
            Math.abs(k.time - time) < KF_EPS
              ? { ...k, easing, bezier: easing === 'bezier' ? (bezier ?? k.bezier ?? [0.42, 0, 0.58, 1]) : undefined }
              : k,
          );
          return setAnimated(l, path, { ...ap, keyframes: kfs });
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

  moveKeyframesAt: (layerId, fromTime, toTime) =>
    set((s) => {
      const to = Math.max(0, Math.min(s.project.composition.duration, toTime));
      if (Math.abs(to - fromTime) < 1e-6) return s;
      let changed = false;
      const layers = s.project.layers.map((l) => {
        if (l.id !== layerId) return l;
        let next = l;
        for (const path of ALL_ANIM_PATHS) {
          const ap = getAnimated(next, path);
          if (!ap?.keyframes?.length) continue;
          const moving = ap.keyframes.filter((k) => Math.abs(k.time - fromTime) < KF_EPS);
          if (!moving.length) continue;
          // Moved keys overwrite any key already sitting at the destination.
          const rest = ap.keyframes.filter(
            (k) => Math.abs(k.time - fromTime) >= KF_EPS && Math.abs(k.time - to) >= KF_EPS,
          );
          const kfs = [...rest, ...moving.map((k) => ({ ...k, time: to }))].sort((a, b) => a.time - b.time);
          next = setAnimated(next, path, { ...ap, keyframes: kfs });
          changed = true;
        }
        return next;
      });
      return changed ? { project: touch({ ...s.project, layers }) } : s;
    }),

  copyKeyframesAt: (layerId, time) => {
    const l = get().project.layers.find((x) => x.id === layerId);
    if (!l) return 0;
    const clip: KfClip = [];
    for (const path of ALL_ANIM_PATHS) {
      const k = getAnimated(l, path)?.keyframes?.find((x) => Math.abs(x.time - time) < KF_EPS);
      if (k) clip.push({ path, value: JSON.parse(JSON.stringify(k.value)), easing: k.easing, bezier: k.bezier ? [...k.bezier] as Bezier : undefined });
    }
    if (clip.length) { kfClipboard = clip; lastCopied = 'keyframes'; }
    return clip.length;
  },

  pasteKeyframesAt: (layerId, time) => {
    const clip = kfClipboard;
    if (!clip?.length) return 0;
    let pasted = 0;
    set((s) => ({
      project: touch({
        ...s.project,
        layers: s.project.layers.map((l) => {
          if (l.id !== layerId) return l;
          let next = l;
          for (const c of clip) {
            // Skip props this layer type doesn't have (e.g. fontSize onto a rect).
            let ap = getAnimated(next, c.path);
            if (!ap && EFFECT_KEYS.includes(c.path as EffectProp)) {
              next = { ...next, effects: next.effects ?? neutralEffects() } as Layer;
              ap = getAnimated(next, c.path);
            }
            if (!ap) continue;
            const withKey = upsertKeyframe(ap, time, c.value, c.easing);
            // Carry a custom curve along with its easing (not just the name).
            const keyed = c.bezier
              ? { ...withKey, keyframes: withKey.keyframes!.map((k) => (Math.abs(k.time - time) < KF_EPS ? { ...k, bezier: c.bezier } : k)) }
              : withKey;
            next = setAnimated(next, c.path, keyed);
            pasted++;
          }
          return next;
        }),
      }),
    }));
    return pasted;
  },

  hasKeyframeClipboard: () => !!kfClipboard?.length,

  setKeyframeAt: (layerId, path, time, value) => {
    let ok = false;
    const t = Math.max(0, Math.min(get().project.composition.duration, time));
    set((s) => ({
      project: touch({
        ...s.project,
        layers: s.project.layers.map((l) => {
          if (l.id !== layerId) return l;
          let next = l;
          if (!getAnimated(next, path) && EFFECT_KEYS.includes(path as EffectProp)) {
            next = { ...next, effects: next.effects ?? neutralEffects() } as Layer;
          }
          const ap = getAnimated(next, path);
          if (!ap) return l;
          ok = true;
          return setAnimated(next, path, upsertKeyframe(ap, t, value));
        }),
      }),
    }));
    return ok;
  },

  selectLayer: (id) => set({ selectedLayerId: id, selectedIds: id ? [id] : [] }),
  toggleSelect: (id) => {
    const cur = selectionOf(get());
    if (cur.includes(id)) {
      const rest = cur.filter((x) => x !== id);
      set({ selectedIds: rest, selectedLayerId: rest[rest.length - 1] ?? null });
    } else {
      set({ selectedIds: [...cur, id], selectedLayerId: id });
    }
  },
  selectAll: () => {
    const ids = get().project.layers.map((l) => l.id);
    set({ selectedIds: ids, selectedLayerId: ids[ids.length - 1] ?? null });
  },
  removeSelected: () => {
    const ids = selectionOf(get());
    if (!ids.length) return;
    get().batch(() => ids.forEach((id) => get().removeLayer(id)), 'Delete');
    set({ selectedIds: [], selectedLayerId: null });
  },
  duplicateSelected: () => {
    const ids = selectionOf(get());
    if (!ids.length) return;
    const copies: string[] = [];
    get().batch(() => ids.forEach((id) => { get().duplicate(id); copies.push(get().selectedLayerId!); }), 'Duplicate');
    set({ selectedIds: copies, selectedLayerId: copies[copies.length - 1] ?? null });
  },
  alignSelected: (edge) => {
    const s = get();
    const ids = selectionOf(s);
    if (ids.length === 1) { s.alignToFrame(ids[0], edge); return; }
    const boxes = ids.map((id) => boxOf(s, id)).filter((b): b is NonNullable<ReturnType<typeof boxOf>> => !!b);
    if (boxes.length < 2) return;
    const all = aabb(boxes.flatMap((b) => b.world.corners));
    // Align each box against the selection's bounds (a "frame" of that size).
    s.batch(() => {
      for (const b of boxes) {
        const own = aabb(b.world.corners);
        const local: Box = { minX: own.minX - all.minX, maxX: own.maxX - all.minX, minY: own.minY - all.minY, maxY: own.maxY - all.minY };
        moveBy(get(), b.id, b.world.toParent(alignDelta(local, edge, { width: all.maxX - all.minX, height: all.maxY - all.minY })));
      }
    }, 'Align');
  },
  distributeSelected: (axis) => {
    const s = get();
    const boxes = selectionOf(s).map((id) => boxOf(s, id)).filter((b): b is NonNullable<ReturnType<typeof boxOf>> => !!b);
    if (boxes.length < 3) return;
    const centre = (b: (typeof boxes)[number]) => { const a = aabb(b.world.corners); return axis === 'x' ? (a.minX + a.maxX) / 2 : (a.minY + a.maxY) / 2; };
    const sorted = [...boxes].sort((a, b) => centre(a) - centre(b));
    const first = centre(sorted[0]), last = centre(sorted[sorted.length - 1]);
    const step = (last - first) / (sorted.length - 1);
    s.batch(() => {
      sorted.forEach((b, i) => {
        const d = first + step * i - centre(b);
        if (Math.abs(d) > 1e-6) moveBy(get(), b.id, b.world.toParent(axis === 'x' ? [d, 0] : [0, d]));
      });
    }, 'Distribute');
  },
  setCurrentTime: (t) => {
    const comp = get().project.composition;
    set({ currentTime: Math.max(0, Math.min(comp.duration, t)) });
  },
  setIsPlaying: (b) => set({ isPlaying: b }),
  setActiveTool: (t) => set({ activeTool: t }),

  addMarker: (time, label) => {
    const t = Math.max(0, Math.min(get().project.composition.duration, +time.toFixed(3)));
    const existing = (get().project.markers ?? []).find((m) => Math.abs(m.time - t) < 0.01);
    if (existing) return existing.id;                    // one marker per moment
    const id = `m_${Math.random().toString(36).slice(2, 8)}`;
    set((s) => {
      const list = [...(s.project.markers ?? []), { id, time: t, label: label?.trim() || `Marker ${(s.project.markers?.length ?? 0) + 1}` }];
      return { project: touch({ ...s.project, markers: list.sort((a, b) => a.time - b.time) }) };
    });
    return id;
  },
  renameMarker: (id, label) =>
    set((s) => ({ project: touch({ ...s.project, markers: (s.project.markers ?? []).map((m) => (m.id === id ? { ...m, label: label.trim() || m.label } : m)) }) })),
  removeMarker: (id) =>
    set((s) => ({ project: touch({ ...s.project, markers: (s.project.markers ?? []).filter((m) => m.id !== id) }) })),

  addComments: (list) => {
    const have = new Set((get().project.comments ?? []).map((c) => c.id));
    const fresh = list.filter((c) => !have.has(c.id));
    if (fresh.length) {
      set((s) => ({
        project: touch({ ...s.project, comments: [...(s.project.comments ?? []), ...fresh].sort((a, b) => a.time - b.time) }),
      }));
    }
    return fresh.length;
  },
  setCommentResolved: (id, resolved) =>
    set((s) => ({
      project: touch({ ...s.project, comments: (s.project.comments ?? []).map((c) => (c.id === id ? { ...c, resolved } : c)) }),
    })),
  removeComment: (id) =>
    set((s) => ({ project: touch({ ...s.project, comments: (s.project.comments ?? []).filter((c) => c.id !== id) }) })),

  copyLayers: (ids) => {
    const p = get().project;
    const layers = p.layers.filter((l) => ids.includes(l.id));
    if (!layers.length) return 0;
    const assetIds = new Set(layers.map((l) => (l.type === 'media' || l.type === 'image' ? l.assetId : '')).filter(Boolean));
    layerClipboard = {
      layers: JSON.parse(JSON.stringify(layers)) as Layer[],
      assets: p.assets.filter((a) => assetIds.has(a.id)).map((a) => ({ ...a })),
    };
    lastCopied = 'layers';
    return layers.length;
  },
  pasteLayers: () => {
    const clip = layerClipboard;
    if (!clip?.layers.length) return 0;
    const map = new Map(clip.layers.map((l) => [l.id, newLayerId()]));
    const pasted: Layer[] = clip.layers.map((src) => {
      const l = JSON.parse(JSON.stringify(src)) as Layer;
      l.id = map.get(src.id)!;
      // Keep links within the pasted set; drop ones that would point elsewhere.
      l.parentId = src.parentId && map.has(src.parentId) ? map.get(src.parentId) : undefined;
      l.matte = src.matte && map.has(src.matte.layerId) ? { ...src.matte, layerId: map.get(src.matte.layerId)! } : undefined;
      return l;
    });
    set((s) => {
      const have = new Set(s.project.assets.map((a) => a.id));
      const assets = [...s.project.assets, ...clip.assets.filter((a) => !have.has(a.id))];
      return {
        project: touch({ ...s.project, assets, layers: [...s.project.layers, ...pasted] }),
        selectedIds: pasted.map((l) => l.id),
        selectedLayerId: pasted[pasted.length - 1].id,
      };
    });
    return pasted.length;
  },
  hasLayerClipboard: () => !!layerClipboard?.layers.length,
  lastCopied: () => lastCopied,

  batch: (fn, label = 'Edit') => {
    const before = get().project;
    history.silence(fn);
    if (get().project !== before) history.push(get().project, label);
  },

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
    // The pending autosave holds this same project; writing it after the
    // save would make reopening think there are unsaved changes.
    if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
    await persistSave(p);
    set({ savedAt: Date.now(), isDirty: false });
  },

  loadFromStorage: async (id: string) => {
    const { saved, autosave } = await persistLoad(id);
    const newer = !!autosave && (!saved || autosave.savedAt > saved.savedAt);
    // An autosave identical to the save is not an unsaved change.
    const differs = newer && (!saved || JSON.stringify(autosave!.project) !== JSON.stringify(saved.project));
    const pick = newer ? autosave : saved;
    if (!pick) throw new Error('Project not found in local storage.');
    const rehydrated = await rehydrateMedia(pick.project);
    history.clear(rehydrated);
    opening = true; // opening a project is not an edit (no dirty flag, no history entry)
    try {
      set({
        project: rehydrated,
        selectedLayerId: null,
        currentTime: 0,
        isPlaying: false,
        savedAt: saved?.savedAt ?? null,
        isDirty: differs,
      });
    } finally {
      opening = false;
    }
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
    if (opening) return;
    history.push(state.project);
    scheduleAutosave(state.project);
    if (!state.isDirty) useV1.setState({ isDirty: true });
  }
});
