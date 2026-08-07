-- Production migration 20260807074131. These helpers are used by RLS policies, but they only read the caller's own
-- harmony_users row. SECURITY INVOKER is sufficient and avoids exposing a
-- privileged RPC through the public schema.
create or replace function public.harmony_current_role()
returns public.harmony_role
language sql
stable
security invoker
set search_path = ''
as $$
  select harmony_user.role
    from public.harmony_users as harmony_user
   where harmony_user.user_id = (select auth.uid())
     and harmony_user.is_active
$$;

create or replace function public.harmony_current_workspace_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select harmony_user.workspace_id
    from public.harmony_users as harmony_user
   where harmony_user.user_id = (select auth.uid())
     and harmony_user.is_active
$$;

create or replace function public.harmony_can_write()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select public.harmony_current_role() in ('administrator', 'accountant')), false)
$$;

revoke all privileges on table public.harmony_users from public, anon, authenticated;
grant select on table public.harmony_users to authenticated;

revoke all on function public.harmony_current_role() from public, anon;
revoke all on function public.harmony_current_workspace_id() from public, anon;
revoke all on function public.harmony_can_write() from public, anon;
grant execute on function public.harmony_current_role() to authenticated;
grant execute on function public.harmony_current_workspace_id() to authenticated;
grant execute on function public.harmony_can_write() to authenticated;
