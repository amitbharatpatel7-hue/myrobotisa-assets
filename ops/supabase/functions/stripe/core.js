// stripe: payments through Night Shift Labs Ltd's Stripe account (20 Nov 2026, hub D27). The logic, with every outside
// call passed in as `d`; index.ts wires the real ones and test/core_test.mjs drives this with stubs. Plain JS so Deno
// and Node both run it.
//
// Routes (index.ts):
//   POST /stripe/checkout {item, waiver?}  -> {url}   item: kit (no sign-in), renewal or robot_care (signed in)
//        with embedded: true (the kit, on /buy.html) -> {client_secret, publishable_key} for Stripe's form on our page
//   POST /stripe/portal                    -> {url}   signed in: Stripe's page for card, receipts, cancel Robot Care
//   POST /stripe/webhook                   Stripe's events, signature checked
//
// Products are found by Stripe lookup key, so test and live use the same code: kit_founding (£99) while founding
// places are left, else kit_standard (£199); updates_renewal (£99, never renews); robot_care_monthly (£10 a month).

export const SITE = "https://myrobotisa.com";
const MEMBERS = `${SITE}/members/`;
const ok = (body) => ({ status: 200, body: { ok: true, ...body } });
const no = (status, error, code) => ({ status, body: { ok: false, error, code } });
const londonToday = (now) => new Date(now).toLocaleDateString("en-CA", { timeZone: "Europe/London" });   // YYYY-MM-DD

// ── Checkout ───────────────────────────────────────────────────────────────────────────────────────────────────
// d: { member(user) -> row|null, founding() -> {left, sales_open}, price(lookup) -> id, stripe(path, form) -> json,
//      live: boolean, now: ms }
export async function checkout(d, { item, waiver, user, embedded }) {
  // Test mode is for the owner and test members only: a test card must never make a stranger a member.
  const me = user ? await d.member(user) : null;
  if (!d.live && !(me && me.status === "active" && ["owner", "test"].includes(me.plan)))
    return no(403, "Payments are being tested. Sales open in January.", "test-mode");
  const buyers = d.live ? ["founding", "standard"] : ["founding", "standard", "owner", "test"];
  if (item === "kit") {
    const f = await d.founding();
    if (!f.sales_open && d.live) return no(409, "Sales open in January. Join the free test drive for now.", "closed");
    if (waiver !== true) return no(400, "Tick the box to say you understand the 14-day right to cancel ends when you open the code.", "waiver");
    if (d.live && me && ["active", "lapsed"].includes(me.status) && me.plan !== "test")
      return no(409, "You already have the kit. Manage membership is in Help and membership.", "has-kit");
    const plan = f.left > 0 ? "founding" : "standard";
    const waiverAt = new Date(d.now).toISOString();
    const meta = { item: "kit", plan, waiver_at: waiverAt };
    const s = await d.stripe("checkout/sessions", {
      mode: "payment", locale: "en-GB",
      line_items: [{ price: await d.price(plan === "founding" ? "kit_founding" : "kit_standard"), quantity: 1 }],
      customer_creation: "always", ...(user?.email && d.live ? { customer_email: user.email } : {}),
      metadata: meta, payment_intent_data: { metadata: meta },
      custom_text: { submit: { message: "You agreed that opening the code ends your 14-day right to cancel. The QuickStart promise still applies: see our terms." } },
      // On our page Stripe's form sits in a white card, so its own summary panel is white too (not the brand purple).
      ...(embedded ? { ui_mode: "embedded_page", return_url: `${SITE}/buy.html?done={CHECKOUT_SESSION_ID}`,
        branding_settings: { background_color: "#ffffff", display_name: "My Robot I.S.A." } }
        : { success_url: `${MEMBERS}?welcome=1&session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${SITE}/buy.html?checkout=cancelled` }),
    });
    if (embedded) return d.pk && s.client_secret ? ok({ client_secret: s.client_secret, publishable_key: d.pk, plan })
      : no(503, "Payments aren't set up yet.", "no-key");
    return ok({ url: s.url, plan });
  }
  if (item !== "renewal" && item !== "robot_care") return no(400, "Choose something to buy.", "item");
  if (!user) return no(401, "Sign in again.", "auth");
  const m = me;
  if (!m || !["active", "lapsed"].includes(m.status) || !buyers.includes(m.plan))
    return no(403, "This is for members with the kit.", "not-member");
  const customer = m.stripe_customer_id ? { customer: m.stripe_customer_id } : { customer_email: m.email, customer_creation: "always" };
  const meta = { item, member_id: m.id };
  if (item === "renewal") {
    const s = await d.stripe("checkout/sessions", {
      mode: "payment", locale: "en-GB", ...customer,
      line_items: [{ price: await d.price("updates_renewal"), quantity: 1 }],
      metadata: meta, payment_intent_data: { metadata: meta },
      success_url: `${MEMBERS}?renewed=1`, cancel_url: MEMBERS,
    });
    return ok({ url: s.url });
  }
  const today = londonToday(d.now);
  if (m.robot_care && m.robot_care_until && m.robot_care_until >= today && !m.robot_care_sub_id)
    return no(409, `Your free year of Robot Care runs until ${m.robot_care_until}. We'll email you before it ends.`, "free-year");
  if (m.robot_care_sub_id && ["active", "trialing", "past_due"].includes(m.robot_care_sub_status))
    return no(409, "Robot Care is already on. Manage it from Manage membership.", "has-care");
  const { customer_creation, ...subCustomer } = customer;   // subscription mode always makes a customer
  const s = await d.stripe("checkout/sessions", {
    mode: "subscription", locale: "en-GB", ...subCustomer,
    line_items: [{ price: await d.price("robot_care_monthly"), quantity: 1 }],
    metadata: meta, subscription_data: { metadata: meta },
    success_url: `${MEMBERS}?robot_care=on`, cancel_url: MEMBERS,
  });
  return ok({ url: s.url });
}

