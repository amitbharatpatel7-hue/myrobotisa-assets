// stripe/core.js with stubs (20 Nov 2026). No network.   node ops/supabase/functions/stripe/test/core_test.mjs
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import * as core from "../core.js";

let passed = 0;
const t = async (name, f) => { await f(); passed++; console.log("ok  ", name); };
const hmacHex = async (k, m) => createHmac("sha256", k).update(m).digest("hex");
const NOW = Date.parse("2026-11-20T15:00:00Z");

function world({ left = 37, open = true, live = true, m = null, held = null } = {}) {
  const calls = [];
  return { calls, d: {
    live, now: NOW, pk: "pk_test_x",
    founding: async () => ({ left, sales_open: open }),
    member: async () => m,
    memberByEmail: async (e) => { calls.looked = e; return held; },
    price: async (k) => `price_${k}`,
    stripe: async (path, params) => { calls.push({ path, params }); return { url: `https://checkout.stripe.com/${path}`, id: "cs_1", client_secret: "cs_1_secret" }; },
  } };
}
const member = (o = {}) => ({ id: "m1", email: "a@x.com", plan: "founding", status: "active", stripe_customer_id: "cus_1",
  robot_care: false, robot_care_until: null, robot_care_sub_id: null, robot_care_sub_status: null, ...o });

await t("kit: founding price while places are left, standard after; waiver recorded in metadata", async () => {
  let w = world({ left: 3 });
  let r = await core.checkout(w.d, { item: "kit", waiver: true, user: null, email: "new@x.com" });
  assert.equal(r.status, 200); assert.equal(r.body.plan, "founding");
  assert.equal(w.calls[0].params.line_items[0].price, "price_kit_founding");
  assert.equal(w.calls[0].params.metadata.waiver_at, new Date(NOW).toISOString());
  assert.equal(w.calls[0].params.payment_intent_data.metadata.plan, "founding");
  w = world({ left: 0 });
  r = await core.checkout(w.d, { item: "kit", waiver: true, user: null, email: "new@x.com" });
  assert.equal(r.body.plan, "standard"); assert.equal(w.calls[0].params.line_items[0].price, "price_kit_standard");
});

await t("kit, embedded: Stripe's form on our page gets a client secret and the publishable key, and a return_url", async () => {
  const w = world({ left: 3 });
  const r = await core.checkout(w.d, { item: "kit", waiver: true, user: null, embedded: true, email: "new@x.com" });
  assert.equal(r.body.client_secret, "cs_1_secret"); assert.equal(r.body.publishable_key, "pk_test_x"); assert.equal(r.body.url, undefined);
  const p = w.calls[0].params;
  assert.equal(p.ui_mode, "embedded_page"); assert.equal(p.branding_settings.background_color, "#ffffff"); assert.match(p.return_url, /buy\.html\?done=\{CHECKOUT_SESSION_ID\}$/); assert.equal(p.success_url, undefined);
  w.d.pk = "";
  assert.equal((await core.checkout(w.d, { item: "kit", waiver: true, embedded: true, email: "new@x.com" })).body.code, "no-key");
});

await t("kit: no tick, no checkout; closed in live mode before sales open, open in test mode", async () => {
  assert.equal((await core.checkout(world().d, { item: "kit", waiver: false })).body.code, "waiver");
  assert.equal((await core.checkout(world({ open: false, live: true }).d, { item: "kit", waiver: true })).body.code, "closed");
  // test mode: strangers and ordinary members are refused; the owner or a test member may buy even before sales open
  assert.equal((await core.checkout(world({ live: false }).d, { item: "kit", waiver: true })).body.code, "test-mode");
  assert.equal((await core.checkout(world({ live: false, m: member() }).d, { item: "kit", waiver: true, user: { id: "u" } })).body.code, "test-mode");
  assert.equal((await core.checkout(world({ open: false, live: false, m: member({ plan: "owner" }) }).d, { item: "kit", waiver: true, user: { id: "u" } })).status, 200);
  assert.equal((await core.checkout(world({ live: false, m: member({ plan: "test" }) }).d, { item: "renewal", user: { id: "u" } })).status, 200);
});

