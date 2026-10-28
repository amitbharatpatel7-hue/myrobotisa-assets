// Offline simulation of Robot Care's fix path and the members area's Accept fix / Ask a question (28 Oct 2026).
// node ops/supabase/functions/robot-care/test/accept_sim.mjs  -- no network: GitHub, Claude, Supabase and email are stubs.
import assert from "node:assert/strict";
import { fix } from "../handler.js";
import { acceptFix, askFix, checksFromMergeState } from "../accept.js";
import { guard, prRails, checksState, urgency, workflowOf, APP_BOT } from "../core.js";
import { fill } from "../ask_email.js";

let passed = 0;
const t = async (name, f) => { await f(); passed++; console.log("ok  ", name); };

// ---------- stubs
const UID = "11111111-1111-4111-8111-111111111111", OTHER = "22222222-2222-4222-8222-222222222222";
function makeStore(o = {}) {
  const s = {
    marks: [], notices: [], states: [], logs: [], reqCount: o.reqCount ?? 0, askFix: o.askFix ?? 0, askDay: o.askDay ?? 0,
    members: { byLogin: async () => ({ status: "active", robot_care: true, robot_care_until: null }) },
    seen: async () => false, counts: async () => ({ day: 0, month: 0, globalDay: 0 }), toldRecently: async () => false,
    mark: async (key, rec) => { s.marks.push({ key, ...rec }); },
    notice: async (login, n) => { s.notices.push({ login, ...n }); return true; },
    memberByUser: async (uid) => ({ [UID]: { user_id: UID, email: "alice@example.com", first_name: "Alice", status: o.status || "active", github_login: "Alice-GH", founding_no: 7 },
                                     [OTHER]: { user_id: OTHER, email: "bob@example.com", status: "active", github_login: "bob" } })[uid] || null,
    run: async (id) => (o.runs || RUNS)[id] || null,
    openRuns: async () => Object.values(o.runs || RUNS).filter((r) => r.outcome === "pr" && (r.fix_state || "open") !== "accepted"),
    setState: async (id, st) => { s.states.push([id, st]); return true; },
    installation: async () => (o.noInstall ? null : 4242),
    requests: async (uid, ms, kind, runId) => kind === "ask" ? (runId ? s.askFix : s.askDay) : s.reqCount,
    logRequest: async (rec) => { s.logs.push(rec); return true; },
  };
  return s;
}
const RUNS = { 7: { id: 7, outcome: "pr", login: "alice-gh", repo: "alice-gh/my-robot-isa", pr: "https://github.com/alice-gh/my-robot-isa/pull/4", pr_number: 4,
                    pr_title: "Fix the setup check", diagnosis: "A helper didn't exist.", fix_state: "open" },
               8: { id: 8, outcome: "advice", login: "alice-gh", repo: "alice-gh/my-robot-isa" } };
const SHA = "399d6a00c33db4781459b296076e522856052ce6";
function goodPR(over = {}) {
  return { number: 4, state: "open", merged: false, draft: false, commits: 1, mergeable: true, title: "Fix the setup check", body: "plain words",
    user: { login: APP_BOT, type: "Bot" }, head: { ref: "robot-care/run-1", sha: SHA, repo: { full_name: "alice-gh/my-robot-isa" } },
    base: { ref: "main", repo: { full_name: "alice-gh/my-robot-isa", default_branch: "main" } }, ...over };
}
const GOOD_FILES = [{ filename: "ops/member_setup_check.py", status: "modified", additions: 1, deletions: 1,
  patch: "@@ -10,3 +10,3 @@\n-    timeout = default_timeout()\n+    timeout = 30\n" }];
