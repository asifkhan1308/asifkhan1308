// Local project storage (IndexedDB). Nothing here talks to a server.
//
// Two slots per project: the saved project and an autosave. Autosave is
// written continuously; the saved slot only on save / leaving the editor.
// A crash can therefore never corrupt the saved project, and on reopen we
// offer the newer autosave.

import type { AssetIndex, ProjectDoc } from './types';
import { reviveProject } from './project';

const DB = 'kaatchat';
const VERSION = 1;
/** Files larger than this are not copied into browser storage (relink on reopen). */
export const MAX_STORED_BYTES = 420 * 1024 * 1024;

type StoreName = 'projects' | 'autosave' | 'media' | 'index';

let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const s of ['projects', 'autosave', 'media', 'index'] as StoreName[]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open local storage.'));
    });
    dbp.catch(() => (dbp = null));
  }
  return dbp;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(store, mode);
        const req = fn(t.objectStore(store));
        t.oncomplete = () => resolve(req ? req.result : (undefined as T));
        t.onerror = () => reject(t.error ?? new Error('Storage error'));
        t.onabort = () => reject(t.error ?? new Error('Storage was aborted (disk full?)'));
      }),
  );
}

export interface StoredProject {
  doc: ProjectDoc;
  savedAt: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  savedAt: number;
  duration: number;
  clips: number;
  aspect: string;
  hasNewerAutosave: boolean;
}

export async function saveProject(doc: ProjectDoc): Promise<void> {
  const rec: StoredProject = { doc, savedAt: Date.now() };
  await tx('projects', 'readwrite', (s) => s.put(rec, doc.id));
  await tx('autosave', 'readwrite', (s) => s.delete(doc.id));
}

export async function autosave(doc: ProjectDoc): Promise<void> {
  await tx('autosave', 'readwrite', (s) => s.put({ doc, savedAt: Date.now() } satisfies StoredProject, doc.id));
}

export async function loadProject(id: string): Promise<{ saved: StoredProject | null; autosave: StoredProject | null }> {
  const saved = (await tx<StoredProject | undefined>('projects', 'readonly', (s) => s.get(id))) ?? null;
  const auto = (await tx<StoredProject | undefined>('autosave', 'readonly', (s) => s.get(id))) ?? null;
  const fix = (r: StoredProject | null) => (r ? { ...r, doc: reviveProject(r.doc) } : null);
  return { saved: fix(saved), autosave: fix(auto) };
}

export async function discardAutosave(id: string) {
  await tx('autosave', 'readwrite', (s) => s.delete(id));
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const saved = (await tx<StoredProject[]>('projects', 'readonly', (s) => s.getAll())) ?? [];
  const autos = (await tx<StoredProject[]>('autosave', 'readonly', (s) => s.getAll())) ?? [];
  const autoById = new Map(autos.map((a) => [a.doc.id, a]));
  const all = new Map<string, StoredProject & { hasNewerAutosave: boolean }>();
  for (const p of saved) all.set(p.doc.id, { ...p, hasNewerAutosave: (autoById.get(p.doc.id)?.savedAt ?? 0) > p.savedAt });
  // A project that crashed before its first save exists only as an autosave.
  for (const a of autos) if (!all.has(a.doc.id)) all.set(a.doc.id, { ...a, hasNewerAutosave: true });
  return [...all.values()]
    .map((p) => ({
      id: p.doc.id,
      name: p.doc.name,
      savedAt: p.savedAt,
      duration: p.doc.clips.reduce((d, c) => d + (c.out - c.in), 0),
      clips: p.doc.clips.length,
      aspect: p.doc.aspect,
      hasNewerAutosave: p.hasNewerAutosave,
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteProject(id: string): Promise<void> {
  const { saved, autosave: auto } = await loadProject(id);
  const assetIds = new Set([...Object.keys(saved?.doc.assets ?? {}), ...Object.keys(auto?.doc.assets ?? {})]);
  await tx('projects', 'readwrite', (s) => s.delete(id));
  await tx('autosave', 'readwrite', (s) => s.delete(id));
  // Media belongs to exactly one project in this version, so it can go too.
  for (const a of assetIds) {
    await tx('media', 'readwrite', (s) => s.delete(a));
    await tx('index', 'readwrite', (s) => s.delete(a));
  }
}

export const putMedia = (assetId: string, blob: Blob) => tx('media', 'readwrite', (s) => s.put(blob, assetId));
export const getMedia = (assetId: string) => tx<Blob | undefined>('media', 'readonly', (s) => s.get(assetId));
export const putIndex = (assetId: string, idx: AssetIndex) => tx('index', 'readwrite', (s) => s.put(idx, assetId));
export const getIndex = (assetId: string) => tx<AssetIndex | undefined>('index', 'readonly', (s) => s.get(assetId));

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}
