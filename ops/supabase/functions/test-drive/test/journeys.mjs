// 100 simulated visitors through the free test drive (hub D41; Amit: "run 100 simulations of it to prove it works").
// Each is a real Chromium session on the real page (docs/drive/, served as https://myrobotisa.com/drive/), with the
// real test-drive logic (core.js) behind it and a clock the simulation moves on, so a visitor's week passes in seconds.
// Visitors open on 7 December at a random hour (some a day or a week late), come back on their own pattern (every
// day, skipping days, all at the end, twice a day), on a phone or a computer, and sometimes press play, go back to
// an earlier day, or try to finish a day early.
// Every visit checks: no page error; no share's name in the page or in any reply before the day it is revealed is
// finished; each day opens on the right London date and never early; the pot carries from day to day; the end shows
// the real seven-week result; nothing wider than a phone screen. Exits 1 on any failure.
//
// The seven days are NOT in this public repo (their reveals name the shares). Build them in the hub first:
//   RISK_PROFILE=balanced python ops/test_drive/drive.py <dir>      (stock-boom-hunter)
//   DRIVE_DIR=<dir> node ops/supabase/functions/test-drive/test/journeys.mjs [count] [seed]
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { handle, londonMidnight } from "../core.js";
import { memoryStore } from "./memory.mjs";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = fs.readFileSync(path.resolve(HERE, "../../../../../docs/drive/index.html"), "utf8");
const DIR = process.env.DRIVE_DIR; if (!DIR) { console.error("set DRIVE_DIR (see the top of this file)"); process.exit(2); }
const DAYS = JSON.parse(fs.readFileSync(path.join(DIR, "drive.json")));
const REV = JSON.parse(fs.readFileSync(path.join(DIR, "drive-reveal.json")));
const FN = "https://vxnestmhtjotidhzzqbo.supabase.co/functions/v1/test-drive";
const COUNT = Number(process.argv[2] || 100), SEED = Number(process.argv[3] || 7);

let seed = SEED; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const HOUR = 3600000, DAY = 24 * HOUR, OPEN = londonMidnight("2026-12-07");
// first day each name is revealed, so we can say when it may first appear
const firstReveal = {}; for (const r of REV) for (const s of r.shares) firstReveal[s.name] ??= r.day;
const NAMES = Object.keys(firstReveal);
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
const lday = (ms) => Math.floor(Date.parse(fmt.format(new Date(ms)) + "T12:00:00Z") / DAY);

const PATTERNS = {
  daily: (s) => [0, 1, 2, 3, 4, 5, 6].map((n) => s + n * DAY + rnd() * 4 * HOUR),
  skipping: (s) => [0, 1, 3, 4, 6, 8].map((n) => s + n * DAY + rnd() * 3 * HOUR),
  late_binge: (s) => [s, s + 9 * DAY],
  twice_a_day: (s) => [0, 0.4, 1, 1.4, 2, 3, 3.5, 4, 5, 6, 6.2].map((n) => s + n * DAY),
  gives_up: (s) => [s, s + DAY],
  weekend: (s) => [s, s + 5 * DAY, s + 6 * DAY, s + 7 * DAY],
};

const failures = []; const stats = { visits: 0, finished_all: 0, gave_up: 0, early_tries: 0, plays: 0, back: 0, by: {} };

