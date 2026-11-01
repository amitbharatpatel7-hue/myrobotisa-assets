-- Moonshotters board, 1 Nov 2026 (Amit: retire the moonshot pot, "we took the L, so you don't have to"; data, not
-- headlines). Same shape as 2026-10-30-community-seed-weekly.sql: run once in the Supabase SQL editor. A server-side run
-- (auth.uid() is null) keeps the values given and sends no Messages. Idempotent through `source` and the status check.
-- Long version on the public site: docs/questions.html#faq-moonshot and #faq-bigrun.
do $$
declare v_owner uuid; v_post bigint; v_comment bigint; v_idea bigint;
begin
  select user_id into v_owner from public.members where plan = 'owner' and status = 'active' limit 1;
  if v_owner is null then raise exception 'no active owner'; end if;

  -- 1. An answered question, so a member who searches "moonshot" finds the reason.
  if not exists (select 1 from public.community_posts where source = 'seed/2026-11-01-moonshot') then
    insert into public.community_posts (kind, title, body, category, status, user_id, author_name, source)
    values ('question',
            'Where did the moonshot pot go?',
            'The website used to show three jobs: the foundation, the hunter and a small moonshot pot for the biggest swings. Now it says two. What happened, and will my robot miss the next big run without it?',
            'robot', 'review', v_owner, 'Amit', 'seed/2026-11-01-moonshot')
    returning id into v_post;
    insert into public.community_comments (post_id, user_id, author_name, is_team, body)
    values (v_post, v_owner, 'Amit', true,
'We switched it off on 1 November, because our own tests said the money does better without it. It was the most exciting part of the product, and we retired it anyway: the robot follows the data, not the headlines, and that has to include our own ideas. We took the L, so you don''t have to.

- I ran it with my own money from 12 October. Three weeks later it was down about 22%, the rest of the account about 6%. Three weeks proves nothing, so we tested it properly.
- Ten versions over six years of prices, including picking from Trading 212''s top winners and losers and buying breakouts early. Every rule and the test it had to pass were written down before we saw any results, and a rule had to win from 2020, 2021 and 2022.
- The pot picked from the same list as the hunter, so it was the same bet with fewer stocks. Some versions made more money, but only with much bigger falls (up to 61-74% along the way, against 51% for the hunter and 28% for the whole robot), and most of their gains came from a handful of shares nobody could name in advance. None gave a better trade-off.

Will you miss the next big run? The hunter is the part that catches them: in the backtest it bought Sandisk twice and made about 4.5 times on that slot, on a stock that went up about 35 times. It won''t catch the bottom or sell the top, and the robot still has down months. The numbers, in two small tables, are on the Questions page ("Wouldn''t a pot that lets a winner like that run make me rich?"). Backtest, not a prediction. Capital at risk.')
    returning id into v_comment;
    update public.community_posts set answer_id = v_comment where id = v_post;
  end if;

  -- 2. Close the "Moonshot pot, second go" idea with the result, so its backers see what happened.
  select id into v_idea from public.community_posts
   where kind = 'idea' and title ilike 'Moonshot pot, second go%' and status <> 'declined'
   order by id limit 1;
  if v_idea is not null then
    update public.community_posts set status = 'declined' where id = v_idea;
    insert into public.community_status_events (post_id, status, note)
    values (v_idea, 'declined',
            'Tested and retired on 1 November. Trading 212''s top winners and losers, and nine other versions: some made more money, but only with much bigger falls, and none gave a better trade-off than keeping the money in the hunter. Why, in full: the "Where did the moonshot pot go?" answer on this board.');
  end if;
end $$;
select id, kind, title, status, answer_id from public.community_posts
 where source = 'seed/2026-11-01-moonshot' or title ilike 'Moonshot pot, second go%';
