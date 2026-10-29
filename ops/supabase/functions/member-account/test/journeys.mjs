// 100 simulated members using Help and membership (29 Oct 2026, D28; Amit: "run 100 simulations to ensure the UX
// journey is as pain free as possible"). Each one is a real Chromium session on the real members page, served as
// https://myrobotisa.com/members/, with the real member-account logic and SQL behind it (emulator.mjs). Members are
// generated from 24 journeys, on desktop and phone, with human noise: codes pasted with a space, addresses typed in
// capitals with stray spaces, Enter instead of a click, the wrong GitHub account still signed in.
// For every journey it records whether the member reached their goal, how many actions it took, every error they
// saw and whether that error told them what to do next. Exits 1 on any dead end, page error or unclear error.
//   PG_MODULE_DIR=<dir with node_modules/pg> node ops/supabase/functions/member-account/test/journeys.mjs [count] [seed]
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildDb, makeWorld } from "./emulator.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.resolve(HERE, "../../../../../docs");
const SB = "https://vxnestmhtjotidhzzqbo.supabase.co";
const SITE = "https://myrobotisa.com";
const TEMPLATE = "amitbharatpatel7-hue/my-robot-isa-template";
const COUNT = Number(process.argv[2] || 100), SEED = Number(process.argv[3] || 29102026);
const OUT = process.env.SIM_OUT || path.join(HERE, "out");
fs.mkdirSync(OUT, { recursive: true });

// ---- deterministic randomness
let s = SEED >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rnd() * a.length)];

