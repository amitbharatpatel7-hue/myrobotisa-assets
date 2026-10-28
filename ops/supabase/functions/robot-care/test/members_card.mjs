// Members area: the Robot Care fixes card (28 Oct 2026). Serves docs/ locally, signs in with a stub session and answers
// my_robot_care_fixes() from a LOCAL Postgres mirror (pg_mirror.sql + the migration), so the real SQL decides what the
// member sees. The two edge functions are stubbed. Run as root in the cloud sandbox:
//   node ops/supabase/functions/robot-care/test/members_card.mjs
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, "../../../../.."), DOCS = path.join(ROOT, "docs");
const psql = (sql, db = "rc") => execFileSync("su", ["postgres", "-c", `psql -X -q -t -A -d ${db} -v ON_ERROR_STOP=1`], { input: sql }).toString();

// ---- database: mirror + migration + two members' fixes
execFileSync("su", ["postgres", "-c", "psql -X -q -v ON_ERROR_STOP=1"], { input: require("fs").readFileSync(path.join(HERE, "pg_mirror.sql")) });
psql(require("fs").readFileSync(path.join(ROOT, "ops/supabase/2026-10-28-robot-care-fixes.sql"), "utf8"));
const ALICE = "11111111-1111-4111-8111-111111111111", BOB = "22222222-2222-4222-8222-222222222222";
psql(`insert into members(user_id,email,github_login) values ('${ALICE}','alice@example.com','Alice-GH'),('${BOB}','bob@example.com','bob');
insert into robot_care_runs(key,outcome,login,repo,pr,pr_number,pr_title,diagnosis,files,urgent,fix_state) values
 ('a1','pr','alice-gh','alice-gh/r','https://github.com/alice-gh/r/pull/4',4,'Fix the weekly plan','The weekly plan stopped because a date was read the wrong way.','{signals_report.py}',true,'open'),
 ('a2','pr','alice-gh','alice-gh/r','https://github.com/alice-gh/r/pull/2',2,'Fix the setup check','A helper did not exist.','{ops/member_setup_check.py}',false,'accepted'),
 ('b1','pr','bob','bob/r','https://github.com/bob/r/pull/9',9,'BOB SECRET FIX','bob only','{x.py}',false,'open');`);
const fixesFor = (uid) => JSON.parse(psql(`begin; set local role authenticated; set local request.jwt.claims='{"sub":"${uid}"}';
  select coalesce(json_agg(f), '[]')::text from my_robot_care_fixes() f; rollback;`).replace(/\n/g, " ").trim());

// ---- serve docs/
const PORT = 8731;
const srv = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", DOCS], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64({ alg: "HS256" })}.${b64({ sub, exp: 4102444800 })}.sig`;

let passed = 0;
async function run(name, uid, acceptReply, f) {
  const browser = await chromium.launch(), page = await browser.newPage();
  const calls = [];
  page.on("pageerror", (e) => calls.push(["pageerror", String(e)]));
  await page.route("https://vxnestmhtjotidhzzqbo.supabase.co/**", async (route) => {
    const u = new URL(route.request().url()), p = u.pathname, body = route.request().postData();
    const json = (o, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(o) });
    if (p.endsWith("/rpc/my_robot_care_fixes")) { calls.push(["list"]); return json(fixesFor(uid)); }
    if (p.endsWith("/functions/v1/robot-care-accept")) { const b = JSON.parse(body || "{}"); calls.push(["accept", b]); return json(...acceptReply(b)); }
    if (p.endsWith("/functions/v1/robot-care-ask")) { const b = JSON.parse(body || "{}"); calls.push(["ask", b]); return json({ ok: true, answered: true, answer: "It changes how one date is read. It can't place orders." }); }
    if (p.endsWith("/rest/v1/members")) return json([{ email: "alice@example.com", plan: "founding", status: "active", joined_at: "2026-10-01", updates_until: "2027-10-01", founding_no: 7, preview_videos: true }]);
    if (p.includes("/rest/v1/rpc/")) return json([]);
    if (p.includes("/rest/v1/")) return json([]);
    if (p.includes("/functions/v1/")) return json({});
    return json({});
  });
  await page.addInitScript(([s]) => localStorage.setItem("mri-members-session", JSON.stringify(s)),
    [{ access_token: jwt(uid), refresh_token: "r", expires_at: 4102444800, email: "alice@example.com" }]);
  try { await f(page, calls); passed++; console.log("ok  ", name); }
  finally { await browser.close(); }
}
const OK = (b) => b.action === "sync" ? [{ ok: true, changed: 0 }] : b.action === "decline" ? [{ ok: true, fix_state: "declined", message: "Left as it is." }] : [{ ok: true, fix_state: "accepted", message: "Fixed. Your robot uses it from its next run." }];
const URL_ = `http://127.0.0.1:${PORT}/members/`;

