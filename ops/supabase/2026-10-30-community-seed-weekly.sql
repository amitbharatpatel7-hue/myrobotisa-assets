-- Seed question for the Moonshotters board (30 Oct 2026, Amit): "why only once a week?", answered from the hub's
-- daily-stop backtest (stock-boom-hunter research/daily_stop/REPORT.md, DECISIONS D26). Applied with execute_sql as a
-- server-side insert (auth.uid() is null, so the triggers keep the values given and send no Messages).
-- Same answer, longer, on the public site: docs/questions.html#faq-weekly. Idempotent through source.
do $$
declare v_owner uuid; v_post bigint; v_comment bigint;
begin
  if exists (select 1 from public.community_posts where source = 'seed/2026-10-30-weekly') then return; end if;
  select user_id into v_owner from public.members where plan = 'owner' and status = 'active' limit 1;
  if v_owner is null then raise exception 'no active owner'; end if;
  insert into public.community_posts (kind, title, body, category, status, user_id, author_name, source)
  values ('question',
          'Why does the robot only check once a week? Wouldn''t every day be safer?',
          'If a holding dives on a Monday, the robot doesn''t act until the next Sunday. Would checking the stops every day, or trading more often, protect me better?',
          'robot', 'review', v_owner, 'Amit', 'seed/2026-10-30-weekly')
  returning id into v_post;
  insert into public.community_comments (post_id, user_id, author_name, is_team, body)
  values (v_post, v_owner, 'Amit', true,
'We tested it rather than guess. Same rules, but the stops checked every trading day instead of once a week, each midweek sale waiting for approval and going through the next day. Daily prices from 2020 to October 2026, Adventurous settings.

- 4 in 10 holdings sold midweek were back above their stop by the Friday.
- Daily came out ahead only if the test started in 2020, thanks to the Covid crash (24.1% a year vs 23.3%). From 2021 weekly was ahead (23.8% vs 23.0%), and from 2022 too (25.3% vs 24.0%).
- Five crash-only versions, written down before we saw the results, softened 2020 but all returned less than weekly from every start date, with a deeper worst fall overall.
- Daily meant 65 extra sales to approve.

Day trading is allowed in a Trading 212 ISA, so weekly is the design, not a limit: the rules use weekly prices (the 40-week average). The trade-off is real: in a crash as fast as 2020, a daily check would have cushioned the fall (about 18.5% instead of 22.9%). On this history that insurance cost more in ordinary years than it saved. Your code is yours, and lesson 5 shows how to test a change like this yourself. Backtest, not a prediction. Capital at risk.')
  returning id into v_comment;
  update public.community_posts set answer_id = v_comment where id = v_post;
end $$;
