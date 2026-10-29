-- Members manage their own account (29 Oct 2026, D28): change sign-in email, delete my account (7-day grace, then
-- purged), download my data. Apply once through the Supabase MCP apply_migration, project vxnestmhtjotidhzzqbo.
-- The edge function member-account (ops/supabase/functions/member-account) is the only caller of the service-role
-- functions; the page calls my_account() and my_data_export() as the signed-in member.

-- A deleted paying member keeps a minimal sales record (privacy.html: six years); everyone else's row goes.
alter table public.members drop constraint if exists members_status_check;
alter table public.members add constraint members_status_check check (status in ('active','lapsed','refunded','deleted'));

-- One pending code per member per purpose. Codes are stored hashed; they last an hour and allow five tries.
create table if not exists admin.member_codes (
  user_id uuid not null,
  purpose text not null check (purpose in ('email','delete')),
  new_email text check (new_email is null or new_email = lower(new_email)),
  code_hash text not null,
  tries integer not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id, purpose)
);
-- Every code sent, for the hourly limit (kept a day).
create table if not exists admin.member_code_log (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  purpose text not null,
  at timestamptz not null default now()
);
create index if not exists member_code_log_user_idx on admin.member_code_log (user_id, at);

create table if not exists admin.member_deletions (
  user_id uuid primary key,
  member_id uuid not null,
  email text not null,
  first_name text,
  github_login text,
  requested_at timestamptz not null default now(),
  due_at timestamptz not null,
  cancel_token uuid not null default gen_random_uuid() unique,
  cancelled_at timestamptz,
  done_at timestamptz,
  detail text
);
revoke all on admin.member_codes, admin.member_code_log, admin.member_deletions from public, anon, authenticated;

-- ---- codes (service role only)
-- Returns 'ok' | 'not-member' | 'owner' | 'same' | 'taken' | 'busy'.
create or replace function public.acct_code_put(p_user uuid, p_purpose text, p_new_email text, p_code_hash text)
returns text language plpgsql security definer set search_path = public, pg_catalog as $$
declare m public.members; e text := lower(btrim(coalesce(p_new_email, '')));
begin
  select * into m from public.members where user_id = p_user and status in ('active','lapsed');
  if not found then return 'not-member'; end if;
  if p_purpose = 'delete' and m.plan = 'owner' then return 'owner'; end if;
  if p_purpose = 'email' then
    if e = m.email then return 'same'; end if;
    if exists (select 1 from public.members x where x.email = e and x.id <> m.id)
       or exists (select 1 from auth.users u where lower(u.email) = e and u.id <> p_user) then return 'taken'; end if;
  end if;
  if (select count(*) from admin.member_code_log l where l.user_id = p_user and l.at > now() - interval '1 hour') >= 5 then return 'busy'; end if;
  insert into admin.member_code_log (user_id, purpose) values (p_user, p_purpose);
  delete from admin.member_code_log where at < now() - interval '1 day';
  insert into admin.member_codes (user_id, purpose, new_email, code_hash, tries, expires_at, created_at)
  values (p_user, p_purpose, case when p_purpose = 'email' then e end, p_code_hash, 0, now() + interval '1 hour', now())
  on conflict (user_id, purpose) do update set new_email = excluded.new_email, code_hash = excluded.code_hash, tries = 0,
    expires_at = excluded.expires_at, created_at = excluded.created_at;
  return 'ok';
end $$;

-- Checks a code. {ok:true,new_email} once (the code is then used up), or {ok:false,reason:'none'|'expired'|'tries'|'wrong',left}.
create or replace function public.acct_code_check(p_user uuid, p_purpose text, p_code_hash text)
returns json language plpgsql security definer set search_path = public, pg_catalog as $$
declare c admin.member_codes;
begin
  select * into c from admin.member_codes where user_id = p_user and purpose = p_purpose for update;
  if not found then return json_build_object('ok', false, 'reason', 'none'); end if;
  if c.expires_at < now() then delete from admin.member_codes where user_id = p_user and purpose = p_purpose;
    return json_build_object('ok', false, 'reason', 'expired'); end if;
  if c.tries >= 5 then return json_build_object('ok', false, 'reason', 'tries'); end if;
  if c.code_hash <> p_code_hash then
    update admin.member_codes set tries = tries + 1 where user_id = p_user and purpose = p_purpose;
    return json_build_object('ok', false, 'reason', case when c.tries + 1 >= 5 then 'tries' else 'wrong' end, 'left', 4 - c.tries);
  end if;
  delete from admin.member_codes where user_id = p_user and purpose = p_purpose;
  return json_build_object('ok', true, 'new_email', c.new_email);
