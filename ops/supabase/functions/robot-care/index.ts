// robot-care: the Robot Care GitHub App's webhook (Supabase edge function, 24 Oct 2026). verify_jwt is off because
// GitHub signs its webhooks itself (X-Hub-Signature-256); handle() rejects anything unsigned.
// Secrets: ROBOT_CARE_WEBHOOK_SECRET, ROBOT_CARE_APP_ID, ROBOT_CARE_PRIVATE_KEY (the App's PEM), ANTHROPIC_API_KEY.
// 28 Oct 2026: GET returns the App's public facts (its slug and the permissions it was granted), so a session can check
// that Accept fix will work without anyone opening the App's settings. No secrets, no member data.
import { handle } from "./handler.js";
import { githubApp, anthropic, supabaseStore } from "./clients.js";

const env = (k: string) => (Deno.env.get(k) || "").trim();
const NEEDED = ["ROBOT_CARE_WEBHOOK_SECRET", "ROBOT_CARE_APP_ID", "ROBOT_CARE_PRIVATE_KEY", "ANTHROPIC_API_KEY"];
const store = supabaseStore({ url: env("SUPABASE_URL"), serviceKey: env("SUPABASE_SERVICE_ROLE_KEY") });
const gh = githubApp({ appId: env("ROBOT_CARE_APP_ID"), privateKey: (Deno.env.get("ROBOT_CARE_PRIVATE_KEY") || "").replace(/\\n/g, "\n") });
const deps = { secret: env("ROBOT_CARE_WEBHOOK_SECRET"), gh, claude: anthropic({ apiKey: env("ANTHROPIC_API_KEY") }), store, members: store.members };
let info: { at: number; body: unknown } | null = null;

Deno.serve(async (req: Request) => {
  // names only, never values
  const missing = NEEDED.filter((k) => !env(k));
  if (req.method === "GET") {
    if (missing.length) return Response.json({ ok: false, missing }, { status: 503 });
    try {
      if (!info || Date.now() - info.at > 6e5) info = { at: Date.now(), body: { ok: true, ...(await gh.appInfo()) } };
      return Response.json(info.body, { headers: { "Cache-Control": "no-store" } });
    } catch (e) { return Response.json({ ok: false, error: String((e as Error)?.message || e).slice(0, 80) }, { status: 502 }); }
  }
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (missing.length) return new Response("not configured: " + missing.join(", "), { status: 503 });
  const raw = await req.text();
  const { response, work } = await handle({ name: req.headers.get("x-github-event") || "", raw,
    sig: req.headers.get("x-hub-signature-256") || "", delivery: req.headers.get("x-github-delivery") || "" }, deps);
  // @ts-ignore EdgeRuntime is provided by Supabase
  if (work) (globalThis.EdgeRuntime?.waitUntil ? EdgeRuntime.waitUntil(work) : work.catch(() => {}));
  return new Response(JSON.stringify(response.body), { status: response.status, headers: { "Content-Type": "application/json" } });
});
