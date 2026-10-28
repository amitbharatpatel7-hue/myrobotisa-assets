// lesson-upload (28 Oct 2026): one-off copy of the 20 lesson videos from the public repo into the private R2 bucket.
// Run once before the videos are removed from the repo, then retired. It only ever copies this fixed list, from one
// fixed commit, into one bucket, and skips anything already there, so calling it again (or by someone else) does
// nothing new. GET -> starts the copy in the background and answers with the current state; GET again to watch it.
// Secrets: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY (needs Object Read & Write on the bucket).
import { AwsClient } from "npm:aws4fetch@1.0.20";

const BUCKET = "myrobotisa-lessons";
const SRC = "https://raw.githubusercontent.com/amitbharatpatel7-hue/myrobotisa-assets/d066bbee41eb7638d176b8902d05af3845f07eb2/docs/members/video-7b085e8e0a/";
const SLUGS = ["qs-01-copy-the-code", "qs-02-broker-key", "qs-03-email-key", "qs-04-setup-check", "qs-05-optional-extras", "qs-06-your-app",
  "day-01-rules-not-tips", "day-02-get-it-running", "day-03-data-you-can-trust", "day-04-make-it-yours", "day-05-backtest-honestly",
  "day-06-paper-money-first", "day-07-the-plumbing", "day-08-done-means-it-happened", "day-09-make-it-explain-itself",
  "day-10-keys-and-secrets", "day-11-it-runs-while-you-sleep", "day-12-limits-and-an-off-switch", "day-13-small-and-real",
  "day-14-keep-an-honest-record"];
const env = (k: string) => (Deno.env.get(k) || "").trim();
let running: Promise<void> | null = null;
const log: Record<string, string> = {};

function client() {
  return new AwsClient({ accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY"), service: "s3", region: "auto" });
}
const objUrl = (slug: string) => `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com/${BUCKET}/lessons/${slug}.mp4`;

async function state() {
  const aws = client(), out: Record<string, number | string> = {};
  for (const s of SLUGS) {
    const h = await aws.fetch(objUrl(s), { method: "HEAD" }).catch(() => null);
    out[s] = h && h.ok ? Number(h.headers.get("content-length")) : (log[s] || "missing");
  }
  return out;
}

async function copyAll() {
  const aws = client();
  for (const s of SLUGS) {
    try {
      const h = await aws.fetch(objUrl(s), { method: "HEAD" });
      if (h.ok) { log[s] = "already there"; continue; }
      log[s] = "copying";
      const src = await fetch(SRC + s + ".mp4");
      if (!src.ok) { log[s] = `source ${src.status}`; continue; }
      const body = new Uint8Array(await src.arrayBuffer());
      const put = await aws.fetch(objUrl(s), { method: "PUT", body, headers: { "Content-Type": "video/mp4", "Cache-Control": "private, max-age=7200" } });
      log[s] = put.ok ? `copied ${body.length}` : `put ${put.status}: ${(await put.text()).slice(0, 120)}`;
    } catch (e) { log[s] = "error " + String((e as Error).message || e).slice(0, 120); }
  }
}

Deno.serve(async (req) => {
  if (req.method !== "GET") return new Response("GET only", { status: 405 });
  if (!env("R2_ACCOUNT_ID") || !env("R2_ACCESS_KEY_ID") || !env("R2_SECRET_ACCESS_KEY")) {
    return new Response(JSON.stringify({ error: "R2 secrets not set" }), { status: 503, headers: { "Content-Type": "application/json" } });
  }
  if (!running) {
    running = copyAll().finally(() => { running = null; });
    // @ts-ignore EdgeRuntime is provided by Supabase
    if (globalThis.EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(running);
  }
  return new Response(JSON.stringify({ copying: !!running, files: await state() }, null, 1),
    { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
});
