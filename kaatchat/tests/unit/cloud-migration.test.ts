// Runs the real Studio Cloud migration in Postgres (PGlite) and checks the
// row-level security rules as different signed-in people. Supabase's auth
// schema is stubbed the way Supabase defines it: auth.uid() / auth.jwt()
// read the request's JWT claims; signed-in requests run as `authenticated`.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const SQL = readFileSync(new URL('../../supabase/migrations/20261023000000_studio_cloud.sql', import.meta.url), 'utf8');
const ANN = '00000000-0000-0000-0000-00000000000a';
const BOB = '00000000-0000-0000-0000-00000000000b';
const EVE = '00000000-0000-0000-0000-00000000000e';
let db: PGlite;

/** Run `sql` as a signed-in user (or as nobody with `null`). */
async function as<T = Record<string, unknown>>(who: [string, string] | null, sql: string, params: unknown[] = []): Promise<T[]> {
  const claims = who ? JSON.stringify({ sub: who[0], email: who[1], role: 'authenticated' }) : '';
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [claims]);
  await db.exec(`set role ${who ? 'authenticated' : 'anon'}`);
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec('reset role'); }
}
const ann: [string, string] = [ANN, 'ann@example.com'];
const bob: [string, string] = [BOB, 'bob@example.com'];
const eve: [string, string] = [EVE, 'eve@example.com'];

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; grant usage on schema auth to anon, authenticated;
    create table auth.users (id uuid primary key, email text);
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
    grant execute on all functions in schema auth to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    insert into auth.users values ('${ANN}', 'ann@example.com'), ('${BOB}', 'bob@example.com'), ('${EVE}', 'eve@example.com');
  `);
  await db.exec(SQL);
  await db.exec(SQL);                                                 // safe to run twice
}, 60_000);

describe('Studio Cloud database rules (real migration, real Postgres)', () => {
  let pid = '';
  it('owners create; ownership and author are stamped by the server', async () => {
    const [row] = await as<{ id: string; owner: string; owner_email: string; updated_by_email: string }>(ann,
      `insert into public.studio_projects (name, data) values ('Promo', '{"layers":[]}') returning id, owner, owner_email, updated_by_email`);
    pid = row.id;
    expect(row).toMatchObject({ owner: ANN, owner_email: 'ann@example.com', updated_by_email: 'ann@example.com' });
    await expect(as(bob, `insert into public.studio_projects (owner, name, data) values ('${ANN}', 'Fake', '{}')`)).rejects.toThrow(/row-level security/);
    await expect(as(null, `select * from public.studio_projects`)).rejects.toThrow(/permission denied/);
  });

  it('strangers see and change nothing', async () => {
    expect(await as(eve, `select id from public.studio_projects`)).toEqual([]);
    expect(await as(eve, `update public.studio_projects set name = 'pwned' where id = $1 returning id`, [pid])).toEqual([]);
    expect(await as(eve, `delete from public.studio_projects where id = $1 returning id`, [pid])).toEqual([]);
    await expect(as(eve, `insert into public.studio_members (project_id, email) values ($1, 'eve@example.com')`, [pid])).rejects.toThrow(/row-level security/);
  });

  it('viewers read but cannot save; editors save; the server stamps the author and time', async () => {
    await as(ann, `insert into public.studio_members (project_id, email, role) values ($1, 'bob@example.com', 'viewer')`, [pid]);
    expect(await as(bob, `select name from public.studio_projects`)).toEqual([{ name: 'Promo' }]);
    expect(await as(bob, `update public.studio_projects set name = 'x' where id = $1 returning id`, [pid])).toEqual([]);
    await as(ann, `update public.studio_members set role = 'editor' where project_id = $1 and email = 'bob@example.com'`, [pid]);
    const before = (await as<{ updated_at: string }>(ann, `select updated_at from public.studio_projects`))[0].updated_at;
    const [saved] = await as<{ name: string; updated_by_email: string; owner: string; updated_at: string }>(bob,
      `update public.studio_projects set name = 'By Bob', owner = '${BOB}', updated_by_email = 'ann@example.com' where id = $1 returning name, updated_by_email, owner, updated_at`, [pid]);
    expect(saved).toMatchObject({ name: 'By Bob', updated_by_email: 'bob@example.com', owner: ANN });   // can't take ownership or fake the author
    expect(new Date(saved.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });

  it('the version check refuses a stale save (optimistic concurrency)', async () => {
    const [cur] = await as<{ updated_at: string }>(ann, `select updated_at from public.studio_projects where id = $1`, [pid]);
    expect(await as(ann, `update public.studio_projects set name = 'old' where id = $1 and updated_at = '2000-01-01' returning id`, [pid])).toEqual([]);
    expect(await as(ann, `update public.studio_projects set name = 'Promo 2' where id = $1 and updated_at = $2 returning id`, [pid, cur.updated_at])).toHaveLength(1);
  });

  it('only owners share or delete; members see only their own membership and may leave', async () => {
    await expect(as(bob, `insert into public.studio_members (project_id, email) values ($1, 'eve@example.com')`, [pid])).rejects.toThrow(/row-level security/);
    expect(await as(bob, `delete from public.studio_projects where id = $1 returning id`, [pid])).toEqual([]);
    await as(ann, `insert into public.studio_members (project_id, email, role) values ($1, 'eve@example.com', 'viewer')`, [pid]);
    expect(await as(bob, `select email from public.studio_members`)).toEqual([{ email: 'bob@example.com' }]);
    expect(await as(ann, `select email from public.studio_members order by email`)).toHaveLength(2);
    expect(await as(bob, `delete from public.studio_members where email = 'bob@example.com' returning email`)).toHaveLength(1);
    expect(await as(bob, `select id from public.studio_projects`)).toEqual([]);
    await expect(as(ann, `insert into public.studio_members (project_id, email) values ($1, 'Mixed@Case.com')`, [pid])).rejects.toThrow(/check constraint/);
    expect(await as(ann, `delete from public.studio_projects where id = $1 returning id`, [pid])).toHaveLength(1);
    expect(await as(ann, `select * from public.studio_members`)).toEqual([]);               // cascade
  });

  it('projects over 2 MB are refused by the database', async () => {
    await expect(as(ann, `insert into public.studio_projects (name, data) values ('Big', jsonb_build_object('x', repeat('a', 2100000)))`)).rejects.toThrow(/check constraint/);
  });
});
