// Editor state. The project is immutable; every change is a transaction
// that pushes the previous project onto the undo stack. One transaction =
// one Ctrl+Z, however many commands it contains (a whole AI plan, or five
// new Reels, included).
//
// Editing code works on an `EditView` — the active sequence plus the
// project's assets — so commands never need to know about sequences.

import type { ProjectDoc, ProjectIndex, AssetIndex, MediaAsset, Clip, EditView, Sequence, FitMode } from './types';
import { nearestAspect, shapeDiffers } from './types';
import type { Command, EditPlan } from './commands/schema';
import { applyCommand, previewPlan, CommandError } from './commands/execute';
import { activeSequence, fromView, newSequence, toView } from './project';
import { clampProjectOverlays } from './timeline';
import { uid } from './id';
import { buildShort, type RepurposeOptions } from './repurpose';

export interface HistoryEntry {
  id: string;
  label: string;
  source: 'you' | 'ai' | 'magic';
  at: number;
  notes: string[];
}

interface Snapshot {
  project: ProjectDoc;
  entry: HistoryEntry;
}

const HISTORY_LIMIT = 200;

export type Listener = () => void;

export class EditorStore {
  private _project: ProjectDoc;
  private _view: EditView;
  private _index: ProjectIndex;
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private listeners = new Set<Listener>();
  private _version = 0;
  /** Named versions: full project copies the user can return to. */
  versions: { id: string; name: string; at: number; project: ProjectDoc }[] = [];

  constructor(project: ProjectDoc, index: ProjectIndex = {}) {
    this._project = project;
    this._view = toView(project);
    this._index = index;
  }

  /** The active sequence, as an editable view. */
  get doc(): EditView {
    return this._view;
  }
  get project(): ProjectDoc {
    return this._project;
  }
  get sequences(): Sequence[] {
    return this._project.sequences;
  }
  get index() {
    return this._index;
  }
  /** Changes on every project or index update; handy for memo keys. */
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

  private set(project: ProjectDoc) {
    this._project = project;
    this._view = toView(project);
    this._version++;
    for (const l of this.listeners) l();
  }

  private commit(next: ProjectDoc, label: string, source: HistoryEntry['source'], notes: string[]) {
    // Every edit path ends here, so this is where layers are kept inside the edit.
    next = clampProjectOverlays(next);
    if (next === this._project) return;
    const entry: HistoryEntry = { id: uid(), label, source, at: Date.now(), notes };
    this.past.push({ project: this._project, entry });
    if (this.past.length > HISTORY_LIMIT) this.past.shift();
    this.future = [];
    this.set({ ...next, updatedAt: Date.now() });
  }

  private commitView(view: EditView, label: string, source: HistoryEntry['source'], notes: string[]) {
    if (view === this._view) return;
    this.commit(fromView(this._project, view), label, source, notes);
  }

  /** Run commands on the active sequence as a single undoable step. Throws (and changes nothing) on failure. */
  run(commands: Command[], label: string, source: HistoryEntry['source'] = 'you'): string[] {
    let cur = this._view;
    const notes: string[] = [];
    for (const cmd of commands) {
      const r = applyCommand(cur, cmd, { index: this._index, newId: uid });
      cur = r.doc;
      notes.push(...r.notes);
    }
    this.commitView(cur, label, source, notes);
    return notes;
  }

  /** Apply a validated plan to the active sequence atomically. */
  applyPlan(plan: EditPlan, label: string, source: HistoryEntry['source'] = 'ai') {
    const p = previewPlan(this._view, plan, { index: this._index, newId: uid });
    if (!p.ok) {
      const err = p.steps.find((s) => s.error)?.error ?? 'The plan could not be applied.';
      throw new CommandError(err);
    }
    this.commitView(p.doc, label, source, p.steps.flatMap((s) => s.notes));
    return p;
  }

  preview(plan: EditPlan) {
    return previewPlan(this._view, plan, { index: this._index, newId: uid });
  }

  /** Direct edits to the active sequence (inspector sliders, overlays…). */
  mutate(label: string, fn: (view: EditView) => EditView, source: HistoryEntry['source'] = 'you') {
    this.commitView(fn(this._view), label, source, []);
  }

  /** Edits that span sequences (repurposing, brand kit). */
  mutateProject(label: string, fn: (p: ProjectDoc) => ProjectDoc, source: HistoryEntry['source'] = 'you', notes: string[] = []) {
    this.commit(fn(this._project), label, source, notes);
  }

  addAsset(asset: MediaAsset, addToTimeline = true) {
    this.mutate(`Import ${asset.name}`, (d) => {
      const withAsset = { ...d, assets: { ...d.assets, [asset.id]: asset } };
      return addToTimeline ? appendToTimeline(withAsset, asset) : withAsset;
    });
  }

  /** Adds another copy of an imported asset to the end of the timeline (Media bin "Add"). */
  addToTimeline(asset: MediaAsset) {
    this.mutate(`Add ${asset.name}`, (d) => appendToTimeline(d, asset));
  }

  /** Update asset metadata without creating an undo step (e.g. relinking). */
  patchAsset(id: string, patch: Partial<MediaAsset>) {
    const a = this._project.assets[id];
    if (!a) return;
    const fixP = (p: ProjectDoc) => (p.assets[id] ? { ...p, assets: { ...p.assets, [id]: { ...p.assets[id], ...patch } } } : p);
    this.past = this.past.map((s) => ({ ...s, project: fixP(s.project) }));
    this.future = this.future.map((s) => ({ ...s, project: fixP(s.project) }));
    this.set(fixP(this._project));
  }

