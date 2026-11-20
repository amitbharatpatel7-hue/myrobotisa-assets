// stripe/core.js with stubs (20 Nov 2026). No network.   node ops/supabase/functions/stripe/test/core_test.mjs
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import * as core from "../core.js";

let passed = 0;
const t = async (name, f) => { await f(); passed++; console.log("ok  ", name); };
const hmacHex = async (k, m) => createHmac("sha256", k).update(m).digest("hex");
const NOW = Date.parse("2026-11-20T15:00:00Z");

function world({ left = 37, open = true, live = false, m = null } = {}) {
  const calls = [];
  return { calls, d: {
    live, now: NOW,
    founding: async () => ({ left, sales_open: open }),
    member: async () => m,
    price: async (k) => `price_${k}`,
    stripe: async (path, params) => { calls.push({ path, params }); return { url: `https://checkout.stripe.com/${path}`, id: "cs_1" }; },
  } };
}
const member = (o = {}) => ({ id: "m1", email: "a@x.com", plan: "founding", status: "active", stripe_customer_id: "cus_1",
  robot_care: false, robot_care_until: null, robot_care_sub_id: null, robot_care_sub_status: null, ...o });

await t("kit: founding price while places are left, standard after; waiver recorded in metadata", async () => {
  let w = world({ left: 3 });
  let r = await core.checkout(w.d, { item: "kit", waiver: true, user: null });
  assert.equal(r.status, 200); assert.equal(r.body.plan, "founding");
  assert.equal(w.calls[0].params.line_items[0].price, "price_kit_founding");
  assert.equal(w.calls[0].params.metadata.waiver_at, new Date(NOW).toISOString());
  assert.equal(w.calls[0].params.payment_intent_data.metadata.plan, "founding");
  w = world({ left: 0 });
  r = await core.checkout(w.d, { item: "kit", waiver: true, user: null });
  assert.equal(r.body.plan, "standard"); assert.equal(w.calls[0].params.line_items[0].price, "price_kit_standard");
});

await t("kit: no tick, no checkout; closed in live mode before sales open, open in test mode", async () => {
  assert.equal((await core.checkout(world().d, { item: "kit", waiver: false })).body.code, "waiver");
  assert.equal((await core.checkout(world({ open: false, live: true }).d, { item: "kit", waiver: true })).body.code, "closed");
  assert.equal((await core.checkout(world({ open: false, live: false }).d, { item: "kit", waiver: true })).status, 200);
});

await t("kit: a signed-in member who already has it is stopped", async () => {
  const r = await core.checkout(world({ m: member() }).d, { item: "kit", waiver: true, user: { id: "u", email: "a@x.com" } });
  assert.equal(r.body.code, "has-kit");
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
