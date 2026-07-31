-- Profile data is fetched directly only for the signed-in person. Administration
-- is performed by the privileged Edge Function, so accountants and observers
-- cannot enumerate colleagues through the public REST endpoint.
drop policy if exists "harmony_users_read_workspace" on public.harmony_users;

create policy "harmony_users_read_self" on public.harmony_users
  for select to authenticated
  using (user_id = (select auth.uid()));
