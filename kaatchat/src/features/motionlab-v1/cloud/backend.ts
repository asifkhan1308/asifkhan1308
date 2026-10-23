import type { Project } from '../types';
import { importProjectFromText, serializeProject } from '../engine/persist';

/* V2 cloud: accounts, cloud projects, sharing and live updates.
 *
 * One small interface, two implementations:
 *   - Supabase (free plan): email-link + Google sign-in, projects table with
 *     row-level security (see supabase/migrations), Realtime for live saves.
 *   - "memory:" demo: the same behaviour inside this browser (localStorage),
 *     for trying the flow without a server and for the browser tests.
 * Projects travel as the same JSON as .kaatchat files; media stays on each
 * device (re-attached from the local media store when it is there). */

export interface CloudUser { id: string; email: string }
export interface CloudRow { id: string; name: string; updatedAt: string; updatedBy: string; owner: boolean; ownerEmail: string; role: 'owner' | 'editor' | 'viewer' }
export interface CloudMember { email: string; role: 'editor' | 'viewer' }
export type SaveResult = { updatedAt: string } | { conflict: true; updatedBy: string };

export interface CloudBackend {
  readonly kind: 'supabase' | 'memory';
  user(): Promise<CloudUser | null>;
  onAuth(cb: (u: CloudUser | null) => void): () => void;
  signInWithEmail(email: string): Promise<'link-sent' | 'signed-in'>;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  list(): Promise<CloudRow[]>;
  load(id: string): Promise<{ project: Project; row: CloudRow }>;
  create(project: Project): Promise<CloudRow>;
  /** Saves only if nobody else saved since `expected` (optimistic check). */
  update(id: string, project: Project, expected: string): Promise<SaveResult>;
  remove(id: string): Promise<void>;
  members(id: string): Promise<CloudMember[]>;
  share(id: string, email: string, role: CloudMember['role']): Promise<void>;
  unshare(id: string, email: string): Promise<void>;
  /** Someone saved this project: called with the new version stamp and author. */
  watch(id: string, cb: (updatedAt: string, by: string) => void): () => void;
}

/* ───── Config ───── */

export interface CloudConfig { url: string; key: string }
const CONFIG_KEY = 'kaatchat.cloud.config';

/** Build-time config (VITE_SUPABASE_URL / VITE_SUPABASE_KEY), overridable in the
 *  app (Cloud → Set up) so a deployed build can be connected without a rebuild. */
export function cloudConfig(): CloudConfig | null {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? 'null') as CloudConfig | null;
    if (saved?.url && (saved.key || saved.url === 'memory:')) return saved;
  } catch { /* storage blocked: fall back to the build config */ }
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  return env.VITE_SUPABASE_URL && env.VITE_SUPABASE_KEY ? { url: env.VITE_SUPABASE_URL, key: env.VITE_SUPABASE_KEY } : null;
}

export function setCloudConfig(c: CloudConfig | null): void {
  try {
    if (c) localStorage.setItem(CONFIG_KEY, JSON.stringify({ url: c.url.trim().replace(/\/+$/, ''), key: c.key.trim() }));
    else localStorage.removeItem(CONFIG_KEY);
  } catch { /* private mode */ }
  backendP = null;
}

/** Only https Supabase-style URLs (or the demo) — never a script / data URL. */
export function validConfig(c: CloudConfig): string | null {
  if (c.url === 'memory:') return null;
  let u: URL;
  try { u = new URL(c.url); } catch { return 'That isn’t a web address.'; }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return 'Use the https:// project URL.';
  if (!c.key.trim()) return 'Paste the publishable (anon) key.';
  if (/service_role|sb_secret_/.test(c.key) || /"role"\s*:\s*"service_role"/.test(atobSafe(c.key.split('.')[1] ?? ''))) {
    return 'That is a secret key — never put it in an app. Use the publishable (anon) key.';
  }
  return null;
}
const atobSafe = (s: string) => { try { return atob(s.replace(/-/g, '+').replace(/_/g, '/')); } catch { return ''; } };

let backendP: Promise<CloudBackend> | null = null;
export function getBackend(): Promise<CloudBackend> | null {
  const c = cloudConfig();
  if (!c) return null;
  if (!backendP) backendP = c.url === 'memory:' ? Promise.resolve(memoryBackend()) : supabaseBackend(c);
  return backendP;
}

/** Where sign-in links / Google send people back: this page, Studio route. */
export function returnUrl(): string {
  return `${location.origin}${location.pathname}#/studio`;
}

const toJson = (p: Project) => JSON.parse(serializeProject(p)) as unknown;
const fromJson = (d: unknown) => importProjectFromText(JSON.stringify(d));
export const MAX_PROJECT_BYTES = 2_000_000;
function checkSize(p: Project) {
  if (serializeProject(p).length > MAX_PROJECT_BYTES) throw new Error('This project is too large for the cloud (2 MB of layers and keyframes).');
}
const normEmail = (e: string) => e.trim().toLowerCase();
export const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

