// Robot Care, Accept fix and Ask a question (28 Oct 2026, hub DECISIONS D25 stage 1).
// A member taps Accept fix in the members area; robot-care-accept calls acceptFix(), which re-checks everything with
// GitHub and merges Robot Care's pull request with the App's own installation token. No member ever needs GitHub.
// Network goes through deps only (store, gh, claude, mail), so test/accept_sim.mjs runs all of it offline.
import { acceptDecision, checksState, askPrompt, parseAnswer, APP_BOT, ACCEPT_LIMITS, ASK_LIMITS } from "./core.js";

const out = (status, body) => ({ status, body });
const HOUR = 36e5, DAY = 864e5;
const NOT_FOUND = "We couldn't find that fix.";
const NO_MEMBER = "We couldn't find your membership. Sign out and in again, or email hello@myrobotisa.com.";
const NOT_INSTALLED = "Robot Care isn't installed on your robot's copy any more, so it can't apply the fix. Switch it back on in Set up my robot, step 5.";

async function ownedRun(store, member, id) {
  const run = await store.run(id);
  if (!run || run.outcome !== "pr" || !run.pr_number) return null;
  if (!member.github_login || String(run.login || "").toLowerCase() !== member.github_login.toLowerCase()) return null;   // never say whose it is
  return run;
}

// The Robot Care App has Pull requests and Contents permissions but not Checks or Commit statuses (28 Oct 2026), so
// GitHub refuses the checks APIs (403). Then GitHub's own verdict on the pull request stands in: mergeable_state is
// "clean" only when every check has passed and nothing blocks the merge.
export function checksFromMergeState(state) {
  if (["clean", "has_hooks", "behind", "dirty"].includes(state)) return { state: "passed", names: [] };   // dirty = a conflict, caught by mergeable
  if (state === "unstable") return { state: "failing", names: ["a check on your copy"] };
  if (state === "blocked") return { state: "failing", names: ["a rule on your copy that needs a check or a review first"] };
  return { state: "pending", names: [] };   // "unknown" or missing: GitHub is still working it out
}

async function lookAtPR(g, run) {
  const pr = await g.pull(run.repo, run.pr_number);
  if (!pr || pr.state !== "open" || pr.merged) return { pr, files: [], checks: null };
  const files = await g.prFiles(run.repo, run.pr_number);
  let checks;
  try { const c = await g.checks(run.repo, pr.head.sha); checks = checksState(c.runs, c.combined); }
  catch (e) { if (e?.status !== 403 && e?.status !== 404) throw e; checks = checksFromMergeState(pr.mergeable_state); }
  return { pr, files, checks };
}

export async function acceptFix({ uid, id, action = "accept" }, deps) {
  const { store } = deps;
  const member = await store.memberByUser(uid);
  if (!member || !["active", "lapsed"].includes(member.status)) return out(404, { error: NO_MEMBER });
  if (action === "sync") return syncFixes(member, deps);
  if (!["accept", "decline"].includes(action)) return out(400, { error: "Accept or decline only." });
  const used = await store.requests(member.user_id, HOUR, "accept,decline");
  if (used === null) return out(503, { error: "Robot Care can't check that just now. Try again in a minute." });   // fail closed
  if (used >= ACCEPT_LIMITS.perMemberPerHour) return out(429, { error: "That's a lot of taps in one hour. Try again a little later." });
  const run = await ownedRun(store, member, id);
  if (!run) return out(404, { error: NOT_FOUND });
  const log = (ok, detail) => store.logRequest({ user_id: member.user_id, run_id: run.id, kind: action, ok, detail: String(detail || "").slice(0, 300) || null });

  if (action === "decline") {
    if ((run.fix_state || "open") !== "open") return out(409, { error: "This fix has already been decided." });
    await store.setState(run.id, "declined"); await log(true, "not now");
    return out(200, { ok: true, fix_state: "declined", message: "Left as it is. The fix stays under Earlier if you change your mind." });
  }

  const inst = await store.installation(member.github_login);
  if (!inst) { await log(false, "not installed"); return out(409, { error: NOT_INSTALLED, code: "not-installed" }); }
  const g = deps.gh(inst);
  let look;
  try { look = await lookAtPR(g, run); }
  catch (e) { await log(false, `github ${e?.status || ""}`); return out(502, { error: e?.status === 403 ? "Robot Care doesn't have permission to read this fix on GitHub. We've been told." : "GitHub didn't answer. Try again in a minute." }); }
  const d = acceptDecision({ member, run, pr: look.pr, files: look.files, checks: look.checks });
  if (!d.ok) {
    if (d.state) await store.setState(run.id, d.state);
    await log(false, d.code);
    if (d.code === "merged") return out(200, { ok: true, fix_state: "accepted", message: d.why });
    return out(409, { error: d.why, code: d.code, ...(d.state ? { fix_state: d.state } : {}) });
  }
  const m = await g.merge(run.repo, run.pr_number, look.pr.head.sha, `${look.pr.title} (#${run.pr_number})`);
  if (!m.ok) {
    await log(false, `merge ${m.status}`);
    const why = m.status === 409 ? "The fix changed while we were checking it. Nothing was merged: open Robot Care fixes again and take another look."
      : m.status === 405 ? "GitHub won't merge this fix yet: your copy has a rule that needs something first (a check or a review). Open it on GitHub to see what."
      : m.status === 403 || m.status === 404 ? "Robot Care doesn't have permission to merge on your copy. Nothing changed. We've been told."
      : "GitHub didn't merge it. Nothing changed. Try again in a minute.";
    return out(409, { error: why, code: `merge-${m.status}` });
  }
  await store.setState(run.id, "accepted");
  await log(true, `merged ${String(m.sha || "").slice(0, 12)}`);
  try { await store.notice(member.github_login, { title: "Fixed", body: "Fixed. Your robot uses it from its next run.", link_url: "#fixes", link_text: "Robot Care fixes" }); } catch { /* the page shows it anyway */ }
  return out(200, { ok: true, fix_state: "accepted", message: "Fixed. Your robot uses it from its next run." });
}