end $$;

-- Moves the members row to the new address (the function changes the sign-in user first). Returns the old address,
-- or raises 23505 if the address was taken in the meantime.
create or replace function public.acct_email_set(p_user uuid, p_new_email text)
returns text language plpgsql security definer set search_path = public, pg_catalog as $$
declare old text;
begin
  select email into old from public.members where user_id = p_user and status in ('active','lapsed') for update;
  if not found then raise exception 'not a member' using errcode = '42501'; end if;
  update public.members set email = lower(btrim(p_new_email)) where user_id = p_user;
  delete from admin.member_codes where user_id = p_user and purpose = 'email';
  return old;
end $$;

-- ---- deletion (service role only)
create or replace function public.acct_delete_request(p_user uuid)
returns json language plpgsql security definer set search_path = public, pg_catalog as $$
declare m public.members; d admin.member_deletions;
begin
  select * into m from public.members where user_id = p_user and status in ('active','lapsed');
  if not found then raise exception 'not a member' using errcode = '42501'; end if;
  insert into admin.member_deletions (user_id, member_id, email, first_name, github_login, due_at)
  values (p_user, m.id, m.email, m.first_name, m.github_login, now() + interval '7 days')
  on conflict (user_id) do update set member_id = excluded.member_id, email = excluded.email, first_name = excluded.first_name,
    github_login = excluded.github_login, requested_at = now(), due_at = excluded.due_at, cancel_token = gen_random_uuid(),
    cancelled_at = null, done_at = null, detail = null, claimed_at = null
  returning * into d;
  return json_build_object('due_at', d.due_at, 'cancel_token', d.cancel_token, 'email', d.email, 'first_name', d.first_name);
end $$;

-- Cancel by the signed-in member (p_user) or by the token in the email. Returns the email to tell, or null.
create or replace function public.acct_delete_cancel(p_user uuid default null, p_token uuid default null)
returns text language plpgsql security definer set search_path = public, pg_catalog as $$
declare e text;
begin
  update admin.member_deletions set cancelled_at = now()
   where cancelled_at is null and done_at is null
     and ((p_user is not null and user_id = p_user) or (p_token is not null and cancel_token = p_token))
  returning email into e;
  return e;
end $$;

-- Claims up to 20 due deletions for one run, so two runs at once never both finish (and email) the same member.
-- A claim lapses after 10 minutes, so a run that died part-way is picked up by the next one.
alter table admin.member_deletions add column if not exists claimed_at timestamptz;
create or replace function public.acct_purge_due()
returns setof admin.member_deletions language sql security definer set search_path = public, pg_catalog as $$
  update admin.member_deletions d set claimed_at = now()
   where d.user_id in (select x.user_id from admin.member_deletions x
                        where x.cancelled_at is null and x.done_at is null and x.due_at <= now()
                          and (x.claimed_at is null or x.claimed_at < now() - interval '10 minutes')
                        order by x.due_at limit 20 for update skip locked)
  returning d.*;
$$;

-- Removes everything tied to the member (their ideas and replies stay, as "Former member": Amit, 29 Oct 2026), and
-- the members row unless it is a sales record. The sign-in user is deleted by the function afterwards (members.user_id
-- then goes null by its foreign key). Safe to run twice.
create or replace function public.acct_purge(p_user uuid)
returns json language plpgsql security definer set search_path = public, pg_catalog as $$
declare d admin.member_deletions; m public.members; nil constant uuid := '00000000-0000-0000-0000-000000000000'; kept boolean := false;
begin
  select * into d from admin.member_deletions where user_id = p_user and cancelled_at is null and due_at <= now();
  if not found then return json_build_object('ok', false, 'reason', 'not-due'); end if;
  update public.community_posts set user_id = nil, author_name = 'Former member' where user_id = p_user;
  update public.community_comments set user_id = nil, author_name = 'Former member' where user_id = p_user;
  delete from public.community_votes where user_id = p_user;
  delete from public.member_progress where user_id = p_user;
  delete from public.member_notice_reads where user_id = p_user;
  delete from public.member_notices where user_id = p_user;
  delete from public.lesson_link_log where user_id = p_user;
  delete from public.robot_care_requests where user_id = p_user;
  delete from admin.member_codes where user_id = p_user;
  delete from admin.member_code_log where user_id = p_user;
  if d.github_login is not null then delete from public.robot_care_runs where lower(login) = lower(d.github_login); end if;
  select * into m from public.members where id = d.member_id;
  if found then
    if m.plan in ('founding','standard') then
      kept := true;
      update public.members set status = 'deleted', first_name = null, github_login = null, dashboard_url = null, repo_url = null,
        robot_care = false, preview_videos = false,
        note = 'Account deleted ' || to_char(now() at time zone 'Europe/London', 'YYYY-MM-DD') || ' at the member''s request; sales record kept six years'
       where id = m.id;
    else
      delete from public.members where id = m.id;
    end if;
  end if;
  update admin.member_deletions set first_name = null, github_login = null where user_id = p_user;
  return json_build_object('ok', true, 'kept_sales_record', kept);
