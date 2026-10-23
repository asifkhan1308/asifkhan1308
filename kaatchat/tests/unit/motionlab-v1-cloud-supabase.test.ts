// The real Supabase backend, against a fake network: checks the requests it
// sends (sign-in link, version-checked save) and how it reads the replies.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultProject } from '../../src/features/motionlab-v1/engine/defaults';

class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, String(v)); } removeItem(k: string) { this.m.delete(k); } clear() { this.m.clear(); } get length() { return this.m.size; } key(i: number) { return [...this.m.keys()][i] ?? null; } }
const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = new Mem();
g.sessionStorage = new Mem();
g.location = { origin: 'https://app.example', pathname: '/app/', search: '', hash: '#/studio', href: 'https://app.example/app/#/studio' };

const calls: Array<{ method: string; url: URL; body: unknown }> = [];
let replies: Array<(u: URL, m: string) => Response | null> = [];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const raw = init?.body ?? null;
    calls.push({ method, url, body: typeof raw === 'string' && raw ? JSON.parse(raw) : raw });
    for (const r of replies) { const res = r(url, method); if (res) return res; }
    return json({});
  }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; });

const { setCloudConfig, getBackend } = await import('../../src/features/motionlab-v1/cloud/backend');

describe('MOTIONLAB V2 cloud — Supabase backend requests', () => {
  it('email sign-in asks for a link that returns to Studio', async () => {
    setCloudConfig({ url: 'https://abc.supabase.co', key: 'sb_publishable_test' });
    const b = await getBackend()!;
    expect(b.kind).toBe('supabase');
    expect(await b.signInWithEmail(' Ann@Example.com ')).toBe('link-sent');
    const otp = calls.find((c) => c.url.pathname === '/auth/v1/otp')!;
    expect(otp.method).toBe('POST');
    expect(otp.body).toMatchObject({ email: 'ann@example.com', create_user: true });
    expect(otp.url.searchParams.get('redirect_to')).toBe('https://app.example/app/#/studio');
  });

  it('a save filters on the version it started from; an empty reply means someone saved first', async () => {
    const b = await getBackend()!;
    calls.length = 0;
    replies = [
      (u, m) => (m === 'PATCH' && u.pathname === '/rest/v1/studio_projects' ? json([]) : null),
      (u, m) => (m === 'GET' && u.pathname === '/rest/v1/studio_projects' ? json({ updated_by_email: 'bob@example.com' }) : null),
    ];
    const res = await b.update('p1', { ...defaultProject(), name: 'Mine' }, '2026-10-23T10:00:00.123456+00:00');
    expect(res).toEqual({ conflict: true, updatedBy: 'bob@example.com' });
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url.searchParams.get('id')).toBe('eq.p1');
    expect(patch.url.searchParams.get('updated_at')).toBe('eq.2026-10-23T10:00:00.123456+00:00');
    expect(patch.body).toMatchObject({ name: 'Mine', data: { format: 'motionlab', name: 'Mine' } });

    calls.length = 0;
    replies = [(_u, m) => (m === 'PATCH' ? json([{ updated_at: '2026-10-23T10:05:00+00:00' }]) : null)];
    expect(await b.update('p1', defaultProject(), 'x')).toEqual({ updatedAt: '2026-10-23T10:05:00+00:00' });
  });

  it('server errors surface as readable messages', async () => {
    const b = await getBackend()!;
    replies = [(u, m) => (m === 'POST' && u.pathname === '/rest/v1/studio_members' ? json({ message: 'new row violates row-level security policy' }, 403) : null)];
    await expect(b.share('p1', 'eve@example.com', 'viewer')).rejects.toThrow(/row-level security/);
    await expect(b.share('p1', 'not-an-email', 'viewer')).rejects.toThrow(/email/);
  });
});