await t("kit: a signed-in member who already has it is stopped", async () => {
  const r = await core.checkout(world({ m: member() }).d, { item: "kit", waiver: true, user: { id: "u", email: "a@x.com" } });
  assert.equal(r.body.code, "has-kit");
});

await t("kit: the email is checked before payment, so nobody pays twice; Stripe gets the same email", async () => {
  // signed out, live: no email, no checkout
  assert.equal((await core.checkout(world().d, { item: "kit", waiver: true, user: null })).body.code, "email");
  assert.equal((await core.checkout(world().d, { item: "kit", waiver: true, user: null, email: "not an email" })).body.code, "email");
  // an email that already holds a licence (paid, early adopter, owner, lapsed) is refused and Stripe is never called
  for (const held of [{ plan: "founding", status: "active" }, { plan: "standard", status: "lapsed" }, { plan: "early", status: "active" }, { plan: "owner", status: "active" }]) {
    const w = world({ held });
    const r = await core.checkout(w.d, { item: "kit", waiver: true, user: null, email: " Held@X.com " });
    assert.equal(r.body.code, "has-kit"); assert.equal(w.calls.length, 0); assert.equal(w.calls.looked, "held@x.com");
  }
  // refunded or deleted rows, and brand new emails, can buy; the checked email is the one Stripe locks in
  for (const held of [null, { plan: "founding", status: "refunded" }, { plan: "standard", status: "deleted" }]) {
    const w = world({ held });
    const r = await core.checkout(w.d, { item: "kit", waiver: true, user: null, email: "Back@X.com" });
    assert.equal(r.status, 200); assert.equal(w.calls[0].params.customer_email, "back@x.com");
  }
  // signed in, live, nothing typed: their sign-in email is used and checked
  const w = world({ held: null });
  await core.checkout(w.d, { item: "kit", waiver: true, user: { id: "u", email: "me@x.com" } });
  assert.equal(w.calls.looked, "me@x.com"); assert.equal(w.calls[0].params.customer_email, "me@x.com");
  // test mode: a test member's email may pay again (that exercises the automatic refund); a real member's may not
  const o = member({ plan: "owner" });
  assert.equal((await core.checkout(world({ live: false, m: o, held: { plan: "test", status: "active" } }).d, { item: "kit", waiver: true, user: { id: "u" }, email: "t@x.com" })).status, 200);
  assert.equal((await core.checkout(world({ live: false, m: o, held: { plan: "owner", status: "active" } }).d, { item: "kit", waiver: true, user: { id: "u" }, email: "a@x.com" })).body.code, "has-kit");
});

await t("renewal and Robot Care need a signed-in member with the kit", async () => {
  assert.equal((await core.checkout(world().d, { item: "renewal", user: null })).body.code, "auth");
  assert.equal((await core.checkout(world({ m: member({ plan: "early" }) }).d, { item: "renewal", user: { id: "u" } })).body.code, "not-member");
  const w = world({ m: member() });
  const r = await core.checkout(w.d, { item: "renewal", user: { id: "u" } });
  assert.equal(r.status, 200); assert.equal(w.calls[0].params.customer, "cus_1");
  assert.equal(w.calls[0].params.line_items[0].price, "price_updates_renewal");
  assert.equal(w.calls[0].params.metadata.member_id, "m1");
});

