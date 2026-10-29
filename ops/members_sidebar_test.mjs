// Members area sidebar (29 Oct 2026, Amit): Set up my robot folds its pages away (with a green "new" dot, not a pill),
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
async function run(name, { robotCare = false, fixes = [], vp = { width: 1280, height: 900 }, store = {} }, f) {
  const browser = await chromium.launch(), page = await browser.newPage({ viewport: vp });
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.route("https://vxnestmhtjotidhzzqbo.supabase.co/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (o) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(o) });
    if (p.endsWith("/rpc/my_robot_care_fixes")) return json(fixes);
    if (p.endsWith("/rest/v1/members")) return json([{ email: "a@example.com", plan: "founding", status: "active", joined_at: "2026-10-01", updates_until: "2027-10-01", founding_no: 7, preview_videos: true, robot_care: robotCare }]);
    if (p.endsWith("/functions/v1/robot-care-accept")) return json({ ok: true, changed: 0 });
    if (p.endsWith("/rest/v1/lesson_guides")) return json([{ id: "day-1", data: { title: "Lesson 1", mins: 5, steps: [] } }]);
    return json([]);
  });
  await page.addInitScript(([s, st]) => { localStorage.setItem("mri-members-session", JSON.stringify(s)); for (const k in st) localStorage.setItem(k, st[k]); },
    [{ access_token: jwt, refresh_token: "r", expires_at: 4102444800, email: "a@example.com" }, store]);
  try { await f(page); assert.deepEqual(errs, [], "no page errors"); passed++; console.log("ok  ", name); }
  finally { await browser.close(); }
}
const side = "#mgroup-sub";
const vis = (page, sel) => page.isVisible(sel);

try {
  await run("menu order and groups (desktop)", {}, async (page) => {
    await page.goto(URL_ + "#home"); await page.waitForSelector("#v-home:not([hidden])");
    const top = await page.$$eval(`${side} > li:not([hidden])`, (lis) => lis.map((li) => li.querySelector("a:not([hidden])").textContent.trim()));
    assert.deepEqual(top, ["Set up my robot (new)", "Your dashboard", "Moonshotters", "What's new", "Help and membership"]);
    assert.equal(await page.$$eval(`${side} a[data-go="setup"] .ndot`, (d) => d.length), 1, "a green dot, not a New pill");
    const dot = await page.$eval(`${side} a[data-go="setup"]`, (a) => { const r = a.querySelector(".ndot").getBoundingClientRect(), t = a.getBoundingClientRect(); return r.top - t.top < 20; });
    assert.ok(dot, "the dot sits on the label's first line");
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
    await page.waitForFunction(() => /Your fixes/.test(document.getElementById("h-rcf").textContent), null, { timeout: 5000 });
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
    assert.equal(await page.getAttribute(`${side} a[data-go="lessons"]`, "aria-current"), "page", "a lesson guide lights The 14 lessons");
  });
  await run("Moonshotters opens the board; Help and membership opens membership", {}, async (page) => {
    await page.goto(URL_ + "#home"); await page.waitForSelector("#v-home:not([hidden])");
    await page.click(`${side} a[data-go="ideas"]`); await page.waitForFunction(() => location.hash === "#ideas" && document.documentElement.dataset.pg === "help");
    await page.waitForTimeout(200);
    assert.equal(await vis(page, "#pane-space"), true); assert.equal(await vis(page, "#pane-memb"), false);
    assert.match(await page.textContent("#h-help"), /Moonshotters/);
    assert.equal(await page.getAttribute(`${side} a[data-go="ideas"]`, "aria-current"), "page");
    assert.equal(await page.getAttribute(`${side} a[data-go="help"]`, "aria-current"), null);
    await page.click(`${side} a[data-go="help"]`); await page.waitForFunction(() => location.hash === "#help");
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
    await page.click('#pk-card .hp-seg a[href="#help"]'); await page.waitForFunction(() => location.hash === "#help"); await page.waitForTimeout(200);
    assert.equal(await vis(page, "#pane-memb"), true); assert.equal(await vis(page, "#pk-card"), false);
    await page.click('#pane-memb .hp-seg a[href="#passkeys"]'); await page.waitForFunction(() => location.hash === "#passkeys"); await page.waitForTimeout(200);
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
  await run("installed app menu has the same group", { robotCare: true }, async (page) => {
    await page.goto(URL_ + "?app=1#home"); await page.waitForSelector("#v-home:not([hidden])");
    const items = await page.$$eval("#appnav > li", (lis) => lis.filter((li) => !li.hidden).map((li) => (li.querySelector("a:not([hidden])") || {}).textContent.trim()));
    assert.deepEqual(items, ["Home", "Set up my robot (new)", "Your fixes", "Your dashboard", "Moonshotters", "What's new", "Help and membership"]);
    assert.equal(await page.$$eval('#appnav .grp-t', (b) => b.length), 1);
  });
  console.log(`all passed (${passed})`);
} finally { srv.kill(); }
