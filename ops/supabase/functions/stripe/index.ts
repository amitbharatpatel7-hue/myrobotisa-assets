// stripe edge function (20 Nov 2026, hub D27). The logic is core.js; this file wires the real calls.
// Deploy with verify_jwt = false: Stripe's webhook carries no Supabase token, and a kit can be bought before sign-in.
// Sign-ins on the other routes are checked here against Supabase Auth (/auth/v1/user), not just decoded.
// Secrets: STRIPE_SECRET_KEY (a restricted key: Checkout Sessions, Customer portal, Prices and Subscriptions read,
//          and Refunds write, used only to send back a second kit payment),
//          STRIPE_WEBHOOK_SECRET (whsec_… for this endpoint), STRIPE_PUBLISHABLE_KEY (pk_…). The service role key is built in.
import * as core from "./core.js";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const WHSEC = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const PK = Deno.env.get("STRIPE_PUBLISHABLE_KEY") || "";   // pk_…, public by design; sent to /buy.html for Stripe.js
const LIVE = KEY.startsWith("sk_live_") || KEY.startsWith("rk_live_");
const ALLOWED = new Set(["https://myrobotisa.com", "https://www.myrobotisa.com"]);
const cors = (o: string | null) => ({ "Access-Control-Allow-Origin": o && ALLOWED.has(o) ? o : "https://myrobotisa.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Vary": "Origin" });
const reply = (o: string | null, r: { status: number; body: unknown }) =>
  new Response(JSON.stringify(r.body), { status: r.status, headers: { ...cors(o), "Content-Type": "application/json", "Cache-Control": "no-store" } });

const db = (path: string, init: RequestInit = {}) => fetch(`${URL_}/rest/v1/${path}`, { ...init,
  headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", ...(init.headers || {}) } });
async function rpc(name: string, args: Record<string, unknown>) {
  const r = await db(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${name}: ${r.status} ${await r.text()}`);
  return r.json();
}
async function stripe(path: string, params: Record<string, unknown> | null, method = "POST") {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, { method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: method === "GET" ? undefined : core.form(params || {}).toString() });
  const j = await r.json();
  if (!r.ok) throw new Error(`stripe ${path}: ${r.status} ${j?.error?.message || ""}`);
  return j;
}
const prices = new Map<string, string>();
async function price(lookup: string) {
  if (!prices.has(lookup)) {
    const j = await stripe(`prices?active=true&lookup_keys[]=${encodeURIComponent(lookup)}`, null, "GET");
    if (!j.data?.[0]?.id) throw new Error(`no active price ${lookup}`);
    prices.set(lookup, j.data[0].id);
  }
  return prices.get(lookup)!;
}
async function user(auth: string) {   // a real check of the token with Supabase Auth
  if (!/^Bearer \S+/.test(auth)) return null;
  const r = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: SRK, Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  return u?.id ? { id: u.id as string, email: String(u.email || "").toLowerCase() } : null;
}
async function member(u: { id: string }) {
  const rows = await (await db(`members?select=id,email,plan,status,stripe_customer_id,robot_care,robot_care_until,robot_care_sub_id,robot_care_sub_status&user_id=eq.${u.id}&limit=1`)).json();
  return Array.isArray(rows) ? rows[0] || null : null;
}
async function memberByEmail(email: string) {
  const rows = await (await db(`members?select=plan,status&email=eq.${encodeURIComponent(email)}&limit=1`)).json();
  return Array.isArray(rows) ? rows[0] || null : null;
}
const founding = async () => rpc("founding_status", {});
async function hmacHex(secret: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  const route = new URL(req.url).pathname.split("/").pop();
  const origin = req.headers.get("origin");
  if (!KEY) return reply(origin, { status: 503, body: { ok: false, error: "Payments aren't set up yet." } });

  if (route === "webhook") {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const body = await req.text();
    if (!WHSEC || !(await core.verify(hmacHex, WHSEC, req.headers.get("stripe-signature"), body, Date.now())))
      return new Response("bad signature", { status: 400 });
    try {
      const r = await core.handle({ rpc, stripe, log: console.error }, JSON.parse(body));
      return new Response(JSON.stringify(r.body), { status: 200, headers: { "Content-Type": "application/json" } });
    } catch (e) {
      console.error("stripe webhook:", e);   // a 500 makes Stripe retry, which is what we want
      return new Response("error", { status: 500 });
    }
  }

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return reply(origin, { status: 405, body: { ok: false, error: "POST only" } });
  if (!origin || !ALLOWED.has(origin)) return reply(origin, { status: 403, body: { ok: false, error: "Use myrobotisa.com" } });
  let input: Record<string, unknown> = {};
  try { input = await req.json(); } catch { /* empty body is fine */ }
  const u = await user(req.headers.get("authorization") || "");
  const d = { member, memberByEmail, founding, price, stripe, live: LIVE, now: Date.now(), pk: PK };
  try {
    if (route === "checkout") return reply(origin, await core.checkout(d, { item: input.item, waiver: input.waiver, user: u, embedded: input.embedded === true, email: input.email }));
    if (route === "portal") return reply(origin, await core.portal(d, { user: u }));
  } catch (e) {
    console.error("stripe:", e);
    return reply(origin, { status: 502, body: { ok: false, error: "Payments are having a moment. Try again in a minute." } });
  }
  return reply(origin, { status: 404, body: { ok: false, error: "No such route." } });
});
