-- Production migration 20260807072955 uses a transactional counter instead of nextval(). A PostgreSQL sequence
-- allocates values before commit, so a slower transaction with a lower value
-- could otherwise become visible after a client has advanced past it.
create schema if not exists private;
revoke all on schema private from public, anon;
revoke create on schema private from authenticated;
grant usage on schema private to authenticated;

create table private.harmony_workspace_sync_counters (
  workspace_id uuid primary key references public.harmony_workspaces(id) on delete cascade,
  last_value bigint not null check (last_value >= 0)
);
revoke all on private.harmony_workspace_sync_counters from public, anon, authenticated;

alter table public.harmony_records add column change_seq bigint;

-- Give every existing record a stable initial position within its workspace.
-- This is migration metadata, not a business write, so it must not create a
-- synthetic revision for every existing row.
alter table public.harmony_records disable trigger harmony_records_assign_revision;

with numbered as (
  select workspace_id, entity_type, id,
         row_number() over (partition by workspace_id order by entity_type, id) as change_seq
    from public.harmony_records
)
update public.harmony_records as target
   set change_seq = numbered.change_seq
  from numbered
 where target.workspace_id = numbered.workspace_id
   and target.entity_type = numbered.entity_type
   and target.id = numbered.id;

alter table public.harmony_records enable trigger harmony_records_assign_revision;

insert into private.harmony_workspace_sync_counters (workspace_id, last_value)
select workspace_id, coalesce(max(change_seq), 0)
  from public.harmony_records
 group by workspace_id
on conflict (workspace_id) do update set last_value = excluded.last_value;

alter table public.harmony_records alter column change_seq set not null;
alter table public.harmony_records
  add constraint harmony_records_change_seq_positive check (change_seq > 0);
create unique index harmony_records_workspace_change_seq_uidx
  on public.harmony_records (workspace_id, change_seq);

create or replace function private.harmony_assign_change_sequence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.harmony_workspace_sync_counters as counter (workspace_id, last_value)
  values (new.workspace_id, 1)
  on conflict (workspace_id) do update
    set last_value = counter.last_value + 1
  returning last_value into new.change_seq;
  return new;
end;
$$;

revoke all on function private.harmony_assign_change_sequence() from public, anon, authenticated;

create trigger harmony_records_assign_change_sequence
before insert or update on public.harmony_records
for each row execute function private.harmony_assign_change_sequence();

-- The RPC return shape changes, so PostgreSQL requires drop/recreate rather
-- than CREATE OR REPLACE. The migration is transactional; callers never see
-- an interval in which the function is absent.
drop function public.harmony_compare_and_swap_records(jsonb);
drop function private.harmony_compare_and_swap_records(jsonb);

