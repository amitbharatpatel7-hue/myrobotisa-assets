-- The free test drive (hub D41, docs/TEST-DRIVE.md). Adds two tables; changes nothing that exists.
-- test_drive_days holds the seven days (built by the hub's ops/test_drive/drive.py) and each day's reveal.
-- test_drive holds one link per person. Row-level security is on with no policies: only the test-drive function
-- (service role) can read either, so no name can be read from the browser before the function hands out its reveal.
create table if not exists public.test_drive_days (
  day int primary key check (day between 1 and 7),
  data jsonb not null,
  reveal jsonb not null,
  built_at timestamptz not null default now()
);
create table if not exists public.test_drive (
  token uuid primary key default gen_random_uuid(),
  waitlist_id bigint unique references public.waitlist(id) on delete cascade,
  kind text not null default 'member' check (kind in ('member', 'preview', 'sim')),
  started_at timestamptz,
  done int[] not null default '{}',
  last_seen timestamptz,
  created_at timestamptz not null default now()
);
alter table public.test_drive_days enable row level security;
alter table public.test_drive enable row level security;
revoke all on public.test_drive_days, public.test_drive from anon, authenticated;

-- Mark a day finished, once, and only a day that exists (the function checks it has unlocked).
create or replace function public.test_drive_done(p_token uuid, p_day int) returns int[]
language sql security definer set search_path = public as $$
  update test_drive set done = (select array_agg(distinct d order by d) from unnest(done || p_day) d), last_seen = now()
  where token = p_token and p_day between 1 and 7 returning done;
$$;
revoke all on function public.test_drive_done(uuid, int) from public, anon, authenticated;

-- One link for each person on the list who asked for the test drive (run before the 7 Dec email; safe to re-run).
create or replace function public.test_drive_issue() returns int
language sql security definer set search_path = public as $$
  with n as (insert into test_drive (waitlist_id) select id from waitlist
             where launch and unsubscribed_at is null on conflict (waitlist_id) do nothing returning 1)
  select count(*)::int from n;
$$;
revoke all on function public.test_drive_issue() from public, anon, authenticated;
grant execute on function public.test_drive_done(uuid, int), public.test_drive_issue() to service_role;
grant select, insert, update on public.test_drive, public.test_drive_days to service_role;
-- When each person's "your test drive is open" email went (test-drive-email); null = not yet.
alter table public.test_drive add column if not exists emailed_at timestamptz;
