-- Lesson guides behind the member sign-in (28 Oct 2026, Amit: protect the paid lessons, Cloudflare R2 for video).
-- The written step-by-step guides used to ship as docs/members/guides.js on the public site, so anyone could read
-- them. They now live here, readable only by active or lapsed members. The content itself is loaded separately and
-- is deliberately not in this public repo: this table is its home (myrobotisa-backups copies it nightly). To change a
-- guide, update its row (data is the same shape guides.js had: title, kind, mins, steps[{t,d,img,stuck}], tips).
create table if not exists public.lesson_guides (
  id text primary key check (id ~ '^(qs|day)-[a-z0-9]{1,12}$'),
  ord integer not null,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.lesson_guides enable row level security;
revoke all on table public.lesson_guides from anon, authenticated;
grant select on table public.lesson_guides to authenticated;
drop policy if exists "members read guides" on public.lesson_guides;
create policy "members read guides" on public.lesson_guides for select to authenticated using (public.is_member());

-- Lesson video links: one row per link lesson-media issues (service role only). It caps each member at 60 links an
-- hour, because R2 bills per read and has no spending cap. Rows older than a day are cleared as new ones arrive.
create table if not exists public.lesson_link_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  video text not null,
  at timestamptz not null default now()
);
create index if not exists lesson_link_log_user_at on public.lesson_link_log (user_id, at);
alter table public.lesson_link_log enable row level security;
revoke all on table public.lesson_link_log from anon, authenticated;
create or replace function public.lesson_link_log_trim() returns trigger language plpgsql security definer
  set search_path = public, pg_catalog as $$
begin
  if random() < 0.05 then delete from public.lesson_link_log where at < now() - interval '1 day'; end if;
  return null;
end $$;
revoke all on function public.lesson_link_log_trim() from public, anon, authenticated;
drop trigger if exists lesson_link_log_trim on public.lesson_link_log;
create trigger lesson_link_log_trim after insert on public.lesson_link_log for each statement execute function public.lesson_link_log_trim();
