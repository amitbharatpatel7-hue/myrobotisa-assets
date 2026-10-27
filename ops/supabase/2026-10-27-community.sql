-- Members' ideas & questions (27 Oct 2026, Amit). Replaces the GitHub Discussions space.
-- Members only. Status changes, team updates and replies to your question become in-app Messages
-- (member_notices, now addressable to one member), never email. Apply once, in the Supabase SQL editor
-- or through the Supabase MCP apply_migration, project vxnestmhtjotidhzzqbo.

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public, pg_catalog as $$
  select exists (select 1 from public.members m where m.user_id = auth.uid() and m.status = 'active' and m.plan = 'owner');
$$;

create table public.community_posts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('idea','question')),
  title text not null check (char_length(btrim(title)) between 3 and 140),
  body text not null default '' check (char_length(body) <= 4000),
  category text not null default 'other' check (category in ('robot','lessons','dashboard','emails','account','other')),
  status text not null default 'review' check (status in ('review','planned','building','live','declined')),
  user_id uuid not null default auth.uid(),
  author_name text not null default 'Member',
  vote_count integer not null default 0,
  comment_count integer not null default 0,
  answer_id bigint,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  status_at timestamptz not null default now()
);
comment on table public.community_posts is 'Members'' ideas and questions. Members insert; status, answers and moderation go only through the community_* functions.';
create index community_posts_kind_idx on public.community_posts (kind, hidden, vote_count desc);
create index community_posts_user_idx on public.community_posts (user_id);

