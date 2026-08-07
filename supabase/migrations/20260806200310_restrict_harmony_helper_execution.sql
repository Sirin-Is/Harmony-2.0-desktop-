-- SECURITY DEFINER helpers are implementation details of authenticated RLS
-- policies. Anonymous Data API callers must not be able to invoke them.
revoke execute on function public.harmony_current_role() from public, anon;
revoke execute on function public.harmony_current_workspace_id() from public, anon;
revoke execute on function public.harmony_can_write() from public, anon;

grant execute on function public.harmony_current_role() to authenticated;
grant execute on function public.harmony_current_workspace_id() to authenticated;
grant execute on function public.harmony_can_write() to authenticated;
