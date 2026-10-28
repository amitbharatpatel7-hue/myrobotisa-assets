-- Local mirror of the production tables Accept fix reads (28 Oct 2026): run it, then ops/supabase/2026-10-28-robot-care-fixes.sql.
-- psql -f pg_mirror.sql (creates database rc), then psql -d rc -f ../../../2026-10-28-robot-care-fixes.sql
drop database if exists rc; create database rc;
\c rc
do $$ begin create role anon nologin; exception when others then null; end $$;
do $$ begin create role authenticated nologin; exception when others then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when others then null; end $$;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;
create table public.members (id uuid primary key default gen_random_uuid(), email text, user_id uuid unique, plan text default 'founding',
  status text default 'active', github_login text, robot_care boolean default false);
alter table public.members enable row level security;
create policy "members read their own row" on public.members for select using (user_id = (select auth.uid()));
grant select on public.members to authenticated;
create table public.robot_care_runs (id bigint generated always as identity primary key, key text, outcome text check (outcome in ('pr','advice','blocked','skipped','no-run','error')),
  login text, repo text, issue int, delivery text, why text, pr text, files text[], usd numeric, at timestamptz default now());
alter table public.robot_care_runs enable row level security;
grant all on all tables in schema public to service_role;
