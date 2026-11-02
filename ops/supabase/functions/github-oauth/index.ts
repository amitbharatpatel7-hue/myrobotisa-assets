// github-oauth: the one server step of the members' "Set up my robot" page (23 Oct 2026; 25 Oct 2026 adds the link).
//
// GitHub's OAuth code-for-token exchange needs the app's client secret and doesn't allow browser calls, so the page
// sends the one-time code here and gets the member's GitHub token back. The member's Trading 212 and email keys never
// come here: they go from their browser straight to GitHub, encrypted to their own repo. This function never logs or
// stores the token, and only answers signed-in members (verify_jwt on) calling from myrobotisa.com.
// 25 Oct 2026: with the token in hand it also asks GitHub who the member is (GET /user) and saves that verified login
// on their members row (Robot Care needs it), then invites the login to the community org (myrobotisa).
// 2 Nov 2026 (D32): an early adopter is also invited to the private template, so they can make their copy.
//
// GET  -> { configured, client_id }
// POST { code } -> { access_token, scope, login, link, invite, template, saved }     (or { error }); link "different" = the
//                  member already has another login saved, which is kept (the page offers to switch)
// Secrets (set by Amit): GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET, COMMUNITY_INVITE_TOKEN, TEMPLATE_INVITE_TOKEN
import { db, userIdFromJwt, memberByUser, linkLogin, inviteToOrg, inviteToTemplate } from "./link.js";

const ID = Deno.env.get("GITHUB_OAUTH_CLIENT_ID") || "";
const SECRET = Deno.env.get("GITHUB_OAUTH_CLIENT_SECRET") || "";
const INVITE = (Deno.env.get("COMMUNITY_INVITE_TOKEN") || "").trim();
const TEMPLATE_INVITE = (Deno.env.get("TEMPLATE_INVITE_TOKEN") || "").trim();
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
  if (req.method === "GET") return reply(origin, 200, { configured: !!(ID && SECRET), client_id: ID || null });
  if (req.method !== "POST") return reply(origin, 405, { error: "POST only" });
  if (!origin || !ALLOWED.has(origin)) return reply(origin, 403, { error: "Use the setup page at myrobotisa.com/members" });
  if (!ID || !SECRET) return reply(origin, 503, { error: "GitHub connection isn't switched on yet." });

  let code = "";
  try { code = String((await req.json())?.code || ""); } catch { /* fall through */ }
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(code)) return reply(origin, 400, { error: "That GitHub sign-in didn't come through. Press Connect GitHub again." });

  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: ID, client_secret: SECRET, code }),
  }).catch(() => null);
  if (!r || !r.ok) return reply(origin, 502, { error: "GitHub didn't answer. Try Connect GitHub again in a minute." });
  const j = await r.json().catch(() => ({}));
  if (!j.access_token) return reply(origin, 400, { error: "That GitHub sign-in expired. Press Connect GitHub again." });

  // Who is this, according to GitHub? Best effort: setup carries on even if the link or the invite fails.
  let login = "", link = "skipped", invite = "skipped", template = "skipped", saved: string | null = null;
  try {
    const u = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${j.access_token}`, Accept: "application/vnd.github+json", "User-Agent": "myrobotisa-members" } });
    if (u.ok) login = String((await u.json()).login || "");
    if (login) {
      const member = await memberByUser(q, userIdFromJwt(req.headers.get("authorization") || ""));
      link = await linkLogin(q, member, login);
      saved = member?.github_login || null;
      if (member && member.status === "active" && link !== "taken" && link !== "error") {
        invite = await inviteToOrg(INVITE, login);
        if (member.plan === "early") template = await inviteToTemplate(TEMPLATE_INVITE, login);
      }
    }
  } catch (e) { console.error("link/invite", String(e).slice(0, 120)); }
  return reply(origin, 200, { access_token: j.access_token, scope: j.scope || "", login, link, invite, template, saved });
});
