-- Local mirror of the production tables the account functions touch (29 Oct 2026). Run as the postgres superuser:
--   psql -f pg_mirror.sql            (creates database acct)
--   psql -d acct -f ../../../2026-10-27-community.sql -f ../../../2026-10-29-account.sql
-- Column names, constraints and the member-facing row-level security match production as of 29 Oct 2026.
drop database if exists acct; create database acct;
\c acct
do $$ begin create role anon nologin; exception when others then null; end $$;
do $$ begin create role authenticated nologin; exception when others then null; end $$;
do $$ begin create role service_role nologin bypassrls; exception when others then null; end $$;
create extension if not exists pgcrypto;
create schema auth; create schema admin;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant usage on schema admin to service_role;
grant execute on function auth.uid() to anon, authenticated;

create table public.members (
  id uuid primary key default gen_random_uuid(), email text not null unique check (email = lower(email) and position('@' in email) > 1),
  user_id uuid unique references auth.users(id) on delete set null, plan text not null default 'founding' check (plan in ('founding','standard','owner','test')),
  status text not null default 'active' check (status in ('active','lapsed','refunded')), joined_at timestamptz not null default now(),
  updates_until date, repo_invited_at timestamptz, note text, dashboard_url text, first_name text, founding_no integer unique,
  preview_videos boolean not null default false, repo_url text, github_login text, robot_care boolean not null default false,
  robot_care_since timestamptz, robot_care_until date);
alter table public.members enable row level security;
create policy "members read their own row" on public.members for select using (user_id = (select auth.uid()));
grant select on public.members to authenticated;

create table public.member_notices (id bigint generated always as identity primary key, title text not null, body text not null,
  kind text not null default 'news', audience text not null default 'all', link_url text, link_text text,
  starts_at timestamptz not null default now(), ends_at timestamptz, created_at timestamptz not null default now());
alter table public.member_notices enable row level security;
create table public.member_progress (user_id uuid not null, item text not null, done boolean not null default true,
  updated_at timestamptz not null default now(), primary key (user_id, item));
alter table public.member_progress enable row level security;
create policy "members read their progress" on public.member_progress for select using (user_id = (select auth.uid()));
create table public.member_notice_reads (user_id uuid not null, notice_id bigint not null, read_at timestamptz not null default now(),
  primary key (user_id, notice_id));
alter table public.member_notice_reads enable row level security;
create policy "members read their reads" on public.member_notice_reads for select using (user_id = (select auth.uid()));
create table public.lesson_link_log (id bigint generated always as identity primary key, user_id uuid not null, video text not null, at timestamptz not null default now());
alter table public.lesson_link_log enable row level security;
create table public.robot_care_runs (id bigint generated always as identity primary key, key text not null, outcome text not null, login text, repo text,
  at timestamptz not null default now());
alter table public.robot_care_runs enable row level security;
create table public.robot_care_requests (id bigint generated always as identity primary key, user_id uuid not null, run_id bigint not null,
  kind text not null, ok boolean not null default false, question text, answer text, handed_over boolean not null default false, detail text,
  at timestamptz not null default now());
alter table public.robot_care_requests enable row level security;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema admin grant all on tables to service_role;
create or replace function public.is_member() returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (select 1 from public.members m where m.user_id = auth.uid() and m.status in ('active', 'lapsed'));
$$;
