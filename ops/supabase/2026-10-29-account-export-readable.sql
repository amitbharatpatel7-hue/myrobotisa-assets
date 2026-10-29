-- Download my data, readable (29 Oct 2026, after Amit's own download): steps in words rather than codes ("qs:4" ->
-- "QuickStart step 4"), message titles rather than ids, and the ideas a member backed by name. Replaces
-- my_data_export() from 2026-10-29-account.sql; same grants (signed-in members only, their own data).
create or replace function public.my_data_export()
returns json language plpgsql stable security definer set search_path = public, pg_catalog, pg_temp as $$
declare u uuid := auth.uid(); m public.members;
begin
  select * into m from public.members where user_id = u;
  if not found then raise exception 'Not a member.' using errcode = '42501'; end if;
  return json_build_object(
    'exported_at', now(),
    'about', 'Everything My Robot I.S.A. keeps about you in the members area. Your robot''s keys and trading data live in your own GitHub and Trading 212 accounts, not here.',
    'membership', json_build_object('email', m.email, 'first_name', m.first_name, 'plan', m.plan, 'status', m.status, 'founding_no', m.founding_no,
      'joined_at', m.joined_at, 'updates_until', m.updates_until, 'github_login', m.github_login, 'dashboard_url', m.dashboard_url,
      'repo_url', m.repo_url, 'robot_care', m.robot_care, 'robot_care_since', m.robot_care_since, 'robot_care_until', m.robot_care_until),
    'progress', (select coalesce(json_agg(json_build_object(
        'step', case
          when p.item ~ '^qs:\d+$' then 'QuickStart step ' || split_part(p.item, ':', 2)
          when p.item ~ '^day:\d+$' then 'Lesson ' || split_part(p.item, ':', 2)
          when p.item = 'acct:1' then 'Account ready: Trading 212'
          when p.item = 'acct:2' then 'Account ready: GitHub'
          when p.item = 'acct:3' then 'Account ready: Resend'
          else p.item end,
        'done', p.done, 'updated_at', p.updated_at)
      order by case split_part(p.item, ':', 1) when 'acct' then 1 when 'qs' then 2 when 'day' then 3 else 4 end,
               case when split_part(p.item, ':', 2) ~ '^\d+$' then split_part(p.item, ':', 2)::int end, p.item), '[]')
      from public.member_progress p where p.user_id = u),
    'messages_read', (select coalesce(json_agg(json_build_object('title', coalesce(n.title, 'A message that has since been removed'), 'read_at', r.read_at) order by r.read_at), '[]')
      from public.member_notice_reads r left join public.member_notices n on n.id = r.notice_id where r.user_id = u),
    'messages_to_you', (select coalesce(json_agg(json_build_object('title', n.title, 'body', n.body, 'at', n.starts_at) order by n.starts_at), '[]') from public.member_notices n where n.user_id = u),
    'moonshotters_posts', (select coalesce(json_agg(json_build_object('kind', p.kind, 'title', p.title, 'body', p.body, 'status', p.status, 'at', p.created_at) order by p.created_at), '[]') from public.community_posts p where p.user_id = u),
    'moonshotters_replies', (select coalesce(json_agg(json_build_object('on', p.title, 'body', c.body, 'at', c.created_at) order by c.created_at), '[]')
      from public.community_comments c join public.community_posts p on p.id = c.post_id where c.user_id = u),
    'moonshotters_votes', (select coalesce(json_agg(json_build_object('idea', p.title, 'at', v.created_at) order by v.created_at), '[]')
      from public.community_votes v join public.community_posts p on p.id = v.post_id where v.user_id = u),
    'robot_care_questions', (select coalesce(json_agg(json_build_object('kind', q.kind, 'question', q.question, 'answer', q.answer, 'at', q.at) order by q.at), '[]') from public.robot_care_requests q where q.user_id = u),
    'lesson_videos_opened', (select count(*) from public.lesson_link_log l where l.user_id = u));
end $$;
revoke execute on function public.my_data_export() from public, anon;
grant execute on function public.my_data_export() to authenticated;
