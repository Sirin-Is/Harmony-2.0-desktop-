-- One shared Harmony workspace. The structure permits additional workspaces later.
create table public.harmony_workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.harmony_workspaces enable row level security;
revoke all on public.harmony_workspaces from anon, authenticated;

insert into public.harmony_workspaces (slug, name)
values ('main', 'Harmony')
on conflict (slug) do nothing;

alter table public.harmony_users add column workspace_id uuid references public.harmony_workspaces(id);
update public.harmony_users set workspace_id = (select id from public.harmony_workspaces where slug = 'main') where workspace_id is null;
alter table public.harmony_users alter column workspace_id set not null;
create index harmony_users_workspace_id_idx on public.harmony_users (workspace_id);

create or replace function public.harmony_current_role()
returns public.harmony_role
language sql stable security definer
set search_path = public
as $$
  select role from public.harmony_users
  where user_id = (select auth.uid()) and is_active
$$;

create or replace function public.harmony_current_workspace_id()
returns uuid
language sql stable security definer
set search_path = public
as $$
  select workspace_id from public.harmony_users
  where user_id = (select auth.uid()) and is_active
$$;

create or replace function public.harmony_can_write()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((select public.harmony_current_role() in ('administrator', 'accountant')), false)
$$;

revoke all on function public.harmony_current_workspace_id() from public;
revoke all on function public.harmony_can_write() from public;
grant execute on function public.harmony_current_workspace_id() to authenticated;
grant execute on function public.harmony_can_write() to authenticated;

drop policy if exists "harmony_users_read_self_or_administrator" on public.harmony_users;
create policy "harmony_users_read_workspace" on public.harmony_users
  for select to authenticated
  using (workspace_id = (select public.harmony_current_workspace_id()));

alter table public.harmony_records add column workspace_id uuid references public.harmony_workspaces(id);
update public.harmony_records set workspace_id = (select id from public.harmony_workspaces where slug = 'main') where workspace_id is null;
alter table public.harmony_records alter column workspace_id set not null;
alter table public.harmony_records drop constraint harmony_records_pkey;
alter table public.harmony_records add primary key (workspace_id, entity_type, id);
create index harmony_records_workspace_updated_at_idx on public.harmony_records (workspace_id, updated_at asc);

drop policy if exists "harmony_records_select_own" on public.harmony_records;
drop policy if exists "harmony_records_insert_own" on public.harmony_records;
drop policy if exists "harmony_records_update_own" on public.harmony_records;
drop policy if exists "harmony_records_delete_own" on public.harmony_records;

create policy "harmony_records_read_workspace" on public.harmony_records
  for select to authenticated
  using (workspace_id = (select public.harmony_current_workspace_id()));
create policy "harmony_records_insert_workspace" on public.harmony_records
  for insert to authenticated
  with check (
    workspace_id = (select public.harmony_current_workspace_id())
    and user_id = (select auth.uid())
    and (select public.harmony_can_write())
  );
create policy "harmony_records_update_workspace" on public.harmony_records
  for update to authenticated
  using (workspace_id = (select public.harmony_current_workspace_id()) and (select public.harmony_can_write()))
  with check (
    workspace_id = (select public.harmony_current_workspace_id())
    and user_id = (select auth.uid())
    and (select public.harmony_can_write())
  );
create policy "harmony_records_delete_workspace" on public.harmony_records
  for delete to authenticated
  using (workspace_id = (select public.harmony_current_workspace_id()) and (select public.harmony_can_write()));
