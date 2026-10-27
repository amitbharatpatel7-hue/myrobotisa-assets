-- One-off import of github.com/myrobotisa/community into the Ideas & questions board (27 Oct 2026, applied).
-- 1. Server-side inserts (no signed-in member: auth.uid() is null) keep the values they're given; anything a member
--    sends is still overwritten by the triggers. Anon has no insert grant, so only the database's own roles reach this.
-- 2. community_posts.source (unique) records where an imported post came from, so an import never duplicates.
-- 3. community_import(jsonb), service_role only, took the discussions from the community-import edge function
--    (now retired to a 410 stub). Result: 3 discussions found; the Welcome announcement was skipped (the members
--    area has its own welcome Message); the two "open thread" / "vote here" threads were Amit's seed posts, so their
--    five options became five ideas of their own (ids 4-8, by Amit, Under review, source github#35/1..5) and the
--    two threads themselves were removed, since the board now does what they did.

alter table public.community_posts add column if not exists source text unique;

create or replace function public.community_posts_before_insert() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if auth.uid() is null then return new; end if;   -- server-side import only: anon has no insert grant
  new.user_id := auth.uid();
  new.author_name := coalesce(public.community_name(), 'Member');
  new.status := 'review'; new.vote_count := 0; new.comment_count := 0; new.answer_id := null; new.hidden := false;
  new.created_at := now(); new.status_at := now(); new.source := null;
  new.title := btrim(new.title);
  if (select count(*) from public.community_posts p where p.user_id = auth.uid() and p.created_at > now() - interval '1 day') >= 10 then
    raise exception 'You''ve posted a lot today. Try again tomorrow.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function public.community_comments_before_insert() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if auth.uid() is null then return new; end if;   -- server-side import only
  new.user_id := auth.uid();
  new.author_name := coalesce(public.community_name(), 'Member');
  new.is_team := public.is_owner(); new.hidden := false; new.created_at := now();
  if (select count(*) from public.community_comments c where c.user_id = auth.uid() and c.created_at > now() - interval '1 day') >= 50 then
    raise exception 'You''ve replied a lot today. Try again tomorrow.' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- No Messages for server-side inserts (an import is nobody replying to anyone).
create or replace function public.community_comments_after() returns trigger
language plpgsql security definer set search_path = public, pg_catalog as $$
declare p public.community_posts;
begin
  if tg_op = 'INSERT' then
    update public.community_posts set comment_count = comment_count + 1 where id = new.post_id returning * into p;
    if auth.uid() is not null and p.kind = 'question' and p.user_id <> new.user_id then
      insert into public.member_notices (title, body, kind, audience, user_id, link_url, link_text)
      values ('New reply to your question', left(p.title, 120), 'community', 'all', p.user_id, '#post/' || p.id, 'See the reply');
    end if;
  elsif tg_op = 'DELETE' then
    update public.community_posts set comment_count = greatest(comment_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end $$;

-- community_import(p jsonb): see the applied migration "community_github_import" in Supabase for the full body;
-- it maps ideas -> idea, q-a -> question, skips other categories, files posts under a member whose github_login
-- matches (else the owner, with the GitHub login as the name), carries GitHub upvotes into vote_count and the
-- accepted answer into answer_id. service_role only.