  setIndex(assetId: string, patch: Partial<AssetIndex>) {
    this._index = { ...this._index, [assetId]: { ...this._index[assetId], ...patch } };
    this._version++;
    for (const l of this.listeners) l();
  }

  // ------------------------------------------------------------- sequences

  /** Switching sequences is navigation, not an edit: it is not an undo step. */
  setActiveSequence(id: string) {
    if (id === this._project.activeSequenceId || !this._project.sequences.some((s) => s.id === id)) return;
    this.set({ ...this._project, activeSequenceId: id });
  }

  createSequence(seq: Sequence, label = `New sequence “${seq.name}”`, activate = true, source: HistoryEntry['source'] = 'you') {
    this.commit(
      { ...this._project, sequences: [...this._project.sequences, seq], activeSequenceId: activate ? seq.id : this._project.activeSequenceId },
      label,
      source,
      [],
    );
  }

  duplicateSequence(id = this._project.activeSequenceId) {
    const s = this._project.sequences.find((x) => x.id === id);
    if (!s) return;
    const copy: Sequence = {
      ...structuredClone(s),
      id: uid(),
      name: `${s.name} copy`,
      createdAt: Date.now(),
      sourceSequenceId: s.id,
    };
    copy.clips = copy.clips.map((c) => ({ ...c, id: uid() }));
    this.createSequence(copy, `Duplicate “${s.name}”`);
  }

  renameSequence(id: string, name: string) {
    const n = name.trim().slice(0, 80);
    if (!n) return;
    this.commit({ ...this._project, sequences: this._project.sequences.map((s) => (s.id === id ? { ...s, name: n } : s)) }, `Rename sequence`, 'you', []);
  }

  deleteSequence(id: string) {
    if (this._project.sequences.length <= 1) throw new CommandError('A project needs at least one sequence.');
    const rest = this._project.sequences.filter((s) => s.id !== id);
    const active = this._project.activeSequenceId === id ? rest[0].id : this._project.activeSequenceId;
    const name = this._project.sequences.find((s) => s.id === id)?.name ?? '';
    this.commit({ ...this._project, sequences: rest, activeSequenceId: active }, `Delete sequence “${name}”`, 'you', []);
  }

  /** A new sequence holding only these timeline ranges of the active one. */
  sequenceFromRanges(name: string, ranges: { start: number; end: number }[], activate = true) {
    const view = this._view;
    const r = applyCommand(view, { type: 'keep_ranges', ranges }, { index: this._index, newId: uid });
    const seq: Sequence = {
      ...newSequence(name, view.aspect, r.doc.clips.map((c) => ({ ...c, id: uid() }))),
      fps: view.fps,
      captions: { ...view.captions },
      sourceSequenceId: view.id,
    };
    this.createSequence(seq, `New sequence “${name}”`, activate);
    return seq;
  }

  /** One new sequence per moment — cut, tightened, reframed, captioned — in one undo step. */
  repurpose(moments: { start: number; end: number; title?: string }[], opts: RepurposeOptions, prefix = 'Clip'): Sequence[] {
    if (moments.length === 0) return [];
    const notes: string[] = [];
    const created = moments.map((m, i) => {
      const r = buildShort(this._view, this._index, m, `${prefix} ${String(i + 1).padStart(2, '0')}`, opts, uid);
      notes.push(`${r.sequence.name}: ${r.notes.slice(-4).join(' · ')}`);
      return r.sequence;
    });
    this.commit(
      { ...this._project, sequences: [...this._project.sequences, ...created], activeSequenceId: created[0].id },
      `Create ${created.length} clip${created.length > 1 ? 's' : ''}`,
      'ai',
      notes,
    );
    return created;
  }

  active(): Sequence {
    return activeSequence(this._project);
  }

  // ------------------------------------------------------------- history

  undo() {
    const s = this.past.pop();
    if (!s) return;
    this.future.push({ project: this._project, entry: s.entry });
    this.set(s.project);
  }

  redo() {
    const s = this.future.pop();
    if (!s) return;
    this.past.push({ project: this._project, entry: s.entry });
    this.set(s.project);
  }

  saveVersion(name: string) {
    this.versions = [...this.versions, { id: uid(), name, at: Date.now(), project: this._project }];
    this._version++;
    for (const l of this.listeners) l();
  }

  restoreVersion(id: string) {
    const v = this.versions.find((x) => x.id === id);
    if (!v) return;
    // Media added since the version was saved stays in the bin.
    this.commit({ ...v.project, assets: { ...this._project.assets, ...v.project.assets } }, `Restore “${v.name}”`, 'you', []);
  }
}

/**
 * Appends an asset to the timeline: audio goes on the audio track; pictures
 * become a clip. The first picture on an empty timeline sets the canvas shape
 * (a vertical phone clip makes a 9:16 edit). Later clips of another shape are
 * letterboxed rather than cropped; reframe or switch them to fill when wanted.
 */
function appendToTimeline(d: EditView, asset: MediaAsset): EditView {
  if (asset.kind === 'audio')
    return { ...d, audio: [...d.audio, { id: uid(), assetId: asset.id, start: 0, in: 0, out: asset.duration, gainDb: -6, fadeIn: 0.5, fadeOut: 1, duck: true }] };
  const aspect = d.clips.length === 0 ? (nearestAspect(asset.width, asset.height) ?? d.aspect) : d.aspect;
  const fit: FitMode = shapeDiffers(asset.width, asset.height, aspect) ? 'fit' : 'fill';
  const clip: Clip = { id: uid(), assetId: asset.id, in: 0, out: asset.duration, gainDb: 0, focusX: 0.5, focusY: 0.5, fit };
  return { ...d, aspect, clips: [...d.clips, clip] };
}