// ── Customer portal ────────────────────────────────────────────────────────────────────────────────────────────
export async function portal(d, { user }) {
  if (!user) return no(401, "Sign in again.", "auth");
  const m = await d.member(user);
  if (!m?.stripe_customer_id) return no(404, "There's nothing to manage yet: no payments on this account.", "no-customer");
  const s = await d.stripe("billing_portal/sessions", { customer: m.stripe_customer_id, return_url: MEMBERS });
  return ok({ url: s.url });
}

// ── Webhook ────────────────────────────────────────────────────────────────────────────────────────────────────
// Stripe-Signature: t=<unix>,v1=<hex hmac-sha256 of "t.body"> (docs.stripe.com/webhooks#verify-manually).
export async function verify(hmacHex, secret, header, body, nowMs, tolerance = 300) {
  const parts = Object.fromEntries(String(header || "").split(",").map((p) => p.split("=")).filter((p) => p.length === 2)
    .map(([k, v]) => [k.trim(), v.trim()]));
  const sigs = String(header || "").split(",").filter((p) => p.trim().startsWith("v1=")).map((p) => p.trim().slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length) return false;
  if (Math.abs(nowMs / 1000 - t) > tolerance) return false;
  const want = await hmacHex(secret, `${t}.${body}`);
  return sigs.some((s) => s.length === want.length && timingSafe(s, want));
}
function timingSafe(a, b) { let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }

const day = (unix) => unix ? new Date(unix * 1000).toLocaleDateString("en-CA", { timeZone: "Europe/London" }) : null;
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || null;

// d: { rpc(name, args) -> json, stripe(path, form, method) -> json, log }
export async function handle(d, event) {
  if (!(await d.rpc("stripe_event_claim", { p_id: event.id, p_type: event.type }))) return ok({ repeat: true });
  const o = event.data?.object || {};
  const live = !!event.livemode;
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    if (o.payment_status !== "paid" && o.mode !== "subscription") return ok({ waiting: o.payment_status });
    const meta = o.metadata || {};
    if (meta.item === "kit") {
      const r = await d.rpc("stripe_kit_paid", {
        p_email: o.customer_details?.email || o.customer_email, p_first_name: firstName(o.customer_details?.name),
        p_plan: meta.plan, p_customer: o.customer, p_session: o.id, p_payment_intent: o.payment_intent,
        p_amount: o.amount_total, p_waiver_at: meta.waiver_at || null, p_live: live });
      if (r?.note) d.log("stripe: for the owner:", r.note);
      return ok({ kit: r });
    }
    if (meta.item === "renewal") {
      return ok({ renewal: await d.rpc("stripe_renewal_paid", { p_member: meta.member_id, p_customer: o.customer,
        p_session: o.id, p_payment_intent: o.payment_intent, p_amount: o.amount_total, p_live: live }) });
    }
    if (meta.item === "robot_care" && o.subscription) {
      const sub = await d.stripe(`subscriptions/${o.subscription}`, null, "GET");
      return ok({ care: await careFromSub(d, sub) });
    }
    return ok({ ignored: meta.item || "no item" });
  }
  if (event.type.startsWith("customer.subscription.")) {
    // Events can arrive out of order, so read the subscription as it stands now and never trust an old snapshot.
    let sub = o;
    try { sub = await d.stripe(`subscriptions/${o.id}`, null, "GET"); } catch (e) { d.log("stripe: using the event's copy of", o.id, String(e)); }
    return ok({ care: await careFromSub(d, sub) });
  }
  if (event.type === "charge.refunded") {
    if (!o.refunded) return ok({ partial: true });   // only a full refund ends anything
    return ok({ refund: await d.rpc("stripe_refunded", { p_payment_intent: o.payment_intent }) });
  }
  return ok({ ignored: event.type });
}

async function careFromSub(d, sub) {
  const member = sub.metadata?.member_id;
  if (!member) return { ignored: "no member_id" };
  const item = sub.items?.data?.[0];
  const periodEnd = item?.current_period_end ?? sub.current_period_end;
  const end = sub.status === "canceled" ? day(sub.ended_at || sub.canceled_at) : sub.cancel_at_period_end ? day(sub.cancel_at || periodEnd) : null;
  return d.rpc("stripe_care_sub", { p_member: member, p_customer: sub.customer, p_sub: sub.id, p_status: sub.status, p_end: end });
}

// Stripe's API takes form encoding with brackets for nesting: line_items[0][price]=...
export function form(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") form(v, key, out); else out.append(key, String(v));
  }
  return out;
}
