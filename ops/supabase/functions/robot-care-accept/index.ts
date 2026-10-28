// robot-care-accept (28 Oct 2026, hub DECISIONS D25 stage 1): the members area's Accept fix.
// POST { id }                      -> merge Robot Care's fix after re-checking it with GitHub (accept.js acceptFix)
// POST { id, action: "decline" }   -> "Not now": marks it declined; the pull request stays open on GitHub
// POST { action: "sync" }          -> mark fixes merged or closed on GitHub since
// verify_jwt is on: only a signed-in member, from myrobotisa.com. The merge uses Robot Care's own installation token.
// Deploy bundle: this file plus ../robot-care/{core,clients,accept}.js copied beside it (the same files robot-care runs).
// Secrets: ROBOT_CARE_APP_ID, ROBOT_CARE_PRIVATE_KEY (service role key is built in).
import { acceptFix } from "./accept.js";
import { githubApp, supabaseStore } from "./clients.js";

const env = (k: string) => (Deno.env.get(k) || "").trim();
const store = supabaseStore({ url: env("SUPABASE_URL"), serviceKey: env("SUPABASE_SERVICE_ROLE_KEY") });
const gh = githubApp({ appId: env("ROBOT_CARE_APP_ID"), privateKey: (Deno.env.get("ROBOT_CARE_PRIVATE_KEY") || "").replace(/\\n/g, "\n") });
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
  if (!env("ROBOT_CARE_APP_ID") || !env("ROBOT_CARE_PRIVATE_KEY")) return reply(origin, 503, { error: "Robot Care isn't available just now." });
  let body: any = {};
  try { body = await req.json(); } catch { return reply(origin, 400, { error: "bad request" }); }
  try {
    const r = await acceptFix({ uid: uidFromJwt(req.headers.get("authorization") || ""), id: body.id, action: body.action || "accept" }, { store, gh });
    return reply(origin, r.status, r.body);
  } catch (_e) {
    return reply(origin, 500, { error: "Something went wrong and nothing was merged. Try again in a minute." });
  }
});
