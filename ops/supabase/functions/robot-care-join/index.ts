// robot-care-join (25 Oct 2026): the one-tap "Robot Care" step on Set up my robot.
// GET  -> { login, robot_care, eligible, installed, install_url } the member's Robot Care state (installed comes from
//         the App's installation webhooks, recorded by robot-care in robot_care_installs)
// POST -> { ok, robot_care, install_url, invite, until }  switch Robot Care on (founding members' free year: until = today + 1 year)
// POST { switch: true, token } -> { ok, login, switched }  move Robot Care to the GitHub account now connected
// Needs the member's GitHub login, which github-oauth saves when they connect GitHub. Only signed-in members
// (verify_jwt on) from myrobotisa.com. Secrets: COMMUNITY_INVITE_TOKEN (service role key is built in).
import { db, userIdFromJwt, memberByUser, inviteToOrg, careEligible, careStart, linkLogin, loginFromToken } from "./link.js";

const INSTALL = "https://github.com/apps/my-robot-i-s-a-robot-care/installations/new";
const INVITE = (Deno.env.get("COMMUNITY_INVITE_TOKEN") || "").trim();
const q = db(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
const ALLOWED = new Set(["https://myrobotisa.com", "https://www.myrobotisa.com"]);
const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED.has(origin) ? origin : "https://myrobotisa.com",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Vary": "Origin",
});
const reply = (origin: string | null, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (!origin || !ALLOWED.has(origin)) return reply(origin, 403, { error: "Use the members area at myrobotisa.com/members" });
  const m = await memberByUser(q, userIdFromJwt(req.headers.get("authorization") || ""));
  if (!m) return reply(origin, 404, { error: "We couldn't find your membership. Sign out and in again, or email hello@myrobotisa.com." });
  const eligible = careEligible(m);
  if (req.method === "GET") {
    let installed = false;
    if (m.github_login) {
      const r = await q(`robot_care_installs?select=action&account=ilike.${encodeURIComponent(m.github_login)}&order=at.desc&limit=1`);
      const last = r.ok ? (await r.json())[0] : null;
      installed = !!last && !["deleted", "suspend"].includes(last.action);
    }
    return reply(origin, 200, { login: m.github_login || null, robot_care: !!m.robot_care, eligible, installed, install_url: INSTALL, until: m.robot_care_until || null });
  }
  if (req.method !== "POST") return reply(origin, 405, { error: "GET or POST" });
  let body: any = {};
  try { body = await req.json(); } catch { /* an empty POST switches Robot Care on */ }
  if (body && body.switch) {   // "Use @new instead": GitHub says who the token belongs to; the token is not kept
    const login = await loginFromToken(String(body.token || ""));
    if (!login) return reply(origin, 400, { error: "GitHub didn't recognise that connection. Press Connect GitHub again." });
    const link = await linkLogin(q, m, login, true);
    if (link === "taken") return reply(origin, 409, { error: `@${login} is already linked to another membership. Email hello@myrobotisa.com.` });
    if (link === "error") return reply(origin, 500, { error: "That didn't save. Try again in a minute." });
    const invite = m.status === "active" ? await inviteToOrg(INVITE, login).catch(() => "error") : "skipped";
    return reply(origin, 200, { ok: true, login, switched: link === "linked", invite });
  }
  if (!m.github_login) return reply(origin, 409, { error: "Connect GitHub first (step 1), so Robot Care knows which copy is yours." });
  if (!eligible) return reply(origin, 403, { error: "Robot Care's free year is for the first 100 founding members. Paid Robot Care opens soon: we'll email you." });
  const start = careStart(m);
  if (start) {
    const u = await q(`members?id=eq.${m.id}`, { method: "PATCH", body: JSON.stringify(start) });
    if (!u.ok) return reply(origin, 500, { error: "That didn't save. Try again in a minute." });
  }
  const invite = await inviteToOrg(INVITE, m.github_login).catch(() => "error");
  return reply(origin, 200, { ok: true, robot_care: true, install_url: INSTALL, invite, until: (start || m).robot_care_until || null });
});
