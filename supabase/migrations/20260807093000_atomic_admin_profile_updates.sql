-- Serialize administrator demotions per workspace so concurrent requests cannot
-- both observe another administrator and leave the workspace without one.
create or replace function public.harmony_admin_update_user(
  p_workspace_id uuid,
  p_user_id uuid,
  p_login text,
  p_display_name text,
  p_role public.harmony_role,
  p_is_active boolean
)
returns setof public.harmony_users
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  target public.harmony_users%rowtype;
  active_administrators bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('harmony-admin:' || p_workspace_id::text, 0)
  );

  select * into target
  from public.harmony_users
  where user_id = p_user_id and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'HARMONY_USER_NOT_FOUND';
  end if;

  if target.role = 'administrator' and target.is_active
     and not (p_role = 'administrator' and p_is_active) then
    select count(*) into active_administrators
    from public.harmony_users
    where workspace_id = p_workspace_id
      and role = 'administrator'
      and is_active;
    if active_administrators <= 1 then
      raise exception using errcode = 'P0001', message = 'HARMONY_LAST_ADMIN';
    end if;
  end if;

  return query
  update public.harmony_users
  set login = p_login,
      display_name = p_display_name,
      role = p_role,
      is_active = p_is_active,
      updated_at = now()
  where user_id = p_user_id and workspace_id = p_workspace_id
  returning *;
end;
$$;

revoke all on function public.harmony_admin_update_user(uuid, uuid, text, text, public.harmony_role, boolean) from public, anon, authenticated;
grant execute on function public.harmony_admin_update_user(uuid, uuid, text, text, public.harmony_role, boolean) to service_role;
