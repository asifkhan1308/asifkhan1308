// One open project: document store + job queue + media, and the glue that
// imports, measures, transcribes and saves. The UI talks to this.

import { EditorStore } from '../engine/store';
import { JobQueue } from '../engine/jobs';
import { analyzeAudio, analyzeFrames, importFile, matchesAsset, media, transcribe, ImportError } from '../engine/media';
import { autosave, getIndex, getMedia, putIndex, putMedia, saveProject, MAX_STORED_BYTES } from '../engine/persist';
import { parseSubtitles } from '../engine/transcript';
import type { MediaAsset, ProjectDoc, ProjectIndex } from '../engine/types';
import { getPrefs } from './prefs';

export class EditorSession {
  readonly store: EditorStore;
  readonly jobs = new JobQueue(1);
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSavedVersion = -1;
  private unsub: () => void;
  savedAt: number | null = null;
  dirty = false;

  private constructor(doc: ProjectDoc, index: ProjectIndex) {
    this.store = new EditorStore(doc, index);
    this.unsub = this.store.subscribe(() => this.scheduleAutosave());
  }

  /** Load media bytes and measurements for a stored project. */
  static async open(doc: ProjectDoc): Promise<EditorSession> {
    const index: ProjectIndex = {};
    const assets = { ...doc.assets };
    for (const a of Object.values(doc.assets)) {
      const idx = await getIndex(a.id).catch(() => undefined);
      if (idx) index[a.id] = idx;
      if (media.get(a.id)) continue;
      const blob = await getMedia(a.id).catch(() => undefined);
      if (blob) {
        media.set(a.id, blob);
        assets[a.id] = { ...a, storage: 'local' };
      } else assets[a.id] = { ...a, storage: 'missing' };
    }
    const s = new EditorSession({ ...doc, assets }, index);
    s.savedAt = doc.updatedAt;
    s.lastSavedVersion = s.store.version;
    // Finish any measurement that did not complete last time.
    for (const a of Object.values(assets)) if (a.storage !== 'missing') s.analyze(a, false);
    return s;
  }

  static create(doc: ProjectDoc) {
    const s = new EditorSession(doc, {});
    void s.save();
    return s;
  }

  dispose() {
    this.unsub();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    for (const j of this.jobs.getSnapshot()) this.jobs.cancel(j.id);
  }

  private scheduleAutosave() {
    if (this.store.version === this.lastSavedVersion) return;
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void autosave(this.store.doc).catch(() => undefined);
    }, 700);
  }

  async save() {
    await saveProject(this.store.doc);
    this.lastSavedVersion = this.store.version;
    this.savedAt = Date.now();
    this.dirty = false;
  }

  // ---------------------------------------------------------------- import

  async importFiles(files: File[]): Promise<{ imported: MediaAsset[]; errors: string[] }> {
    const imported: MediaAsset[] = [];
    const errors: string[] = [];
    for (const f of files) {
      try {
        const asset = await importFile(f);
        this.store.addAsset(asset);
        imported.push(asset);
        if (asset.storage === 'session')
          errors.push(`“${asset.name}” is larger than ${Math.round(MAX_STORED_BYTES / 1024 / 1024)} MB, so it was not copied into browser storage. It works now; after a reload you will be asked to relink it.`);
        this.analyze(asset, true);
      } catch (e) {
        errors.push(e instanceof ImportError ? e.message : `Could not import “${f.name}”: ${e instanceof Error ? e.message : e}`);
      }
    }
    return { imported, errors };
  }

  /** Relink a missing file. Only the same file (name + size) is accepted. */
  async relink(asset: MediaAsset, file: File): Promise<void> {
    if (!matchesAsset(asset, file)) throw new Error(`That is not “${asset.name}” (${asset.size} bytes).`);
    media.set(asset.id, file);
    let storage: MediaAsset['storage'] = 'session';
    if (file.size <= MAX_STORED_BYTES) {
      try {
        await putMedia(asset.id, file);
        storage = 'local';
      } catch {
        /* keep for this session */
      }
    }
    this.store.patchAsset(asset.id, { storage });
    this.analyze(this.store.doc.assets[asset.id], false);
  }

  // ---------------------------------------------------------------- measurement

  analyze(asset: MediaAsset, force: boolean) {
    const blob = media.get(asset.id);
    if (!blob) return;
    const idx = this.store.index[asset.id] ?? {};
    const group = `asset:${asset.id}`;
    if (asset.kind === 'video' && asset.hasAudio && (force || !idx.audio)) {
      this.jobs.add(`Loudness · ${asset.name}`, group, async (ctl) => {
        const audio = await analyzeAudio(blob, ctl);
        if (audio) await this.setIndex(asset.id, { audio });
      });
    }
    if (force || !idx.framing || !idx.thumbs) {
      this.jobs.add(`Framing · ${asset.name}`, group, async (ctl) => {
        const r = await analyzeFrames(asset, blob, ctl);
        await this.setIndex(asset.id, r);
      });
    }
  }

  transcribe(asset: MediaAsset) {
    const blob = media.get(asset.id);
    if (!blob) return;
    const p = getPrefs();
    this.jobs.add(`Transcribe · ${asset.name}`, `asset:${asset.id}`, async (ctl) => {
      const transcript = await transcribe(blob, p.whisperModel, p.speechLanguage || undefined, ctl);
      await this.setIndex(asset.id, { transcript });
    });
  }

  async importSubtitles(asset: MediaAsset, file: File) {
    const transcript = parseSubtitles(await file.text());
    await this.setIndex(asset.id, { transcript });
    return transcript.segments.length;
  }

  private async setIndex(assetId: string, patch: Partial<ProjectIndex[string]>) {
    this.store.setIndex(assetId, patch);
    await putIndex(assetId, this.store.index[assetId]).catch(() => undefined);
  }
}
