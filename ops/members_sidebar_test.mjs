// Members area sidebar (29 Oct 2026, Amit): Set up my robot folds its pages away (no dot since v90; Your lessons and
// Your updates since v86/v89, Your updates above Moonshotters),
// Faster sign-in is a pill on Help and membership, the
// Moonshotters have their own line, and "Your fixes" shows only once Robot Care is on or a fix exists.
// Serves docs/ locally and signs in with a stub session; Supabase is stubbed. Needs playwright.
//   node ops/members_sidebar_test.mjs [screenshot-dir]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), DOCS = path.join(ROOT, "docs");
const SHOTS = process.argv[2] || null;

const PORT = 8742;
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", DOCS], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "HS256" })}.${b64({ sub: "11111111-1111-4111-8111-111111111111", exp: 4102444800 })}.sig`;
const URL_ = `http://127.0.0.1:${PORT}/members/`;
const FIX = { id: 7, outcome: "pr", pr_number: 4, pr_title: "Fix the weekly plan", diagnosis: "A date was read the wrong way.", files: ["signals_report.py"], urgent: true, fix_state: "open", at: "2026-10-29T09:00:00Z" };

let passed = 0;
async function run(name, { robotCare = false, fixes = [], vp = { width: 1280, height: 900 }, store = {}, guides = null, voice = null, owner = false, preview = true, progress = [], notices = [], reads = [], posts = [] }, f) {
  // bypassCSP: the test's own waitForFunction predicates are evaluated as strings, which the page's CSP (no unsafe-eval) refuses
  // under CI's Playwright 1.49 (17 Nov 2026). The test page only; the live page keeps its policy.
  const browser = await chromium.launch(), page = await browser.newPage({ viewport: vp, bypassCSP: true });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.route("https://vxnestmhtjotidhzzqbo.supabase.co/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(o) });
    if (p.endsWith("/rpc/my_robot_care_fixes")) return json(fixes);
    if (p.endsWith("/rest/v1/members")) return json([{ email: "a@example.com", plan: owner ? "owner" : "founding", status: "active", joined_at: "2026-10-01", updates_until: "2027-10-01", founding_no: 7, preview_videos: preview, robot_care: robotCare }]);
    if (p.endsWith("/rest/v1/member_progress") && route.request().method() === "GET") return json(progress.map((item) => ({ item, done: true })));
    if (p.endsWith("/rest/v1/member_notices")) return json(notices);
    if (p.endsWith("/rest/v1/community_posts")) return json(posts);
    if (p.endsWith("/rest/v1/member_notice_reads") && route.request().method() === "GET") return json(reads.map((notice_id) => ({ notice_id })));
    if (p.endsWith("/functions/v1/robot-care-accept")) return json({ ok: true, changed: 0 });
    if (p.endsWith("/rest/v1/lesson_guides")) return json(guides || [{ id: "day-1", data: { title: "Lesson 1", mins: 5, steps: [] } }]);
    if (p.endsWith("/functions/v1/lesson-media")) return json({ error: "stub" });
    if (p.endsWith("/rpc/owner_early_list")) return json([]);
    return json([]);
  });
  await page.addInitScript(([s, st]) => { localStorage.setItem("mri-members-session", JSON.stringify(s)); for (const k in st) localStorage.setItem(k, st[k]); },
    [{ access_token: jwt, refresh_token: "r", expires_at: 4102444800, email: "a@example.com" }, store]);
  try { await f(page); assert.deepEqual(errs, [], "no page errors"); passed++; console.log("ok  ", name); }
  finally { await browser.close(); }
}
const LX = { id: "day-12", data: { title: "Limits and an off switch", kind: "Lesson 12", mins: 5, tips: [], steps: [
  { t: "Safety comes first", d: "Words for one.", lx: { from: 0, to: 30, try: { type: "tiles", title: "Tap each limit", items: [["Holding cap", "No single holding above 15%."]] } } },
  { t: "The safety stop", d: "Words for two.", lx: { from: 30, to: 54, try: { type: "line", title: "Move the market", intro: "Example.", high: 5000, line: 4250 } } },
  { t: "Your off switch", d: "Words for three.", lx: { from: 54, to: 77, try: { type: "pause", note: "Do it once for real." } } },
  { t: "When to pause", d: "Words for four.", lx: { from: 77, to: 99, try: { type: "ask", title: "Ask your robot", items: [["I'm on holiday.", "Enjoy it."]] } } },
  { t: "We took the L", d: "Words for five.", lx: { from: 99, to: 135, try: { type: "points", title: "We took the L", items: ["A rule, not a promise"] } } } ] } };
