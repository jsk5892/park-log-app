-- Park Log: run this once in Supabase (SQL Editor > New query > paste > Run).
-- It creates one table that holds one row per account: your whole Park Log as JSON.

create table if not exists public.park_log (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

-- Row-level security: every account can only see and change its own row.
alter table public.park_log enable row level security;

drop policy if exists "Read own park log"   on public.park_log;
drop policy if exists "Create own park log" on public.park_log;
drop policy if exists "Update own park log" on public.park_log;

create policy "Read own park log" on public.park_log
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Create own park log" on public.park_log
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "Update own park log" on public.park_log
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