await t("Robot Care: refused during the free year or when already paying; subscription otherwise", async () => {
  let r = await core.checkout(world({ m: member({ robot_care: true, robot_care_until: "2027-11-20" }) }).d, { item: "robot_care", user: { id: "u" } });
  assert.equal(r.body.code, "free-year");
  r = await core.checkout(world({ m: member({ robot_care_sub_id: "sub_1", robot_care_sub_status: "active" }) }).d, { item: "robot_care", user: { id: "u" } });
  assert.equal(r.body.code, "has-care");
  const w = world({ m: member({ stripe_customer_id: null, robot_care: true, robot_care_until: "2026-11-01" }) });
  r = await core.checkout(w.d, { item: "robot_care", user: { id: "u" } });
  assert.equal(r.status, 200);
  const p = w.calls[0].params;
  assert.equal(p.mode, "subscription"); assert.equal(p.customer_email, "a@x.com"); assert.equal(p.customer_creation, undefined);
  assert.equal(p.subscription_data.metadata.member_id, "m1");
});

await t("portal: only with a Stripe customer", async () => {
  assert.equal((await core.portal(world({ m: member({ stripe_customer_id: null }) }).d, { user: { id: "u" } })).body.code, "no-customer");
  const w = world({ m: member() });
  const r = await core.portal(w.d, { user: { id: "u" } });
  assert.equal(r.status, 200); assert.equal(w.calls[0].path, "billing_portal/sessions");
});

await t("signature: right secret and fresh passes; wrong secret, old timestamp or junk fail", async () => {
  const body = '{"id":"evt_1"}', ts = Math.floor(NOW / 1000);
  const sig = await hmacHex("whsec_a", `${ts}.${body}`);
  assert.equal(await core.verify(hmacHex, "whsec_a", `t=${ts},v1=${sig}`, body, NOW), true);
  assert.equal(await core.verify(hmacHex, "whsec_a", `t=${ts},v1=bad,v1=${sig}`, body, NOW), true, "any v1 may match");
  assert.equal(await core.verify(hmacHex, "whsec_b", `t=${ts},v1=${sig}`, body, NOW), false);
  assert.equal(await core.verify(hmacHex, "whsec_a", `t=${ts},v1=${sig}`, body, NOW + 301000), false);
  assert.equal(await core.verify(hmacHex, "whsec_a", `t=${ts},v1=${sig}`, body + " ", NOW), false);
  assert.equal(await core.verify(hmacHex, "whsec_a", "nonsense", body, NOW), false);
});

function hooks() {
  const seen = new Set(), rpcs = [];
  const h = { rpcs, sub: null };
  h.d = { log: () => {},
    rpc: async (name, args) => { rpcs.push({ name, args }); if (name === "stripe_event_claim") { const n = !seen.has(args.p_id); seen.add(args.p_id); return n; } return { done: name }; },
    stripe: async () => h.sub || { id: "sub_1", customer: "cus_1", status: "active", cancel_at_period_end: false, metadata: { member_id: "m1" } } };
  return h;
}