const side = "#mgroup-sub";
const vis = (page, sel) => page.isVisible(sel);
// Lesson progress (5 Nov 2026): real lengths and step counts, so the time left is the sum a member would get
const GUIDE14 = [[10, 3], [30, 4], [20, 3], [40, 4], [45, 4], [25, 3], [25, 3], [25, 3], [20, 3], [25, 3], [20, 3], [5, 5], [20, 3], [30, 3]]
  .map(([mins, n], i) => ({ id: `day-${i + 1}`, data: { title: `Lesson ${i + 1}`, kind: `Lesson ${i + 1}`, mins, tips: [], steps: Array.from({ length: n }, (_, k) => ({ t: `Step ${k + 1}`, d: "Words." })) } }));
const days = (n) => Array.from({ length: n }, (_, i) => `day:${i + 1}`);
const lessons = async (page) => { await page.goto(URL_ + "#lessons"); await page.waitForFunction(() => /Lesson \d|last one/.test(document.querySelector("#les-panel").textContent) && document.querySelector("#les-left").textContent); };

const LONG = "Your robot could not sign in to Trading 212.\n\nNothing was bought or sold, and your money is safe. " + "Open Set up my robot and re-enter your key and secret. ".repeat(6).trim();
const NOTE = (id, title, body) => ({ id, kind: "action", title, body, link_url: null, link_text: null, starts_at: new Date(Date.now() - 864e5).toISOString() });   // a day ago: Earlier keeps a month

