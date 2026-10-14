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
    // Coalesce rapid edits with the same label — "Move Layer" x200 → one entry.
    if (prev && now - prev.at < COALESCE_MS && prev.label === label) {
      entries[index] = { project, at: now, label };
      return;
    }
    // Drop redo stack; append.
    entries = entries.slice(0, index + 1);
    entries.push({ project, at: now, label });
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
