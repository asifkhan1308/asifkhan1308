import type { Project } from '../types';

/* Undo/redo history for V1.
 *
 * Design goal: the store doesn't know history exists. We watch its project
 * field change and append snapshots to a ring buffer. A continuous
 * interaction (slider drag, text typing) coalesces into a single history
 * entry via a short idle window — "move Layer" instead of 200 micro-steps.
 *
 * Capped at MAX_ENTRIES to bound memory on long sessions.
 */

const MAX_ENTRIES = 100;
/** When two project changes land within this many ms, they merge into the
 *  same undo entry — so dragging a slider counts as one undo. */
const COALESCE_MS = 400;

interface Entry {
  project: Project;
  at: number;
  label: string;
  /** What this entry changed, so only repeats of the same edit coalesce. */
  key?: string;
}

/** Signature of the change prev → next: which layers / comp settings it
 *  touched. Structural changes (add, delete, reorder) get a unique key so
 *  they never merge with neighbours. Relies on the store's immutable
 *  updates: untouched layers keep their object identity. */
let uniq = 0;
export function changeKey(prev: Project, next: Project): string {
  const a = prev.layers, b = next.layers;
  if (a.length !== b.length || a.some((l, i) => l.id !== b[i].id)) return `struct#${++uniq}`;
  const parts: string[] = [];
  if (prev.composition !== next.composition) parts.push('comp');
  b.forEach((l, i) => { if (l !== a[i]) parts.push(l.id); });
  if (prev.assets !== next.assets) parts.push('assets');
  // Markers / review comments: adding or removing one is its own step;
  // edits (rename, resolve) only merge with the same kind of edit.
  for (const k of ['markers', 'comments'] as const) {
    if (prev[k] === next[k]) continue;
    if ((prev[k]?.length ?? 0) !== (next[k]?.length ?? 0)) return `struct#${++uniq}`;
    parts.push(k);
  }
  return parts.join(',') || 'meta';
}

export interface HistoryHandle {
  push: (project: Project, label?: string) => void;
  undo: () => Project | null;
  redo: () => Project | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: (initial: Project) => void;
  state: () => { undoLabel: string | null; redoLabel: string | null };
  /** Pause coalescing + snapshotting while a bulk op runs. */
  silence: (fn: () => void) => void;
}

export function createHistory(initial: Project): HistoryHandle {
  // index points at the current project in `entries`. Entries after it are
  // the redo stack. A push after an undo truncates the redo stack.
  let entries: Entry[] = [{ project: initial, at: Date.now(), label: 'New project' }];
  let index = 0;
  let silenced = 0;

  const push: HistoryHandle['push'] = (project, label = 'Edit') => {
    if (silenced > 0) return;
    const now = Date.now();
    const prev = entries[index];
    // Reference-equal projects (no real change) are ignored.
    if (prev && prev.project === project) return;
    const key = prev ? changeKey(prev.project, project) : undefined;
    // Coalesce rapid repeats of the same edit — a slider drag on one layer
    // → one entry — but never chain different edits into one undo step.
    if (prev && index > 0 && now - prev.at < COALESCE_MS && prev.label === label && prev.key === key) {
      entries[index] = { project, at: now, label, key };
      return;
    }
    // Drop redo stack; append.
    entries = entries.slice(0, index + 1);
    entries.push({ project, at: now, label, key });
    if (entries.length > MAX_ENTRIES) {
      entries = entries.slice(entries.length - MAX_ENTRIES);
    }
    index = entries.length - 1;
  };

  const undo: HistoryHandle['undo'] = () => {
    if (index <= 0) return null;
    index--;
    return entries[index].project;
  };

  const redo: HistoryHandle['redo'] = () => {
    if (index >= entries.length - 1) return null;
    index++;
    return entries[index].project;
  };

  return {
    push,
    undo,
    redo,
    canUndo: () => index > 0,
    canRedo: () => index < entries.length - 1,
    clear: (initialProject: Project) => {
      entries = [{ project: initialProject, at: Date.now(), label: 'Open project' }];
      index = 0;
    },
    state: () => ({
      undoLabel: index > 0 ? entries[index].label : null,
      redoLabel: index < entries.length - 1 ? entries[index + 1].label : null,
    }),
    silence: (fn) => {
      silenced++;
      try {
        fn();
      } finally {
        silenced--;
      }
    },
  };
}
