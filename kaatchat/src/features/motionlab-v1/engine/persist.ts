/* MOTIONLAB V1 persistence.
 *
 * Two stores:
 *   - projects/{id}     — the saved project (manual Save)
 *   - autosave/{id}     — written continuously; on open we offer the newer
 *                         of (saved, autosave) so a crash never loses work
 *
 * Lives in its own IndexedDB (`motionlab-v1`) so V1 projects never collide
 * with Podcast Editor projects. Media assets continue to live in Kaatchat's
 * shared media store (via src/engine/persist.ts), so a video dropped in
 * Studio is reachable from the Podcast Editor and vice versa.
 */

import type { Project } from '../types';

const DB_NAME = 'motionlab-v1';
const VERSION = 1;

type StoreName = 'projects' | 'autosave';

let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const s of ['projects', 'autosave'] as StoreName[]) {
          if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Could not open local storage.'));
      // Another tab holding an older version open would otherwise hang us forever.
      req.onblocked = () => reject(new Error('Local storage is busy in another tab. Close other MOTIONLAB tabs and try again.'));
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
  project: Project;
  savedAt: number;
}

export interface ProjectSummary {
  id: string;
  name: string;
  savedAt: number;
  duration: number;
  layerCount: number;
  width: number;
  height: number;
  hasNewerAutosave: boolean;
}

/* Media URLs are session-bound (blob: URLs die on reload). Strip them before
 * persisting; the asset id + the shared media store survives. On load we
 * re-materialise URLs from the shared store (see rehydrateMedia below). */
function stripBlobUrls(project: Project): Project {
  return {
    ...project,
    assets: project.assets.map((a) => ({
      ...a,
      url: a.url?.startsWith('blob:') ? '' : a.url,
    })),
  };
}

export async function saveProject(project: Project): Promise<void> {
  const rec: StoredProject = { project: stripBlobUrls(project), savedAt: Date.now() };
  await tx('projects', 'readwrite', (s) => s.put(rec, project.id));
  // Clear the autosave since the saved copy is now authoritative.
  await tx('autosave', 'readwrite', (s) => s.delete(project.id));
}

export async function autosave(project: Project): Promise<void> {
  const rec: StoredProject = { project: stripBlobUrls(project), savedAt: Date.now() };
  await tx('autosave', 'readwrite', (s) => s.put(rec, project.id));
}

export async function loadProject(
  id: string,
): Promise<{ saved: StoredProject | null; autosave: StoredProject | null }> {
  const saved = (await tx<StoredProject | undefined>('projects', 'readonly', (s) => s.get(id))) ?? null;
  const auto = (await tx<StoredProject | undefined>('autosave', 'readonly', (s) => s.get(id))) ?? null;
  return { saved, autosave: auto };
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const d = await db();
  const items: ProjectSummary[] = [];
  await new Promise<void>((resolve, reject) => {
    const t = d.transaction(['projects', 'autosave'], 'readonly');
    const proj = t.objectStore('projects');
    const auto = t.objectStore('autosave');
    const projKeys = proj.getAllKeys();
    const projVals = proj.getAll();
    const autoKeys = auto.getAllKeys();
    const autoVals = auto.getAll();
    t.oncomplete = () => {
      const autoMap = new Map<string, StoredProject>();
      (autoKeys.result as IDBValidKey[]).forEach((k, i) => {
        autoMap.set(String(k), (autoVals.result as StoredProject[])[i]);
      });
      (projKeys.result as IDBValidKey[]).forEach((k, i) => {
        const stored = (projVals.result as StoredProject[])[i];
        const id = String(k);
        const a = autoMap.get(id);
        items.push({
          id,
          name: stored.project.name,
          savedAt: stored.savedAt,
          duration: stored.project.composition.duration,
          layerCount: stored.project.layers.length,
          width: stored.project.composition.width,
          height: stored.project.composition.height,
          hasNewerAutosave: !!a && a.savedAt > stored.savedAt,
        });
      });
      items.sort((x, y) => y.savedAt - x.savedAt);
      resolve();
    };
    // Surface failures instead of silently showing "No saved projects"; an
    // aborted transaction used to leave this promise pending forever.
    t.onerror = () => reject(t.error ?? new Error('Could not read saved projects.'));
    t.onabort = () => reject(t.error ?? new Error('Reading saved projects was interrupted. Try again.'));
  });
  return items;
}

export async function deleteProject(id: string): Promise<void> {
  await tx('projects', 'readwrite', (s) => s.delete(id));
  await tx('autosave', 'readwrite', (s) => s.delete(id));
}

/* ───── File export / import ─────
 *
 * Downloads the project as a .kaatchat JSON file (no media bytes, so files
 * stay tiny and shareable). The companion importProjectFromText parses it
 * back. Media isn't bundled in V1 — users bring their own clips, same as the
 * Podcast Editor's project model. Re-link UI lands with the Media bin later.
 */
export function serializeProject(project: Project): string {
  return JSON.stringify(stripBlobUrls(project), null, 2);
}

export function importProjectFromText(text: string): Project {
  const parsed = JSON.parse(text) as Project;
  if (parsed.format !== 'motionlab' || parsed.version !== 1) {
    throw new Error(`This file isn't a MOTIONLAB V1 project (got ${parsed.format}/${parsed.version}).`);
  }
  // Minimal structural check so a bad JSON surfaces as a clear message, not a
  // deep render error later.
  if (!parsed.composition || !Array.isArray(parsed.layers)) {
    throw new Error('Project file is missing required fields.');
  }
  return parsed;
}

export function downloadProject(project: Project): void {
  const blob = new Blob([serializeProject(project)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const safe = project.name.replace(/[^\p{L}\p{N} _-]+/gu, '').trim() || 'project';
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safe}.kaatchat`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* After loading from IndexedDB or a file, assets have no live blob URL.
 * Pull their bytes from the shared Kaatchat media store (populated by the
 * motionlab/bridge import path) and rebuild blob: URLs. Assets that aren't
 * present are returned with url: '' so the user can relink later. */
export async function rehydrateMedia(project: Project): Promise<Project> {
  const { getMedia } = await import('../../../engine/persist');
  const assets = await Promise.all(
    project.assets.map(async (a) => {
      // Already has a live blob: URL — nothing to do.
      if (a.url && a.url.startsWith('blob:')) return a;
      try {
        const blob = await getMedia(a.id);
        if (blob) return { ...a, url: URL.createObjectURL(blob) };
      } catch {
        /* fall through: asset stays unlinked */
      }
      return a;
    }),
  );
  return { ...project, assets };
}
