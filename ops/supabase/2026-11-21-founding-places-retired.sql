-- 21 Nov 2026 (Amit): a refunded founding place stays retired.
-- The public count follows the founding numbers handed out (the same max+1 the allocator uses), not who is still
-- active, so the page can never offer a place whose number cannot be given. And a founding number is never taken
-- off a row, so a refund followed by a return at the standard price cannot reopen a place either.
-- Additive: two functions replaced, same signatures and grants. Applied live on 21 Nov 2026.

create or replace function public.founding_status()
 returns json
 language sql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
  select json_build_object(
    'total', 100,
    'sold', s.sold,
    'left', greatest(0, 100 - s.sold),
    'sales_open', s.paid > 0 or coalesce(now() >= c.sales_open_at, false),
    'sales_open_at', c.sales_open_at
  )
  from (
    select least(100, coalesce(max(founding_no), 0))::int as sold,
           count(*) filter (where plan in ('founding', 'standard')) as paid
    from public.members
  ) s
  left join public.site_settings c on c.id = 1;
$function$;

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
    -- A founding number once given is never taken off the row, even if they come back at the standard price: it stays retired.
    update public.members set plan = plan_, status = 'active', founding_no = coalesce(case when plan_ = 'founding' then no_ end, cur.founding_no),
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