// When the members area opens Robot Care fixes: anything merged or closed on GitHub since is marked so here.
export async function syncFixes(member, deps) {
  const { store } = deps;
  if (!member.github_login) return out(200, { ok: true, changed: 0 });
  const runs = await store.openRuns(member.github_login);
  if (!runs.length) return out(200, { ok: true, changed: 0 });
  const inst = await store.installation(member.github_login);
  if (!inst) return out(200, { ok: true, changed: 0, installed: false });
  const g = deps.gh(inst);
  let changed = 0;
  for (const run of runs.slice(0, 10)) {
    try {
      const pr = await g.pull(run.repo, run.pr_number);
      const st = !pr ? "closed" : pr.merged ? "accepted" : pr.state === "closed" ? "closed" : null;
      if (st && st !== run.fix_state) { await store.setState(run.id, st); changed++; }
    } catch { /* leave it as it is; the next open tries again */ }
  }
  return out(200, { ok: true, changed });
}

export async function askFix({ uid, id, question }, deps) {
  const { store } = deps;
  const q = String(question || "").replace(/\s+/g, " ").trim();
  if (!q) return out(400, { error: "Type your question first." });
  if (q.length > ASK_LIMITS.maxChars) return out(400, { error: `Keep it under ${ASK_LIMITS.maxChars} characters.` });
  const member = await store.memberByUser(uid);
  if (!member || member.status !== "active") return out(404, { error: NO_MEMBER });
  const run = await ownedRun(store, member, id);
  if (!run) return out(404, { error: NOT_FOUND });
  const [perFix, perDay] = await Promise.all([store.requests(member.user_id, 3650 * DAY, "ask", run.id), store.requests(member.user_id, DAY, "ask")]);
  if (perFix === null || perDay === null) return out(503, { error: "Robot Care can't take questions just now. Try again in a minute." });
  if (perFix >= ASK_LIMITS.perFix) return out(429, { error: `You've asked ${ASK_LIMITS.perFix} questions about this fix. For more, email hello@myrobotisa.com.` });
  if (perDay >= ASK_LIMITS.perMemberPerDay) return out(429, { error: "That's today's questions. Ask again tomorrow, or email hello@myrobotisa.com." });

  let pr = null, files = [];
  const inst = await store.installation(member.github_login);
  if (inst) { try { const g = deps.gh(inst); pr = await g.pull(run.repo, run.pr_number); if (pr) files = await g.prFiles(run.repo, run.pr_number); } catch { /* answer from the diagnosis */ } }
  if (pr && (pr.user?.login !== APP_BOT)) { pr = null; files = []; }   // only ever describe what Robot Care wrote

  let a = { answer: "", can_answer: false };
  try { a = parseAnswer((await deps.claude.complete({ ...askPrompt({ run, pr, files, question: q }), maxTokens: 600 })).text); } catch { /* hand it to a person */ }
  if (a.can_answer) {
    await store.logRequest({ user_id: member.user_id, run_id: run.id, kind: "ask", ok: true, question: q, answer: a.answer });
    try { await store.notice(member.github_login, { title: "Robot Care answered your question", body: a.answer, link_url: "#fixes", link_text: "See the fix" }); } catch { /* shown on the page */ }
    return out(200, { ok: true, answered: true, answer: a.answer });
  }
  let sent = false;
  try {
    sent = await deps.mail({ member: `${member.first_name || "A member"} (${member.email}${member.founding_no ? `, founding #${member.founding_no}` : ""})`,
      question: q, repo: run.repo, title: run.pr_title || pr?.title || `Fix #${run.pr_number}`, diagnosis: run.diagnosis || "(not recorded)",
      state: run.fix_state || "open", pr: /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(run.pr || "") ? run.pr : "https://github.com" , replyTo: member.email,
      key: `rc-ask-${run.id}-${perFix + 1}` });
  } catch { sent = false; }
  await store.logRequest({ user_id: member.user_id, run_id: run.id, kind: "ask", ok: sent, question: q, handed_over: true, detail: sent ? "emailed Amit" : "email failed" });
  if (!sent) return out(502, { error: "We couldn't pass your question on just now. Email it to hello@myrobotisa.com and we'll answer." });
  return out(200, { ok: true, answered: false, message: "We've passed this to a person; you'll get a reply in Messages or by email." });
}
