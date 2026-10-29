// member-account (29 Oct 2026, D28): members change their sign-in email, switch GitHub account, and delete their
// account (7 days' grace, then the hourly job finishes it). The logic is in core.js; this file wires the real calls.
//
// verify_jwt is OFF so the hourly pg_cron job (purge) and the email's cancel link can reach it. Every other action
// checks the member's sign-in itself (GET /auth/v1/user with their token) and only answers myrobotisa.com.
// "purge" only ever finishes deletions that are already due, so calling it early does nothing.
// Secrets: RESEND_API_KEY, COMMUNITY_INVITE_TOKEN (already set for members-login and robot-care-join).
import { handle } from "./core.js";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND = Deno.env.get("RESEND_API_KEY") || "";
const INVITE = (Deno.env.get("COMMUNITY_INVITE_TOKEN") || "").trim();
const FROM = "My Robot I.S.A. <hello@myrobotisa.com>";
const ORG = "myrobotisa", UA = "myrobotisa-members";
const ALLOWED = new Set(["https://myrobotisa.com", "https://www.myrobotisa.com"]);
const SELF = `${URL_}/functions/v1/member-account`;

const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED.has(origin) ? origin : "https://myrobotisa.com",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Vary": "Origin",
});
const svc = (path: string, init: RequestInit = {}) =>
  fetch(`${URL_}${path}`, { ...init, headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", ...(init.headers || {}) } });
async function rpc(name: string, args: Record<string, unknown>) {
  const r = await svc(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
  const j = await r.json().catch(() => null);
  if (!r.ok) { const e: any = new Error((j && j.message) || `rpc ${name} ${r.status}`); e.code = j && j.code; throw e; }
  return j;
}
async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const gh = (path: string, init: RequestInit = {}) => fetch(`https://api.github.com${path}`, { ...init,
  headers: { Authorization: `Bearer ${INVITE}`, Accept: "application/vnd.github+json", "User-Agent": UA, "X-GitHub-Api-Version": "2022-11-28", ...(init.headers || {}) } });

const deps = {
  sha,
  rand: () => crypto.getRandomValues(new Uint32Array(1))[0],
  cancelUrl: (token: string) => `${SELF}?cancel=${token}`,
  send: async (to: string, m: { subject: string; html: string; text: string }, tag: string) => {
    if (!RESEND) return false;
    const r = await fetch("https://api.resend.com/emails", { method: "POST",
      headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json", "Idempotency-Key": tag + "-" + (await sha(to + m.subject + Date.now())).slice(0, 24) },
      body: JSON.stringify({ from: FROM, to: [to], reply_to: "hello@myrobotisa.com", subject: m.subject, html: m.html, text: m.text, tags: [{ name: "kind", value: tag }] }) });
    return r.ok;
  },
  store: {
    member: async (uid: string) => {
      const r = await svc(`/rest/v1/members?select=id,email,plan,status,github_login&user_id=eq.${uid}&status=in.(active,lapsed)&limit=1`);
      return r.ok ? (await r.json())[0] || null : null;
    },
    codePut: (uid: string, purpose: string, email: string | null, hash: string) => rpc("acct_code_put", { p_user: uid, p_purpose: purpose, p_new_email: email, p_code_hash: hash }),
    codeCheck: (uid: string, purpose: string, hash: string) => rpc("acct_code_check", { p_user: uid, p_purpose: purpose, p_code_hash: hash }),
    emailSet: (uid: string, email: string) => rpc("acct_email_set", { p_user: uid, p_new_email: email }),
    deleteRequest: (uid: string) => rpc("acct_delete_request", { p_user: uid }),
    deleteCancel: (uid: string | null, token: string | null) => rpc("acct_delete_cancel", { p_user: uid, p_token: token }),
    purgeDue: async () => (await rpc("acct_purge_due", {})) || [],
    purge: (uid: string) => rpc("acct_purge", { p_user: uid }),
    purgeDone: (uid: string, detail: string | null) => rpc("acct_purge_done", { p_user: uid, p_detail: detail }),
    loginTaken: async (login: string, exceptId?: string) => {
      const r = await svc(`/rest/v1/members?select=id&github_login=ilike.${encodeURIComponent(login)}${exceptId ? `&id=neq.${exceptId}` : ""}&limit=1`);
      return !r.ok || (await r.json()).length > 0;   // when unsure, treat it as taken
    },
    setLogin: async (id: string, login: string) => (await svc(`/rest/v1/members?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ github_login: login }) })).ok,
  },
  auth: {
    setEmail: async (uid: string, email: string) => {
      const r = await svc(`/auth/v1/admin/users/${uid}`, { method: "PUT", body: JSON.stringify({ email, email_confirm: true }) });
      if (r.ok) return "ok";
      const j = await r.json().catch(() => ({}));
      return r.status === 422 || /already|exists/i.test(JSON.stringify(j)) ? "taken" : `error:${r.status}`;
    },
    deleteUser: async (uid: string) => {
      const r = await svc(`/auth/v1/admin/users/${uid}`, { method: "DELETE" });
      return r.ok || r.status === 404 ? "ok" : `error:${r.status}`;
    },
  },
  gh: {
    loginFromToken: async (token: string) => {
      if (!/^[A-Za-z0-9_]{20,255}$/.test(token)) return "";
      const u = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": UA } });
      return u.ok ? String((await u.json()).login || "") : "";
    },
    invite: async (login: string) => {   // same as link.js inviteToOrg
      if (!INVITE) return "skipped";
      const m = await gh(`/orgs/${ORG}/memberships/${encodeURIComponent(login)}`);
      if (m.status === 200) return "already";
      const u = await gh(`/users/${encodeURIComponent(login)}`);
      if (!u.ok) return `error:user ${u.status}`;
      const r = await gh(`/orgs/${ORG}/invitations`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invitee_id: (await u.json()).id, role: "direct_member" }) });
      return r.status === 201 ? "invited" : r.status === 422 ? "already" : `error:${r.status}`;
    },
    // Take a login out of the members' org (or cancel its invite). Never an org admin; with check, never a login that
    // is still on any membership (so a member can only ever remove the account they just moved away from).
    leave: async (login: string, opt: { check: boolean }) => {
      if (!INVITE || !login) return "skipped";
      if (opt.check && (await deps.store.loginTaken(login))) return "kept";
      const m = await gh(`/orgs/${ORG}/memberships/${encodeURIComponent(login)}`);
      if (m.status === 404) return "none";
      if (!m.ok) return `error:${m.status}`;
      if ((await m.json()).role === "admin") return "admin";
      const r = await gh(`/orgs/${ORG}/memberships/${encodeURIComponent(login)}`, { method: "DELETE" });
      return r.status === 204 ? "removed" : `error:${r.status}`;
    },
  },
};

async function signedIn(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!/^Bearer [A-Za-z0-9._-]{20,}$/.test(auth)) return null;
  const r = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: SRK, Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  return u && u.id ? { id: String(u.id), email: String(u.email || "") } : null;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const headers = { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.has("cancel")) {
    const r: any = await handle({ action: "cancel-link", token: url.searchParams.get("cancel") }, deps);
    return new Response(null, { status: 303, headers: { Location: r.location!, "Cache-Control": "no-store" } });
  }
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, error: "POST only" }), { status: 405, headers });
  let body: any = {};
  try { body = await req.json(); } catch { /* fall through */ }
  const action = String(body?.action || "");
  if (action !== "purge") {
    if (!origin || !ALLOWED.has(origin)) return new Response(JSON.stringify({ ok: false, error: "Use the members area at myrobotisa.com/members" }), { status: 403, headers });
    body.user = await signedIn(req);
  }
  try {
    const r: any = await handle({ ...body, action, user: action === "purge" ? null : body.user }, deps);
    return new Response(JSON.stringify(r.body), { status: r.status, headers });
  } catch (e) {
    console.error("member-account", action, String(e).slice(0, 200));
    return new Response(JSON.stringify({ ok: false, error: "Something went wrong on our side. Nothing has changed: try again in a minute." }), { status: 500, headers });
  }
});
