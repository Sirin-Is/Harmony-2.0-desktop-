-- Emergency containment for tables created by the legacy Google Sites client.
-- The current desktop client reads and writes public.harmony_records instead.
-- Keep this migration tolerant of clean installations where the legacy tables
-- were never created.
do $$
declare
  legacy_table text;
begin
  foreach legacy_table in array array[
    'app_state',
    'calendar_events',
    'tasks',
    'clients',
    'monthly_payments',
    'income_records',
    'tax_records'
  ]
  loop
    if to_regclass(format('public.%I', legacy_table)) is not null then
      execute format('alter table public.%I enable row level security', legacy_table);
      execute format(
        'revoke all privileges on table public.%I from public, anon, authenticated',
        legacy_table
      );
    end if;
  end loop;

  if to_regclass('public.app_state') is not null then
    execute 'drop policy if exists "Allow public insert" on public.app_state';
    execute 'drop policy if exists "Allow public read" on public.app_state';
    execute 'drop policy if exists "Allow public update" on public.app_state';
  end if;

  if to_regclass('public.calendar_events') is not null then
    execute 'drop policy if exists "Allow public access to calendar_events" on public.calendar_events';
  end if;

  if to_regclass('public.tasks') is not null then
    execute 'drop policy if exists "Allow public access to tasks" on public.tasks';
  end if;
end;
$$;

-- Supabase historically auto-granted API roles access to new public objects.
-- Make future exposure opt-in. Application migrations must grant only the
-- precise privileges they need after enabling RLS.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from public, anon, authenticated;

notify pgrst, 'reload schema';