function makeGH(o = {}) {
  const g = { calls: [], merged: null };
  const api = {
    pull: async (repo, n) => { g.calls.push(["pull", repo, n]); return o.pr === undefined ? goodPR() : o.pr; },
    prFiles: async () => { g.calls.push(["files"]); return o.files || GOOD_FILES; },
    checks: async (repo, sha) => { g.calls.push(["checks", sha]); if (o.checks403) { const e = new Error("403"); e.status = 403; throw e; }
      return o.checks || { runs: { check_runs: [] }, combined: { state: "pending", statuses: [] } }; },
    merge: async (repo, n, sha, title) => { g.calls.push(["merge", repo, n, sha]); g.merged = { repo, n, sha, title }; return o.merge || { ok: true, status: 200, sha: "abc" }; },
  };
  g.factory = (inst) => { g.inst = inst; return api; };
  return g;
}
const accept = (args, store, gh) => acceptFix({ uid: UID, id: 7, ...args }, { store, gh: gh.factory });

// ---------- Robot Care opens the fix
const ISSUE = (wf) => `**${wf}** did not finish on Sun 25 Oct 2026, 18:02 GMT.\nRun: https://github.com/alice-gh/my-robot-isa/actions/runs/123\n`;
function fixDeps(store) {
  const comments = [];
  return { comments, deps: { store, members: store.members,
    gh: () => ({ runLog: async () => 'Traceback\n  File "ops/member_setup_check.py", line 10\nNameError', tree: async () => ["ops/member_setup_check.py"],
      file: async () => "def main():\n    timeout = default_timeout()\n", comment: async (r, i, b) => comments.push(b),
      openPR: async () => ({ url: "https://github.com/alice-gh/my-robot-isa/pull/4", number: 4 }) }),
    claude: { complete: async () => ({ usage: { input_tokens: 1000, output_tokens: 100 }, text: JSON.stringify({ action: "pr", diagnosis: "A helper didn't exist.",
      pr_title: "Fix the setup check", pr_body: "plain", edits: [{ path: "ops/member_setup_check.py", search: "default_timeout()", replace: "30" }] }) }) } } };
}
const EV = (wf) => ({ kind: "failure", installation: 1, repo: "alice-gh/my-robot-isa", owner: "alice-gh", issue: 3, runId: "123", title: "Robot run failed",
  issueBody: ISSUE(wf), workflow: workflowOf(ISSUE(wf)) });