buildDb();
const W = makeWorld(); W.fnBase = SB;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".css": "text/css" };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64({ alg: "HS256" })}.${b64({ sub, exp: 4102444800 })}.sig`;
const subOf = (h) => { try { return JSON.parse(Buffer.from(String(h).replace(/^Bearer /, "").split(".")[1], "base64url").toString()).sub; } catch { return null; } };
const COLS = /^[a-z_,]+$/;

// An actionable error tells the member what to do next.
const NEXT = /(press|try again|check|use |wait|email hello@|type |finish|sign out|sign in|copy|start again|fix|paste|connect|open)/i;

async function setupPage(browser, sim) {
  const ctx = await browser.newContext({ viewport: sim.device === "phone" ? { width: 390, height: 844 } : { width: 1280, height: 860 },
    isMobile: sim.device === "phone", hasTouch: sim.device === "phone", acceptDownloads: true });
  const page = await ctx.newPage();
  sim.pageErrors = []; sim.errorsSeen = []; sim.steps = 0;
  page.on("pageerror", (e) => sim.pageErrors.push((String(e) + " @ " + String(e.stack || "").split("\n").slice(1, 3).join(" ")).slice(0, 400)));
  await ctx.addInitScript(([store, sess]) => {
    try { if (!sessionStorage.getItem("sim-init")) { localStorage.setItem(store, JSON.stringify(sess)); sessionStorage.setItem("sim-init", "1"); } } catch (e) {}
    const st = window.setTimeout; window.setTimeout = (f, ms, ...a) => st(f, Math.min(Number(ms) || 0, 25), ...a);   // the robot's waits, fast-forwarded
    let seal; Object.defineProperty(window, "mriSeal", { configurable: true, get: () => seal ? (k, v) => "SIM:" + btoa(v) : undefined, set: (f) => { seal = f; } });
  }, ["mri-members-session", { access_token: jwt(sim.m.uid), refresh_token: "r", expires_at: 4102444800, email: sim.m.email }]);

  await ctx.route(SITE + "/**", async (route) => {
    const u = new URL(route.request().url());
    let p = decodeURIComponent(u.pathname); if (p.endsWith("/")) p += "index.html";
    const f = path.join(DOCS, p);
    if (!f.startsWith(DOCS) || !fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
    return route.fulfill({ status: 200, contentType: MIME[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) });
  });
  await ctx.route("https://fonts.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await ctx.route("https://fonts.gstatic.com/**", (r) => r.fulfill({ status: 404, body: "" }));

  await ctx.route(SB + "/**", async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, uid = subOf(req.headers()["authorization"]);
    const json = (o, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": SITE }, body: JSON.stringify(o) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": SITE, "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    const alive = uid && (await W.one("select 1 from auth.users where id=$1", [uid]));
    try {
      if (p === "/functions/v1/member-account") {
        if (req.method() === "GET") { const r = await W.call({ action: "cancel-link", token: u.searchParams.get("cancel") }); return route.fulfill({ status: 303, headers: { location: r.location } }); }
        const body = JSON.parse(req.postData() || "{}");
        const user = body.action === "purge" ? null : (alive ? { id: uid, email: "" } : null);
        const r = await W.call({ ...body, user }); return json(r.body, r.status);
      }
      if (p.startsWith("/rest/v1/") && !alive) return json({ message: "JWT expired", code: "PGRST301" }, 401);
      if (p === "/rest/v1/members") {
        const cols = u.searchParams.get("select"); assert.match(cols, COLS);
        return json(await W.asUser(uid, `select ${cols} from members where user_id = $1`, [uid]));
      }
      if (p === "/rest/v1/member_progress") return json(await W.asUser(uid, "select item, done from member_progress"));
      if (p === "/rest/v1/rpc/my_account") return json((await W.asUser(uid, "select my_account() j"))[0].j);
      if (p === "/rest/v1/rpc/my_data_export") return json((await W.asUser(uid, "select my_data_export() j"))[0].j);
      if (p === "/functions/v1/github-oauth") {
        if (req.method() === "GET") return json({ configured: true, client_id: "sim-client" });
        const { code } = JSON.parse(req.postData() || "{}"), tok = sim.codes[code], login = W.tokens.get(tok);
        if (!login) return json({ error: "That GitHub sign-in expired. Press Connect GitHub again." }, 400);
        const l = await W.oauthLink(uid, login);
        return json({ access_token: tok, scope: "repo,workflow", login, link: l.link, saved: l.saved, invite: "already" });
      }
      if (p === "/functions/v1/robot-care-join") return json({ login: null, robot_care: false, eligible: false, installed: false });
      if (p.startsWith("/rest/v1/")) return json(req.method() === "GET" ? [] : [], req.method() === "GET" ? 200 : 201);
      return json({});
    } catch (e) { sim.notes.push("emulator: " + String(e).slice(0, 160)); return json({ message: String(e) }, 500); }
  });

  // GitHub: OAuth returns whichever account is signed in on github.com right now (sim.ghSignedIn).
  await ctx.route("https://github.com/login/oauth/authorize**", (route) => {
    const u = new URL(route.request().url()), code = "c" + Math.random().toString(36).slice(2);
    sim.codes[code] = sim.ghSignedIn;
    return route.fulfill({ status: 302, headers: { location: `${SITE}/members/?code=${code}&state=${u.searchParams.get("state")}` } });
  });
  await ctx.route("https://api.github.com/**", async (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, m = req.method();
    const login = W.tokens.get(String(req.headers()["authorization"] || "").replace(/^Bearer /, ""));
    const json = (o, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": SITE }, body: o === null ? "" : JSON.stringify(o) });
    if (m === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": SITE, "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (!login) return json({ message: "Bad credentials" }, 401);
    if (p === "/user") return json({ login, id: 1000 + login.length });
    const r = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(p);
    if (!r) return json({ message: "Not Found" }, 404);
    const full = `${r[1]}/${r[2]}`, repo = W.repos.get(full.toLowerCase()), rest = r[3] || "";
    if (!repo || r[1].toLowerCase() !== login.toLowerCase()) return json({ message: "Not Found" }, 404);
    if (!rest) return json({ full_name: repo.full, id: 77, template_repository: { full_name: TEMPLATE } });
    let v = /^\/actions\/variables\/([A-Z_]+)$/.exec(rest);
    if (v && m === "GET") return repo.vars[v[1]] === undefined ? json({ message: "Not Found" }, 404) : json({ name: v[1], value: repo.vars[v[1]] });
    if (v && m === "PATCH") { if (repo.vars[v[1]] === undefined) return json({ message: "Not Found" }, 404); repo.vars[v[1]] = JSON.parse(req.postData()).value; return json(null, 204); }
    if (rest === "/actions/variables" && m === "POST") { const b = JSON.parse(req.postData()); if (repo.vars[b.name] !== undefined) return json({}, 409); repo.vars[b.name] = b.value; return json(null, 201); }
    if (rest === "/actions/secrets/public-key") return json({ key: "c2ltLWtleQ==", key_id: "1" });
    v = /^\/actions\/secrets\/([A-Z_]+)$/.exec(rest);
    if (v && m === "PUT") { const enc = JSON.parse(req.postData()).encrypted_value; repo.secrets[v[1]] = Buffer.from(String(enc).replace(/^SIM:/, ""), "base64").toString(); return json(null, 204); }
    v = /^\/actions\/workflows\/([a-z-]+\.yml)\/(dispatches|runs)$/.exec(rest);
    if (v && v[2] === "dispatches") { const run = W.runWorkflow(full, v[1]); return run === "missing" ? json({ message: "Not Found" }, 404) : json(null, 204); }
    if (v && v[2] === "runs") { const runs = repo.runs.filter((x) => x.wf === v[1]).slice().reverse(); return json({ workflow_runs: runs.slice(0, 1) }); }
    return json({ message: "Not Found" }, 404);
  });
  return { ctx, page };
}

// ---- what a member does
const act = async (sim, f) => { sim.steps++; await f(); await sim.page.waitForTimeout(40); await noteErrors(sim); };
async function noteErrors(sim) {
  const errs = await sim.page.$$eval(".ac .msg.err, #v-signin .msg.err", (els) => els.filter((e) => e.offsetParent && e.textContent.trim()).map((e) => e.textContent.trim()));
  const bad = await sim.page.$$eval("#ac-rb-log li.bad span", (els) => els.map((e) => e.textContent.trim()));
  for (const e of errs.concat(bad)) if (!sim.errorsSeen.includes(e)) sim.errorsSeen.push(e);
}
async function phoneFits(sim) {
  if (sim.device !== "phone") return;
  const over = await sim.page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  if (over) sim.notes.push("PHONE: page scrolls sideways");
}
const open = async (sim, hash = "help") => { await sim.page.goto(`${SITE}/members/#${hash}`); await sim.page.waitForFunction(() => document.getElementById("ac-email") && document.getElementById("ac-email").textContent.length > 3); await phoneFits(sim); };
// SIM_SHOTS=1: a picture of the account section at each key moment, once per journey and device
const shot = async (sim, name) => { if (!process.env.SIM_SHOTS || SHOTS.has(name + sim.device)) return; SHOTS.add(name + sim.device);
  try { await sim.page.locator("#ac").screenshot({ path: path.join(OUT, `ui-${name}-${sim.device}.png`) }); } catch {} };
