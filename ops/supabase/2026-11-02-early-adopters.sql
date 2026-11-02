-- Early adopters (Amit, 2 Nov 2026): a few real people try the product before the test drive, as close to the finished
-- product as it gets. Each is a real member: all lessons open, a free licence and a free year of Robot Care, outside the
-- founding 100 (plan 'early' takes no founding number and isn't counted in founding_status). Hub DECISIONS D32.
-- Only the owner can add, list or remove them, from the card in Help and membership.

alter table public.members drop constraint if exists members_plan_check;
alter table public.members add constraint members_plan_check
  check (plan = any (array['founding'::text, 'standard'::text, 'owner'::text, 'test'::text, 'early'::text]));

alter table public.members add column if not exists invited_at timestamptz;

create or replace function public.owner_early_add(p_email text, p_first_name text default null)
returns json language plpgsql security definer set search_path = public, pg_catalog as $$
declare e text := lower(trim(p_email)); n text := nullif(trim(coalesce(p_first_name, '')), ''); cur public.members%rowtype;
begin
  if not public.is_owner() then raise exception 'owner only' using errcode = '42501'; end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,24}$' then return json_build_object('ok', false, 'error', 'That email doesn''t look right.'); end if;
  select * into cur from public.members where email = e;
  if found then
    if cur.plan <> 'early' then return json_build_object('ok', false, 'error', 'That email is already a member.'); end if;
    update public.members set status = 'active', first_name = coalesce(n, first_name), preview_videos = true,
      updates_until = greatest(coalesce(updates_until, current_date), (current_date + interval '1 year')::date) where id = cur.id;
    return json_build_object('ok', true, 'id', cur.id, 'again', true);
  end if;
  insert into public.members (email, first_name, plan, status, preview_videos, updates_until, note)
    values (e, n, 'early', 'active', true, (current_date + interval '1 year')::date, 'Early adopter')
    returning * into cur;
  return json_build_object('ok', true, 'id', cur.id);
end $$;

-- Each person's progress, so the owner sees where people stop and how long setup really took.
create or replace function public.owner_early_list()
returns json language plpgsql stable security definer set search_path = public, pg_catalog as $$
begin
  if not public.is_owner() then raise exception 'owner only' using errcode = '42501'; end if;
  return coalesce((select json_agg(r order by r.joined_at desc) from (
    select m.id, m.email, m.first_name, m.joined_at, m.invited_at, m.user_id is not null as signed_in, m.github_login,
           m.dashboard_url is not null as has_dash, m.robot_care,
           coalesce(p.done, 0) as qs_done,
           case when p.first_at is not null and p.trade_at is not null then round(extract(epoch from p.trade_at - p.first_at) / 60) end as minutes
    from public.members m
    left join lateral (
      select count(*) filter (where q.done and q.item like 'qs:%') as done,
             min(q.updated_at) filter (where q.done and q.item like 'acct:%') as first_at,
             max(q.updated_at) filter (where q.done and q.item = 'qs:5') as trade_at
      from public.member_progress q where q.user_id = m.user_id) p on true
    where m.plan = 'early' and m.status <> 'deleted') r), '[]'::json);
end $$;

create or replace function public.owner_early_remove(p_id uuid)
returns json language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  if not public.is_owner() then raise exception 'owner only' using errcode = '42501'; end if;
  update public.members set status = 'deleted', preview_videos = false where id = p_id and plan = 'early';
  return json_build_object('ok', found);
end $$;

revoke all on function public.owner_early_add(text, text), public.owner_early_list(), public.owner_early_remove(uuid) from public, anon;
grant execute on function public.owner_early_add(text, text), public.owner_early_list(), public.owner_early_remove(uuid) to authenticated;