await t("rehearsal: live keys before sales open let only the owner and test members pay, marked as a rehearsal", async () => {
  const owner = member({ plan: "owner", email: "o@x.com" }), stranger = member({ plan: "founding" });
  // nobody signed in, or a real member: closed, Stripe never called
  for (const m of [null, stranger]) {
    const w = world({ live: true, open: false, m });
    for (const item of ["kit", "renewal", "robot_care"]) {
      const r = await core.checkout(w.d, { item, waiver: true, user: m ? { id: "u" } : null, email: "n@x.com" });
      assert.equal(r.body.code, "closed", item); 
    }
    assert.equal(w.calls.length, 0);
  }
  // the owner can buy the kit with a fresh email (not their own: that already has it), renew and start Robot Care
  let w = world({ live: true, open: false, m: owner, held: null });
  let r = await core.checkout(w.d, { item: "kit", waiver: true, user: { id: "u", email: "o@x.com" }, email: "live1@x.com" });
  assert.equal(r.status, 200); assert.equal(w.calls[0].params.metadata.rehearsal, "1"); assert.equal(w.calls[0].params.payment_intent_data.metadata.rehearsal, "1");
  w = world({ live: true, open: false, m: owner, held: { plan: "owner", status: "active" } });
  assert.equal((await core.checkout(w.d, { item: "kit", waiver: true, user: { id: "u" }, email: "o@x.com" })).body.code, "has-kit");
  w = world({ live: true, open: false, m: owner });
  r = await core.checkout(w.d, { item: "renewal", user: { id: "u" } });
  assert.equal(r.status, 200); assert.equal(w.calls[0].params.metadata.rehearsal, "1");
  w = world({ live: true, open: false, m: owner });
  r = await core.checkout(w.d, { item: "robot_care", user: { id: "u" } });
  assert.equal(r.status, 200); assert.equal(w.calls[0].params.subscription_data.metadata.rehearsal, "1");
  // once sales open the rehearsal ends by itself: the owner is refused like anyone with the kit, and nothing is marked
  w = world({ live: true, open: true, m: owner });
  assert.equal((await core.checkout(w.d, { item: "kit", waiver: true, user: { id: "u" }, email: "fresh@x.com" })).body.code, "has-kit");
  assert.equal((await core.checkout(w.d, { item: "renewal", user: { id: "u" } })).body.code, "not-member");
  w = world({ live: true, open: true, m: null, held: null });
  await core.checkout(w.d, { item: "kit", waiver: true, user: null, email: "buyer@x.com" });
  assert.equal(w.calls[0].params.metadata.rehearsal, undefined);
  // test mode never marks anything (test payments are tests already)
  w = world({ live: false, open: true, m: owner, held: null });
  await core.checkout(w.d, { item: "kit", waiver: true, user: { id: "u" }, email: "t@x.com" });
  assert.equal(w.calls[0].params.metadata.rehearsal, undefined);
});

await t("rehearsal: a live payment marked as a rehearsal is recorded as a test; an unmarked live one is real", async () => {
  const ev = (id, meta) => ({ id, type: "checkout.session.completed", livemode: true, data: { object: { id: "cs_" + id, mode: "payment",
    payment_status: "paid", customer: "cus_r", payment_intent: "pi_" + id, amount_total: 9900, customer_details: { email: "r@x.com", name: "R" }, metadata: meta } } });
  let h = hooks();
  await core.handle(h.d, ev("r1", { item: "kit", plan: "founding", rehearsal: "1" }));
  assert.equal(h.rpcs.find((x) => x.name === "stripe_kit_paid").args.p_live, false);
  h = hooks();
  await core.handle(h.d, ev("r2", { item: "kit", plan: "founding" }));
  assert.equal(h.rpcs.find((x) => x.name === "stripe_kit_paid").args.p_live, true);
  h = hooks();
  await core.handle(h.d, ev("r3", { item: "renewal", member_id: "m1", rehearsal: "1" }));
  assert.equal(h.rpcs.find((x) => x.name === "stripe_renewal_paid").args.p_live, false);
});

await t("webhook: a paid kit makes the membership once, however often Stripe sends it", async () => {
  const h = hooks();
  const ev = { id: "evt_k", type: "checkout.session.completed", livemode: false, data: { object: {
    id: "cs_k", mode: "payment", payment_status: "paid", customer: "cus_9", payment_intent: "pi_9", amount_total: 9900,
    customer_details: { email: "New@X.com", name: "Sam  Jones" }, metadata: { item: "kit", plan: "founding", waiver_at: "2026-11-20T15:00:00.000Z" } } } };
  await core.handle(h.d, ev); await core.handle(h.d, ev);
  const kit = h.rpcs.filter((r) => r.name === "stripe_kit_paid");
  assert.equal(kit.length, 1);
  assert.equal(kit[0].args.p_first_name, "Sam"); assert.equal(kit[0].args.p_amount, 9900); assert.equal(kit[0].args.p_plan, "founding");
});

