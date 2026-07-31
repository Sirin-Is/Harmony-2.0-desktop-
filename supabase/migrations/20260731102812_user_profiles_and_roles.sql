create type public.harmony_role as enum ('administrator', 'accountant', 'observer');

create table public.harmony_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  login text not null unique check (login ~ '^[a-z0-9._-]{3,40}$'),
  display_name text not null check (char_length(display_name) between 1 and 80),
  role public.harmony_role not null default 'accountant',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.harmony_users enable row level security;
grant select on public.harmony_users to authenticated;

create or replace function public.harmony_current_role()
returns public.harmony_role
language sql stable security definer
set search_path = public
as $$ select role from public.harmony_users where user_id = (select auth.uid()) $$;

revoke all on function public.harmony_current_role() from public;
grant execute on function public.harmony_current_role() to authenticated;

create policy "harmony_users_read_self_or_administrator" on public.harmony_users
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.harmony_current_role()) = 'administrator');

-- Accounts and passwords are managed only through the server-side Edge Function.
-- The initial administrator is the existing Supabase account of Roman.
insert into public.harmony_users (user_id, login, display_name, role)
select id, 'roman', 'Роман', 'administrator'
from auth.users
where email = 'isidarsirin@gmail.com'
on conflict (user_id) do update set login = excluded.login, display_name = excluded.display_name, role = excluded.role;
