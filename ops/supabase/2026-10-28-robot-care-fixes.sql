-- Robot Care fixes in the members area (28 Oct 2026, hub DECISIONS D25 stage 1).
-- Amit: a member should accept Robot Care's fix from the members area, never from GitHub. Robot Care already opens the
-- fix as a pull request on the member's copy; this lets the members area list those fixes and lets the
-- robot-care-accept and robot-care-ask edge functions record what the member did.
--
-- * robot_care_runs gains the PR's number and title, the plain-words diagnosis, an urgent flag (the failed run was the
--   weekly plan or the approved-orders run, so the robot can't do its core job until the fix is in) and the fix's state.
--   The table stays service-role only: no policy, no grant.
-- * robot_care_requests logs every accept, decline and question (service role only); the edge functions rate-limit from it.
-- * my_robot_care_fixes() is the one way a signed-in member reads fixes: only rows for repos owned by the GitHub login on
--   their own members row, only fixes Robot Care opened as a PR.
-- Applied to production 28 Oct 2026. Re-runnable.

alter table public.robot_care_runs
  add column if not exists pr_number  integer,
  add column if not exists pr_title   text,
  add column if not exists diagnosis  text,
  add column if not exists urgent     boolean not null default false,
  add column if not exists fix_state  text,
  add column if not exists decided_at timestamptz;

do $$ begin
  alter table public.robot_care_runs add constraint robot_care_runs_fix_state_check
    check (fix_state is null or fix_state in ('open', 'accepted', 'declined', 'closed'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.robot_care_runs add constraint robot_care_runs_text_lengths_check
    check (coalesce(length(pr_title), 0) <= 300 and coalesce(length(diagnosis), 0) <= 2000);
exception when duplicate_object then null; end $$;

-- Fixes opened before today: number from the PR link, state open (the members area's sync marks merged ones accepted).
update public.robot_care_runs
   set pr_number = (regexp_match(pr, '/pull/(\d+)$'))[1]::int,
       fix_state = coalesce(fix_state, 'open')
 where outcome = 'pr' and pr ~ '/pull/\d+$' and (pr_number is null or fix_state is null);

create index if not exists robot_care_runs_fixes_by_login
  on public.robot_care_runs (lower(login), at desc) where outcome = 'pr';

create table if not exists public.robot_care_requests (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  run_id      bigint not null references public.robot_care_runs (id) on delete cascade,
  kind        text not null check (kind in ('accept', 'decline', 'ask')),
  ok          boolean not null default false,
  question    text check (question is null or length(question) between 1 and 600),
  answer      text check (answer is null or length(answer) <= 4000),
  handed_over boolean not null default false,
  detail      text check (detail is null or length(detail) <= 300),
  at          timestamptz not null default now()
);
create index if not exists robot_care_requests_user_at on public.robot_care_requests (user_id, at);
create index if not exists robot_care_requests_run on public.robot_care_requests (run_id);
alter table public.robot_care_requests enable row level security;
revoke all on public.robot_care_requests from anon, authenticated;

create or replace function public.my_robot_care_fixes()
returns table (id bigint, repo text, pr text, pr_number integer, pr_title text, diagnosis text, files text[],
               urgent boolean, fix_state text, at timestamptz, decided_at timestamptz, questions integer)
language sql stable security definer
set search_path = public, pg_catalog
as $$
  select r.id, r.repo, r.pr, r.pr_number, r.pr_title, r.diagnosis, r.files, r.urgent,
         coalesce(r.fix_state, 'open'), r.at, r.decided_at,
         (select count(*)::int from public.robot_care_requests q where q.run_id = r.id and q.kind = 'ask')
    from public.members m
    join public.robot_care_runs r on r.outcome = 'pr' and r.pr is not null and lower(r.login) = lower(m.github_login)
   where m.user_id = (select auth.uid()) and m.status in ('active', 'lapsed') and m.github_login is not null
   order by r.at desc
   limit 50;
$$;
revoke all on function public.my_robot_care_fixes() from public, anon;
grant execute on function public.my_robot_care_fixes() to authenticated;
