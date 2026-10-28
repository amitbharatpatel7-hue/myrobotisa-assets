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