create function private.harmony_compare_and_swap_records(p_records jsonb)
returns table (
  entity_type text,
  id text,
  status text,
  revision bigint,
  change_seq bigint,
  payload jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  synced_at timestamptz,
  is_deleted boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_workspace_id uuid;
  v_input jsonb;
  v_base_revision bigint;
  v_row public.harmony_records%rowtype;
begin
  if v_actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select harmony_user.workspace_id
    into v_workspace_id
    from public.harmony_users as harmony_user
   where harmony_user.user_id = v_actor_id
     and harmony_user.is_active
     and harmony_user.role in ('administrator', 'accountant');

  if v_workspace_id is null then
    raise exception 'Active Harmony writer profile required' using errcode = '42501';
  end if;

  if jsonb_typeof(p_records) <> 'array' then
    raise exception 'p_records must be a JSON array' using errcode = '22023';
  end if;

  if pg_column_size(p_records) > 10485760 then
    raise exception 'A CAS batch cannot exceed 10 MiB' using errcode = '22023';
  end if;

  if jsonb_array_length(p_records) > 100 then
    raise exception 'A CAS batch cannot contain more than 100 records' using errcode = '22023';
  end if;

  for v_input in select value from jsonb_array_elements(p_records)
  loop
    if pg_column_size(v_input) > 1048576 then
      raise exception 'A CAS record cannot exceed 1 MiB' using errcode = '22023';
    end if;

    if jsonb_typeof(v_input) <> 'object'
       or nullif(btrim(v_input->>'entity_type'), '') is null
       or nullif(btrim(v_input->>'id'), '') is null
       or jsonb_typeof(v_input->'payload') is null
       or jsonb_typeof(v_input->'payload') = 'null'
       or (v_input->>'base_revision') is null
       or (v_input->>'created_at') is null
       or (v_input->>'updated_at') is null then
      raise exception 'Invalid CAS record' using errcode = '22023';
    end if;

    if length(v_input->>'entity_type') > 64 or length(v_input->>'id') > 512 then
      raise exception 'CAS record key is too long' using errcode = '22023';
    end if;

    if (v_input->>'entity_type') not in (
      'clients', 'custom_columns', 'monthly_payments', 'tax_records',
      'income_records', 'report_records', 'calendar_events', 'hr_orders',
      'hr_monthly_documents', 'payroll_records', 'audit_operations',
      'audit_events', 'settings'
    ) then
      raise exception 'Unsupported Harmony entity type' using errcode = '22023';
    end if;

    v_base_revision := (v_input->>'base_revision')::bigint;
    if v_base_revision < 0 then
      raise exception 'base_revision cannot be negative' using errcode = '22023';
    end if;

    v_row := null;
    if v_base_revision = 0 then
      insert into public.harmony_records as target (
        user_id, workspace_id, entity_type, id, payload, created_at,
        updated_at, synced_at, is_deleted, revision
      )
      values (
        v_actor_id,
        v_workspace_id,
        v_input->>'entity_type',
        v_input->>'id',
        v_input->'payload',
        (v_input->>'created_at')::timestamptz,
        (v_input->>'updated_at')::timestamptz,
        clock_timestamp(),
        coalesce((v_input->>'is_deleted')::boolean, false),
        1
      )
      on conflict on constraint harmony_records_pkey do nothing
      returning target.* into v_row;
    else
      update public.harmony_records as target
         set user_id = v_actor_id,
             payload = v_input->'payload',
             updated_at = (v_input->>'updated_at')::timestamptz,
             synced_at = clock_timestamp(),
             is_deleted = coalesce((v_input->>'is_deleted')::boolean, false)
       where target.workspace_id = v_workspace_id
         and target.entity_type = v_input->>'entity_type'
         and target.id = v_input->>'id'
         and target.revision = v_base_revision
      returning target.* into v_row;
    end if;

    if v_row.workspace_id is not null then
      status := 'applied';
    else
      select remote.*
        into v_row
        from public.harmony_records as remote
       where remote.workspace_id = v_workspace_id
         and remote.entity_type = v_input->>'entity_type'
         and remote.id = v_input->>'id';
      if v_row.workspace_id is null then
        raise exception 'CAS target disappeared during update' using errcode = '40001';
      end if;
      status := 'conflict';
    end if;

    entity_type := v_row.entity_type;
    id := v_row.id;
    revision := v_row.revision;
    change_seq := v_row.change_seq;
    payload := v_row.payload;
    created_at := v_row.created_at;
    updated_at := v_row.updated_at;
    synced_at := v_row.synced_at;
    is_deleted := v_row.is_deleted;
    return next;
  end loop;
end;
$$;

comment on function private.harmony_compare_and_swap_records(jsonb) is
  'Applies revision CAS and returns the commit-ordered workspace change sequence.';

revoke all on function private.harmony_compare_and_swap_records(jsonb) from public, anon;
grant execute on function private.harmony_compare_and_swap_records(jsonb) to authenticated;

create function public.harmony_compare_and_swap_records(p_records jsonb)
returns table (
  entity_type text,
  id text,
  status text,
  revision bigint,
  change_seq bigint,
  payload jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  synced_at timestamptz,
  is_deleted boolean
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.harmony_compare_and_swap_records(p_records)
$$;

comment on function public.harmony_compare_and_swap_records(jsonb) is
  'Authenticated Data API wrapper for CAS writes with commit-ordered sequence.';

revoke all on function public.harmony_compare_and_swap_records(jsonb) from public, anon;
grant execute on function public.harmony_compare_and_swap_records(jsonb) to authenticated;
