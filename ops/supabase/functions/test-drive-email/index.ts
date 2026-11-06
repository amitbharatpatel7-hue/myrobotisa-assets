// test-drive-email (6 Nov 2026, hub D41): the 7 December "your test drive is open" email, one per person, each with
// their own link (email.js, from ops/build_test_drive_email.py). NOT DEPLOYED until Amit says "send" for this email.
// POST { action: "preview" } sends it to the signed-in owner only, with a preview link. POST { action: "send" } makes
// a link for everyone on the list who asked for the test drive (test_drive_issue()), then emails each person not yet
// emailed, stamping test_drive.emailed_at so a re-run never sends twice. Only the owner, signed in, from myrobotisa.com.
// Secrets: RESEND_API_KEY (service role key is built in).
import { buildOpen } from "./email.js";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND = Deno.env.get("RESEND_API_KEY");
const DRIVE = "https://myrobotisa.com/drive/?t=";
const UNSUB_PAGE = "https://myrobotisa.com/unsubscribe/?t=";
const UNSUB_API = `${URL_}/functions/v1/waitlist-unsubscribe?t=`;
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
async function mail(to: string, link: string, unsubToken: string | null, key: string) {
  const unsub = unsubToken ? UNSUB_PAGE + unsubToken : "https://myrobotisa.com/unsubscribe/";
  const { subject, html, text } = buildOpen(link, unsub);
  const r = await fetch("https://api.resend.com/emails", { method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify({ from: "My Robot I.S.A. <hello@myrobotisa.com>", to: [to], reply_to: "hello@myrobotisa.com", subject, html, text,
      headers: unsubToken ? { "List-Unsubscribe": `<${UNSUB_API}${unsubToken}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined,
      tags: [{ name: "kind", value: "test_drive_open" }] }) });
  return r.ok;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return reply(origin, 405, { error: "POST only" });
  if (!origin || !ALLOWED.has(origin)) return reply(origin, 403, { error: "Use the members area at myrobotisa.com/members" });
  if (!RESEND) return reply(origin, 503, { error: "Email isn't set up." });
  const uid = sub(req.headers.get("authorization") || "");
  if (!uid || !/^[0-9a-f-]{36}$/i.test(uid)) return reply(origin, 401, { error: "Sign in again." });
  const own = (await (await db(`members?select=id,email&user_id=eq.${uid}&plan=eq.owner&status=eq.active&limit=1`)).json())[0];
  if (!own) return reply(origin, 403, { error: "Owner only." });
  let action = "";
  try { action = String((await req.json())?.action || ""); } catch { /* fall through */ }
  if (action === "preview") {
    const p = (await (await db("test_drive?select=token&kind=eq.preview&order=created_at&limit=1")).json())[0];
    if (!p) return reply(origin, 404, { error: "No preview link yet." });
    const ok = await mail(own.email, DRIVE + p.token, null, `test-drive-preview-${Date.now()}`);
    return reply(origin, ok ? 200 : 502, ok ? { ok: true, to: own.email } : { error: "The email didn't send." });
  }
  if (action !== "send") return reply(origin, 400, { error: "Say preview or send." });
  await db("rpc/test_drive_issue", { method: "POST", body: "{}" });
  const rows = await (await db("test_drive?select=token,waitlist:waitlist_id(email,unsub_token,unsubscribed_at)&kind=eq.member&emailed_at=is.null&waitlist_id=not.is.null&limit=500")).json();
  let sent = 0, failed = 0;
  for (const r of rows) {
    const w = r.waitlist; if (!w || w.unsubscribed_at) continue;
    // stamp first, so a crash part-way can only ever miss someone (shown in the count), never email them twice
    const claim = await db(`test_drive?token=eq.${r.token}&emailed_at=is.null`, { method: "PATCH", headers: { Prefer: "return=representation" },
      body: JSON.stringify({ emailed_at: new Date().toISOString() }) });
    if (!claim.ok || !(await claim.json()).length) continue;
    if (await mail(w.email, DRIVE + r.token, w.unsub_token, `test-drive-open-${r.token}`)) sent++;
    else { failed++; await db(`test_drive?token=eq.${r.token}`, { method: "PATCH", body: JSON.stringify({ emailed_at: null }) }); }
  }
  return reply(origin, 200, { ok: true, sent, failed, remaining: rows.length >= 500 ? "run again" : 0 });
});
