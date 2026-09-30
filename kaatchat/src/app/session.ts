// One open project: document store + job queue + media, and the glue that
// imports, measures, transcribes and saves. The UI talks to this.

import { EditorStore } from '../engine/store';
import { JobQueue } from '../engine/jobs';
import { analyzeAudio, analyzeFrames, importFile, matchesAsset, media, transcribe, ImportError } from '../engine/media';
import { autosave, getFont, getIndex, getMedia, putIndex, putMedia, registerFont, saveProject, MAX_STORED_BYTES } from '../engine/persist';
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
    const font = doc.brand?.font;
    if (font && !['Inter', 'JetBrains Mono', 'system-serif', 'system-sans'].includes(font)) {
      const blob = await getFont(font).catch(() => undefined);
      if (blob) await registerFont(font, blob).catch(() => undefined);
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
      void autosave(this.store.project).catch(() => undefined);
    }, 700);
  }

  async save() {
    await saveProject(this.store.project);
    this.lastSavedVersion = this.store.version;
    this.savedAt = Date.now();
    this.dirty = false;
  }

  // ---------------------------------------------------------------- import

  async importFiles(files: File[], addToTimeline = true): Promise<{ imported: MediaAsset[]; errors: string[]; jobIds: string[] }> {
    const imported: MediaAsset[] = [];
    const errors: string[] = [];
    const jobIds: string[] = [];
    for (const f of files) {
      try {
        const asset = await importFile(f);
        this.store.addAsset(asset, addToTimeline);
        imported.push(asset);
        if (asset.storage === 'session')
          errors.push(`“${asset.name}” is larger than ${Math.round(MAX_STORED_BYTES / 1024 / 1024)} MB, so it was not copied into browser storage. It works now; after a reload you will be asked to relink it.`);
        jobIds.push(...this.analyze(asset, true));
      } catch (e) {
        errors.push(e instanceof ImportError ? e.message : `Could not import “${f.name}”: ${e instanceof Error ? e.message : e}`);
      }
    }
    return { imported, errors, jobIds };
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

  /** Queues the measurements this asset still needs; returns their job ids. */
  analyze(asset: MediaAsset, force: boolean): string[] {
    const blob = media.get(asset.id);
    if (!blob) return [];
    const idx = this.store.index[asset.id] ?? {};
    const group = `asset:${asset.id}`;
    const ids: string[] = [];
    if (asset.kind === 'audio' && (force || !idx.audio)) {
      ids.push(
        this.jobs.add(`Loudness and beat · ${asset.name}`, group, async (ctl) => {
          const r = await analyzeAudio(blob, ctl, true);
          if (r) await this.setIndex(asset.id, { audio: r.audio, beats: r.beats ?? undefined });
        }).id,
      );
      return ids;
    }
    if (asset.kind === 'video' && asset.hasAudio && (force || !idx.audio)) {
      ids.push(
        this.jobs.add(`Loudness · ${asset.name}`, group, async (ctl) => {
          const r = await analyzeAudio(blob, ctl);
          if (r) await this.setIndex(asset.id, { audio: r.audio });
        }).id,
      );
    }
    if (asset.kind !== 'audio' && (force || !idx.framing || !idx.thumbs)) {
      ids.push(
        this.jobs.add(`Framing · ${asset.name}`, group, async (ctl) => {
          const r = await analyzeFrames(asset, blob, ctl);
          await this.setIndex(asset.id, r);
        }).id,
      );
    }
    return ids;
  }

  /** Queues local transcription; returns the job id (null when the file needs relinking). */
  transcribe(asset: MediaAsset): string | null {
    const blob = media.get(asset.id);
    if (!blob) return null;
    const p = getPrefs();
    return this.jobs.add(`Transcribe · ${asset.name}`, `asset:${asset.id}`, async (ctl) => {
      const transcript = await transcribe(blob, p.whisperModel, p.speechLanguage || undefined, ctl);
      await this.setIndex(asset.id, { transcript });
    }).id;
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
