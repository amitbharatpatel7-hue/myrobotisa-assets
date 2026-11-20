-- Payments through Stripe (20 Nov 2026, hub D27): Night Shift Labs Ltd's Stripe account, built in test mode first.
-- Additive only. Apply through the Supabase MCP apply_migration, project vxnestmhtjotidhzzqbo.
-- Caller: the edge function stripe (ops/supabase/functions/stripe), with the service role. Nothing here is readable
-- by the page.
--
-- Products (Stripe lookup keys): kit_founding £99 and kit_standard £199 (one-off), updates_renewal £99 (one-off, never
-- renews), robot_care_monthly £10 a month. The founding year of Robot Care is NOT a Stripe trial: terms.html says it
-- only carries on at £10 a month if the member chooses, so it stays members.robot_care_until and nothing is charged.

alter table public.members add column if not exists stripe_customer_id text;
alter table public.members add column if not exists robot_care_sub_id text;      -- the paid £10 a month subscription
alter table public.members add column if not exists robot_care_sub_status text;  -- Stripe's status for it
create unique index if not exists members_stripe_customer_id_key on public.members (stripe_customer_id)
  where stripe_customer_id is not null;

-- Every paid checkout, for the six-year sales record (privacy.html) and for refunds.
create table if not exists admin.purchases (
  id bigint generated always as identity primary key,
  member_id uuid references public.members (id) on delete set null,
  email text not null,
  item text not null check (item in ('kit', 'renewal', 'robot_care')),
  plan text,                                   -- founding / standard, for a kit
  amount integer not null,                     -- pence
  currency text not null default 'gbp',
  checkout_session text not null unique,
  payment_intent text unique,
  waiver_at timestamptz,                       -- when they agreed that opening the code ends the 14-day right to cancel
  livemode boolean not null default false,
  refunded_at timestamptz,
  created_at timestamptz not null default now()
);

-- Stripe sends an event more than once; each is applied once.
create table if not exists admin.stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

revoke all on admin.purchases, admin.stripe_events from anon, authenticated;

