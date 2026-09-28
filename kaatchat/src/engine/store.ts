// Editor state. The document is immutable; every change is a transaction
// that pushes the previous document onto the undo stack. One transaction =
// one Ctrl+Z, however many commands it contains (a whole AI plan included).

import type { ProjectDoc, ProjectIndex, AssetIndex, MediaAsset, Clip } from './types';
import type { Command, EditPlan } from './commands/schema';
import { applyCommand, previewPlan, CommandError } from './commands/execute';
import { uid } from './id';

export interface HistoryEntry {
  id: string;
  label: string;
  source: 'you' | 'ai' | 'magic';
  at: number;
  notes: string[];
}

interface Snapshot {
  doc: ProjectDoc;
  entry: HistoryEntry;
}

const HISTORY_LIMIT = 200;

export type Listener = () => void;

export class EditorStore {
  private _doc: ProjectDoc;
  private _index: ProjectIndex;
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private listeners = new Set<Listener>();
  private _version = 0;
  /** Named versions: full document copies the user can return to. */
  versions: { id: string; name: string; at: number; doc: ProjectDoc }[] = [];

  constructor(doc: ProjectDoc, index: ProjectIndex = {}) {
    this._doc = doc;
    this._index = index;
  }

  get doc() {
    return this._doc;
  }
  get index() {
    return this._index;
  }
  /** Changes on every document or index update; handy for memo keys. */
  get version() {
    return this._version;
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  get history(): HistoryEntry[] {
    return this.past.map((s) => s.entry);
  }
  get redoLabel() {
    return this.future[this.future.length - 1]?.entry.label;
  }
  get undoLabel() {
    return this.past[this.past.length - 1]?.entry.label;
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this._version;

  private emit() {
    this._version++;
    for (const l of this.listeners) l();
  }

  private commit(next: ProjectDoc, label: string, source: HistoryEntry['source'], notes: string[]) {
    if (next === this._doc) return;
    const entry: HistoryEntry = { id: uid(), label, source, at: Date.now(), notes };
    this.past.push({ doc: this._doc, entry });
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this._doc = { ...next, updatedAt: Date.now() };
    this.emit();
  }

  /** Run commands as a single undoable step. Throws (and changes nothing) on failure. */
  run(commands: Command[], label: string, source: HistoryEntry['source'] = 'you'): string[] {
    let cur = this._doc;
    const notes: string[] = [];
    for (const cmd of commands) {
      const r = applyCommand(cur, cmd, { index: this._index, newId: uid });
      cur = r.doc;
      notes.push(...r.notes);
    }
    this.commit(cur, label, source, notes);
    return notes;
  }

  /** Apply a validated plan atomically. */
  applyPlan(plan: EditPlan, label: string, source: HistoryEntry['source'] = 'ai') {
    const p = previewPlan(this._doc, plan, { index: this._index, newId: uid });
    if (!p.ok) {
      const err = p.steps.find((s) => s.error)?.error ?? 'The plan could not be applied.';
      throw new CommandError(err);
    }
    this.commit(p.doc, label, source, p.steps.flatMap((s) => s.notes));
    return p;
  }

  preview(plan: EditPlan) {
    return previewPlan(this._doc, plan, { index: this._index, newId: uid });
  }

  /** Structural edits that are not expressible as AI commands (imports etc.). */
  mutate(label: string, fn: (doc: ProjectDoc) => ProjectDoc) {
    this.commit(fn(this._doc), label, 'you', []);
  }

  addAsset(asset: MediaAsset, addClip = true) {
    this.mutate(`Import ${asset.name}`, (d) => {
      const clips: Clip[] = addClip
        ? [
            ...d.clips,
            { id: uid(), assetId: asset.id, in: 0, out: asset.duration, gainDb: 0, focusX: 0.5, focusY: 0.5, fit: 'fill' },
          ]
        : d.clips;
      return { ...d, assets: { ...d.assets, [asset.id]: asset }, clips };
    });
  }

  /** Update asset metadata without creating an undo step (e.g. relinking). */
  patchAsset(id: string, patch: Partial<MediaAsset>) {
    const a = this._doc.assets[id];
    if (!a) return;
    this._doc = { ...this._doc, assets: { ...this._doc.assets, [id]: { ...a, ...patch } } };
    // Keep history snapshots consistent so undo does not resurrect stale storage state.
    const fix = (s: Snapshot) =>
      s.doc.assets[id] ? { ...s, doc: { ...s.doc, assets: { ...s.doc.assets, [id]: { ...s.doc.assets[id], ...patch } } } } : s;
    this.past = this.past.map(fix);
    this.future = this.future.map(fix);
    this.emit();
  }

  setIndex(assetId: string, patch: Partial<AssetIndex>) {
    this._index = { ...this._index, [assetId]: { ...this._index[assetId], ...patch } };
    this.emit();
  }

  undo() {
    const s = this.past.pop();
    if (!s) return;
    this.future.push({ doc: this._doc, entry: s.entry });
    this._doc = s.doc;
    this.emit();
  }

  redo() {
    const s = this.future.pop();
    if (!s) return;
    this.past.push({ doc: this._doc, entry: s.entry });
    this._doc = s.doc;
    this.emit();
  }

  saveVersion(name: string) {
    this.versions = [...this.versions, { id: uid(), name, at: Date.now(), doc: this._doc }];
    this.emit();
  }

  restoreVersion(id: string) {
    const v = this.versions.find((x) => x.id === id);
    if (!v) return;
    // Media added since the version was saved stays in the bin.
    this.commit({ ...v.doc, assets: { ...this._doc.assets, ...v.doc.assets } }, `Restore “${v.name}”`, 'you', []);
  }
}