async function visitor(browser, n) {
  const kind = pick(Object.keys(PATTERNS)); stats.by[kind] = (stats.by[kind] || 0) + 1;
  const phone = rnd() < 0.55;
  const ctx = await browser.newContext(phone ? { ...devices[pick(["iPhone 13", "Pixel 7", "iPhone SE"])] } : { viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const token = `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const S = memoryStore(DAYS, REV); S.add(token, "member");
  let clock = OPEN + (rnd() < 0.15 ? Math.floor(rnd() * 3) * DAY : 0) + (6 + rnd() * 16) * HOUR;
  const errs = []; const fail = (m) => failures.push(`visitor ${n} (${kind}, ${phone ? "phone" : "computer"}): ${m}`);
  page.on("pageerror", (e) => errs.push(String(e)));
  const revealedSoFar = () => new Set(S.rows.get(token).done.flatMap((d) => REV[d - 1].shares.map((s) => s.name)));
  await page.route(`${FN}**`, async (route) => {
    const req = route.request(); const u = new URL(req.url());
    let q = Object.fromEntries(u.searchParams); if (req.method() === "POST") q = { ...q, ...JSON.parse(req.postData() || "{}") };
    const r = await handle({ method: req.method(), ...q }, S, clock);
    const body = JSON.stringify(r.body);
    const ok = revealedSoFar(); for (const nm of NAMES) if (body.includes(nm) && !ok.has(nm)) fail(`reply named ${nm} before its day was finished`);
    await route.fulfill({ status: r.status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body });
  });
  await page.route("https://myrobotisa.com/drive/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: PAGE }));
  await page.route("https://myrobotisa.com/avatar.png", (route) => route.fulfill({ status: 200, contentType: "image/png", body: Buffer.alloc(0) }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());

  // a member who opens a day early sees "opens on Monday"
  if (n % 10 === 0) {
    const was = clock; clock = OPEN - 2 * HOUR;
    await page.goto(`https://myrobotisa.com/drive/?t=${token}`);
    const t = await page.textContent("#msg");
    if (!/opens on Monday 7 December/.test(t || "")) fail("before 7 Dec the page didn't say when it opens");
    if (S.rows.get(token).started_at) fail("opening early started the clock");
    clock = was;
  }

  const visits = PATTERNS[kind](clock); const start = visits[0];
  for (const at of visits) {
    clock = at; stats.visits++;
    await page.goto(`https://myrobotisa.com/drive/?t=${token}`);
    await page.waitForSelector("#app:not(.hidden), #msg:not(.hidden)");
    const expectOpen = Math.min(7, lday(clock) - lday(start) + 1);
    const opened = await page.$$eval("#strip button:not([disabled])", (b) => b.length);
    if (opened !== expectOpen) fail(`on visit at ${new Date(clock).toISOString()} ${opened} days open, expected ${expectOpen}`);
    // the page must never be wider than the screen
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 1) fail(`page ${over}px wider than the screen`);
    if (kind === "gives_up" && at !== visits[0]) { stats.gave_up++; break; }
    // finish every open day not yet finished, in order, like a person catching up
    for (;;) {
      const done = S.rows.get(token).done; const next = done.length + 1;
      if (next > expectOpen) break;
      await page.click(`#strip button:nth-child(${next})`);
      const textBefore = await page.textContent("#app");
      const ok = revealedSoFar(); for (const nm of NAMES) if (textBefore.includes(nm) && !ok.has(nm)) fail(`page showed ${nm} on day ${next} before finishing it`);
      if (rnd() < 0.5) { stats.plays++; await page.click("#play"); await page.waitForFunction(() => /again/.test(document.querySelector("#play").textContent), null, { timeout: 15000 }); }
      // the pot tile at Monday morning must equal the day's start (the pot carries)
      const potStart = DAYS[next - 1].pot_start; const want = next === 1 ? 10000 : DAYS[next - 2].pot_end;
      if (Math.abs(potStart - want) > 0.011) fail(`day ${next} starts at ${potStart}, the day before ended at ${want}`);
      // every day says what the robot did at Friday's close, even if that was checking and holding
      const lines = await page.$$eval("#orders .order", (o) => o.length);
      if (!lines || await page.$eval("#ordersCard", (c) => c.classList.contains("hidden"))) fail(`day ${next} showed nothing for what the robot did`);
      await page.click("#finish");
      await page.waitForSelector("#revealCard:not(.hidden)");
      const shown = await page.$$eval("#reveal li", (l) => l.length);
      if (shown !== REV[next - 1].shares.length) fail(`day ${next} revealed ${shown} names, expected ${REV[next - 1].shares.length}`);
      if (rnd() < 0.15 && next > 1) { stats.back++; await page.click(`#strip button:nth-child(${next - 1})`); await page.waitForSelector("#revealCard:not(.hidden)"); }
    }
    // trying a day that hasn't opened: its button is disabled, and the function refuses it too
    if (expectOpen < 7 && rnd() < 0.3) {
      stats.early_tries++;
      const dis = await page.$eval(`#strip button:nth-child(${expectOpen + 1})`, (b) => b.disabled);
      if (!dis) fail(`day ${expectOpen + 1} button was clickable before it opened`);
      const r = await handle({ method: "POST", t: token, action: "done", day: expectOpen + 1 }, S, clock);
      if (r.status !== 403) fail(`finishing day ${expectOpen + 1} early returned ${r.status}`);
    }
  }
  const done = S.rows.get(token).done;
  if (done.length === 7) {
    stats.finished_all++;
    const end = await page.textContent("#endline");
    const g = (v) => "£" + v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (!end.includes(g(DAYS[6].pot_end)) || !end.includes(g(DAYS[6].fund_end))) fail(`end card said "${end}"`);
  } else if (kind !== "gives_up") fail(`finished ${done.length} of 7 days`);
  for (const e of errs) fail(`page error: ${e}`);
  await ctx.close();
}

const browser = await chromium.launch();
try { for (let n = 1; n <= COUNT; n++) await visitor(browser, n); } finally { await browser.close(); }
console.log(JSON.stringify(stats));
if (failures.length) { console.log(`${failures.length} failures:`); for (const f of failures.slice(0, 40)) console.log("  " + f); process.exit(1); }
console.log(`${COUNT} visitors, all passed`);
