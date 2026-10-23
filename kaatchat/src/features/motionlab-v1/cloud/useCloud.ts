import { create } from 'zustand';
import { useV1 } from '../store';
import type { Project } from '../types';
import { getBackend, type CloudBackend, type CloudMember, type CloudRow, type CloudUser } from './backend';

/* Cloud session state for Studio: who is signed in, which cloud project the
 * open project is linked to, saving (with conflict detection), sharing, and
 * live updates when a collaborator saves. */

export interface CloudLink { cloudId: string; updatedAt: string; role: CloudRow['role'] }

const LINKS_KEY = 'kaatchat.cloud.links';
function readLinks(): Record<string, CloudLink> {
  try { return JSON.parse(localStorage.getItem(LINKS_KEY) ?? '{}') as Record<string, CloudLink>; } catch { return {}; }
}
function writeLink(projectId: string, link: CloudLink | null) {
  const all = readLinks();
  if (link) all[projectId] = link; else delete all[projectId];
  try { localStorage.setItem(LINKS_KEY, JSON.stringify(all)); } catch { /* private mode */ }
}

export interface CloudState {
  configured: boolean;
  kind: CloudBackend['kind'] | null;
  user: CloudUser | null;
  busy: boolean;
  error: string | null;
  /** Link of the project open in the editor (null = local only). */
  link: CloudLink | null;
  /** A collaborator saved a newer version while this one had unsaved changes. */
  remote: { updatedAt: string; by: string } | null;
  /** The last cloud save was refused: someone else saved first. */
  conflict: { by: string } | null;
  /** Shown briefly after a live update was applied. */
  notice: string | null;
  /** Other people with this cloud project open right now. */
  others: string[];
  init: () => Promise<void>;
  signInWithEmail: (email: string) => Promise<'link-sent' | 'signed-in' | null>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  list: () => Promise<CloudRow[]>;
  open: (cloudId: string) => Promise<boolean>;
  /** Save the open project to the cloud (create or update). `force` overwrites a newer version. */
  save: (force?: boolean) => Promise<boolean>;
  remove: (cloudId: string) => Promise<boolean>;
  members: () => Promise<CloudMember[]>;
  share: (email: string, role: CloudMember['role']) => Promise<boolean>;
  unshare: (email: string) => Promise<boolean>;
  loadRemote: () => Promise<void>;
  dismiss: () => void;
}

let unwatch: (() => void) | null = null;
let unpresence: (() => void) | null = null;
let unauth: (() => void) | null = null;

