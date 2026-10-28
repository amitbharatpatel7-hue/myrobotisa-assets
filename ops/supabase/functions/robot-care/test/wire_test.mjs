// Wire test (28 Oct 2026): the real GitHub and Supabase clients against a fake fetch, checking the exact requests the
// Accept fix path sends. node ops/supabase/functions/robot-care/test/wire_test.mjs
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { githubApp, supabaseStore } from "../clients.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" });   // GitHub's format
const seen = [];
const res = (status, body, headers = {}) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const fakeGH = async (url, init = {}) => {
  seen.push({ url, method: init.method || "GET", auth: init.headers?.Authorization, body: init.body ? JSON.parse(init.body) : null });
  if (url.endsWith("/access_tokens")) return res(201, { token: "ghs_test", expires_at: new Date(Date.now() + 36e5).toISOString(), permissions: { pull_requests: "write", contents: "write", checks: "read" } });
  if (url.endsWith("/pulls/4/merge")) return init.body && JSON.parse(init.body).sha === "deadbeef" ? res(200, { merged: true, sha: "m1" }) : res(409, { message: "Head branch was modified" });
  if (url.endsWith("/pulls/4")) return res(200, { number: 4, state: "open" });
  if (url.endsWith("/pulls/5")) return res(404, { message: "Not Found" });
  if (url.includes("/check-runs")) return res(200, { check_runs: [] });
  if (url.endsWith("/status")) return res(200, { state: "pending", statuses: [] });
  if (url.endsWith("/app")) return res(200, { slug: "my-robot-i-s-a-robot-care", permissions: { pull_requests: "write" }, events: ["issues"] });
  return res(404, {});
};
const gh = githubApp({ appId: "123", privateKey: pem, fetchImpl: fakeGH });
const g = gh(4242);
assert.equal((await g.pull("a/b", 4)).state, "open");
assert.equal(await g.pull("a/b", 5), null, "a missing PR is null, not a crash");
const c = await g.checks("a/b", "deadbeef");
assert.ok(seen.some((s) => s.url === "https://api.github.com/repos/a/b/commits/deadbeef/check-runs?per_page=100"));
assert.equal(c.combined.state, "pending");
const ok = await g.merge("a/b", 4, "deadbeef", "Fix (#4)");
assert.deepEqual(ok, { ok: true, status: 200, sha: "m1" });
const m = seen.find((s) => s.url.endsWith("/pulls/4/merge"));
assert.equal(m.method, "PUT"); assert.deepEqual(m.body, { sha: "deadbeef", merge_method: "squash", commit_title: "Fix (#4)" });
assert.equal(m.auth, "token ghs_test", "merges with the installation token");
assert.deepEqual(await g.merge("a/b", 4, "other", "x"), { ok: false, status: 409 });
assert.equal(seen.filter((s) => s.url.endsWith("/access_tokens")).length, 1, "installation token cached");
assert.equal((await g.permissions()).pull_requests, "write");
const info = await gh.appInfo(); assert.equal(info.slug, "my-robot-i-s-a-robot-care");
assert.match(seen.find((s) => s.url.endsWith("/app")).auth, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/, "app JWT");

// Supabase store
const sb = [];
const fakeSB = async (url, init = {}) => {
  sb.push({ url: decodeURIComponent(url), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null, prefer: init.headers?.Prefer });
  if (url.includes("members?select=user_id")) return res(200, [{ user_id: "u1" }]);
  if (url.includes("robot_care_installs")) return res(200, [{ installation: 77, action: "created" }]);
  if (url.includes("robot_care_requests?select")) return res(200, [], { "content-range": "0-0/3" });
  return res(201, null);
};
const st = supabaseStore({ url: "https://x.supabase.co", serviceKey: "k", fetchImpl: fakeSB });
assert.equal(await st.notice("Alice-GH", { title: "Fixed", body: "Fixed. Your robot uses it from its next run." }), true);
const ins = sb.find((s) => s.url.endsWith("/member_notices"));
assert.deepEqual(ins.body, { user_id: "u1", kind: "action", audience: "all", title: "Fixed", body: "Fixed. Your robot uses it from its next run.", link_url: "#fixes", link_text: "See the fix" });
assert.equal(await st.installation("Alice-GH"), 77);
assert.equal(await st.requests("u1", 36e5, "accept,decline"), 3);
assert.ok(sb.some((s) => s.url.includes("kind=in.(accept,decline)")));
assert.equal(await st.run("7; drop"), null, "ids must be numbers"); assert.equal(await st.memberByUser("not-a-uuid"), null);
await st.setState(7, "accepted");
const p = sb.find((s) => s.method === "PATCH"); assert.ok(p.url.endsWith("robot_care_runs?id=eq.7")); assert.equal(p.body.fix_state, "accepted"); assert.ok(p.body.decided_at);
console.log("wire_test: all requests as expected");
