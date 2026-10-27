// email-review (24 Oct 2026): sends Amit a review copy of every email a subscriber or member can receive.
// The recipient and sender are fixed here, and it only sends pages from the unlisted review folder on the site,
// so calling it can only ever email Amit. Secret: RESEND_API_KEY (shared with waitlist-welcome).
// 27 Oct 2026 (security review): verify_jwt accepts any valid project key, so anyone holding one could call this
// without limit. Each send is now logged in public.email_review_sends (service role only) and it stops at
// DAILY_CAP a rolling day. A batch of the whole folder (23) still fits twice.
const RESEND = Deno.env.get("RESEND_API_KEY");
const URL_ = Deno.env.get("SUPABASE_URL") || "";
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TO = "amit.bharat.patel7@gmail.com";
const FROM = "My Robot I.S.A. <hello@myrobotisa.com>";
const BASE = "https://myrobotisa.com/email-review-3f9c/";
const DAILY_CAP = 60;
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const db = (path: string, init: RequestInit = {}) => fetch(`${URL_}/rest/v1/${path}`, { ...init,
  headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", ...(init.headers || {}) } });

async function sentToday(): Promise<number | null> {
  const since = new Date(Date.now() - 864e5).toISOString();
  const r = await db(`email_review_sends?select=id&at=gte.${encodeURIComponent(since)}`, { headers: { Prefer: "count=exact", Range: "0-0" } });
  if (!r.ok) return null;
  return Number((r.headers.get("content-range") || "/0").split("/")[1]) || 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (!RESEND) return json(503, { error: "RESEND_API_KEY not set" });
  let items: { file: string; subject: string }[] = [];
  try { items = (await req.json()).items || []; } catch { return json(400, { error: "bad body" }); }
  if (!Array.isArray(items) || items.length < 1 || items.length > 30) return json(400, { error: "1 to 30 items" });
  const used = await sentToday();
  if (used === null) return json(503, { error: "send log unavailable; nothing sent" });   // fail closed
  if (used + items.length > DAILY_CAP) return json(429, { error: `daily cap: ${used} of ${DAILY_CAP} sent in the last 24 hours` });
  const out: unknown[] = [];
  for (let i = 0; i < items.length; i++) {
    const { file, subject } = items[i];
    if (!/^[0-9a-z-]+\.html$/.test(file || "")) { out.push({ file, error: "bad name" }); continue; }
    const page = await fetch(BASE + file);
    if (!page.ok) { out.push({ file, error: `fetch ${page.status}` }); continue; }
    const html = await page.text();
    const subj = `[Review ${i + 1} of ${items.length}] ${String(subject || file).slice(0, 150)}`;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json", "Idempotency-Key": `email-review-${file}-${new Date().toISOString().slice(0, 13)}` },
      body: JSON.stringify({ from: FROM, to: [TO], reply_to: "hello@myrobotisa.com", subject: subj, html,
        text: `Review copy of ${file}. Example data only.`, tags: [{ name: "kind", value: "email_review" }] }),
    });
    if (r.ok) await db("email_review_sends", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ file }) });
    out.push({ file, status: r.status });
    await new Promise((res) => setTimeout(res, 250));
  }
  return json(200, { sent: out.filter((o: any) => o.status === 200).length, results: out });
});
