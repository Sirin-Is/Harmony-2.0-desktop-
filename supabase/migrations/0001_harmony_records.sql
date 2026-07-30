-- Apply in Supabase SQL Editor before enabling cloud sync.
-- Stage 5 replaces this temporary owner placeholder with auth.uid()-based RLS.
create table if not exists public.harmony_records (
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  entity_type text not null,
  id text not null,
  payload jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  synced_at timestamptz,
  is_deleted boolean not null default false,
  primary key (user_id, entity_type, id)
);

create index if not exists harmony_records_user_updated_at_idx
  on public.harmony_records (user_id, updated_at asc);

alter table public.harmony_records enable row level security;

grant select, insert, update, delete on public.harmony_records to authenticated;

drop policy if exists "harmony_records_select_own" on public.harmony_records;
drop policy if exists "harmony_records_insert_own" on public.harmony_records;
drop policy if exists "harmony_records_update_own" on public.harmony_records;
drop policy if exists "harmony_records_delete_own" on public.harmony_records;

create policy "harmony_records_select_own" on public.harmony_records
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "harmony_records_insert_own" on public.harmony_records
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "harmony_records_update_own" on public.harmony_records
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "harmony_records_delete_own" on public.harmony_records
  for delete to authenticated using ((select auth.uid()) = user_id);
