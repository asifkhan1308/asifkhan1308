-- MOTIONLAB Studio cloud projects (V2).
-- Projects are small JSON documents (layers, keyframes, settings). Media
-- files stay on each person's device, so the free plan's storage isn't used.
-- Access: the owner, plus people the owner shares with by email
-- (editor = can save, viewer = can open). Enforced by row-level security.

create table if not exists public.studio_projects (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_email text not null default (auth.jwt() ->> 'email'),
  name text not null default 'Untitled' check (char_length(name) <= 200),
  data jsonb not null check (octet_length(data::text) <= 2000000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_email text not null default (auth.jwt() ->> 'email')
);

create table if not exists public.studio_members (
  project_id uuid not null references public.studio_projects (id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) <= 320),
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  added_at timestamptz not null default now(),
  primary key (project_id, email)
);

create index if not exists studio_projects_owner_idx on public.studio_projects (owner);
create index if not exists studio_members_email_idx on public.studio_members (email);

-- Stamp every save server-side (clients can't fake the time or the author).
create or replace function public.studio_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by_email := coalesce(auth.jwt() ->> 'email', new.updated_by_email);
  new.owner := old.owner;              -- ownership can't be changed by an update
  new.owner_email := old.owner_email;
  new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists studio_projects_touch on public.studio_projects;
create trigger studio_projects_touch before update on public.studio_projects
  for each row execute function public.studio_touch();

-- Membership lookups for the policies (security definer avoids policy recursion).
create or replace function public.studio_role(pid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.studio_members m
  where m.project_id = pid and m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;
create or replace function public.studio_is_owner(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.studio_projects p where p.id = pid and p.owner = auth.uid())
$$;
revoke all on function public.studio_role(uuid) from public;
revoke all on function public.studio_is_owner(uuid) from public;
grant execute on function public.studio_role(uuid) to authenticated;
grant execute on function public.studio_is_owner(uuid) to authenticated;

alter table public.studio_projects enable row level security;
alter table public.studio_members enable row level security;

drop policy if exists "read own or shared" on public.studio_projects;
create policy "read own or shared" on public.studio_projects for select to authenticated
  using (owner = (select auth.uid()) or public.studio_role(id) is not null);
drop policy if exists "create own" on public.studio_projects;
create policy "create own" on public.studio_projects for insert to authenticated
  with check (owner = (select auth.uid()));
drop policy if exists "save own or as editor" on public.studio_projects;
create policy "save own or as editor" on public.studio_projects for update to authenticated
  using (owner = (select auth.uid()) or public.studio_role(id) = 'editor')
  with check (owner = (select auth.uid()) or public.studio_role(id) = 'editor');
drop policy if exists "delete own" on public.studio_projects;
create policy "delete own" on public.studio_projects for delete to authenticated
  using (owner = (select auth.uid()));

drop policy if exists "owner manages, members see themselves" on public.studio_members;
create policy "owner manages, members see themselves" on public.studio_members for select to authenticated
  using (public.studio_is_owner(project_id) or email = lower(coalesce((select auth.jwt()) ->> 'email', '')));
drop policy if exists "owner adds" on public.studio_members;
create policy "owner adds" on public.studio_members for insert to authenticated
  with check (public.studio_is_owner(project_id));
drop policy if exists "owner changes" on public.studio_members;
create policy "owner changes" on public.studio_members for update to authenticated
  using (public.studio_is_owner(project_id)) with check (public.studio_is_owner(project_id));
drop policy if exists "owner removes, members leave" on public.studio_members;
create policy "owner removes, members leave" on public.studio_members for delete to authenticated
  using (public.studio_is_owner(project_id) or email = lower(coalesce((select auth.jwt()) ->> 'email', '')));

grant select, insert, update, delete on public.studio_projects to authenticated;
grant select, insert, update, delete on public.studio_members to authenticated;

-- Live updates: collaborators hear about saves (Realtime respects the policies above).
do $$ begin
  alter publication supabase_realtime add table public.studio_projects;
exception when duplicate_object then null; when undefined_object then null;
end $$;
