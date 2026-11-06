// test-drive (6 Nov 2026, hub D41): serves the free test drive at myrobotisa.com/drive/?t=<link>. Logic in core.js.
// verify_jwt is OFF: visitors have no account, so the link's own token (a random UUID, one per person) is the key.
// The tables are service-role only (2026-11-06-test-drive.sql). No secrets beyond the built-in service role key.
import { handle } from "./core.js";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOWED = new Set(["https://myrobotisa.com", "https://www.myrobotisa.com"]);
const cors = (o: string | null) => ({
  "Access-Control-Allow-Origin": o && (ALLOWED.has(o) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)) ? o : "https://myrobotisa.com",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Vary": "Origin",
});
const rest = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { apikey: SRK, Authorization: `Bearer ${SRK}`,
    "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${path.split("?")[0]} ${r.status}`);
  return r.status === 204 ? null : r.json();
};

const store = {
  get: async (t: string) => (await rest(`test_drive?token=eq.${t}&select=kind,started_at,done`))[0] || null,
  start: (t: string, iso: string) => rest(`test_drive?token=eq.${t}&started_at=is.null`, { method: "PATCH", body: JSON.stringify({ started_at: iso, last_seen: iso }) }),
  done: async (t: string, day: number) => (await rest("rpc/test_drive_done", { method: "POST", body: JSON.stringify({ p_token: t, p_day: day }) })) || [],
  reset: (t: string) => rest(`test_drive?token=eq.${t}`, { method: "PATCH", body: JSON.stringify({ started_at: null, done: [] }) }),
  days: async (n: number) => n ? (await rest(`test_drive_days?day=lte.${n}&select=day,data&order=day`)).map((r: any) => r.data) : [],
  reveals: async (ds: number[]) => ds.length ? (await rest(`test_drive_days?day=in.(${ds.join(",")})&select=day,reveal&order=day`)).map((r: any) => r.reveal) : [],
};

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { headers: h });
  try {
    const u = new URL(req.url);
    let q: Record<string, unknown> = Object.fromEntries(u.searchParams);
    if (req.method === "POST") q = { ...q, ...(await req.json().catch(() => ({}))) };
    const r = await handle({ method: req.method, ...q }, store);
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { ...h, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("test-drive", String(e));
    return new Response(JSON.stringify({ error: "Something went wrong on our side. Try again in a minute." }), { status: 500, headers: { ...h, "Content-Type": "application/json" } });
  }
});
