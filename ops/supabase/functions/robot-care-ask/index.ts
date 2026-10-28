// robot-care-ask (28 Oct 2026, hub DECISIONS D25 stage 1): the members area's Ask a question about a Robot Care fix.
// POST { id, question } -> { answered: true, answer } from Claude, in plain words, about this fix only; or, when it can't
// answer (anything about money, investing or their account, or beyond the fix), one email to Amit and
// { answered: false, message }. Capped: 5 questions a fix, 10 a member a day (robot_care_requests).
// verify_jwt is on: only a signed-in active member, from myrobotisa.com.
// Deploy bundle: this file plus ../robot-care/{core,clients,accept,ask_email}.js copied beside it.
// Secrets: ROBOT_CARE_APP_ID, ROBOT_CARE_PRIVATE_KEY, ANTHROPIC_API_KEY, RESEND_API_KEY.
import { askFix } from "./accept.js";
import { githubApp, anthropic, supabaseStore } from "./clients.js";
import { fill } from "./ask_email.js";

const env = (k: string) => (Deno.env.get(k) || "").trim();
const store = supabaseStore({ url: env("SUPABASE_URL"), serviceKey: env("SUPABASE_SERVICE_ROLE_KEY") });
const gh = githubApp({ appId: env("ROBOT_CARE_APP_ID"), privateKey: (Deno.env.get("ROBOT_CARE_PRIVATE_KEY") || "").replace(/\\n/g, "\n") });
const claude = anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
const TO = "amit.bharat.patel7@gmail.com";
const FROM = "My Robot I.S.A. <hello@myrobotisa.com>";
async function mail(v: Record<string, string>) {
  const key = env("RESEND_API_KEY");
  if (!key) return false;
  const m = fill(v);
  const r = await fetch("https://api.resend.com/emails", { method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": v.key },
    body: JSON.stringify({ from: FROM, to: [TO], reply_to: v.replyTo || "hello@myrobotisa.com", subject: m.subject, html: m.html, text: m.text,
      tags: [{ name: "kind", value: "robot_care_ask" }] }) });
  return r.ok;
}
const ALLOWED = new Set(["https://myrobotisa.com", "https://www.myrobotisa.com"]);
const cors = (o: string | null) => ({ "Access-Control-Allow-Origin": o && ALLOWED.has(o) ? o : "https://myrobotisa.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Vary": "Origin" });
const reply = (o: string | null, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(o), "Content-Type": "application/json", "Cache-Control": "no-store" } });
function uidFromJwt(auth: string) {   // verify_jwt has already checked the signature; only the subject is read
  try { return JSON.parse(atob(auth.replace(/^Bearer /, "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub || null; } catch { return null; }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (!origin || !ALLOWED.has(origin)) return reply(origin, 403, { error: "Use the members area at myrobotisa.com/members" });
  if (req.method !== "POST") return reply(origin, 405, { error: "POST only" });
  if (!env("ANTHROPIC_API_KEY")) return reply(origin, 503, { error: "Questions aren't available just now. Email hello@myrobotisa.com." });
  let body: any = {};
  try { body = await req.json(); } catch { return reply(origin, 400, { error: "bad request" }); }
  try {
    const r = await askFix({ uid: uidFromJwt(req.headers.get("authorization") || ""), id: body.id, question: body.question }, { store, gh, claude, mail });
    return reply(origin, r.status, r.body);
  } catch (_e) {
    return reply(origin, 500, { error: "Something went wrong. Email your question to hello@myrobotisa.com and we'll answer." });
  }
});
