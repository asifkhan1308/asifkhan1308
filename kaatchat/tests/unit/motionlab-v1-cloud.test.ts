import { beforeEach, describe, expect, it } from 'vitest';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';

// Minimal Web Storage for the in-browser demo backend under Node.
class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, String(v)); } removeItem(k: string) { this.m.delete(k); } clear() { this.m.clear(); } }
const g = globalThis as unknown as { localStorage: Mem; sessionStorage: Mem };
g.localStorage = new Mem();
g.sessionStorage = new Mem();

const { memoryBackend, validConfig, isEmail } = await import('../../src/features/motionlab-v1/cloud/backend');

/** Each "tab" is its own signed-in person; the cloud (localStorage) is shared. */
const tab = () => { g.sessionStorage = new Mem(); return memoryBackend(); };

beforeEach(() => g.localStorage.clear());

describe('MOTIONLAB V2 cloud (demo backend = same rules as the database policies)', () => {
  it('owner creates, saves with a version check, and sees conflicts', async () => {
    const a = tab();
    await expect(a.list()).rejects.toThrow(/Sign in/);
    await a.signInWithEmail('Ann@Example.com');
    expect((await a.user())!.email).toBe('ann@example.com');
    const p = { ...defaultProject(), name: 'Promo' };
    const row = await a.create(p);
    expect(row).toMatchObject({ name: 'Promo', owner: true, role: 'owner', updatedBy: 'ann@example.com' });
    const r1 = await a.update(row.id, { ...p, name: 'Promo v2' }, row.updatedAt);
    expect('updatedAt' in r1).toBe(true);
    const stale = await a.update(row.id, p, row.updatedAt);                 // an old version stamp
    expect(stale).toEqual({ conflict: true, updatedBy: 'ann@example.com' });
    const back = await a.load(row.id);
    expect(back.project.name).toBe('Promo v2');
    expect(back.project.layers).toEqual(p.layers);
  });

  it('sharing: strangers see nothing, viewers open but cannot save, editors save; only owners share / delete', async () => {
    const a = tab();
    await a.signInWithEmail('ann@example.com');
    const row = await a.create(defaultProject());
    const b = tab();
    await b.signInWithEmail('bob@example.com');
    expect(await b.list()).toEqual([]);
    await expect(b.load(row.id)).rejects.toThrow(/no longer have access/);
    await a.share(row.id, 'BOB@example.com', 'viewer');
    const seen = await b.list();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ owner: false, role: 'viewer', ownerEmail: 'ann@example.com' });
    const { row: br } = await b.load(row.id);
    await expect(b.update(row.id, defaultProject(), br.updatedAt)).rejects.toThrow(/view this project but not save/);
    await expect(b.share(row.id, 'eve@example.com', 'editor')).rejects.toThrow(/Only the owner/);
    await expect(b.remove(row.id)).rejects.toThrow(/Only the owner/);
    await a.share(row.id, 'bob@example.com', 'editor');                      // upgrade, not a duplicate
    expect(await a.members(row.id)).toEqual([{ email: 'bob@example.com', role: 'editor' }]);
    const saved = await b.update(row.id, { ...defaultProject(), name: 'By Bob' }, br.updatedAt);
    expect('updatedAt' in saved).toBe(true);
    expect((await a.list())[0]).toMatchObject({ name: 'By Bob', updatedBy: 'bob@example.com' });
    await b.unshare(row.id, 'bob@example.com');                              // members may leave
    expect(await b.list()).toEqual([]);
    await a.remove(row.id);
    expect(await a.list()).toEqual([]);
  });

  it('rejects oversized projects and bad emails', async () => {
    const a = tab();
    await expect(a.signInWithEmail('nope')).rejects.toThrow(/email/);
    await a.signInWithEmail('ann@example.com');
    const big = { ...defaultProject(), name: 'x'.repeat(2_100_000) };
    await expect(a.create(big)).rejects.toThrow(/too large/);
    expect(isEmail('a@b.co')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
  });

  it('config: https project URL + publishable key; secret keys are refused', () => {
    expect(validConfig({ url: 'memory:', key: '' })).toBeNull();
    expect(validConfig({ url: 'https://abc.supabase.co', key: 'sb_publishable_123' })).toBeNull();
    expect(validConfig({ url: 'http://abc.supabase.co', key: 'k' })).toMatch(/https/);
    expect(validConfig({ url: 'javascript:alert(1)', key: 'k' })).toMatch(/https/);
    expect(validConfig({ url: 'https://abc.supabase.co', key: '' })).toMatch(/publishable/);
    expect(validConfig({ url: 'https://abc.supabase.co', key: 'sb_secret_abc' })).toMatch(/secret key/);
    const jwt = ['x', btoa(JSON.stringify({ role: 'service_role' })), 'y'].join('.');
    expect(validConfig({ url: 'https://abc.supabase.co', key: jwt })).toMatch(/secret key/);
  });
});