await t("fix: records number, title, diagnosis, state; Message; comment points to the members area", async () => {
  const store = makeStore(); const { deps, comments } = fixDeps(store);
  const r = await fix(EV("Daily P&L"), deps);
  assert.equal(r.outcome, "pr");
  const m = store.marks[0];
  assert.equal(m.pr_number, 4); assert.equal(m.pr_title, "Fix the setup check"); assert.equal(m.diagnosis, "A helper didn't exist.");
  assert.equal(m.fix_state, "open"); assert.equal(m.urgent, false);
  assert.equal(store.notices.length, 1); assert.equal(store.notices[0].title, "Robot Care has a fix for you"); assert.equal(store.notices[0].link_url, "#fixes");
  assert.match(comments.at(-1), /myrobotisa\.com\/members\/#fixes/); assert.match(comments.at(-1), /Merge/);
});
await t("fix: a failed Weekly signals or Execute approved orders run is urgent", async () => {
  for (const wf of ["Weekly signals", "Execute approved orders"]) {
    const store = makeStore(); const { deps } = fixDeps(store);
    await fix(EV(wf), deps);
    assert.equal(store.marks[0].urgent, true, wf); assert.match(store.notices[0].title, /urgent/); assert.match(store.notices[0].body, /main job/);
  }
  assert.equal(urgency({ issueBody: ISSUE("Daily P&L") }), false);
});
await t("fix: a Message that fails never undoes the fix", async () => {
  const store = makeStore(); store.notice = async () => { throw new Error("db down"); }; const { deps } = fixDeps(store);
  assert.equal((await fix(EV("Daily P&L"), deps)).outcome, "pr");
});
await t("rails unchanged: guard still refuses execute.py and protected settings", async () => {
  assert.equal(guard([{ path: "execute.py", search: "a", replace: "b" }], { "execute.py": "a" }).ok, false);
  assert.equal(guard([{ path: "x.py", search: "a", replace: "ORDER_MODE = 'live'" }], { "x.py": "a" }).ok, false);
});

// ---------- Accept fix
await t("accept: happy path merges, pinned to the checked commit, and says Fixed", async () => {
  const store = makeStore(), gh = makeGH();
  const r = await accept({}, store, gh);
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.fix_state, "accepted");
  assert.deepEqual(gh.merged && [gh.merged.repo, gh.merged.n, gh.merged.sha], ["alice-gh/my-robot-isa", 4, SHA]);
  assert.equal(gh.inst, 4242);
  assert.deepEqual(store.states, [[7, "accepted"]]);
  assert.equal(store.notices[0].body, "Fixed. Your robot uses it from its next run.");
  assert.equal(store.logs[0].kind, "accept"); assert.equal(store.logs[0].ok, true);
});
await t("accept: another member's fix is not found, and GitHub is never called", async () => {
  const store = makeStore(), gh = makeGH();
  const r = await acceptFix({ uid: OTHER, id: 7 }, { store, gh: gh.factory });
  assert.equal(r.status, 404); assert.equal(gh.calls.length, 0); assert.equal(store.states.length, 0);
});
await t("accept: not a member / unknown id / an advice row", async () => {
  const gh = makeGH();
  assert.equal((await acceptFix({ uid: "nobody", id: 7 }, { store: makeStore(), gh: gh.factory })).status, 404);
  assert.equal((await accept({ id: 99 }, makeStore(), gh)).status, 404);
  assert.equal((await accept({ id: 8 }, makeStore(), gh)).status, 404);
  assert.equal(gh.merged, null);
});
for (const [name, pr, code] of [
  ["a PR a person opened", goodPR({ user: { login: "alice-gh", type: "User" } }), "not-robot-care"],
  ["a bot that isn't Robot Care", goodPR({ user: { login: "dependabot[bot]", type: "Bot" } }), "not-robot-care"],
  ["a branch that isn't robot-care/", goodPR({ head: { ref: "main2", sha: SHA, repo: { full_name: "alice-gh/my-robot-isa" } } }), "not-robot-care"],
  ["a fork's branch", goodPR({ head: { ref: "robot-care/run-1", sha: SHA, repo: { full_name: "mallory/my-robot-isa" } } }), "not-robot-care"],
  ["a second commit pushed onto the fix", goodPR({ commits: 2 }), "changed"],
  ["aimed at another branch", goodPR({ base: { ref: "dev", repo: { full_name: "alice-gh/my-robot-isa", default_branch: "main" } } }), "wrong-base"],
  ["a merge conflict", goodPR({ mergeable: false }), "conflict"],
  ["GitHub still working out mergeability", goodPR({ mergeable: null }), "not-ready"],
  ["a draft", goodPR({ draft: true }), "draft"],
]) await t(`accept refuses ${name}`, async () => {
  const store = makeStore(), gh = makeGH({ pr });
  const r = await accept({}, store, gh);
  assert.equal(r.status, 409); assert.equal(r.body.code, code); assert.equal(gh.merged, null); assert.equal(store.logs[0].ok, false);
});
await t("accept: checks failing holds the merge", async () => {
  const gh = makeGH({ checks: { runs: { check_runs: [{ name: "Checks", status: "completed", conclusion: "failure" }] }, combined: { statuses: [] } } });
  const r = await accept({}, makeStore(), gh);
  assert.equal(r.body.code, "checks-failing"); assert.match(r.body.error, /Checks/); assert.equal(gh.merged, null);
});
await t("accept: checks still running holds the merge", async () => {
  const gh = makeGH({ checks: { runs: { check_runs: [{ name: "Checks", status: "in_progress" }] }, combined: { statuses: [] } } });
  assert.equal((await accept({}, makeStore(), gh)).body.code, "checks-pending"); assert.equal(gh.merged, null);
  const gh2 = makeGH({ checks: { runs: { check_runs: [] }, combined: { statuses: [{ context: "ci", state: "error" }] } } });
  assert.equal((await accept({}, makeStore(), gh2)).body.code, "checks-failing");
});
for (const [name, files] of [
  ["execute.py", [{ filename: "execute.py", status: "modified", additions: 1, deletions: 1, patch: "-a\n+b" }]],
  ["a workflow", [{ filename: ".github/workflows/weekly-signals.yml", status: "modified", additions: 1, deletions: 1, patch: "-a\n+b" }]],
  ["a protected setting in the patch", [{ filename: "ops/x.py", status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1,2 @@\n a\n+ORDER_MODE = 'live'" }]],
  ["a new file", [{ filename: "ops/new.py", status: "added", additions: 3, deletions: 0, patch: "+a" }]],
  ["a change too big to show", [{ filename: "ops/x.py", status: "modified", additions: 400, deletions: 0 }]],
  ["too many lines", [{ filename: "ops/x.py", status: "modified", additions: 81, deletions: 0, patch: "+a" }]],
  ["a file type outside the list", [{ filename: "ops/x.sh", status: "modified", additions: 1, deletions: 1, patch: "-a\n+b" }]],
]) await t(`accept refuses a fix that now touches ${name}`, async () => {
  const gh = makeGH({ files }); const r = await accept({}, makeStore(), gh);
  assert.equal(r.body.code, "rails"); assert.equal(gh.merged, null);
});
await t("accept: already merged on GitHub -> accepted, no second merge", async () => {
  const store = makeStore(), gh = makeGH({ pr: goodPR({ state: "closed", merged: true }) });
  const r = await accept({}, store, gh);
  assert.equal(r.status, 200); assert.equal(r.body.fix_state, "accepted"); assert.deepEqual(store.states, [[7, "accepted"]]); assert.equal(gh.merged, null);
  assert.ok(!gh.calls.some((c) => c[0] === "files"));
});
await t("accept: closed on GitHub -> closed", async () => {
  const store = makeStore(), gh = makeGH({ pr: goodPR({ state: "closed" }) });
  const r = await accept({}, store, gh); assert.equal(r.body.code, "closed"); assert.deepEqual(store.states, [[7, "closed"]]);
  const gone = makeGH({ pr: null }); assert.equal((await accept({}, makeStore(), gone)).body.code, "no-pr");
});
await t("accept: already accepted here", async () => {
  const store = makeStore({ runs: { 7: { ...RUNS[7], fix_state: "accepted" } } }), gh = makeGH();
  assert.equal((await accept({}, store, gh)).body.code, "done"); assert.equal(gh.merged, null);
});
await t("accept: a declined fix can still be accepted later", async () => {
  const store = makeStore({ runs: { 7: { ...RUNS[7], fix_state: "declined" } } }), gh = makeGH();
  assert.equal((await accept({}, store, gh)).status, 200); assert.ok(gh.merged);
});
await t("accept: Robot Care uninstalled", async () => {
  const gh = makeGH(); const r = await accept({}, makeStore({ noInstall: true }), gh);
  assert.equal(r.body.code, "not-installed"); assert.equal(gh.calls.length, 0);
});
await t("accept: GitHub refuses the merge (changed since checked, rules, permission)", async () => {
  for (const [st, re] of [[409, /changed while/], [405, /rule/], [403, /permission/]]) {
    const store = makeStore(), gh = makeGH({ merge: { ok: false, status: st } });
    const r = await accept({}, store, gh);
    assert.equal(r.status, 409); assert.match(r.body.error, re); assert.equal(store.states.length, 0);
  }
});
await t("accept: 10 an hour per member, failing closed when the count is unavailable", async () => {
  const gh = makeGH();
  assert.equal((await accept({}, makeStore({ reqCount: 10 }), gh)).status, 429);
  const s = makeStore(); s.requests = async () => null; assert.equal((await accept({}, s, gh)).status, 503);
  assert.equal(gh.calls.length, 0);
});
await t("decline: Not now marks it declined and touches nothing on GitHub", async () => {
  const store = makeStore(), gh = makeGH();
  const r = await accept({ action: "decline" }, store, gh);
  assert.equal(r.status, 200); assert.deepEqual(store.states, [[7, "declined"]]); assert.equal(gh.calls.length, 0);
  assert.equal((await accept({ action: "decline" }, makeStore({ runs: { 7: { ...RUNS[7], fix_state: "accepted" } } }), gh)).status, 409);
  assert.equal((await accept({ action: "merge-everything" }, makeStore(), gh)).status, 400);
});
await t("sync: marks fixes merged or closed on GitHub", async () => {
  const runs = { 7: RUNS[7], 9: { ...RUNS[7], id: 9, pr_number: 5 }, 10: { ...RUNS[7], id: 10, pr_number: 6 } };
  const store = makeStore({ runs });
  const prs = { 4: goodPR({ state: "closed", merged: true }), 5: goodPR({ state: "closed" }), 6: goodPR() };
  const gh = { factory: () => ({ pull: async (r, n) => prs[n] }) };
  const r = await acceptFix({ uid: UID, action: "sync" }, { store, gh: gh.factory });
  assert.equal(r.body.changed, 2); assert.deepEqual(store.states.sort(), [[7, "accepted"], [9, "closed"]]);
});

// ---------- Ask a question
const claudeSays = (j) => ({ calls: [], complete: async function (p) { this.calls.push(p); return { text: typeof j === "string" ? j : JSON.stringify(j) }; } });
await t("ask: answered in plain words, logged and posted to Messages", async () => {
  const store = makeStore(), claude = claudeSays({ answer: "It swaps a missing helper for 30 seconds.", can_answer: true }); let mailed = 0;
  const r = await askFix({ uid: UID, id: 7, question: "  Is it  safe? " }, { store, gh: makeGH().factory, claude, mail: async () => { mailed++; return true; } });
  assert.equal(r.status, 200); assert.equal(r.body.answer, "It swaps a missing helper for 30 seconds."); assert.equal(mailed, 0);
  assert.equal(store.logs[0].question, "Is it safe?"); assert.equal(store.notices[0].title, "Robot Care answered your question");
  assert.match(claude.calls[0].system, /Never give investment or financial advice/); assert.match(claude.calls[0].user, /default_timeout/);
  assert.equal(claude.calls[0].maxTokens, 600);
});
await t("ask: can't answer -> one email to Amit, member told a person will reply", async () => {
  const store = makeStore(); const sent = [];
  const r = await askFix({ uid: UID, id: 7, question: "Should I buy more <b>gold</b>?" }, { store, gh: makeGH().factory,
    claude: claudeSays({ answer: "", can_answer: false }), mail: async (v) => { sent.push(v); return true; } });
  assert.equal(r.body.answered, false); assert.match(r.body.message, /passed this to a person/);
  assert.equal(sent.length, 1); assert.equal(sent[0].pr, RUNS[7].pr); assert.equal(sent[0].replyTo, "alice@example.com");
  assert.equal(store.logs[0].handed_over, true); assert.equal(store.notices.length, 0);
  const m = fill(sent[0]);
  assert.match(m.subject, /^\(Internal\) \[My Robot I\.S\.A\. · Support\] A member asked about a Robot Care fix$/);
  assert.ok(m.html.includes("&lt;b&gt;gold&lt;/b&gt;") && !m.html.includes("<b>gold</b>")); assert.match(m.text, /<b>gold<\/b>/);
  assert.ok(!/\{\{\w+\}\}/.test(m.html + m.text));
  assert.match(m.html, /color-scheme" content="light only"/);
});
await t("ask: Claude down or nonsense -> handed to a person", async () => {
  for (const claude of [{ complete: async () => { throw new Error("529"); } }, claudeSays("sorry, no JSON"), claudeSays({ answer: "yes", can_answer: "yes" })]) {
    let n = 0; const r = await askFix({ uid: UID, id: 7, question: "why?" }, { store: makeStore(), gh: makeGH().factory, claude, mail: async () => (++n, true) });
    assert.equal(r.body.answered, false); assert.equal(n, 1);
  }
});
await t("ask: email failing tells the member to write in", async () => {
  const r = await askFix({ uid: UID, id: 7, question: "why?" }, { store: makeStore(), gh: makeGH().factory, claude: claudeSays({ can_answer: false }), mail: async () => false });
  assert.equal(r.status, 502); assert.match(r.body.error, /hello@myrobotisa\.com/);
});
await t("ask: caps (5 a fix, 10 a day), length, lapsed members, other members' fixes", async () => {
  const deps = (s) => ({ store: s, gh: makeGH().factory, claude: claudeSays({ answer: "x", can_answer: true }), mail: async () => true });
  assert.equal((await askFix({ uid: UID, id: 7, question: "q" }, deps(makeStore({ askFix: 5 })))).status, 429);
  assert.equal((await askFix({ uid: UID, id: 7, question: "q" }, deps(makeStore({ askDay: 10 })))).status, 429);
  assert.equal((await askFix({ uid: UID, id: 7, question: "x".repeat(601) }, deps(makeStore()))).status, 400);
  assert.equal((await askFix({ uid: UID, id: 7, question: "" }, deps(makeStore()))).status, 400);
  assert.equal((await askFix({ uid: UID, id: 7, question: "q" }, deps(makeStore({ status: "lapsed" })))).status, 404);
  assert.equal((await askFix({ uid: OTHER, id: 7, question: "q" }, deps(makeStore()))).status, 404);
});
await t("ask: a PR someone else opened is never described", async () => {
  const claude = claudeSays({ answer: "x", can_answer: true });
  await askFix({ uid: UID, id: 7, question: "q" }, { store: makeStore(), gh: makeGH({ pr: goodPR({ user: { login: "mallory", type: "User" } }) }).factory, claude, mail: async () => true });
  assert.ok(!/default_timeout/.test(claude.calls[0].user));
});

await t("accept: without the Checks permission, GitHub's mergeable_state decides", async () => {
  const ok = makeGH({ checks403: true, pr: goodPR({ mergeable_state: "clean" }) });
  assert.equal((await accept({}, makeStore(), ok)).status, 200); assert.ok(ok.merged);
  for (const [st, code] of [["unstable", "checks-failing"], ["blocked", "checks-failing"], ["unknown", "checks-pending"], [undefined, "checks-pending"]]) {
    const gh = makeGH({ checks403: true, pr: goodPR({ mergeable_state: st }) });
    assert.equal((await accept({}, makeStore(), gh)).body.code, code, String(st)); assert.equal(gh.merged, null);
  }
  const boom = makeGH({ checks403: true }); boom.factory = () => ({ ...makeGH().factory(), checks: async () => { const e = new Error("500"); e.status = 500; throw e; } });
  assert.equal((await accept({}, makeStore(), boom)).status, 502, "other GitHub errors are not treated as passed");
  assert.equal(checksFromMergeState("dirty").state, "passed");
});

// ---------- pure helpers
await t("checksState and prRails", async () => {
  assert.equal(checksState({ check_runs: [] }, { state: "pending", statuses: [] }).state, "passed");
  assert.equal(checksState({ check_runs: [{ name: "a", status: "completed", conclusion: "skipped" }] }, null).state, "passed");
  assert.equal(prRails(GOOD_FILES).ok, true); assert.equal(prRails([]).ok, false);
});

console.log(`\n${passed} passed`);