create table public.community_votes (
  post_id bigint not null references public.community_posts(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index community_votes_user_idx on public.community_votes (user_id);

create table public.community_comments (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.community_posts(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  author_name text not null default 'Member',
  is_team boolean not null default false,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index community_comments_post_idx on public.community_comments (post_id, created_at);
create index community_comments_user_idx on public.community_comments (user_id);
alter table public.community_posts add constraint community_posts_answer_fk foreign key (answer_id) references public.community_comments(id) on delete set null;
create index community_posts_answer_idx on public.community_posts (answer_id);

create table public.community_status_events (
  id bigint generated always as identity primary key,
  post_id bigint not null references public.community_posts(id) on delete cascade,
  status text not null,
  note text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now()
);
create index community_status_events_post_idx on public.community_status_events (post_id, created_at);

-- Messages can now be addressed to one member (user_id null = everyone in the audience, as before).
alter table public.member_notices add column if not exists user_id uuid;
create index if not exists member_notices_user_idx on public.member_notices (user_id);
drop policy if exists "members read their notices" on public.member_notices;
create policy "members read their notices" on public.member_notices for select to authenticated using (
  starts_at <= now() and (ends_at is null or ends_at > now())
  and (user_id is null or user_id = (select auth.uid()))
  and exists (select 1 from public.members m where m.user_id = (select auth.uid()) and m.status in ('active','lapsed')
      and (member_notices.audience = 'all' or member_notices.audience = m.plan or m.plan = 'owner'))
);

create or replace function public.community_name() returns text
language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce(nullif(btrim(m.first_name), ''), 'Member') from public.members m where m.user_id = auth.uid() limit 1;
$$;

-- Insert guards: who wrote it, its starting state, and a daily limit.
create or replace function public.community_posts_before_insert() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  new.user_id := auth.uid();
  new.author_name := coalesce(public.community_name(), 'Member');
  new.status := 'review'; new.vote_count := 0; new.comment_count := 0; new.answer_id := null; new.hidden := false;
  new.created_at := now(); new.status_at := now();
  new.title := btrim(new.title);
  if (select count(*) from public.community_posts p where p.user_id = auth.uid() and p.created_at > now() - interval '1 day') >= 10 then
    raise exception 'You''ve posted a lot today. Try again tomorrow.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger community_posts_before_insert before insert on public.community_posts for each row execute function public.community_posts_before_insert();

create or replace function public.community_comments_before_insert() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  new.user_id := auth.uid();
  new.author_name := coalesce(public.community_name(), 'Member');
  new.is_team := public.is_owner(); new.hidden := false; new.created_at := now();
  if (select count(*) from public.community_comments c where c.user_id = auth.uid() and c.created_at > now() - interval '1 day') >= 50 then
    raise exception 'You''ve replied a lot today. Try again tomorrow.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger community_comments_before_insert before insert on public.community_comments for each row execute function public.community_comments_before_insert();

-- Counters, and a Message to the asker when someone else replies to their question.
create or replace function public.community_comments_after() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare p public.community_posts;
begin
  if tg_op = 'INSERT' then
    update public.community_posts set comment_count = comment_count + 1 where id = new.post_id returning * into p;
    if p.kind = 'question' and p.user_id <> new.user_id then
      insert into public.member_notices (title, body, kind, audience, user_id, link_url, link_text)
      values ('New reply to your question', left(p.title, 120), 'community', 'all', p.user_id, '#post/' || p.id, 'See the reply');
    end if;
  elsif tg_op = 'DELETE' then
    update public.community_posts set comment_count = greatest(comment_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end $$;
create trigger community_comments_after after insert or delete on public.community_comments for each row execute function public.community_comments_after();

create or replace function public.community_votes_before_insert() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin new.user_id := auth.uid(); new.created_at := now(); return new; end $$;
create trigger community_votes_before_insert before insert on public.community_votes for each row execute function public.community_votes_before_insert();

create or replace function public.community_votes_after() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if tg_op = 'INSERT' then update public.community_posts set vote_count = vote_count + 1 where id = new.post_id;
  else update public.community_posts set vote_count = greatest(vote_count - 1, 0) where id = old.post_id; end if;
  return null;
end $$;
create trigger community_votes_after after insert or delete on public.community_votes for each row execute function public.community_votes_after();

-- Owner: move an idea along, with an optional note. Everyone who backed it (and the author) gets a Message.
create or replace function public.community_set_status(p_post bigint, p_status text, p_note text default '') returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare p public.community_posts; lbl text;
begin
  if not public.is_owner() then raise exception 'Only the team can change a status.' using errcode = '42501'; end if;
  if p_status not in ('review','planned','building','live','declined') then raise exception 'Unknown status %', p_status; end if;
  update public.community_posts set status = p_status, status_at = now() where id = p_post and kind = 'idea' returning * into p;
  if not found then raise exception 'No such idea.'; end if;
  insert into public.community_status_events (post_id, status, note) values (p_post, p_status, coalesce(btrim(p_note), ''));
  lbl := case p_status when 'review' then 'Under review' when 'planned' then 'Planned' when 'building' then 'Building' when 'live' then 'Live' else 'Not for now' end;
  insert into public.member_notices (title, body, kind, audience, user_id, link_url, link_text)
  select case when s.user_id = p.user_id then 'Your idea is now ' else 'An idea you backed is now ' end || lbl,
         left(p.title, 120) || case when coalesce(btrim(p_note), '') <> '' then E'\n\n' || left(btrim(p_note), 400) else '' end,
         'community', 'all', s.user_id, '#post/' || p.id, 'See the idea'
  from (select v.user_id from public.community_votes v where v.post_id = p_post union select p.user_id) s
  where s.user_id <> auth.uid();
end $$;

-- Owner: a team update on an idea without changing its status (also to backers' Messages).
create or replace function public.community_team_update(p_post bigint, p_note text) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare p public.community_posts;
begin
  if not public.is_owner() then raise exception 'Only the team can post an update.' using errcode = '42501'; end if;
  select * into p from public.community_posts where id = p_post;
  if not found or coalesce(btrim(p_note), '') = '' then raise exception 'Nothing to post.'; end if;
  insert into public.community_status_events (post_id, status, note) values (p_post, p.status, btrim(p_note));
  insert into public.member_notices (title, body, kind, audience, user_id, link_url, link_text)
  select 'Update on an idea you backed', left(p.title, 120) || E'\n\n' || left(btrim(p_note), 400), 'community', 'all', s.user_id, '#post/' || p.id, 'See the idea'
  from (select v.user_id from public.community_votes v where v.post_id = p_post union select p.user_id) s
  where s.user_id <> auth.uid();
end $$;

-- The asker or the team picks the answer to a question (null clears it).
create or replace function public.community_mark_answer(p_post bigint, p_comment bigint) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
declare p public.community_posts;
begin
  select * into p from public.community_posts where id = p_post and kind = 'question';
  if not found then raise exception 'No such question.'; end if;
  if not (public.is_owner() or p.user_id = auth.uid()) then raise exception 'Only the person who asked can pick the answer.' using errcode = '42501'; end if;
  if p_comment is not null and not exists (select 1 from public.community_comments c where c.id = p_comment and c.post_id = p_post) then raise exception 'That reply is not on this question.'; end if;
  update public.community_posts set answer_id = p_comment where id = p_post;
end $$;

-- Owner: hide or show a post or a reply.
create or replace function public.community_hide(p_post bigint, p_comment bigint, p_hidden boolean) returns void
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if not public.is_owner() then raise exception 'Only the team can hide posts.' using errcode = '42501'; end if;
  if p_comment is not null then update public.community_comments set hidden = p_hidden where id = p_comment;
  else update public.community_posts set hidden = p_hidden where id = p_post; end if;
end $$;

revoke all on function public.community_set_status(bigint, text, text), public.community_team_update(bigint, text),
  public.community_mark_answer(bigint, bigint), public.community_hide(bigint, bigint, boolean) from public, anon;
grant execute on function public.community_set_status(bigint, text, text), public.community_team_update(bigint, text),
  public.community_mark_answer(bigint, bigint), public.community_hide(bigint, bigint, boolean) to authenticated;
revoke execute on function public.community_posts_before_insert(), public.community_comments_before_insert(), public.community_comments_after(),
  public.community_votes_before_insert(), public.community_votes_after() from public, anon, authenticated;

alter table public.community_posts enable row level security;
alter table public.community_votes enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_status_events enable row level security;

create policy "members read posts" on public.community_posts for select to authenticated
  using (public.is_member() and (not hidden or user_id = (select auth.uid()) or public.is_owner()));
create policy "members add posts" on public.community_posts for insert to authenticated
  with check (public.is_member());
create policy "members read their votes" on public.community_votes for select to authenticated
  using (user_id = (select auth.uid()) and public.is_member());
create policy "members vote on ideas" on public.community_votes for insert to authenticated
  with check (public.is_member() and exists (select 1 from public.community_posts p where p.id = post_id and p.kind = 'idea' and not p.hidden));
create policy "members take back a vote" on public.community_votes for delete to authenticated
  using (user_id = (select auth.uid()) and public.is_member());
create policy "members read replies" on public.community_comments for select to authenticated
  using (public.is_member() and (not hidden or user_id = (select auth.uid()) or public.is_owner()));
create policy "members reply" on public.community_comments for insert to authenticated
  with check (public.is_member() and exists (select 1 from public.community_posts p where p.id = post_id and not p.hidden));
create policy "members delete own reply" on public.community_comments for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_owner());
create policy "members read progress" on public.community_status_events for select to authenticated
  using (public.is_member());

revoke all on public.community_posts, public.community_votes, public.community_comments, public.community_status_events from anon;
grant select, insert on public.community_posts to authenticated;
grant select, insert, delete on public.community_votes to authenticated;
grant select, insert, delete on public.community_comments to authenticated;
grant select on public.community_status_events to authenticated;