export const useCloud = create<CloudState>((set, get) => {
  const run = async <T,>(fn: (b: CloudBackend) => Promise<T>): Promise<T | null> => {
    const bp = getBackend();
    if (!bp) { set({ error: 'Cloud isn’t set up yet.' }); return null; }
    set({ busy: true, error: null });
    try { return await fn(await bp); }
    catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); return null; }
    finally { set({ busy: false }); }
  };

  /** Swap a cloud copy into the editor without marking it unsaved. */
  const applyProject = async (project: Project, row: CloudRow) => {
    await useV1.getState().openProjectData(project);
    const link = { cloudId: row.id, updatedAt: row.updatedAt, role: row.role };
    writeLink(project.id, link);
    set({ link, remote: null, conflict: null });
    watchCurrent();
  };

  const watchCurrent = () => {
    unwatch?.(); unwatch = null;
    unpresence?.(); unpresence = null;
    if (get().others.length) set({ others: [] });
    const link = get().link;
    const bp = getBackend();
    const me = get().user?.email;
    if (!link || !bp || !me) return;
    void bp.then((b) => {
      if (get().link?.cloudId !== link.cloudId) return;
      unpresence = b.presence(link.cloudId, me, (emails) => set({ others: emails.filter((e) => e !== get().user?.email) }));
      unwatch = b.watch(link.cloudId, (updatedAt, by) => {
        const cur = get().link;
        if (!cur || cur.cloudId !== link.cloudId || updatedAt === cur.updatedAt) return;
        if (by === get().user?.email && useV1.getState().isDirty === false) { set({ link: { ...cur, updatedAt } }); return; }
        // No local edits: take theirs right away. Otherwise ask.
        if (!useV1.getState().isDirty) void get().loadRemote().then(() => set({ notice: `Updated by ${by}` }));
        else set({ remote: { updatedAt, by } });
      });
    });
  };

  // Follow the editor: when another project is opened, pick up its link.
  useV1.subscribe((s, prev) => {
    if (s.project.id === prev.project.id) return;
    set({ link: readLinks()[s.project.id] ?? null, remote: null, conflict: null });
    watchCurrent();
  });

  return {
    configured: !!getBackend(),
    kind: null,
    user: null,
    busy: false,
    error: null,
    link: readLinks()[useV1.getState().project.id] ?? null,
    remote: null,
    conflict: null,
    notice: null,
    others: [],

    init: async () => {
      const bp = getBackend();
      set({ configured: !!bp, error: null });
      if (!bp) { set({ user: null, kind: null }); return; }
      try {
        const b = await bp;
        unauth?.();
        unauth = b.onAuth((user) => { const changed = user?.email !== get().user?.email; set({ user }); if (changed) watchCurrent(); });
        set({ kind: b.kind, user: await b.user(), link: readLinks()[useV1.getState().project.id] ?? null });
        // A sign-in link / Google redirect leaves ?code=… in the address: tidy it.
        if (/[?&]code=/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash);
        watchCurrent();
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) });
      }
    },
    signInWithEmail: (email) => run((b) => b.signInWithEmail(email)).then(async (r) => {
      if (r === 'signed-in') { const b = await getBackend()!; set({ user: await b.user() }); }
      return r;
    }),
    signInWithGoogle: async () => { await run((b) => b.signInWithGoogle()); },
    signOut: async () => {
      await run((b) => b.signOut());
      unwatch?.(); unwatch = null;
      unpresence?.(); unpresence = null;
      set({ user: null, remote: null, conflict: null, others: [] });
    },
    list: async () => (await run((b) => b.list())) ?? [],
    open: async (cloudId) => {
      const r = await run((b) => b.load(cloudId));
      if (!r) return false;
      await applyProject(r.project, r.row);
      return true;
    },
    save: async (force = false) => {
      const project = useV1.getState().project;
      const link = get().link;
      const ok = await run(async (b) => {
        if (!link) {
          const row = await b.create(project);
          return { updatedAt: row.updatedAt, cloudId: row.id, role: row.role };
        }
        let expected = link.updatedAt;
        if (force) expected = (await b.load(link.cloudId)).row.updatedAt;
        const res = await b.update(link.cloudId, project, expected);
        if ('conflict' in res) { set({ conflict: { by: res.updatedBy } }); return null; }
        return { updatedAt: res.updatedAt, cloudId: link.cloudId, role: link.role };
      });
      if (!ok) return false;
      const next = { cloudId: ok.cloudId, updatedAt: ok.updatedAt, role: ok.role };
      writeLink(project.id, next);
      set({ link: next, conflict: null, remote: null });
      // The cloud copy is now the saved version; keep a local copy too.
      await useV1.getState().saveToStorage().catch(() => undefined);
      watchCurrent();
      return true;
    },
    remove: async (cloudId) => {
      const ok = await run(async (b) => { await b.remove(cloudId); return true; });
      if (ok && get().link?.cloudId === cloudId) {
        writeLink(useV1.getState().project.id, null);
        unwatch?.(); unwatch = null;
        unpresence?.(); unpresence = null;
        set({ link: null, others: [] });
      }
      return !!ok;
    },
    members: async () => {
      const link = get().link;
      return link ? (await run((b) => b.members(link.cloudId))) ?? [] : [];
    },
    share: async (email, role) => {
      const link = get().link;
      if (!link) return false;
      return !!(await run(async (b) => { await b.share(link.cloudId, email, role); return true; }));
    },
    unshare: async (email) => {
      const link = get().link;
      if (!link) return false;
      return !!(await run(async (b) => { await b.unshare(link.cloudId, email); return true; }));
    },
    loadRemote: async () => {
      const link = get().link;
      if (!link) return;
      const r = await run((b) => b.load(link.cloudId));
      if (r) await applyProject(r.project, r.row);
    },
    dismiss: () => set({ remote: null, conflict: null, notice: null, error: null }),
  };
});
