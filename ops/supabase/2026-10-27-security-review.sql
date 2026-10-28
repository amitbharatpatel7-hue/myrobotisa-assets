-- Security review fixes, 27 Oct 2026 (Amit: "fix everything you can"). Applied to the live project
-- (vxnestmhtjotidhzzqbo) as migration "security_review_2026_10_27"; this file is the record of it.
--
-- What was wrong, and what was measured before the change:
--  1. The Ideas & questions board could not send Messages. member_notices only allowed kind news/action/update and
--     links starting https:// or /, but the board's functions write kind 'community' and links '#post/<id>'.
--     A rolled-back test insert failed with 23514 member_notices_kind_check. Effect: changing an idea's status,
--     posting a team update and replying to someone else's question all raised an error and saved nothing.
--     Fix: allow 'community' and '#...' links. javascript: and other schemes stay blocked.
--  2. member_progress rejected 'want:<feature>' items, so the members page's "I want this" buttons never saved and
--     want_counts() was always empty. Fix: allow want:<lowercase-slug>.
--  3. Replies on a hidden post were still readable through the API. Fix: a reply is readable only when its post is.
--  4. A lapsed or removed member could still delete their old replies. Fix: deleting needs current membership.
--  5. anon and authenticated held every privilege (including TRUNCATE) on 12 back-office tables, and
--     authenticated held INSERT/UPDATE/DELETE/TRUNCATE on members and member_notices. RLS with no matching policy
--     blocked every row, so nothing was exploitable, but the grants were one mistaken policy away from it.
--     Fix: revoke what no client uses.
--  6. The three token-gated admin RPCs were also executable by signed-in users. Their callers (myrobotisa-backups,
--     the hub dashboard and digest) all use the publishable key, i.e. anon. Fix: revoke from authenticated only.
--  7. Three old join_waitlist overloads with no grants were left behind. Fix: drop them.
--  8. touch_updated_at had a mutable search_path (advisor WARN). Fix: pin it.
--  9. The sign-up RPCs had no rate limit, so a script could put any number of other people's addresses on the list
--     (each gets one welcome email). Fix: at most 10 sign-ups per network per hour across the three forms,
--     answered 'rate_limited'. A request with no client IP header is not limited, so real sign-ups never fail
--     because of a missing header.

-- 1. Messages from the board ----------------------------------------------------------------------------------------
alter table public.member_notices drop constraint if exists member_notices_kind_check;
alter table public.member_notices add constraint member_notices_kind_check
  check (kind = any (array['news', 'action', 'update', 'community']));
alter table public.member_notices drop constraint if exists member_notices_link_url_check;
alter table public.member_notices add constraint member_notices_link_url_check
  check (link_url is null or link_url ~ '^(https://|/|\.\./|#[A-Za-z0-9/_-]*$)');

-- 2. "I want this" buttons ------------------------------------------------------------------------------------------
alter table public.member_progress drop constraint if exists member_progress_item_check;
alter table public.member_progress add constraint member_progress_item_check
  check (item ~ '^(qs|day):[0-9]{1,2}$' or item ~ '^acct:[1-3]$' or item ~ '^g:(qs|day)-[0-9]{1,2}:[0-9]{1,2}$'
         or item ~ '^want:[a-z0-9-]{1,40}$');

-- 3 and 4. Replies follow their post; deleting needs membership --------------------------------------------------------
drop policy if exists "members read replies" on public.community_comments;
create policy "members read replies" on public.community_comments for select to authenticated using (
  public.is_member()
  and exists (select 1 from public.community_posts p where p.id = community_comments.post_id)   -- posts' own RLS hides hidden posts
  and ((not hidden) or user_id = (select auth.uid()) or public.is_owner()));
drop policy if exists "members delete own reply" on public.community_comments;
create policy "members delete own reply" on public.community_comments for delete to authenticated using (
  public.is_owner() or (user_id = (select auth.uid()) and public.is_member()));

-- 5. Grants nobody uses ------------------------------------------------------------------------------------------------
revoke all on table public.accounts, public.brands, public.campaigns, public.clips, public.episodes, public.metrics,
  public.payouts, public.posts, public.revenue, public.sources, public.vidiq_credits, public.waitlist
  from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.members, public.member_notices from authenticated;
revoke delete, truncate, references, trigger on table public.member_progress, public.member_notice_reads from authenticated;