const SHOTS = new Set();
const messy = (sim, email) => sim.noise ? "  " + email.replace(/^./, (c) => c.toUpperCase()) + " " : email;
const spaced = (sim, code) => sim.noise ? code.slice(0, 3) + " " + code.slice(3) : code;
const click = (sim, sel) => act(sim, () => sim.page.click(sel));
const fill = (sim, sel, v) => act(sim, () => sim.page.fill(sel, v));
const waitText = (sim, sel, re, ms = 15000) => sim.page.waitForFunction(([s, r]) => { const e = document.querySelector(s); return e && new RegExp(r, "i").test(e.textContent); }, [sel, re.source], { timeout: ms });
const sendBy = async (sim, inputSel, btnSel) => { if (sim.noise && inputSel) await act(sim, () => sim.page.press(inputSel, "Enter")); else await click(sim, btnSel); };

async function changeEmail(sim, to, { wrongFirst = false, expire = false, tooMany = false } = {}) {
  await click(sim, "#ac-email-edit");
  await fill(sim, "#ac-email-new", messy(sim, to));
  await sendBy(sim, "#ac-email-new", "#ac-email-send");
  await sim.page.waitForSelector("#ac-email-s2:not([hidden])");
  await shot(sim, "1-email-code");
  const focus = await sim.page.evaluate(() => document.activeElement && document.activeElement.id);
  if (focus !== "ac-email-code") sim.notes.push("focus not on the code box after sending");
  if (wrongFirst) { await fill(sim, "#ac-email-code", "111111"); await waitText(sim, "#ac-email-msg", /isn't right/); }
  if (tooMany) { for (let i = 0; i < 5; i++) { await fill(sim, "#ac-email-code", ""); await fill(sim, "#ac-email-code", "22222" + i); } await waitText(sim, "#ac-email-msg", /Too many/); await click(sim, "#ac-email-resend"); await waitText(sim, "#ac-email-msg", /Code sent/); }
  if (expire) { await W.timeTravel(sim.m.uid, "code-expired"); await fill(sim, "#ac-email-code", spaced(sim, W.lastCode(to))); await waitText(sim, "#ac-email-msg", /run out/); await click(sim, "#ac-email-resend"); await waitText(sim, "#ac-email-msg", /Code sent/); }
  await fill(sim, "#ac-email-code", "");
  await fill(sim, "#ac-email-code", spaced(sim, W.lastCode(to)));
  await sim.page.waitForSelector("#ac-email-done:not([hidden])", { timeout: 15000 });
  await shot(sim, "2-email-done");
  assert.equal((await sim.page.textContent("#ac-email")).trim(), to);
  assert.equal((await W.one("select email from members where user_id=$1", [sim.m.uid])).email, to);
  assert.equal((await W.one("select email from auth.users where id=$1", [sim.m.uid])).email, to);
  assert.equal(W.sent(sim.m.email, "account_email_changed").length, 1, "old address told");
  sim.m.newEmail = to;
}
async function connect(sim, fromSel) {   // leaves the page for GitHub and comes back
  await click(sim, fromSel);
  await sim.page.waitForURL(/#help$/, { timeout: 15000 });
  await sim.page.waitForFunction(() => document.getElementById("ac-email").textContent.length > 3);
}
async function showRobot(sim) {
  await connect(sim, "#ac-rb-go");
  await sim.page.waitForFunction(() => !document.getElementById("ac-rb-show").hidden || !document.getElementById("ac-rb-name").hidden, null, { timeout: 15000 });
}
async function moveRobot(sim, to, { resendDone = true, key = null } = {}) {
  await click(sim, "#ac-rb-edit");
  const pre = await sim.page.inputValue("#ac-rb-to");
  if (pre !== to) await fill(sim, "#ac-rb-to", messy(sim, to));
  const resendShown = await sim.page.isVisible("#ac-rb-resend");
  if (key) { await click(sim, "#ac-rb-alt summary"); await fill(sim, "#ac-rb-key", key); }
  else if (resendShown) await click(sim, "#ac-rb-c-r");
  await shot(sim, "3-robot-form");
  if (!(await sim.page.isEnabled("#ac-rb-move"))) throw new Error("Move button stayed disabled");
  await click(sim, "#ac-rb-move");
  await sim.page.waitForFunction(() => /All done|Some of it|one step left|Couldn.t reach/.test(document.getElementById("ac-rb-msg").textContent), null, { timeout: 30000 });
  await noteErrors(sim);
  const res = (await sim.page.textContent("#ac-rb-msg")).trim(); await shot(sim, /All done/.test(res) ? "4-robot-done" : "4-robot-problem"); return res;
}
async function requestDelete(sim, { wrongFirst = false } = {}) {
  await click(sim, "#ac-del");
  await sim.page.waitForSelector("#ac-del-box:not([hidden])");
  await click(sim, "#ac-del-send");
  await sim.page.waitForSelector("#ac-del-s2:not([hidden])");
  await shot(sim, "5-delete-confirm");
  if (wrongFirst) { await fill(sim, "#ac-del-code", "123123"); await click(sim, "#ac-del-ok"); await waitText(sim, "#ac-del-msg", /isn't right/); }
  await fill(sim, "#ac-del-code", spaced(sim, W.lastCode(sim.m.email, "account_delete_code")));
  await click(sim, "#ac-del-ok");
  await sim.page.waitForSelector("#ac-del-banner:not([hidden])", { timeout: 15000 });
  await shot(sim, "6-delete-banner");
  assert.match(await sim.page.textContent("#ac-del-on"), /^\w+day,? \d+ \w+$/);   // "Thursday 5 November"
}

// ---- the 24 journeys (weights add up to 100)
const J = {
  "email: change it": [10, {}, async (sim) => { await open(sim); await changeEmail(sim, "new-" + sim.m.email); }],
  "email: wrong code first": [5, {}, async (sim) => { await open(sim); await changeEmail(sim, "w-" + sim.m.email, { wrongFirst: true }); }],
  "email: code ran out, new code": [4, {}, async (sim) => { await open(sim); await changeEmail(sim, "e-" + sim.m.email, { expire: true }); }],
  "email: five wrong, new code": [3, {}, async (sim) => { await open(sim); await changeEmail(sim, "t-" + sim.m.email, { tooMany: true }); }],
  "email: address on another membership": [4, {}, async (sim) => {
    const other = await W.addMember(); await open(sim);
    await click(sim, "#ac-email-edit"); await fill(sim, "#ac-email-new", other.email); await click(sim, "#ac-email-send");
    await waitText(sim, "#ac-email-msg", /already used/); sim.expectedError = true; }],
  "email: types the same address": [3, {}, async (sim) => {
    await open(sim); await click(sim, "#ac-email-edit"); await fill(sim, "#ac-email-new", messy(sim, sim.m.email)); await click(sim, "#ac-email-send");
    await waitText(sim, "#ac-email-msg", /already your sign-in/); sim.expectedError = true; }],
  "email: typo in the address": [3, {}, async (sim) => {
    await open(sim); await click(sim, "#ac-email-edit"); await fill(sim, "#ac-email-new", "sam@example"); await click(sim, "#ac-email-send");
    await waitText(sim, "#ac-email-msg", /doesn't look right/);
    await fill(sim, "#ac-email-new", "fixed-" + sim.m.email); await click(sim, "#ac-email-send"); await sim.page.waitForSelector("#ac-email-s2:not([hidden])");
    await fill(sim, "#ac-email-code", W.lastCode("fixed-" + sim.m.email)); await sim.page.waitForSelector("#ac-email-done:not([hidden])"); }],
  "email then robot: Resend already moved": [9, {}, async (sim) => {
    await open(sim); const to = "both-" + sim.m.email; await changeEmail(sim, to);
    W.resend.set(sim.m.resendKey, to);   // the member did the Resend step
    await connect(sim, "#ac-email-robot");
    await sim.page.waitForSelector("#ac-rb-show:not([hidden])", { timeout: 15000 });
    const msg = await moveRobot(sim, to); assert.match(msg, /All done/);
    const r = W.repos.get(sim.m.repo.toLowerCase()); assert.equal(r.vars.NOTIFY_TO, to); assert.equal(r.vars.DASHBOARD_EMAIL, to);
    assert.equal(W.sent(to, "robot_setup_check").length >= 1, true, "test email arrived"); }],
  "robot: forgot Resend, then fixes it": [7, {}, async (sim) => {
    await open(sim); const to = "rb-" + sim.m.email; await showRobot(sim);
    let msg = await moveRobot(sim, to); assert.match(msg, /one step left/);
    const r = W.repos.get(sim.m.repo.toLowerCase()); assert.equal(r.vars.NOTIFY_TO, sim.m.email, "put back, nothing broken");
    W.resend.set(sim.m.resendKey, to);
    msg = await moveRobot(sim, to); assert.match(msg, /All done/); assert.equal(r.vars.NOTIFY_TO, to); }],
  "robot: new Resend account key": [4, {}, async (sim) => {
    await open(sim); const to = "key-" + sim.m.email, key = "re_NEW" + Math.random().toString(36).slice(2, 14); W.resend.set(key, to);
    await showRobot(sim); const msg = await moveRobot(sim, to, { key }); assert.match(msg, /All done/);
    assert.equal(W.repos.get(sim.m.repo.toLowerCase()).secrets.RESEND_API_KEY, key); }],
  "robot: copy has its own name": [5, { repo: "isa-bot" }, async (sim) => {
    await W.q("update members set repo_url=null where user_id=$1", [sim.m.uid]);
    await open(sim); await showRobot(sim);
    await sim.page.waitForSelector("#ac-rb-name:not([hidden])");
    await fill(sim, "#ac-rb-repo", "isa-bot"); await click(sim, "#ac-rb-find");
    await sim.page.waitForSelector("#ac-rb-show:not([hidden])"); }],
  "robot: setup check failing for another reason": [3, { otherFailure: true }, async (sim) => {
    await open(sim); const to = "of-" + sim.m.email; W.resend.set(sim.m.resendKey, to); await showRobot(sim);
    const msg = await moveRobot(sim, to); assert.match(msg, /Some of it/);
    assert.equal(W.repos.get(sim.m.repo.toLowerCase()).vars.NOTIFY_TO, sim.m.email); sim.expectedError = true; }],
  "robot: no Robot Dash yet": [3, { dash: false }, async (sim) => {
    await open(sim); const to = "nd-" + sim.m.email; W.resend.set(sim.m.resendKey, to); await showRobot(sim);
    assert.match(await sim.page.textContent("#ac-rb-dash"), /isn't set up/);
    const msg = await moveRobot(sim, to); assert.match(msg, /All done/); }],
  "robot: Robot Dash update fails": [2, { dashFails: true }, async (sim) => {
    await open(sim); const to = "df-" + sim.m.email; W.resend.set(sim.m.resendKey, to); await showRobot(sim);
    const msg = await moveRobot(sim, to); assert.match(msg, /Some of it/);
    const r = W.repos.get(sim.m.repo.toLowerCase()); assert.equal(r.vars.DASHBOARD_EMAIL, sim.m.email, "Robot Dash put back"); assert.equal(r.vars.NOTIFY_TO, to); sim.expectedError = true; }],
  "github: switch account": [6, {}, async (sim) => {
    const tok = W.addGitHubAccount("new-" + sim.m.login); sim.ghSignedIn = tok;
    await open(sim); await click(sim, "#ac-gh-edit"); await connect(sim, "#ac-gh-go");
    await sim.page.waitForSelector("#ac-gh-ask:not([hidden])"); await shot(sim, "7-github-ask"); await click(sim, "#ac-gh-switch");
    await waitText(sim, "#ac-gh-msg", /now uses/); await shot(sim, "8-github-done");
    assert.equal((await W.one("select github_login from members where user_id=$1", [sim.m.uid])).github_login, "new-" + sim.m.login);
    assert.equal(W.org.members.has(sim.m.login.toLowerCase()), false); }],
  "github: old account still signed in": [5, {}, async (sim) => {
    await open(sim); await click(sim, "#ac-gh-edit"); await connect(sim, "#ac-gh-go");
    await waitText(sim, "#ac-gh-msg", /again/); sim.ghSignedIn = W.addGitHubAccount("other-" + sim.m.login);
    await connect(sim, "#ac-gh-go"); await sim.page.waitForSelector("#ac-gh-ask:not([hidden])"); await click(sim, "#ac-gh-switch");
    await waitText(sim, "#ac-gh-msg", /now uses/); }],
  "github: account already on another membership": [2, {}, async (sim) => {
    const other = await W.addMember(); sim.ghSignedIn = other.token;
    await open(sim); await click(sim, "#ac-gh-edit"); await connect(sim, "#ac-gh-go");
    await sim.page.waitForSelector("#ac-gh-ask:not([hidden])"); await click(sim, "#ac-gh-switch");
    await waitText(sim, "#ac-gh-msg", /already linked/); sim.expectedError = true; }],
  "github: first connection": [2, { login: null }, async (sim) => {
    sim.ghSignedIn = W.addGitHubAccount("first-" + sim.m.uid.slice(0, 6));
    await open(sim); assert.match(await sim.page.textContent("#ac-gh"), /Not connected/);
    await click(sim, "#ac-gh-edit"); await connect(sim, "#ac-gh-go"); await waitText(sim, "#ac-gh-msg", /Connected/); }],
  "data: download": [5, {}, async (sim) => {
    await open(sim);
    const [dl] = await Promise.all([sim.page.waitForEvent("download"), click(sim, "#ac-dl")]);
    const j = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
    assert.equal(j.membership.email, sim.m.email); assert.equal(j.moonshotters_posts.length, 1); assert.match(dl.suggestedFilename(), /^my-robot-isa-data-\d{4}-\d\d-\d\d\.json$/); }],
  "delete: then keeps it here": [4, {}, async (sim) => {
    await open(sim); await requestDelete(sim);
    await sim.page.goto(`${SITE}/members/#home`); await sim.page.waitForSelector("#ac-home-del:not([hidden])");
    await click(sim, "#ac-home-del a"); await click(sim, "#ac-keep"); await sim.page.waitForSelector("#ac-del-banner", { state: "hidden" });
    assert.equal((await W.one("select cancelled_at from admin.member_deletions where user_id=$1", [sim.m.uid])).cancelled_at !== null, true); }],
  "delete: keeps it from the email": [3, {}, async (sim) => {
    await open(sim); await requestDelete(sim);
    const link = /https:\S+cancel=[0-9a-f-]+/.exec(W.sent(sim.m.email, "account_delete_scheduled")[0].text)[0];
    await act(sim, () => sim.page.goto(link)); await sim.page.waitForURL(/members\/#help$/);
    await waitText(sim, "#mtoast", /staying/);
    await sim.page.waitForFunction(() => document.getElementById("ac-del-banner").hidden); }],
  "delete: wrong code, then 7 days pass": [4, { founding_no: null }, async (sim) => {
    await open(sim); await requestDelete(sim, { wrongFirst: true });
    await W.timeTravel(sim.m.uid, "deletion-due"); await W.call({ action: "purge" });
    await sim.page.reload(); await sim.page.waitForSelector("#v-signin:not([hidden])");
    const post = await W.one("select author_name from community_posts where title like 'Idea from ' || $1 || '%'", [sim.m.uid.slice(0, 6)]);
    assert.equal(post.author_name, "Former member"); assert.equal(W.sent(sim.m.email, "account_deleted").length, 1); }],
  "delete: changes mind at the code": [3, {}, async (sim) => {
    await open(sim); await click(sim, "#ac-del"); await click(sim, "#ac-del-send"); await sim.page.waitForSelector("#ac-del-s2:not([hidden])");
    await click(sim, "#ac-del-cancel2"); await sim.page.waitForSelector("#ac-del-box", { state: "hidden" });
    assert.equal(await W.one("select 1 from admin.member_deletions where user_id=$1", [sim.m.uid]), null); }],
  "owner: no delete button": [1, { plan: "owner" }, async (sim) => {
    await open(sim); assert.equal(await sim.page.isHidden("#ac-del"), true); }],
};
const weights = Object.values(J).reduce((a, x) => a + x[0], 0);
assert.equal(weights, 100, "weights add up to 100, got " + weights);

// Build exactly COUNT sims in proportion to the weights, devices and noise shuffled.
const plan = [];
for (const [name, [w]] of Object.entries(J)) for (let i = 0; i < Math.round(w * COUNT / 100); i++) plan.push(name);
while (plan.length < COUNT) plan.push("email: change it"); plan.length = COUNT;
const sims = plan.map((name, i) => ({ id: i + 1, name, device: rnd() < 0.5 ? "phone" : "desktop", noise: rnd() < 0.5, notes: [], codes: {} }));

const browser = await chromium.launch();
const t0 = Date.now();
async function runOne(sim) {
  const [, opts, f] = J[sim.name];
  sim.m = await W.addMember({ ...opts });
  sim.ghSignedIn = sim.m.token;
  const { ctx, page } = await setupPage(browser, sim); sim.page = page;
  const start = Date.now();
  try { await f(sim); sim.reached = true; }
  catch (e) { sim.reached = false; sim.failure = String(e.message || e).split("\n")[0].slice(0, 300);
    try { await page.screenshot({ path: path.join(OUT, `sim-${sim.id}.png`), fullPage: true }); } catch {} }
  await phoneFits(sim);
  sim.ms = Date.now() - start;
  sim.unclear = sim.errorsSeen.filter((e) => !NEXT.test(e));
  if (sim.id <= 2 || sim.name.startsWith("robot: forgot")) { try { await page.screenshot({ path: path.join(OUT, `shot-${sim.id}-${sim.device}.png`), fullPage: true }); } catch {} }
  await ctx.close(); delete sim.page;
}
const queue = sims.slice(), WORKERS = Number(process.env.SIM_WORKERS || 6);
await Promise.all(Array.from({ length: WORKERS }, async () => { while (queue.length) await runOne(queue.shift()); }));
await browser.close(); await W.close();

// ---- report
const fails = sims.filter((x) => !x.reached), errs = sims.filter((x) => x.pageErrors.length), unclear = sims.filter((x) => x.unclear.length), notes = sims.filter((x) => x.notes.length);
const by = {};
for (const x of sims) { const b = by[x.name] ||= { n: 0, ok: 0, steps: 0, errors: new Set() }; b.n++; if (x.reached) b.ok++; b.steps += x.steps; x.errorsSeen.forEach((e) => b.errors.add(e)); }
const lines = [`# ${COUNT} simulated members, seed ${SEED}: ${COUNT - fails.length} reached their goal, ${fails.length} dead ends, ${errs.length} with page errors, ${unclear.length} saw an unclear error (${((Date.now() - t0) / 1000).toFixed(0)}s)`, "",
  "| Journey | Runs | Reached goal | Avg actions | Messages members saw |", "|---|---|---|---|---|"];
for (const [k, b] of Object.entries(by)) lines.push(`| ${k} | ${b.n} | ${b.ok} | ${(b.steps / b.n).toFixed(1)} | ${[...b.errors].join(" / ").replace(/\|/g, "/") || "none"} |`);
lines.push("", `Devices: ${sims.filter((x) => x.device === "phone").length} phone, ${sims.filter((x) => x.device === "desktop").length} desktop. Human noise (capitals, spaces, Enter, pasted codes with a space): ${sims.filter((x) => x.noise).length}.`);
for (const x of fails) lines.push(`- DEAD END #${x.id} ${x.name} (${x.device}${x.noise ? ", noisy" : ""}): ${x.failure}`);
for (const x of errs) lines.push(`- PAGE ERROR #${x.id} ${x.name}: ${x.pageErrors.join(" | ")}`);
for (const x of unclear) lines.push(`- UNCLEAR #${x.id} ${x.name}: ${x.unclear.join(" | ")}`);
for (const x of notes) lines.push(`- NOTE #${x.id} ${x.name} (${x.device}): ${x.notes.join(" | ")}`);
fs.writeFileSync(path.join(OUT, "report.md"), lines.join("\n") + "\n");
fs.writeFileSync(path.join(OUT, "sims.json"), JSON.stringify(sims.map(({ m, codes, ...x }) => x), null, 1));
console.log(lines.join("\n"));
process.exit(fails.length || errs.length || unclear.length ? 1 : 0);
