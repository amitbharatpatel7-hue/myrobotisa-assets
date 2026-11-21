-- 21 Nov 2026 (Amit): nobody pays for the kit twice.
-- The stripe function checks the buyer's email before payment. This is the safety net behind it: if a second kit
-- payment still arrives for an email that already holds a licence, it is recorded as 'kit_duplicate', the function
-- refunds it at once, and that refund does not end the licence (a refund of a real 'kit' row still does).
-- Additive: one more allowed value, and two functions replaced with the same signatures and grants.

alter table admin.purchases drop constraint if exists purchases_item_check;
alter table admin.purchases add constraint purchases_item_check
  check (item in ('kit', 'kit_duplicate', 'renewal', 'robot_care'));

create or replace function public.stripe_kit_paid(p_email text, p_first_name text, p_plan text, p_customer text,
  p_session text, p_payment_intent text, p_amount integer, p_waiver_at timestamptz, p_live boolean) returns json
language plpgsql security definer set search_path = public, admin, pg_catalog as $$
declare e text := lower(trim(p_email)); cur public.members%rowtype; m public.members%rowtype; note_ text := null;
  plan_ text := p_plan; no_ integer; dup boolean := false;
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
    -- Already holds a licence: keep it, record the payment as a duplicate and say so. The stripe function refunds it
    -- straight away, and stripe_refunded leaves the licence alone for a 'kit_duplicate' row.
    dup := true; m := cur; note_ := 'paid for a kit again on ' || current_date || ' (session ' || p_session || ')';
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
  values (m.id, e, case when dup then 'kit_duplicate' else 'kit' end, m.plan, p_amount, p_session, p_payment_intent, p_waiver_at, p_live);
  return json_build_object('member_id', m.id, 'plan', m.plan, 'founding_no', m.founding_no, 'note', note_, 'repeat', false, 'duplicate', dup);
end $$;

create or replace function public.stripe_refunded(p_payment_intent text) returns json
language plpgsql security definer set search_path = public, admin, pg_catalog as $$
declare p admin.purchases%rowtype;
begin
  update admin.purchases set refunded_at = coalesce(refunded_at, now()) where payment_intent = p_payment_intent returning * into p;
  if not found then return json_build_object('known', false); end if;
  if p.item = 'kit' then
    update public.members set status = 'refunded', robot_care = false, preview_videos = false
      where id = p.member_id and plan in ('founding', 'standard', 'test');
  elsif p.item = 'kit_duplicate' then   -- the second payment went back; the licence they already had stays
    update public.members set note = concat_ws(' · ', note, 'second kit payment refunded ' || current_date)
      where id = p.member_id;
  elsif p.item = 'renewal' then
    update public.members set note = concat_ws(' · ', note, 'renewal refunded ' || current_date || ': check updates_until')
      where id = p.member_id;
  end if;
  return json_build_object('known', true, 'item', p.item, 'member_id', p.member_id);
end $$;