try {
  await run("messages: a long one folds, See more doesn't mark it read, Hide closes it", { vp: { width: 390, height: 844 }, notices: [NOTE(21, "A failed run needs you", LONG), NOTE(20, "Short one", "All sorted.")] }, async (page) => {
    await page.goto(URL_ + "#home"); await page.waitForSelector('.note[data-id="21"]');
    const n = '.note[data-id="21"]';
    assert.equal((await page.textContent(`${n} p`)).trim(), "Your robot could not sign in to Trading 212.");
    assert.equal(await vis(page, `${n} .note-rest`), false);
    assert.equal((await page.textContent(`${n} .note-more`)).trim(), "See more");
    assert.equal(await page.$('.note[data-id="20"] .note-more'), null, "a short message has no button");
    await page.click(`${n} .note-more`);
    assert.equal(await vis(page, `${n} .note-rest`), true);
    assert.equal((await page.textContent(`${n} .note-more`)).trim(), "Hide");
    assert.equal(await page.$eval(n, (e) => e.classList.contains("new")), true, "reading more leaves it unread");
    await page.click(`${n} time`);   // 17 Nov 2026: marking it read moves it under Earlier, still open
    assert.equal(await vis(page, `#notes ${n}`), false, "read messages leave the main list");
    await page.click("#notes-older summary");
    assert.equal(await page.$eval(`#notes-old ${n}`, (e) => e.classList.contains("read")), true);
    assert.equal(await vis(page, `#notes-old ${n} .note-rest`), true);
    await page.click(`#notes-old ${n} .note-more`);
    assert.equal(await vis(page, `#notes-old ${n} .note-rest`), false);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scroll");
  });
  // 17 Nov 2026 (Amit): only unread messages show, so the Moonshotters stay near the top on a phone
  await run("messages: only unread show; nothing unread is one short line", { vp: { width: 390, height: 844 }, notices: [NOTE(31, "New one", "Fresh."), { ...NOTE(30, "Old one", "Seen."), starts_at: new Date(Date.now() - 5 * 864e5).toISOString() },
    { ...NOTE(29, "Last month", "Long gone."), starts_at: new Date(Date.now() - 40 * 864e5).toISOString() }], reads: [30, 29] }, async (page) => {
    await page.goto(URL_ + "#home"); await page.waitForSelector('#notes .note[data-id="31"]');
    assert.equal(await vis(page, '#notes .note[data-id="30"]'), false, "the read one isn't in the main list");
    await page.click('#notes .note[data-id="31"] time');
    await page.waitForSelector("#msgs.quiet");
    assert.equal(await vis(page, "#notes-none"), true); assert.equal(await vis(page, "#notes"), false);
    assert.match(await page.textContent("#notes-older .fold-l"), /Show 2 earlier messages/, "a read message older than a month drops off");
    assert.equal(await page.$('.note[data-id="29"]'), null);
    const h = (await page.locator("#msgs").boundingBox()).height;
    assert.ok(h < 170, `the quiet card is short on a phone (${h}px)`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "messages-quiet-390.png") });
  });
  await run("lesson progress: picks up the lesson they left, on a phone", { guides: GUIDE14, vp: { width: 390, height: 844 }, progress: [...days(3), "g:day-4:1", "g:day-4:2"] }, async (page) => {
    await lessons(page);
    assert.equal((await page.textContent("#les-count")).trim(), "3 of 14 done");
    assert.equal((await page.textContent("#les-left")).trim(), "About 4 hours 40 min to go");
    const next = await page.textContent("#les-next");
    assert.ok(/Pick up where you left off/.test(next) && /Lesson 4: Make it yours/.test(next) && /2 of 4 steps done · about 40 min/.test(next), next);
    assert.equal(await page.getAttribute("#les-next .btn", "href"), "#guide/day-4");
    assert.equal((await page.textContent("#les-next .btn")).trim(), "Carry on →");
    const card = "#lessons .item:nth-child(4)";
    assert.equal(await page.$eval(card, (e) => e.classList.contains("now")), true);
    assert.equal((await page.textContent(`${card} .les-steps .t`)).trim(), "2 of 4 steps done");
    assert.equal((await page.textContent(`${card} .gd-link`)).trim(), "Carry on →");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scroll");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "lessons-390.png") });
    await page.click(`${card} .tick`);   // ticked by hand: the panel moves on with no reload
    assert.equal((await page.textContent("#les-count")).trim(), "4 of 14 done");
    assert.ok(/Up next/.test(await page.textContent("#les-next")) && /Lesson 5: Backtest honestly/.test(await page.textContent("#les-next")));
    assert.equal(await vis(page, `${card} .les-steps`), false);
    assert.equal((await page.textContent(`${card} .gd-link`)).trim(), "Step by step →");
    assert.equal(await page.$eval("#lessons .item:nth-child(5)", (e) => e.classList.contains("now")), true);
  });
  await run("lesson progress: a step ticked in a guide shows on the way back", { guides: GUIDE14, progress: days(3) }, async (page) => {
    await lessons(page);
    assert.ok(/Start lesson 4/.test(await page.textContent("#les-next .btn")));
    await page.click("#les-next .btn"); await page.waitForSelector('[data-gd="next"]');
    await page.click('[data-gd="next"]');
    await page.evaluate(() => { location.hash = "#lessons"; }); await page.waitForSelector("#les-next .btn >> text=Carry on");
    assert.equal((await page.textContent("#lessons .item:nth-child(4) .les-steps .t")).trim(), "1 of 4 steps done");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "lessons-1280.png") });
  });
  await run("lesson progress: first visit", { guides: GUIDE14 }, async (page) => {
    await lessons(page);
    assert.equal((await page.textContent("#les-count")).trim(), "0 of 14 done");
    assert.equal((await page.textContent("#les-left")).trim(), "About 5 hours 40 min in all, at your own pace");
    assert.ok(/Start here/.test(await page.textContent("#les-next")));
    assert.equal((await page.textContent("#les-next .btn")).trim(), "Start lesson 1 →");
  });
  await run("lesson progress: a lesson that hasn't opened yet has no button", { guides: GUIDE14, preview: false, progress: days(1) }, async (page) => {
    await lessons(page);
    assert.ok(/Lesson 2: Get it running/.test(await page.textContent("#les-next")));
    assert.equal((await page.textContent("#les-next .pill")).trim(), "Opens January 2027");
    assert.equal(await page.$("#les-next .btn"), null);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "lessons-locked-1280.png") });
  });
  await run("lesson progress: all 14 done", { guides: GUIDE14, progress: days(14) }, async (page) => {
    await lessons(page);
    assert.equal((await page.textContent("#les-count")).trim(), "All 14 done");
    assert.equal((await page.textContent("#les-left")).trim(), "That was the last one.");
    assert.ok(await page.$eval("#les-next img", (i) => i.complete && i.naturalWidth > 0), "the high five loads");
    assert.equal(await page.$("#les-next .btn"), null);
    assert.equal(await page.$$eval("#lessons .item.now", (e) => e.length), 0);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "lessons-all-1280.png") });
  });
  await run("interactive lesson: touch everything, no marks, no sideways scroll", { guides: [LX], vp: { width: 390, height: 844 } }, async (page) => {
    await page.goto(URL_ + "#guide/day-12"); await page.waitForSelector("#lx-screen");
    assert.equal((await page.textContent("#h-gd")).trim(), "Limits and an off switch");
    await page.click('[data-lx="tile"]'); assert.equal(await page.getAttribute('[data-lx="tile"]', "aria-expanded"), "true");
    await page.click('[data-gd="next"]'); await page.waitForSelector("#lx-fall");
    await page.$eval("#lx-fall", (r) => { r.value = 18; r.dispatchEvent(new Event("input", { bubbles: true })); });
    assert.equal(await page.textContent("#lx-pill"), "Safety stop on"); assert.equal(await page.textContent("#lx-val"), "\u00a34,100");
    await page.$eval("#lx-fall", (r) => { r.value = 5; r.dispatchEvent(new Event("input", { bubbles: true })); });
    assert.equal(await page.textContent("#lx-pill"), "Running", "the stop lifts by itself");
    await page.click('[data-gd="next"]'); await page.click('[data-lx="pz-ask"]'); await page.click('[data-lx="pz-go"]');
    assert.equal(await page.textContent("#lx-pz .lx-pill"), "Paused");
    await page.click('[data-gd="next"]'); await page.click('[data-lx="ask"]');
    assert.equal(await page.textContent("#lx-chat .bot"), "Enjoy it."); assert.equal(await page.$('[data-lx="ask"]'), null);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.click('[data-gd="next"]'); await page.click('[data-gd="finish"]');
    assert.ok((await page.textContent("#gd-step")).includes("All 5 steps done"));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "lesson-390.png") });
  });
  await run("owner: Early adopters is a third tab; lessons never say preview", { owner: true }, async (page) => {
    await page.goto(URL_ + "#help"); await page.waitForSelector("#pane-memb:not([hidden])"); await page.waitForTimeout(300);
    assert.equal(await page.$$eval('#pane-memb .ea-tab', (t) => t.filter((x) => !x.hidden).length), 1, "owner sees the tab");
    assert.equal(await page.$("#pane-memb #ea-email"), null, "the form is not above Membership any more");
    await page.click('#pane-memb .ea-tab'); await page.waitForSelector("#ea-card:not(.off) #ea-email");
    assert.equal(await page.getAttribute("#ea-card .ea-tab", "aria-selected"), "true");
    await page.goto(URL_ + "#lessons"); await page.waitForSelector("#lessons li");
    const pills = await page.$$eval("#lessons .pill", (p) => p.map((x) => x.textContent.trim()));
    assert.ok(pills.includes("Open") && !pills.some((t) => /preview/i.test(t)), pills.join(","));
  });
  await run("member: no Early adopters tab", {}, async (page) => {
    await page.goto(URL_ + "#help"); await page.waitForSelector("#pane-memb:not([hidden])"); await page.waitForTimeout(300);
    assert.equal(await page.$$eval('.ea-tab', (t) => t.filter((x) => !x.hidden).length), 0);
  });
  await run("menu order and groups (desktop)", {}, async (page) => {
    await page.goto(URL_ + "#home"); await page.waitForSelector("#v-home:not([hidden])");
    const top = await page.$$eval(`${side} > li:not([hidden])`, (lis) => lis.map((li) => li.querySelector("a:not([hidden])").textContent.trim()));
    assert.deepEqual(top, ["Set up my robot", "Your dashboard", "Your updates", "Moonshotters", "Help and membership"]);
    assert.equal(await page.$$eval(`${side} a[data-go="setup"] .ndot`, (d) => d.length), 0, "no green dot (Amit, 29 Oct 2026)");
    assert.equal((await page.textContent(`${side} a[data-go="lessons"]`)).trim(), "Your lessons");
    assert.equal(await vis(page, `${side} a[data-go="code"]`), true);
    assert.equal(await vis(page, `${side} a[data-go="lessons"]`), true);
    assert.equal(await page.$(`${side} a[data-go="passkeys"]`), null, "Faster sign-in is not in the menu any more");
    assert.equal(await page.$$eval(`${side} .grp-t`, (b) => b.length), 1, "Set up my robot is the only group under Members area");
    if (SHOTS) await page.locator("#side").screenshot({ path: path.join(SHOTS, "sidebar-1280.png") });
  });
  await run("Your fixes hidden without Robot Care and with no fixes", { robotCare: false, fixes: [] }, async (page) => {
    await page.goto(URL_ + "#home"); await page.waitForSelector("#v-home:not([hidden])"); await page.waitForTimeout(300);
    assert.equal(await vis(page, `${side} a[data-go="fixes"]`), false);
  });
  await run("Your fixes shown when Robot Care is on, no count when nothing waits", { robotCare: true, fixes: [] }, async (page) => {
    await page.goto(URL_ + "#home"); await page.waitForSelector(`${side} a[data-go="fixes"]`, { state: "visible" });
    assert.equal(await vis(page, "#rcf-nav"), false);
  });
  await run("Your fixes shown with a count when a fix waits; Home card says who it's from", { robotCare: false, fixes: [FIX] }, async (page) => {
    await page.goto(URL_ + "#home"); await page.waitForSelector("#rcf-nav", { state: "visible" });
    assert.equal((await page.textContent("#rcf-nav")).trim(), "1");
    assert.match(await page.textContent("#h-rcf"), /Robot Care has a fix for you/);
    await page.click(`${side} a[data-go="fixes"]`);
    // No waitForFunction on this page: when its condition isn't true at once, Playwright polls with eval, which the
    // members page's CSP blocks ("unsafe-eval"), so it failed on slower CI runners only (30 Oct, 1 Nov 2026).
    await page.waitForSelector('#h-rcf:has-text("Your fixes")', { timeout: 5000 });
    assert.equal(await page.getAttribute(`${side} a[data-go="fixes"]`, "aria-current"), "page");
  });
  await run("groups toggle by mouse and keyboard, and remember", {}, async (page) => {
    await page.goto(URL_ + "#home"); await page.waitForSelector("#v-home:not([hidden])");
    const t = `${side} .sgroup[data-grp="setup"] .grp-t`;
    await page.click(t);
    assert.equal(await page.getAttribute(t, "aria-expanded"), "false");
    assert.equal(await vis(page, `${side} a[data-go="code"]`), false);
    assert.equal(await page.evaluate(() => localStorage.getItem("mri-side-setup")), "closed");
    await page.focus(t); await page.keyboard.press("Enter");
    assert.equal(await page.getAttribute(t, "aria-expanded"), "true");
    await page.focus(t); await page.keyboard.press("Space");
    assert.equal(await page.getAttribute(t, "aria-expanded"), "false");
    await page.reload(); await page.waitForSelector("#v-home:not([hidden])");
    assert.equal(await page.getAttribute(t, "aria-expanded"), "false", "setup stays closed after reload");
  });
  await run("a closed group opens itself for a page inside it, and highlights it", { store: { "mri-side-setup": "closed" } }, async (page) => {
    await page.goto(URL_ + "#lessons"); await page.waitForSelector("#v-home:not([hidden])");
    assert.equal(await vis(page, `${side} a[data-go="lessons"]`), true);
    assert.equal(await page.getAttribute(`${side} a[data-go="lessons"]`, "aria-current"), "page");
    await page.goto(URL_ + "#guide/day-1"); await page.waitForTimeout(300);
    assert.equal(await page.getAttribute(`${side} a[data-go="lessons"]`, "aria-current"), "page", "a lesson guide lights Your lessons");
  });
  await run("Moonshotters opens the board; Help and membership opens membership", {}, async (page) => {
    await page.goto(URL_ + "#home"); await page.waitForSelector("#v-home:not([hidden])");
    await page.click(`${side} a[data-go="ideas"]`); await page.waitForURL(/#ideas$/); await page.waitForSelector('html[data-pg="help"]', { state: "attached" });
    await page.waitForTimeout(200);
    assert.equal(await vis(page, "#pane-space"), true); assert.equal(await vis(page, "#pane-memb"), false);
    assert.match(await page.textContent("#h-help"), /Moonshotters/);
    assert.equal(await page.getAttribute(`${side} a[data-go="ideas"]`, "aria-current"), "page");
    assert.equal(await page.getAttribute(`${side} a[data-go="help"]`, "aria-current"), null);
    await page.click(`${side} a[data-go="help"]`); await page.waitForURL(/#help$/);
    await page.waitForTimeout(200);
    assert.equal(await vis(page, "#pane-memb"), true); assert.equal(await vis(page, "#pane-space"), false);
    assert.match(await page.textContent("#h-help"), /Help and membership/);
    assert.equal(await page.getAttribute(`${side} a[data-go="help"]`, "aria-current"), "page");
    assert.equal(await page.getAttribute(`${side} a[data-go="ideas"]`, "aria-current"), null);
    assert.equal(await page.$(".help-seg"), null, "no Moonshotters tab inside Help any more");
    assert.equal(await page.getAttribute('#pane-memb .hp-seg a[href="#help"]', "aria-selected"), "true");
  });
  await run("Faster sign-in is a pill on Help and membership", {}, async (page) => {
    await page.goto(URL_ + "#passkeys"); await page.waitForSelector("#pk-card:not(.off)"); await page.waitForTimeout(200);
    assert.equal(await vis(page, "#pk-card"), true);
    assert.equal(await page.getAttribute('#pk-card .hp-seg a[href="#passkeys"]', "aria-selected"), "true");
    assert.match(await page.textContent("#h-pk"), /Help and membership/);
    assert.equal(await page.getAttribute(`${side} a[data-go="help"]`, "aria-current"), "page", "#passkeys lights Help and membership");
    await page.click('#pk-card .hp-seg a[href="#help"]'); await page.waitForURL(/#help$/); await page.waitForTimeout(200);
    assert.equal(await vis(page, "#pane-memb"), true); assert.equal(await vis(page, "#pk-card"), false);
    await page.click('#pane-memb .hp-seg a[href="#passkeys"]'); await page.waitForURL(/#passkeys$/); await page.waitForTimeout(200);
    assert.equal(await vis(page, "#pk-card"), true);
    assert.equal(await page.evaluate(() => localStorage.getItem("mri-side-help")), null, "the old Help group setting is gone");
  });
  await run("phone: menu button opens the menu, groups work, no sideways scroll", { vp: { width: 390, height: 844 }, robotCare: true, fixes: [FIX] }, async (page) => {
    await page.goto(URL_ + "#home"); await page.waitForSelector("#v-home:not([hidden])");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scroll");
    const btn = await page.$("#menu-btn, .menu-btn, button[aria-controls='side']");
    assert.ok(btn, "phone menu button exists"); await btn.click(); await page.waitForTimeout(350);
    assert.equal(await vis(page, `${side} a[data-go="code"]`), true);
    await page.click(`${side} .sgroup[data-grp="setup"] .grp-t`);
    assert.equal(await vis(page, `${side} a[data-go="code"]`), false);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no sideways scroll with the menu open");
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "sidebar-390.png") });
  });
  // 17 Nov 2026 (Amit, iPhone): every page but Home has a link back to it, so a phone never needs the menu to get home.
  await run("phone: a link back to the members area on every page but Home", { robotCare: true, fixes: [FIX], vp: { width: 390, height: 844 } }, async (page) => {
    await page.goto(URL_ + "#home"); await page.waitForSelector("#v-home:not([hidden])"); await page.waitForTimeout(200);
    assert.equal(await vis(page, "#pg-back"), false, "not on Home");
    for (const h of ["ideas", "fixes", "help", "clips", "lessons", "questions"]) {
      await page.goto(URL_ + "#" + h); await page.waitForTimeout(250);
      assert.equal(await vis(page, "#pg-back"), true, `back link on #${h}`);
      const box = await page.locator("#pg-back").boundingBox();
      assert.ok(box.height >= 44 && box.y < 300, `#${h}: back link is a full tap target near the top`);
    }
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "back-390.png") });
    await page.click("#pg-back"); await page.waitForURL(/#home$/); await page.waitForTimeout(200);
    assert.equal(await vis(page, "#msgs, .hello"), true, "lands on Home");
  });
  await run("inside Robot Dash the logo goes to the members' Home, not the website", {}, async (page) => {
    await page.setContent(`<iframe src="${URL_}#ideas" style="width:390px;height:800px"></iframe>`);
    const f = await (await page.waitForSelector("iframe")).contentFrame(); await f.waitForSelector("#v-home:not([hidden])");
    assert.equal(await f.getAttribute("#brand", "href"), "#home");
  });
  // Moonshotters board (20 Nov 2026, Amit): opens on All, ideas and questions together, newest first. The board as it
  // stood that day (hidden posts never reach other members: RLS): the newest idea 25 days old, four newer questions hidden behind the Questions tab.
  const post = (id, kind, title, at, extra = {}) => ({ id, kind, title, body: "", category: "robot", status: "review", author_name: "Amit",
    user_id: "u", vote_count: 0, comment_count: 0, answer_id: null, hidden: false, created_at: at, status_at: at, ...extra });
  const BOARD = [
    post(4, "idea", "Show the safety-stop line on the Overview", "2026-10-20T09:00:00Z", { vote_count: 6, status: "planned" }),
    post(5, "idea", "A weekly email option", "2026-10-21T09:00:00Z", { vote_count: 3 }),
    post(6, "idea", "Dark and light themes", "2026-10-22T09:00:00Z", { vote_count: 3 }),
    post(7, "idea", "More brokers", "2026-10-23T09:00:00Z", { vote_count: 1, status: "building" }),
    post(8, "idea", "Lesson 15: testing your own rule", "2026-10-26T09:00:00Z", { vote_count: 2 }),
    post(9, "question", "Can I change my approval time?", "2026-11-01T09:00:00Z"),
    post(10, "question", "Does the robot trade on bank holidays?", "2026-11-08T09:00:00Z"),
    post(11, "question", "What happens if I miss a week?", "2026-11-12T09:00:00Z"),
    post(12, "question", "Why does the safety stop freeze everything instead of selling?", "2026-11-17T09:00:00Z"),
  ];
  const titles = (page) => page.$$eval("#ib-list .ib-t", (as) => as.map((a) => a.textContent));
  for (const vp of [{ width: 1280, height: 900 }, { width: 360, height: 780 }]) {
    await run(`Moonshotters open on All, newest first (${vp.width}px)`, { posts: BOARD, vp }, async (page) => {
      await page.goto(URL_ + "#ideas"); await page.waitForSelector("#ib-list .ib-t");
      assert.equal(await page.getAttribute("#ib-t-all", "aria-selected"), "true");
      assert.deepEqual(await page.$$eval(".ib-seg[aria-label='Ideas or questions'] button", (b) => b.map((x) => x.textContent.trim())), ["All · 9", "Ideas · 5", "Questions · 4"]);
      assert.deepEqual(await titles(page), [BOARD[8].title, BOARD[7].title, BOARD[6].title]);
      assert.deepEqual(await page.$$eval("#ib-list .ib-kind", (s) => s.map((x) => x.textContent)), ["Question", "Question", "Question"]);
      await page.click("#ib-more");
      assert.deepEqual((await titles(page)).slice(3, 5), [BOARD[5].title, BOARD[4].title], "then 9, then Lesson 15");
      const seg = await page.$eval(".ib-seg[aria-label='Ideas or questions']", (e) => ({ sw: e.scrollWidth, cw: e.clientWidth, r: e.getBoundingClientRect().right }));
      assert.ok(seg.sw <= seg.cw + 1 && seg.r <= vp.width, `tabs fit without scrolling: ${JSON.stringify(seg)}`);
      // 20 Nov 2026 (Amit): the two buttons sit side by side, not one under the other, and stay inside the card
      const [bn, ba] = [await page.locator("#ib-new").boundingBox(), await page.locator("#ib-ask").boundingBox()];
      assert.ok(Math.abs(bn.y - ba.y) < 2 && ba.x > bn.x + bn.width - 1, `buttons side by side: ${JSON.stringify([bn, ba])}`);
      const lb = await page.locator("#ib-list").boundingBox();
      assert.ok(ba.x + ba.width <= lb.x + lb.width + 1 && bn.height >= 44, `buttons no wider than the list, full tap target: ${JSON.stringify([ba, lb])}`);
      assert.equal(await page.$eval("#ib-new", (e) => e.scrollWidth <= e.clientWidth + 1), true, "label not clipped");
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `moonshotters-all-${vp.width}.png`), fullPage: false });
      // Ideas keeps vote order, ties newest first, and no kind label
      await page.click("#ib-t-idea");
      assert.deepEqual((await titles(page)).slice(0, 3), [BOARD[0].title, BOARD[2].title, BOARD[1].title]);
      assert.equal(await page.$$eval("#ib-list .ib-kind", (s) => s.length), 0);
      // a status chip on All shows ideas at that stage only
      await page.click("#ib-t-all"); await page.click('#ib-chips button[data-f="planned"]');
      assert.deepEqual(await titles(page), [BOARD[0].title]);
      // search works across All
      await page.click('#ib-chips button[data-f=""]');
      await page.fill("#ib-q", "miss a week"); assert.deepEqual(await titles(page), [BOARD[7].title]);
      // 21 Nov 2026 (Amit): a status chip with no ideas says so, rather than reading as an empty board
      await page.fill("#ib-q", ""); await page.click("#ib-t-all"); await page.click('#ib-chips button[data-f="live"]');
      assert.equal((await page.textContent("#ib-msg")).trim(), "No ideas at this stage yet.");
      await page.click('#ib-chips button[data-f=""]');
      // 21 Nov 2026 (Amit): one roadmap. Your updates lists the board's Building then Planned ideas, no typed-in cards.
      await page.goto(URL_ + "#clips"); await page.waitForSelector("#bench .bch");
      assert.deepEqual(await page.$$eval("#bench .bch", (c) => c.map((x) => [x.querySelector(".pill").textContent, x.querySelector("b").textContent, x.querySelector(".bch-pct").textContent])),
        [["Building", BOARD[3].title, "1 vote"], ["Planned", BOARD[0].title, "6 votes"]]);
      assert.equal(await page.$$eval("#bench .want, #bench .bar", (x) => x.length), 0, "no second vote, no typed-in percentages");
      assert.equal(await page.$eval("#bench", (e) => e.scrollWidth <= e.clientWidth + 1), true, "bench fits the screen");
      if (SHOTS) { await page.$eval("#bench", (e) => e.scrollIntoView({ block: "center" })); await page.screenshot({ path: path.join(SHOTS, `bench-${vp.width}.png`) }); }
      await page.click("#bench .bch a"); await page.waitForTimeout(150);
      assert.ok(page.url().endsWith("#post/" + BOARD[3].id), "a bench card opens its idea");
      await page.goto(URL_ + "#ideas"); await page.waitForSelector("#ib-list .ib-t");
      // the menu link lands on All again
      await page.click("#ib-t-question"); await page.goto(URL_ + "#home"); await page.goto(URL_ + "#ideas"); await page.waitForTimeout(200);
      await page.evaluate(() => document.querySelector('a[href="#ideas"]').click()); await page.waitForTimeout(100);
      assert.equal(await page.getAttribute("#ib-t-all", "aria-selected"), "true");
    });
  }
  await run("installed app menu has the same group", { robotCare: true }, async (page) => {
    await page.goto(URL_ + "?app=1#home"); await page.waitForSelector("#v-home:not([hidden])");
    const items = await page.$$eval("#appnav > li", (lis) => lis.filter((li) => !li.hidden).map((li) => (li.querySelector("a:not([hidden])") || {}).textContent.trim()));
    assert.deepEqual(items, ["Home", "Set up my robot", "Your fixes", "Your dashboard", "Your updates", "Moonshotters", "Help and membership"]);
    assert.equal(await page.$$eval('#appnav .grp-t', (b) => b.length), 1);
  });
  console.log(`all passed (${passed})`);
} finally { srv.kill(); }