end $$;

create or replace function public.acct_purge_done(p_user uuid, p_detail text)
returns void language sql security definer set search_path = public, pg_catalog as $$
  update admin.member_deletions set done_at = case when p_detail is null then now() else done_at end, detail = p_detail where user_id = p_user;
$$;

-- ---- the signed-in member
-- What the Membership tab needs to know: a deletion waiting, an email change waiting.
create or replace function public.my_account()
returns json language sql stable security definer set search_path = public, pg_catalog as $$
  select json_build_object(
    'deletion_due', (select d.due_at from admin.member_deletions d where d.user_id = auth.uid() and d.cancelled_at is null and d.done_at is null),
    'email_pending', (select c.new_email from admin.member_codes c where c.user_id = auth.uid() and c.purpose = 'email' and c.expires_at > now()));
$$;

-- Download my data: everything we hold about the signed-in member, as one JSON document.
create or replace function public.my_data_export()
returns json language plpgsql stable security definer set search_path = public, pg_catalog as $$
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
    'progress', (select coalesce(json_agg(json_build_object('item', p.item, 'done', p.done, 'updated_at', p.updated_at) order by p.item), '[]') from public.member_progress p where p.user_id = u),
    'messages_read', (select coalesce(json_agg(r.notice_id order by r.notice_id), '[]') from public.member_notice_reads r where r.user_id = u),
    'messages_to_you', (select coalesce(json_agg(json_build_object('title', n.title, 'body', n.body, 'at', n.starts_at) order by n.starts_at), '[]') from public.member_notices n where n.user_id = u),
    'moonshotters_posts', (select coalesce(json_agg(json_build_object('kind', p.kind, 'title', p.title, 'body', p.body, 'status', p.status, 'at', p.created_at) order by p.created_at), '[]') from public.community_posts p where p.user_id = u),
    'moonshotters_replies', (select coalesce(json_agg(json_build_object('post_id', c.post_id, 'body', c.body, 'at', c.created_at) order by c.created_at), '[]') from public.community_comments c where c.user_id = u),
    'moonshotters_votes', (select coalesce(json_agg(v.post_id order by v.post_id), '[]') from public.community_votes v where v.user_id = u),
    'robot_care_questions', (select coalesce(json_agg(json_build_object('kind', q.kind, 'question', q.question, 'answer', q.answer, 'at', q.at) order by q.at), '[]') from public.robot_care_requests q where q.user_id = u),
    'lesson_videos_opened', (select count(*) from public.lesson_link_log l where l.user_id = u));
end $$;

revoke execute on function public.acct_code_put(uuid,text,text,text), public.acct_code_check(uuid,text,text), public.acct_email_set(uuid,text),
  public.acct_delete_request(uuid), public.acct_delete_cancel(uuid,uuid), public.acct_purge_due(), public.acct_purge(uuid),
  public.acct_purge_done(uuid,text), public.my_account(), public.my_data_export() from public, anon, authenticated;
grant execute on function public.acct_code_put(uuid,text,text,text), public.acct_code_check(uuid,text,text), public.acct_email_set(uuid,text),
  public.acct_delete_request(uuid), public.acct_delete_cancel(uuid,uuid), public.acct_purge_due(), public.acct_purge(uuid),
  public.acct_purge_done(uuid,text) to service_role;
grant execute on function public.my_account(), public.my_data_export() to authenticated;

-- Hourly: finish deletions whose seven days are up. Calls the function only when one is due (no request otherwise).
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('member-account-purge') where exists (select 1 from cron.job where jobname = 'member-account-purge');
    perform cron.schedule('member-account-purge', '23 * * * *', $cron$
      select net.http_post(url := 'https://vxnestmhtjotidhzzqbo.supabase.co/functions/v1/member-account',
        body := '{"action":"purge"}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb)
      where exists (select 1 from admin.member_deletions where cancelled_at is null and done_at is null and due_at <= now());
    $cron$);
  end if;
end $$;