-- ── Service-role functions (the admin schema isn't on the REST API) ──────────────────────────────────────────────

-- True the first time an event id is seen, false for a repeat.
create or replace function public.stripe_event_claim(p_id text, p_type text) returns boolean
language plpgsql security definer set search_path = public, admin, pg_catalog as $$
begin
  insert into admin.stripe_events (id, type) values (p_id, p_type) on conflict (id) do nothing;
  return found;
end $$;

-- A kit was paid for. Makes (or revives) the membership: 12 months of updates; a founding member also gets the free
-- first year of Robot Care. The founding number comes from the members_assign_founding_no trigger, which turns a
-- 101st founding sale into a standard one (the race the page can't rule out); that case keeps the Robot Care year it
-- was sold with and is noted for the owner. A repeat of the same checkout session changes nothing.
create or replace function public.stripe_kit_paid(p_email text, p_first_name text, p_plan text, p_customer text,
  p_session text, p_payment_intent text, p_amount integer, p_waiver_at timestamptz, p_live boolean) returns json
language plpgsql security definer set search_path = public, admin, pg_catalog as $$
declare e text := lower(trim(p_email)); cur public.members%rowtype; m public.members%rowtype; note_ text := null;
  plan_ text := p_plan; no_ integer;
  yr date := (now() at time zone 'Europe/London')::date + interval '12 months';
begin
  if p_plan not in ('founding', 'standard') then raise exception 'bad plan %', p_plan; end if;
  -- A test-mode payment never takes a founding number or counts as a sale: it makes a plan 'test' row.
  if not p_live then plan_ := 'test'; end if;
  if exists (select 1 from admin.purchases where checkout_session = p_session) then
    select * into m from public.members where email = e;
    return json_build_object('member_id', m.id, 'plan', m.plan, 'founding_no', m.founding_no, 'repeat', true);
  end if;
  select * into cur from public.members where email = e for update;
  if found and cur.status in ('active', 'lapsed') and cur.plan in ('founding', 'standard', 'owner', 'early', 'test') then
    -- Already holds a licence: keep it, record the payment and flag it (a second kit by mistake gets a refund).
    m := cur; note_ := 'paid for a kit again on ' || current_date || ' (session ' || p_session || ')';
    update public.members set note = concat_ws(' · ', note, note_),
      stripe_customer_id = coalesce(stripe_customer_id, p_customer) where id = cur.id returning * into m;
  elsif found then
    -- A returning row (refunded or deleted). The founding-number trigger only fires on insert, so do its job here.
    no_ := cur.founding_no;
    if plan_ = 'founding' and no_ is null then
      perform pg_advisory_xact_lock(hashtext('members_founding_no'));
      select coalesce(max(founding_no), 0) + 1 into no_ from public.members where founding_no is not null;
      if no_ > 100 then plan_ := 'standard'; no_ := null; end if;
    end if;
    update public.members set plan = plan_, status = 'active', founding_no = case when plan_ = 'founding' then no_ end,
      updates_until = yr, stripe_customer_id = p_customer, first_name = coalesce(nullif(trim(p_first_name), ''), first_name),
      robot_care = (p_plan = 'founding'), robot_care_since = case when p_plan = 'founding' then now() end,
      robot_care_until = case when p_plan = 'founding' then yr end
      where id = cur.id returning * into m;
  else
    insert into public.members (email, first_name, plan, status, updates_until, stripe_customer_id,
      robot_care, robot_care_since, robot_care_until)
    values (e, nullif(trim(p_first_name), ''), plan_, 'active', yr, p_customer,
      p_plan = 'founding', case when p_plan = 'founding' then now() end, case when p_plan = 'founding' then yr end)
    returning * into m;
  end if;
  if p_plan = 'founding' and m.plan = 'standard' then   -- all 100 founding numbers had gone by the time they paid
    -- They were sold the founding offer, so the free Robot Care year they were promised stays. The owner decides the rest.
    note_ := 'paid the founding price (£99) after all 100 founding numbers had gone: free Robot Care year honoured, check the rest';
    update public.members set note = concat_ws(' · ', note, note_), robot_care = true, robot_care_since = coalesce(robot_care_since, now()),
      robot_care_until = yr where id = m.id returning * into m;
  end if;
  insert into admin.purchases (member_id, email, item, plan, amount, checkout_session, payment_intent, waiver_at, livemode)
  values (m.id, e, 'kit', m.plan, p_amount, p_session, p_payment_intent, p_waiver_at, p_live);
  return json_build_object('member_id', m.id, 'plan', m.plan, 'founding_no', m.founding_no, 'note', note_, 'repeat', false);
end $$;

-- Another 12 months of updates: from the later of today and the current end date.
create or replace function public.stripe_renewal_paid(p_member uuid, p_customer text, p_session text,
  p_payment_intent text, p_amount integer, p_live boolean) returns json
language plpgsql security definer set search_path = public, admin, pg_catalog as $$
declare m public.members%rowtype; today date := (now() at time zone 'Europe/London')::date;
begin
  if exists (select 1 from admin.purchases where checkout_session = p_session) then
    select * into m from public.members where id = p_member;
    return json_build_object('updates_until', m.updates_until, 'repeat', true);
  end if;
  update public.members set updates_until = greatest(coalesce(updates_until, today), today) + interval '12 months',
    status = case when status = 'lapsed' then 'active' else status end,
    stripe_customer_id = coalesce(stripe_customer_id, p_customer)
    where id = p_member returning * into m;
  if not found then raise exception 'no member %', p_member; end if;
  insert into admin.purchases (member_id, email, item, amount, checkout_session, payment_intent, livemode)
  values (m.id, m.email, 'renewal', p_amount, p_session, p_payment_intent, p_live);
  return json_build_object('updates_until', m.updates_until, 'repeat', false);
end $$;

-- The paid Robot Care subscription changed. p_end is the last day it covers once cancelled (null while it runs).
-- stripe-checkout never sells it during a founding member's free year, so the two never overlap.
create or replace function public.stripe_care_sub(p_member uuid, p_customer text, p_sub text, p_status text, p_end date)
returns json language plpgsql security definer set search_path = public, pg_catalog as $$
declare m public.members%rowtype; today date := (now() at time zone 'Europe/London')::date;
  paying boolean := p_status in ('active', 'trialing', 'past_due');
begin
  update public.members set
    stripe_customer_id = coalesce(stripe_customer_id, p_customer),
    robot_care_sub_id = p_sub, robot_care_sub_status = p_status,
    robot_care = paying or coalesce(p_end >= today, false),
    robot_care_since = case when paying then coalesce(robot_care_since, now()) else robot_care_since end,
    robot_care_until = p_end
    where id = p_member returning * into m;
  if not found then raise exception 'no member %', p_member; end if;
  return json_build_object('robot_care', m.robot_care, 'until', m.robot_care_until);
end $$;

-- A payment was refunded in full. A kit refund ends the licence (terms.html: updates, Robot Care and the members area
-- stop); a renewal refund is noted for the owner to correct by hand; a Robot Care month changes nothing.
create or replace function public.stripe_refunded(p_payment_intent text) returns json
language plpgsql security definer set search_path = public, admin, pg_catalog as $$
declare p admin.purchases%rowtype;
begin
  update admin.purchases set refunded_at = coalesce(refunded_at, now()) where payment_intent = p_payment_intent returning * into p;
  if not found then return json_build_object('known', false); end if;
  if p.item = 'kit' then
    update public.members set status = 'refunded', robot_care = false, preview_videos = false
      where id = p.member_id and plan in ('founding', 'standard', 'test');
  elsif p.item = 'renewal' then
    update public.members set note = concat_ws(' · ', note, 'renewal refunded ' || current_date || ': check updates_until')
      where id = p.member_id;
  end if;
  return json_build_object('known', true, 'item', p.item, 'member_id', p.member_id);
end $$;

revoke all on function public.stripe_event_claim(text, text),
  public.stripe_kit_paid(text, text, text, text, text, text, integer, timestamptz, boolean),
  public.stripe_renewal_paid(uuid, text, text, text, integer, boolean),
  public.stripe_care_sub(uuid, text, text, text, date), public.stripe_refunded(text) from public, anon, authenticated;
grant execute on function public.stripe_event_claim(text, text),
  public.stripe_kit_paid(text, text, text, text, text, text, integer, timestamptz, boolean),
  public.stripe_renewal_paid(uuid, text, text, text, integer, boolean),
  public.stripe_care_sub(uuid, text, text, text, date), public.stripe_refunded(text) to service_role;
