// early-invite (2 Nov 2026, hub DECISIONS D32): the owner's Send invite button on the Early adopters card.
// POST { id } -> { ok } emails that early adopter the invite (email.js, from ops/build_early_invite_email.py) and stamps
// members.invited_at. Only the owner, signed in, from myrobotisa.com. Deployed only after Amit's "send" on the email.
// Secrets: RESEND_API_KEY (service role key is built in).
import { buildInvite } from "./email.js";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND = Deno.env.get("RESEND_API_KEY");
const ALLOWED = new Set(["https://myrobotisa.com", "https://www.myrobotisa.com"]);
const cors = (o: string | null) => ({ "Access-Control-Allow-Origin": o && ALLOWED.has(o) ? o : "https://myrobotisa.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Vary": "Origin" });
const reply = (o: string | null, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(o), "Content-Type": "application/json", "Cache-Control": "no-store" } });
const db = (path: string, init: RequestInit = {}) => fetch(`${URL_}/rest/v1/${path}`, { ...init,
  headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", ...(init.headers || {}) } });
function sub(auth: string) {   // verify_jwt has already checked the signature; only the subject is read
  try { return JSON.parse(atob(auth.replace(/^Bearer /, "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub || null; } catch { return null; }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return reply(origin, 405, { error: "POST only" });
  if (!origin || !ALLOWED.has(origin)) return reply(origin, 403, { error: "Use the members area at myrobotisa.com/members" });
  if (!RESEND) return reply(origin, 503, { error: "Email isn't set up." });
  const uid = sub(req.headers.get("authorization") || "");
  if (!uid || !/^[0-9a-f-]{36}$/i.test(uid)) return reply(origin, 401, { error: "Sign in again." });
  const own = await (await db(`members?select=id&user_id=eq.${uid}&plan=eq.owner&status=eq.active&limit=1`)).json();
  if (!Array.isArray(own) || !own.length) return reply(origin, 403, { error: "Owner only." });
  let id = "";
  try { id = String((await req.json())?.id || ""); } catch { /* fall through */ }
  if (!/^[0-9a-f-]{36}$/i.test(id)) return reply(origin, 400, { error: "No such person." });
  const m = (await (await db(`members?select=id,email&id=eq.${id}&plan=eq.early&status=eq.active&limit=1`)).json())[0];
  if (!m) return reply(origin, 404, { error: "No such person." });
  const { subject, html, text } = buildInvite();
  const sent = await fetch("https://api.resend.com/emails", { method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json", "Idempotency-Key": `early-invite-${id}-${new Date().toISOString().slice(0, 10)}` },
    body: JSON.stringify({ from: "My Robot I.S.A. <hello@myrobotisa.com>", to: [m.email], reply_to: "hello@myrobotisa.com", subject, html, text, tags: [{ name: "kind", value: "early_invite" }] }) });
  if (!sent.ok) return reply(origin, 502, { error: "The email didn't send. Try again in a minute." });
  await db(`members?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ invited_at: new Date().toISOString() }) });
  return reply(origin, 200, { ok: true });
});