-- 6. Admin RPCs: the publishable key (anon) plus the secret token only -----------------------------------------------
-- (admin_signup_stats also had the default PUBLIC grant, which every role inherits, so PUBLIC goes too; anon keeps
-- its own explicit grant.)
revoke execute on function public.admin_backup_export(text) from public, authenticated;
revoke execute on function public.admin_signup_list(text, integer) from public, authenticated;
revoke execute on function public.admin_signup_stats(text) from public, authenticated;
grant execute on function public.admin_backup_export(text), public.admin_signup_list(text, integer), public.admin_signup_stats(text) to anon;
-- Trigger functions can't be called usefully over the API; take the stray grants away anyway.
revoke execute on function public.omt_newsletter_ping() from public, anon, authenticated;
revoke execute on function public.omt_newsletter_rejoin() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- 7. Old overloads ----------------------------------------------------------------------------------------------------
drop function if exists public.join_waitlist(text, boolean, text);
drop function if exists public.join_waitlist(text, boolean, text, text);
drop function if exists public.join_waitlist(text, boolean, text, text, text);

-- 8. search_path -------------------------------------------------------------------------------------------------------
alter function public.touch_updated_at() set search_path = public, pg_catalog;

-- 9. Sign-up rate limit -------------------------------------------------------------------------------------------------
create table if not exists admin.signup_requests (ip_hash text not null, at timestamptz not null default now());
create index if not exists signup_requests_ip_at on admin.signup_requests (ip_hash, at);

create or replace function admin.signup_allowed()
returns boolean language plpgsql security definer set search_path = pg_catalog, admin as $$
declare h json; ip text; k text; n int;
begin
  begin h := nullif(current_setting('request.headers', true), '')::json; exception when others then h := null; end;
  ip := btrim(split_part(coalesce(h->>'cf-connecting-ip', h->>'x-real-ip', h->>'x-forwarded-for', ''), ',', 1));
  if ip = '' then return true; end if;   -- no header (server-side call): never block a real sign-up on that
  k := encode(sha256(convert_to('mri-signup:' || ip, 'UTF8')), 'hex');
  select count(*) into n from admin.signup_requests where ip_hash = k and at > now() - interval '1 hour';
  if n >= 10 then return false; end if;
  insert into admin.signup_requests (ip_hash) values (k);
  if random() < 0.05 then delete from admin.signup_requests where at < now() - interval '1 day'; end if;
  return true;
end $$;
revoke all on function admin.signup_allowed() from public, anon, authenticated;

create or replace function public.join_newsletter(p_email text, p_consent boolean, p_source text)
returns text language plpgsql security definer set search_path to 'public' as $function$
declare e text := lower(btrim(coalesce(p_email, '')));
begin
  if not coalesce(p_consent, false) then return 'consent_required'; end if;
  if length(e) > 254 or e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return 'invalid_email'; end if;
  if not admin.signup_allowed() then return 'rate_limited'; end if;
  insert into public.waitlist (email, source, launch_list, newsletter, newsletter_consent_text)
  values (e, left(nullif(btrim(p_source), ''), 40), false, true,
          'Send me the fortnightly newsletter: the latest L, the lesson behind it and what''s new. I can unsubscribe any time.')
  on conflict (email) do update set newsletter = true,
    newsletter_consent_text = coalesce(public.waitlist.newsletter_consent_text, excluded.newsletter_consent_text),
    last_signup_at = now();
  return 'ok';
end; $function$;

create or replace function public.join_omt_newsletter(p_email text, p_consent boolean, p_source text)
returns text language plpgsql security definer set search_path to 'public' as $function$
declare e text := lower(btrim(coalesce(p_email, '')));
begin
  if not coalesce(p_consent, false) then return 'consent_required'; end if;
  if length(e) > 254 or e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return 'invalid_email'; end if;
  if not admin.signup_allowed() then return 'rate_limited'; end if;
  insert into public.omt_newsletter (email, source, consent_text)
  values (e, left(nullif(btrim(p_source), ''), 40),
          'Email me when a new onemorething.co walkthrough is published, at most twice a month. I can unsubscribe any time.')
  on conflict (email) do update set last_signup_at = now();
  return 'ok';
end; $function$;