await t("webhook: a second kit payment for an email that already has the kit is refunded, and a failed refund is logged, not thrown", async () => {
  const mk = (id) => ({ id, type: "checkout.session.completed", livemode: true, data: { object: { id: "cs_" + id, mode: "payment", payment_status: "paid",
    customer: "cus_9", payment_intent: "pi_dup", amount_total: 9900, customer_details: { email: "a@x.com", name: "A" }, metadata: { item: "kit", plan: "founding" } } } });
  const calls = [], logs = [];
  const d = { log: (...a) => logs.push(a.join(" ")), rpc: async (name) => name === "stripe_event_claim" ? true : { member_id: "m1", duplicate: true, note: "paid for a kit again" },
    stripe: async (path, params) => { calls.push({ path, params }); return { id: "re_1" }; } };
  let r = await core.handle(d, mk("evt_d1"));
  assert.equal(r.body.refunded, true); assert.equal(calls[0].path, "refunds");
  assert.equal(calls[0].params.payment_intent, "pi_dup"); assert.equal(calls[0].params.reason, "duplicate");
  d.stripe = async () => { throw new Error("no permission"); };
  r = await core.handle(d, mk("evt_d2"));
  assert.equal(r.status, 200); assert.equal(r.body.refunded, false); assert.ok(logs.some((l) => /NOT refunded/.test(l) && /pi_dup/.test(l)));
  // a first, ordinary payment is never refunded
  const c2 = []; const d2 = { log: () => {}, rpc: async (name) => name === "stripe_event_claim" ? true : { member_id: "m2", duplicate: false }, stripe: async (p) => { c2.push(p); return {}; } };
  r = await core.handle(d2, mk("evt_d3")); assert.equal(r.body.refunded, undefined); assert.equal(c2.length, 0);
});

await t("webhook: unpaid sessions wait; renewal, subscription and full refunds go to the right function", async () => {
  const h = hooks();
  await core.handle(h.d, { id: "e1", type: "checkout.session.completed", data: { object: { mode: "payment", payment_status: "unpaid", metadata: { item: "kit" } } } });
  assert.equal(h.rpcs.filter((r) => r.name === "stripe_kit_paid").length, 0);
  await core.handle(h.d, { id: "e2", type: "checkout.session.completed", data: { object: { id: "cs_r", mode: "payment", payment_status: "paid", metadata: { item: "renewal", member_id: "m1" } } } });
  h.sub = { id: "sub_1", customer: "cus_1", status: "active", cancel_at_period_end: true,
    items: { data: [{ current_period_end: Date.parse("2026-12-20T12:00:00Z") / 1000 }] }, metadata: { member_id: "m1" } };
  // the event carries a stale snapshot (still "incomplete"); the handler reads the subscription as it is now
  await core.handle(h.d, { id: "e3", type: "customer.subscription.created", data: { object: { id: "sub_1", status: "incomplete", metadata: { member_id: "m1" } } } });
  await core.handle(h.d, { id: "e4", type: "charge.refunded", data: { object: { refunded: false, payment_intent: "pi_1" } } });
  await core.handle(h.d, { id: "e5", type: "charge.refunded", data: { object: { refunded: true, payment_intent: "pi_1" } } });
  const names = h.rpcs.map((r) => r.name).filter((n) => n !== "stripe_event_claim");
  assert.deepEqual(names, ["stripe_renewal_paid", "stripe_care_sub", "stripe_refunded"]);
  const care = h.rpcs.find((r) => r.name === "stripe_care_sub").args;
  assert.equal(care.p_end, "2026-12-20"); assert.equal(care.p_status, "active");
});

await t("form encoding nests like Stripe expects", async () => {
  const s = core.form({ mode: "payment", line_items: [{ price: "p", quantity: 1 }], metadata: { a: "b" }, skip: undefined }).toString();
  assert.equal(decodeURIComponent(s), "mode=payment&line_items[0][price]=p&line_items[0][quantity]=1&metadata[a]=b");
});

console.log(`\n${passed} passed`);