/* ───── Supabase ───── */

interface Row { id: string; name: string; owner: string; owner_email: string; updated_at: string; updated_by_email: string; data?: unknown }

async function supabaseBackend(c: CloudConfig): Promise<CloudBackend> {
  const { createClient } = await import('@supabase/supabase-js');
  const sb = createClient(c.url, c.key, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true, autoRefreshToken: true } });
  const me = async (): Promise<CloudUser | null> => {
    const { data } = await sb.auth.getSession();
    const u = data.session?.user;
    return u ? { id: u.id, email: (u.email ?? '').toLowerCase() } : null;
  };
  const must = <T,>(r: { data: T; error: { message: string } | null }): T => {
    if (r.error) throw new Error(r.error.message);
    return r.data;
  };
  const toRow = async (r: Row): Promise<CloudRow> => {
    const u = await me();
    const owner = !!u && r.owner === u.id;
    let role: CloudRow['role'] = 'owner';
    if (!owner) {
      const m = must(await sb.from('studio_members').select('role').eq('project_id', r.id).eq('email', u?.email ?? '').maybeSingle()) as { role: 'editor' | 'viewer' } | null;
      role = m?.role ?? 'viewer';
    }
    return { id: r.id, name: r.name, updatedAt: r.updated_at, updatedBy: r.updated_by_email, owner, ownerEmail: r.owner_email, role };
  };
  const cols = 'id,name,owner,owner_email,updated_at,updated_by_email';
  return {
    kind: 'supabase',
    user: me,
    onAuth(cb) {
      const { data } = sb.auth.onAuthStateChange((_e, s) => cb(s?.user ? { id: s.user.id, email: (s.user.email ?? '').toLowerCase() } : null));
      return () => data.subscription.unsubscribe();
    },
    async signInWithEmail(email) {
      const { error } = await sb.auth.signInWithOtp({ email: normEmail(email), options: { emailRedirectTo: returnUrl() } });
      if (error) throw new Error(error.message);
      return 'link-sent';
    },
    async signInWithGoogle() {
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: returnUrl() } });
      if (error) throw new Error(error.message);
    },
    async signOut() { await sb.auth.signOut(); },
    async list() {
      const rows = must(await sb.from('studio_projects').select(cols).order('updated_at', { ascending: false }).limit(200)) as Row[];
      return Promise.all(rows.map(toRow));
    },
    async load(id) {
      const r = must(await sb.from('studio_projects').select(`${cols},data`).eq('id', id).single()) as Row;
      return { project: fromJson(r.data), row: await toRow(r) };
    },
    async create(project) {
      checkSize(project);
      const r = must(await sb.from('studio_projects').insert({ name: project.name, data: toJson(project) }).select(cols).single()) as Row;
      return toRow(r);
    },
    async update(id, project, expected) {
      checkSize(project);
      const rows = must(await sb.from('studio_projects').update({ name: project.name, data: toJson(project) })
        .eq('id', id).eq('updated_at', expected).select('updated_at')) as Array<{ updated_at: string }>;
      if (rows.length) return { updatedAt: rows[0].updated_at };
      const cur = must(await sb.from('studio_projects').select('updated_by_email').eq('id', id).maybeSingle()) as { updated_by_email: string } | null;
      if (!cur) throw new Error('This project was deleted, or you no longer have access.');
      return { conflict: true, updatedBy: cur.updated_by_email };
    },
    async remove(id) { must(await sb.from('studio_projects').delete().eq('id', id)); },
    async members(id) {
      return must(await sb.from('studio_members').select('email,role').eq('project_id', id).order('email')) as CloudMember[];
    },
    async share(id, email, role) {
      if (!isEmail(email)) throw new Error('Enter an email address.');
      must(await sb.from('studio_members').upsert({ project_id: id, email: normEmail(email), role }));
    },
    async unshare(id, email) { must(await sb.from('studio_members').delete().eq('project_id', id).eq('email', normEmail(email))); },
    watch(id, cb) {
      const ch = sb.channel(`studio-${id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'studio_projects', filter: `id=eq.${id}` },
          (p) => { const n = p.new as Row; cb(n.updated_at, n.updated_by_email); })
        .subscribe();
      return () => { void sb.removeChannel(ch); };
    },
  };
}

/* ───── In-browser demo ("memory:") ─────
 * Same rules as the database policies, stored in localStorage so several tabs
 * of this browser act as different people (each tab signs in separately). */

interface MemDb { projects: Array<Row & { data: unknown }>; members: Array<{ project_id: string; email: string; role: 'editor' | 'viewer' }> }
const MEM_KEY = 'kaatchat.cloud.memory';
const memRead = (): MemDb => { try { return JSON.parse(localStorage.getItem(MEM_KEY) ?? '') as MemDb; } catch { return { projects: [], members: [] }; } };
const memWrite = (d: MemDb) => localStorage.setItem(MEM_KEY, JSON.stringify(d));

export function memoryBackend(): CloudBackend {
  let user: CloudUser | null = null;
  try { user = JSON.parse(sessionStorage.getItem('kaatchat.cloud.memory.user') ?? 'null') as CloudUser | null; } catch { /* none */ }
  const listeners = new Set<(u: CloudUser | null) => void>();
  const setUser = (u: CloudUser | null) => {
    user = u;
    try { if (u) sessionStorage.setItem('kaatchat.cloud.memory.user', JSON.stringify(u)); else sessionStorage.removeItem('kaatchat.cloud.memory.user'); } catch { /* */ }
    listeners.forEach((f) => f(u));
  };
  const need = () => { if (!user) throw new Error('Sign in first.'); return user; };
  const roleOf = (d: MemDb, r: Row): CloudRow['role'] | null =>
    r.owner === user?.id ? 'owner' : d.members.find((m) => m.project_id === r.id && m.email === user?.email)?.role ?? null;
  const toRow = (d: MemDb, r: Row): CloudRow => ({ id: r.id, name: r.name, updatedAt: r.updated_at, updatedBy: r.updated_by_email, owner: r.owner === user?.id, ownerEmail: r.owner_email, role: roleOf(d, r)! });
  const find = (d: MemDb, id: string) => {
    const r = d.projects.find((p) => p.id === id);
    if (!r || !roleOf(d, r)) throw new Error('This project was deleted, or you no longer have access.');
    return r;
  };
  // Version stamps: ISO times that always move forward (two saves in one ms still differ).
  const stamp = (prev?: string) => new Date(Math.max(Date.now(), prev ? Date.parse(prev) + 1 : 0)).toISOString();
  return {
    kind: 'memory',
    user: async () => user,
    onAuth(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    async signInWithEmail(email) {
      if (!isEmail(email)) throw new Error('Enter an email address.');
      const e = normEmail(email);
      setUser({ id: `u_${e}`, email: e });
      return 'signed-in';
    },
    async signInWithGoogle() { throw new Error('Google sign-in needs the real cloud (demo mode uses email only).'); },
    async signOut() { setUser(null); },
    async list() {
      need();
      const d = memRead();
      return d.projects.filter((r) => roleOf(d, r)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).map((r) => toRow(d, r));
    },
    async load(id) { need(); const d = memRead(); const r = find(d, id); return { project: fromJson(r.data), row: toRow(d, r) }; },
    async create(project) {
      const u = need(); checkSize(project);
      const d = memRead();
      const r = { id: `c_${Math.random().toString(36).slice(2, 10)}`, name: project.name, owner: u.id, owner_email: u.email, updated_at: stamp(), updated_by_email: u.email, data: toJson(project) };
      d.projects.push(r); memWrite(d);
      return toRow(d, r);
    },
    async update(id, project, expected) {
      const u = need(); checkSize(project);
      const d = memRead(); const r = find(d, id);
      if (roleOf(d, r) === 'viewer') throw new Error('You can view this project but not save it (ask the owner for edit access).');
      if (r.updated_at !== expected) return { conflict: true, updatedBy: r.updated_by_email };
      Object.assign(r, { name: project.name, data: toJson(project), updated_at: stamp(r.updated_at), updated_by_email: u.email });
      memWrite(d);
      return { updatedAt: r.updated_at };
    },
    async remove(id) {
      need(); const d = memRead(); const r = find(d, id);
      if (!r || r.owner !== user!.id) throw new Error('Only the owner can delete a project.');
      d.projects = d.projects.filter((p) => p.id !== id); d.members = d.members.filter((m) => m.project_id !== id); memWrite(d);
    },
    async members(id) {
      need(); const d = memRead(); find(d, id);
      return d.members.filter((m) => m.project_id === id).map(({ email, role }) => ({ email, role })).sort((a, b) => a.email.localeCompare(b.email));
    },
    async share(id, email, role) {
      need(); if (!isEmail(email)) throw new Error('Enter an email address.');
      const d = memRead(); const r = find(d, id);
      if (r.owner !== user!.id) throw new Error('Only the owner can share a project.');
      const e = normEmail(email);
      d.members = d.members.filter((m) => !(m.project_id === id && m.email === e));
      d.members.push({ project_id: id, email: e, role }); memWrite(d);
    },
    async unshare(id, email) {
      need(); const d = memRead(); const r = find(d, id);
      const e = normEmail(email);
      if (r.owner !== user!.id && e !== user!.email) throw new Error('Only the owner can remove people.');
      d.members = d.members.filter((m) => !(m.project_id === id && m.email === e)); memWrite(d);
    },
    watch(id, cb) {
      let last = memRead().projects.find((p) => p.id === id)?.updated_at;
      const h = (e: StorageEvent) => {
        if (e.key !== MEM_KEY) return;
        const r = memRead().projects.find((p) => p.id === id);
        if (r && r.updated_at !== last) { last = r.updated_at; cb(r.updated_at, r.updated_by_email); }
      };
      window.addEventListener('storage', h);
      return () => window.removeEventListener('storage', h);
    },
  };
}