create or replace function public.join_waitlist(p_email text, p_consent boolean, p_source text, p_experience text, p_broker text, p_newsletter boolean)
returns text language plpgsql security definer set search_path to 'public' as $function$
declare
  e text := lower(btrim(coalesce(p_email, '')));
  x text := case when p_experience in ('none', 'some', 'developer') then p_experience end;
  b text := left(nullif(btrim(regexp_replace(coalesce(p_broker, ''), '[^[:alnum:] .&()+-]', '', 'g')), ''), 40);
  c boolean := coalesce(p_consent, false);
  n boolean := coalesce(p_newsletter, false);
begin
  if not (c or n) then return 'consent_required'; end if;
  if length(e) > 254 or e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return 'invalid_email'; end if;
  if not admin.signup_allowed() then return 'rate_limited'; end if;
  insert into public.waitlist (email, source, experience, broker, launch_list, consent_text, newsletter, newsletter_consent_text)
  values (e, left(nullif(btrim(p_source), ''), 40), x, b, c,
          case when c then 'Email me when My Robot I.S.A. opens, with the founding price. I can unsubscribe any time.' end,
          n, case when n then 'Send me the fortnightly newsletter: the latest L, the lesson behind it and what''s new. I can unsubscribe any time.' end)
  on conflict (email) do update set experience = coalesce(excluded.experience, public.waitlist.experience),
                                    broker = coalesce(excluded.broker, public.waitlist.broker),
                                    launch_list = public.waitlist.launch_list or excluded.launch_list,
                                    consent_text = coalesce(public.waitlist.consent_text, excluded.consent_text),
                                    newsletter = public.waitlist.newsletter or excluded.newsletter,
                                    newsletter_consent_text = coalesce(public.waitlist.newsletter_consent_text, excluded.newsletter_consent_text);
  return 'ok';
end; $function$;

create or replace function public.join_waitlist(p_email text, p_consent boolean, p_source text, p_experience text, p_broker text, p_newsletter boolean, p_country text)
returns text language plpgsql security definer set search_path to 'public' as $function$
declare
  e text := lower(btrim(coalesce(p_email, '')));
  x text := case when p_experience in ('none', 'some', 'developer') then p_experience end;
  b text := left(nullif(btrim(regexp_replace(coalesce(p_broker, ''), '[^[:alnum:] .&()+-]', '', 'g')), ''), 40);
  k text := case when p_country in ('uk','ie','europe','us','ca','au-nz','in','other') then p_country end;
  c boolean := coalesce(p_consent, false);
  n boolean := coalesce(p_newsletter, false);
begin
  if not (c or n) then return 'consent_required'; end if;
  if length(e) > 254 or e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return 'invalid_email'; end if;
  if not admin.signup_allowed() then return 'rate_limited'; end if;
  -- consent_text records the exact words ticked (page of 15 Oct 2026: test drive + sales opening; newsletter is a separate optional box)
  insert into public.waitlist (email, source, experience, broker, country, launch_list, consent_text, newsletter, newsletter_consent_text)
  values (e, left(nullif(btrim(p_source), ''), 40), x, b, k, c,
          case when c then 'Email me the free test drive in December and tell me when sales open in January. I can unsubscribe any time.' end,
          n, case when n then 'Optional: also send me the fortnightly newsletter. I can unsubscribe any time.' end)
  on conflict (email) do update set experience = coalesce(excluded.experience, public.waitlist.experience),
                                    broker = coalesce(excluded.broker, public.waitlist.broker),
                                    country = coalesce(excluded.country, public.waitlist.country),
                                    launch_list = public.waitlist.launch_list or excluded.launch_list,
                                    consent_text = coalesce(public.waitlist.consent_text, excluded.consent_text),
                                    newsletter = public.waitlist.newsletter or excluded.newsletter,
                                    newsletter_consent_text = coalesce(public.waitlist.newsletter_consent_text, excluded.newsletter_consent_text),
                                    last_signup_at = now();
  return 'ok';
end; $function$;

-- 10. email-review send log ----------------------------------------------------------------------------------------------
-- The email-review edge function accepts any valid project key, so anyone holding one could make it email Amit up
-- to 23 review copies an hour, indefinitely. It now records each send here (service role only) and stops at 60 a day.
create table if not exists public.email_review_sends (id bigint generated always as identity primary key,
  file text not null, at timestamptz not null default now());
create index if not exists email_review_sends_at on public.email_review_sends (at);
alter table public.email_review_sends enable row level security;
revoke all on table public.email_review_sends from anon, authenticated;
