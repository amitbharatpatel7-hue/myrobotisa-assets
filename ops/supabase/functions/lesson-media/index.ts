// lesson-media (28 Oct 2026): short-lived links to the lesson videos for signed-in members.
//
// The 20 lesson videos used to sit in the public website repo, so anyone could download them. They now live in the
// private Cloudflare R2 bucket myrobotisa-lessons (key lessons/<slug>.mp4). The members page asks this function for
// one video at a time and gets a presigned link that works for LINK_SECONDS, so a copied link soon stops working.
//
// GET ?v=<guide id>  (qs-1 … qs-6, day-1 … day-14)  ->  { url, expires_at }  or  { error }
// Who may watch: the same rule as the page. An active member whose row has preview_videos on, or the owner. When the
// lessons open to every member (January 2027), change canWatch() here and the page's me.preview_videos checks together.
// verify_jwt is on; the member is looked up by the token's subject with the service role, so an anon key gets 404.
// Secrets: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (an R2 token limited to this bucket, read only is enough).
import { AwsClient } from "npm:aws4fetch@1.0.20";

const BUCKET = "myrobotisa-lessons";
const LINK_SECONDS = 2 * 60 * 60;
const VIDEOS: Record<string, string> = {
  "qs-1": "qs-01-copy-the-code", "qs-2": "qs-02-broker-key", "qs-3": "qs-03-email-key", "qs-4": "qs-04-setup-check",
  "qs-5": "qs-05-optional-extras", "qs-6": "qs-06-your-app",
  "day-1": "day-01-rules-not-tips", "day-2": "day-02-get-it-running", "day-3": "day-03-data-you-can-trust",
  "day-4": "day-04-make-it-yours", "day-5": "day-05-backtest-honestly", "day-6": "day-06-paper-money-first",
  "day-7": "day-07-the-plumbing", "day-8": "day-08-done-means-it-happened", "day-9": "day-09-make-it-explain-itself",
  "day-10": "day-10-keys-and-secrets", "day-11": "day-11-it-runs-while-you-sleep", "day-12": "day-12-limits-and-an-off-switch",
  "day-13": "day-13-small-and-real", "day-14": "day-14-keep-an-honest-record",
};
const ALLOWED = new Set(["https://myrobotisa.com", "https://www.myrobotisa.com"]);
const env = (k: string) => (Deno.env.get(k) || "").trim();
const URL_ = env("SUPABASE_URL"), SRK = env("SUPABASE_SERVICE_ROLE_KEY");

const cors = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED.has(origin) ? origin : "https://myrobotisa.com",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Vary": "Origin",
});
const reply = (origin: string | null, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" } });

export function subFromJwt(auth: string): string | null {
  // verify_jwt is on, so the platform has already checked the signature; we only read the subject.
  try { return JSON.parse(atob(auth.replace(/^Bearer /, "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub || null; } catch { return null; }
}

export function canWatch(m: { status?: string; plan?: string; preview_videos?: boolean } | null): boolean {
  if (!m || !["active", "lapsed"].includes(m.status || "")) return false;
  return m.plan === "owner" || m.preview_videos === true;
}

export async function presign(accountId: string, keyId: string, secret: string, key: string, seconds: number) {
  const aws = new AwsClient({ accessKeyId: keyId, secretAccessKey: secret, service: "s3", region: "auto" });
  const u = new URL(`https://${accountId}.r2.cloudflarestorage.com/${BUCKET}/${key}`);
  u.searchParams.set("X-Amz-Expires", String(seconds));
  const signed = await aws.sign(new Request(u, { method: "GET" }), { aws: { signQuery: true } });
  return signed.url;
}

if (import.meta.main) Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "GET") return reply(origin, 405, { error: "GET only" });
  if (!origin || !ALLOWED.has(origin)) return reply(origin, 403, { error: "Watch the lessons at myrobotisa.com/members" });
  const slug = VIDEOS[new URL(req.url).searchParams.get("v") || ""];
  if (!slug) return reply(origin, 404, { error: "No such lesson video." });
  const acct = env("R2_ACCOUNT_ID"), kid = env("R2_ACCESS_KEY_ID"), sec = env("R2_SECRET_ACCESS_KEY");
  if (!acct || !kid || !sec) return reply(origin, 503, { error: "Lesson videos aren't switched on yet." });

  const sub = subFromJwt(req.headers.get("authorization") || "");
  if (!sub || !/^[0-9a-f-]{36}$/i.test(sub)) return reply(origin, 401, { error: "Sign in to watch the lessons." });
  const r = await fetch(`${URL_}/rest/v1/members?select=status,plan,preview_videos&user_id=eq.${sub}&limit=1`,
    { headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } });
  const m = r.ok ? (await r.json())[0] || null : null;
  if (!canWatch(m)) return reply(origin, 403, { error: "The lesson videos open to members in January 2027." });

  const url = await presign(acct, kid, sec, `lessons/${slug}.mp4`, LINK_SECONDS);
  return reply(origin, 200, { url, expires_at: new Date(Date.now() + LINK_SECONDS * 1000).toISOString() });
});
