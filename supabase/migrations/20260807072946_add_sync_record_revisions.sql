-- Production migration 20260807072946. Revision 0 is reserved
-- for records that have never been accepted by the server.
alter table public.harmony_records
  add column revision bigint not null default 1;

alter table public.harmony_records
  add constraint harmony_records_revision_positive check (revision > 0);

alter table public.harmony_records
  add constraint harmony_records_key_length_check
    check (length(entity_type) <= 64 and length(id) <= 512),
  add constraint harmony_records_payload_size_check
    check (pg_column_size(payload) <= 1048576),
  add constraint harmony_records_entity_type_check
    check (entity_type in (
      'clients', 'custom_columns', 'monthly_payments', 'tax_records',
      'income_records', 'report_records', 'calendar_events', 'hr_orders',
      'hr_monthly_documents', 'payroll_records', 'audit_operations',
      'audit_events', 'settings'
    ));

-- Compatibility phase: released 1.5.3 clients still use direct PostgREST
-- upserts. A trigger makes those writes advance the same revision counter as
-- CAS clients. Direct writes are revoked only by the later rollout-finalizer.
create schema if not exists private;
revoke all on schema private from public, anon;
revoke create on schema private from authenticated;
grant usage on schema private to authenticated;

create function private.harmony_assign_record_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
  else
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;

revoke all on function private.harmony_assign_record_revision() from public, anon, authenticated;

create trigger harmony_records_assign_revision
before insert or update on public.harmony_records
for each row execute function private.harmony_assign_record_revision();

-- The publishable/anon key never needs table privileges. Authenticated legacy
-- clients need only ordinary CRUD during the compatibility window.
revoke all privileges on table public.harmony_records from public, anon;
revoke truncate, references, trigger on public.harmony_records from authenticated;
grant select, insert, update, delete on public.harmony_records to authenticated;

create function private.harmony_compare_and_swap_records(p_records jsonb)
returns table (
  entity_type text,
  id text,
  status text,
  revision bigint,
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
  'Applies Harmony record writes only when base_revision matches the current server revision.';

revoke all on function private.harmony_compare_and_swap_records(jsonb) from public, anon;
grant execute on function private.harmony_compare_and_swap_records(jsonb) to authenticated;

-- Keep the SECURITY DEFINER implementation outside the exposed schema. This
-- public wrapper runs as the caller and is the sole Data API RPC endpoint.
create function public.harmony_compare_and_swap_records(p_records jsonb)
returns table (
  entity_type text,
  id text,
  status text,
  revision bigint,
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
  'Authenticated Data API wrapper for revision compare-and-swap writes.';

revoke all on function public.harmony_compare_and_swap_records(jsonb) from public, anon;
grant execute on function public.harmony_compare_and_swap_records(jsonb) to authenticated;