try {
  await run("home shows the waiting fix, urgent, and never another member's", ALICE, OK, async (page, calls) => {
    await page.goto(URL_ + "#home"); await page.waitForSelector("#rcf:not([hidden]) .rcf-item");
    const txt = await page.textContent("#rcf");
    assert.match(txt, /Fix the weekly plan/); assert.match(txt, /Urgent/); assert.match(txt, /main job/);
    assert.doesNotMatch(txt, /BOB SECRET/); assert.doesNotMatch(txt, /Fix the setup check/, "accepted fixes stay under Earlier on the fixes page");
    assert.equal(await page.isVisible("#rcf-nav"), true);
    assert.ok(!calls.some((c) => c[0] === "pageerror"), JSON.stringify(calls));
  });
  await run("#fixes lists Earlier; Accept asks in the page, then calls robot-care-accept with the fix id", ALICE, OK, async (page, calls) => {
    let dialog = false; page.on("dialog", (d) => { dialog = true; d.dismiss(); });
    await page.goto(URL_ + "#fixes"); await page.waitForSelector("#rcf .rcf-item");
    assert.equal(await page.isVisible("#rcf-old"), true);
    assert.ok(calls.some((c) => c[0] === "accept" && c[1].action === "sync"), "opening #fixes syncs with GitHub");
    const id = fixesFor(ALICE).find((x) => x.fix_state === "open").id;
    await page.click('#rcf-list [data-act="accept"]');
    assert.equal(await page.isVisible('#rcf-list [data-box="confirm"]'), true);
    assert.ok(!calls.some((c) => c[0] === "accept" && !c[1].action), "nothing merges before the confirm");
    await page.click('#rcf-list [data-act="yes"]');
    await page.waitForFunction(() => /Fixed/.test(document.getElementById("rcf-msg").textContent));
    assert.deepEqual(calls.find((c) => c[0] === "accept" && !c[1].action)[1], { id });
    assert.equal(dialog, false, "no window.confirm");
    assert.equal(await page.locator("#rcf-list .rcf-item").count(), 0);
    assert.match(await page.textContent("#rcf-old-list"), /In your robot/);
  });
  await run("an error from robot-care-accept is shown and nothing changes", ALICE,
    (b) => b.action ? [{ ok: true, changed: 0 }] : [{ error: "Your robot's checks failed on this fix (Checks), so it won't be merged.", code: "checks-failing" }, 409], async (page) => {
    await page.goto(URL_ + "#fixes"); await page.waitForSelector("#rcf-list .rcf-item");
    await page.click('#rcf-list [data-act="accept"]'); await page.click('#rcf-list [data-act="yes"]');
    await page.waitForFunction(() => /checks failed/.test(document.querySelector("#rcf-list .rcf-st").textContent));
    assert.equal(await page.locator("#rcf-list .rcf-item").count(), 1, "still waiting");
    assert.equal(await page.isEnabled('#rcf-list [data-act="yes"]'), true, "buttons come back");
  });
  await run("Ask a question shows the answer in the card; Not now moves it to Earlier", ALICE, OK, async (page, calls) => {
    await page.goto(URL_ + "#fixes"); await page.waitForSelector("#rcf-list .rcf-item");
    await page.click('#rcf-list [data-act="ask"]'); await page.fill("#rcf-list textarea", "Is it safe?");
    await page.click('#rcf-list [data-act="send"]'); await page.waitForSelector("#rcf-list .rcf-ans");
    assert.match(await page.textContent("#rcf-list .rcf-ans"), /can't place orders/);
    assert.equal(calls.find((c) => c[0] === "ask")[1].question, "Is it safe?");
    await page.click('#rcf-list [data-act="decline"]');
    await page.waitForFunction(() => document.querySelectorAll("#rcf-list .rcf-item").length === 0);
    assert.match(await page.textContent("#rcf-old-list"), /Not now/);
    await page.setViewportSize({ width: 390, height: 844 }); await page.reload(); await page.waitForSelector("#rcf-list .rcf-item");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no sideways scroll on a phone");
    await page.screenshot({ path: path.join(process.env.SHOT_DIR || "/tmp", "rcf-phone.png"), fullPage: false });
  });
  await run("a member with no fixes: the home card stays hidden, #fixes says so", "33333333-3333-4333-8333-333333333333", OK, async (page) => {
    await page.goto(URL_ + "#home"); await page.waitForTimeout(1200);
    assert.equal(await page.isHidden("#rcf"), true);
    await page.goto(URL_ + "#fixes"); await page.waitForSelector("#rcf-empty:not([hidden])");
  });
} finally { srv.kill(); }
console.log(`\n${passed} passed`);
