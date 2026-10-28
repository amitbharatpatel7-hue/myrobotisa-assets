// Robot Care, core logic (24 Oct 2026). Pure functions only: no network, so the whole decision path can be
// simulated offline and then run unchanged inside the edge function (Deno) or Node.
// 28 Oct 2026 (D25 stage 1, Accept fix): urgency(), prRails() and acceptDecision() decide whether a member's tap on
// Accept fix in the members area may merge Robot Care's pull request. They re-check the same rails as guard().

export const RAILS = {
  forbiddenPaths: [/^execute\.py$/, /^broker_t212\.py$/, /^approvals\.py$/, /^universe\.json$/, /^\.github\//, /^kit-features\.json$/,
                   /^state\//, /(^|\/)\.env/, /secret/i],
  forbiddenText: [/T212_ENV/, /ORDER_MODE/, /EXECUTE_ORDERS/, /\bHALT\b/, /max_drawdown|drawdown_halt|halt_at/, /max_position|position_cap/,
                  /min_order|MIN_ORDER/, /max_data_age_days|stale/i, /pending_order/, /RESEND_API_KEY|T212_API_(KEY|SECRET)|ANTHROPIC_API_KEY/,
                  /\bcron\s*:/, /https?:\/\/(?!myrobotisa\.com|api\.resend\.com|live\.trading212\.com|demo\.trading212\.com)[a-z0-9.-]+/i],
  allowedExt: /\.(py|md|txt|json|yml|yaml|csv)$/,
  maxFiles: 4,
  maxChangedLines: 80,
};

export const LIMITS = { perMemberPerDay: 3, perMemberPerMonth: 15, globalPerDay: 200, maxUsdPerFix: 1.0 };

// The Robot Care GitHub App's bot account: only pull requests it opened can be accepted from the members area.
export const APP_BOT = "my-robot-i-s-a-robot-care[bot]";
export const BRANCH_PREFIX = "robot-care/";
// The robot's core job: the Sunday plan and sending the orders the member approved. A fix for either is urgent.
export const CORE_JOBS = ["Weekly signals", "Execute approved orders"];

export async function verifySignature(secret, rawBody, header) {
  if (!secret || !header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const got = header.slice(7);
  if (got.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

export function parseEvent(name, body) {
  if (name === "ping") return { kind: "ping" };
  if (name === "installation" || name === "installation_repositories") return { kind: "install", action: body.action, installation: body.installation?.id, account: body.installation?.account?.login };
  if (name !== "issues") return { kind: "ignore", why: `event ${name}` };
  if (!["opened", "labeled"].includes(body.action)) return { kind: "ignore", why: `issues.${body.action}` };
  const labels = (body.issue?.labels || []).map((l) => l.name);
  if (!labels.includes("failure-log")) return { kind: "ignore", why: "not a failure-log issue" };
  if (body.action === "labeled" && body.label?.name !== "failure-log") return { kind: "ignore", why: "another label" };
  // An issue opened WITH the label sends both "opened" and "labeled": handle "opened" only; a label added later still counts.
  if (body.action === "labeled" && Date.now() - Date.parse(body.issue?.created_at || 0) < 60000) return { kind: "ignore", why: "labelled at open" };
  const runId = (String(body.issue?.body || "").match(/actions\/runs\/(\d+)/) || [])[1] || null;
  const issueBody = String(body.issue?.body || "").slice(0, 6000);
  return { kind: "failure", installation: body.installation?.id, repo: body.repository?.full_name, owner: body.repository?.owner?.login,
           issue: body.issue?.number, runId, title: body.issue?.title || "", issueBody, workflow: workflowOf(issueBody) };
}

// The kit's failure log (kit/failure_log.py) opens the issue with "**<workflow name>** did not finish on ...".
export function workflowOf(issueBody) {
  return (String(issueBody || "").match(/^\*\*(.+?)\*\* did not finish/m) || [])[1] || "";
}

export function urgency(ev) {
  return CORE_JOBS.includes(ev?.workflow || workflowOf(ev?.issueBody));
}

export function eligibility(member, counts, seen) {
  if (seen) return { ok: false, why: "duplicate (this run was already handled)" };
  if (!member) return { ok: false, why: "not a member", tell: "Robot Care is for My Robot I.S.A. members. Uninstall it, or sign in at myrobotisa.com/members." };
  if (member.status !== "active") return { ok: false, why: `membership ${member.status}`, tell: "Robot Care is paused because your membership isn't active." };
  if (!member.robot_care) return { ok: false, why: "Robot Care not switched on" };
  if (member.robot_care_until && member.robot_care_until < new Date().toISOString().slice(0, 10)) return { ok: false, why: "free year ended",
    tell: "Your free year of Robot Care has ended, so this failure wasn't looked at. Switch Robot Care back on in the members area (£10 a month, cancel any time), or use your own Claude: the guide is in Set up my robot." };
  if (counts.globalDay >= LIMITS.globalPerDay) return { ok: false, why: "global daily cap", tell: "Robot Care is busy today; it will look at this tomorrow.", retry: true };
  if (counts.day >= LIMITS.perMemberPerDay) return { ok: false, why: "member daily cap", tell: `Robot Care has already made ${LIMITS.perMemberPerDay} fixes for you today. It looks again tomorrow.`, retry: true };
  if (counts.month >= LIMITS.perMemberPerMonth) return { ok: false, why: "member monthly cap", tell: "You've reached this month's Robot Care fixes. Reply @claude on the issue to use your own Claude, or wait for the 1st." };
  return { ok: true };
}

export function buildPrompt(ev, log, files) {
  const fileText = Object.entries(files).map(([p, s]) => `=== ${p} ===\n${s.slice(0, 12000)}`).join("\n\n");
  return {
    system: `You are Robot Care for My Robot I.S.A. A member's robot (their own copy of the code) failed a scheduled run.
Find the cause in the log and propose the SMALLEST fix, or explain what the member must do if code can't fix it.
Hard rules. Never change: execute.py, broker_t212.py, approvals.py, universe.json, anything under .github/, state/,
kit-features.json; any secret or key; T212_ENV, ORDER_MODE or EXECUTE_ORDERS; any cron schedule; any safety rail
(HALT, drawdown, position cap, minimum order, stale data, pending orders). If the fix needs any of those, choose
"comment" and explain. Key, account and settings problems (a wrong or missing key, an unverified sender, Trading 212
refusing an order for funds) are never code bugs: choose "comment" and tell the member exactly what to do.
Reply with ONLY a JSON object:
{"action":"pr"|"comment","diagnosis":"one sentence","edits":[{"path":"...","search":"exact text","replace":"new text"}],
 "pr_title":"...","pr_body":"plain words for a non-developer","comment":"plain words for a non-developer"}`,
    user: `Failed run: ${ev.title}\n\nFailure issue:\n${ev.issueBody}\n\nLog (last lines):\n${log.slice(-15000)}\n\nFiles:\n${fileText}`,
  };
}

export function filesFromLog(log, tree) {
  const named = new Set();
  for (const m of log.matchAll(/File "(?:\/home\/runner\/work\/[^/]+\/[^/]+\/)?([\w./-]+\.py)", line \d+/g)) named.add(m[1]);
  for (const m of log.matchAll(/\b(?:python3?|py) ([\w./-]+\.py)\b/g)) named.add(m[1]);
  return [...named].filter((p) => tree.includes(p)).slice(0, 6);
}

export function parseClaude(text) {
  const s = String(text || "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return { ok: false, why: "no JSON in the reply" };
  let j;
  try { j = JSON.parse(s.slice(a, b + 1)); } catch { return { ok: false, why: "reply was not valid JSON" }; }
  if (!["pr", "comment"].includes(j.action)) return { ok: false, why: "unknown action" };
  if (j.action === "pr" && !(Array.isArray(j.edits) && j.edits.length)) return { ok: false, why: "a PR with no edits" };
  return { ok: true, plan: j };
}

export function guard(edits, files) {
  const problems = [];
  if (edits.length > RAILS.maxFiles) problems.push(`touches ${edits.length} edits (max ${RAILS.maxFiles})`);
  let changed = 0;
  const paths = new Set();
  for (const e of edits) {
    const p = String(e.path || "").replace(/^\.?\//, "");
    paths.add(p);
    if (!p || p.includes("..")) { problems.push(`bad path ${e.path}`); continue; }
    if (RAILS.forbiddenPaths.some((r) => r.test(p))) problems.push(`not allowed to change ${p}`);
    if (!RAILS.allowedExt.test(p)) problems.push(`file type not allowed: ${p}`);
    const cur = files[p];
    if (cur === undefined) { problems.push(`${p} doesn't exist`); continue; }
    if (typeof e.search !== "string" || !e.search) { problems.push(`${p}: empty search text`); continue; }
    const n = cur.split(e.search).length - 1;
    if (n !== 1) problems.push(`${p}: search text found ${n} times (must be exactly once)`);
    for (const r of RAILS.forbiddenText) if (r.test(e.search) || r.test(e.replace || "")) problems.push(`${p}: touches a protected setting (${r.source.slice(0, 28)})`);
    changed += Math.max(e.search.split("\n").length, String(e.replace || "").split("\n").length);
  }
  if (paths.size > RAILS.maxFiles) problems.push(`touches ${paths.size} files`);
  if (changed > RAILS.maxChangedLines) problems.push(`changes ${changed} lines (max ${RAILS.maxChangedLines})`);
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

export function applyEdits(edits, files) {
  const out = { ...files };
  for (const e of edits) {
    const p = e.path.replace(/^\.?\//, "");
    out[p] = out[p].replace(e.search, e.replace ?? "");
  }
  return out;
}

export function costUsd(usage, model = "claude-sonnet-5-5") {
  const price = { in: 3.0, out: 15.0 };
  return ((usage?.input_tokens || 0) * price.in + (usage?.output_tokens || 0) * price.out) / 1e6;
}

export const FOOTER = "\n\n---\nRobot Care, from My Robot I.S.A. It only proposes: nothing changes until you merge. It never touches your keys, your money settings or anything that places orders.";

// ---- Accept fix (28 Oct 2026) ------------------------------------------------------------------------------------

// The same rails as guard(), applied to what is on the pull request NOW (GitHub's list of PR files with their patches),
// so anything pushed to the branch after Robot Care opened it is judged again before it can merge.
export function prRails(prFiles) {
  const problems = [];
  if (!Array.isArray(prFiles) || !prFiles.length) return { ok: false, problems: ["the fix has no changes"] };
  if (prFiles.length > RAILS.maxFiles) problems.push(`touches ${prFiles.length} files (max ${RAILS.maxFiles})`);
  let changed = 0;
  for (const f of prFiles) {
    const p = String(f.filename || "");
    if (!p || p.includes("..")) { problems.push(`bad path ${p}`); continue; }
    if (f.status !== "modified") problems.push(`${p}: ${f.status || "unknown"} (Robot Care only edits existing files)`);
    if (f.previous_filename) problems.push(`${p}: renamed`);
    if (RAILS.forbiddenPaths.some((r) => r.test(p))) problems.push(`not allowed to change ${p}`);
    if (!RAILS.allowedExt.test(p)) problems.push(`file type not allowed: ${p}`);
    if (typeof f.patch !== "string") { problems.push(`${p}: change too big to check`); continue; }
    const lines = f.patch.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)( |$)/.test(l)).map((l) => l.slice(1));
    for (const r of RAILS.forbiddenText) if (lines.some((l) => r.test(l))) problems.push(`${p}: touches a protected setting (${r.source.slice(0, 28)})`);
    changed += Math.max(f.additions || 0, f.deletions || 0);
  }
  if (changed > RAILS.maxChangedLines) problems.push(`changes ${changed} lines (max ${RAILS.maxChangedLines})`);
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

// Checks on the fix's commit: { state: "passed" | "failing" | "pending", names }. No checks at all counts as passed
// (the members' kit runs none on pull requests); anything still running or not green holds the merge.
export function checksState(checkRuns, combined) {
  const runs = (checkRuns && checkRuns.check_runs) || [];
  const failing = [], pending = [];
  for (const c of runs) {
    if (c.status !== "completed") pending.push(c.name);
    else if (!["success", "neutral", "skipped"].includes(c.conclusion)) failing.push(c.name);
  }
  for (const s of (combined && combined.statuses) || []) {
    if (s.state === "pending") pending.push(s.context);
    else if (s.state !== "success") failing.push(s.context);
  }
  if (failing.length) return { state: "failing", names: failing };
  if (pending.length) return { state: "pending", names: pending };
  return { state: "passed", names: [] };
}

// Everything the members area's Accept fix tap must satisfy, in plain words for the member. Pure: the caller fetches.
//   member: their members row; run: the robot_care_runs row; pr: GitHub's pull request; files: its files; checks: checksState()
// -> { ok: true } | { ok: false, code, why, state? }  (state = what the row should now say, when GitHub already decided)
export function acceptDecision({ member, run, pr, files, checks }) {
  const no = (code, why, state) => ({ ok: false, code, why, ...(state ? { state } : {}) });
  if (!member || !["active", "lapsed"].includes(member.status)) return no("not-member", "We couldn't find your membership. Sign out and in again, or email hello@myrobotisa.com.");
  if (!run || run.outcome !== "pr" || !run.pr_number) return no("not-found", "We couldn't find that fix.");
  if (!member.github_login || String(run.login || "").toLowerCase() !== member.github_login.toLowerCase()) return no("not-yours", "That fix is for another member's robot.");
  const st = run.fix_state || "open";
  if (st === "accepted") return no("done", "You've already accepted this fix.");
  if (st === "closed") return no("closed", "This fix was closed on GitHub, so there's nothing to accept.");
  if (!pr) return no("no-pr", "GitHub couldn't find this fix any more.");
  if (pr.merged) return no("merged", "This fix is already in your robot.", "accepted");
  if (pr.state !== "open") return no("closed", "This fix was closed on GitHub, so there's nothing to accept.", "closed");
  const repo = String(pr.base?.repo?.full_name || "");
  if (repo.toLowerCase() !== String(run.repo || "").toLowerCase()) return no("wrong-repo", "That fix doesn't belong to your robot's copy.");
  if (pr.user?.type !== "Bot" || pr.user?.login !== APP_BOT) return no("not-robot-care", "Only fixes Robot Care opened can be accepted here. Open this one on GitHub.");
  if (!String(pr.head?.ref || "").startsWith(BRANCH_PREFIX) || pr.head?.repo?.full_name !== repo) return no("not-robot-care", "Only fixes Robot Care opened can be accepted here. Open this one on GitHub.");
  if (pr.base?.ref !== pr.base?.repo?.default_branch) return no("wrong-base", "This fix isn't aimed at your robot's main code, so it can't be accepted here.");
  if (pr.commits !== 1) return no("changed", "Someone changed this fix after Robot Care made it, so it can't be accepted from here. Open it on GitHub to check it.");
  if (pr.draft) return no("draft", "This fix is still a draft.");
  const rails = prRails(files);
  if (!rails.ok) return no("rails", `This fix breaks Robot Care's safety rules (${rails.problems.join("; ")}), so it won't be merged. Email hello@myrobotisa.com and we'll look.`);
  if (!checks || checks.state === "failing") return no("checks-failing", `Your robot's checks failed on this fix (${(checks?.names || []).join(", ") || "unknown"}), so it won't be merged.`);
  if (checks.state === "pending") return no("checks-pending", "Your robot's checks are still running on this fix. Try again in a few minutes.");
  if (pr.mergeable === false) return no("conflict", "Your code changed since Robot Care made this fix, so it no longer fits. Robot Care will make a new one if the run fails again.");
  if (pr.mergeable == null) return no("not-ready", "GitHub is still getting this fix ready. Try again in a minute.");
  return { ok: true };
}

export const ACCEPT_LIMITS = { perMemberPerHour: 10 };
export const ASK_LIMITS = { perFix: 5, perMemberPerDay: 10, maxChars: 600 };

export function askPrompt({ run, pr, files, question }) {
  const diff = (files || []).map((f) => `=== ${f.filename} ===\n${String(f.patch || "(too big to show)").slice(0, 6000)}`).join("\n\n");
  return {
    system: `You are Robot Care for My Robot I.S.A. You proposed a small fix to a member's robot (their own copy of the
code, which runs in their GitHub account) after one of its scheduled runs failed. The member is not a developer and is
asking about this fix before deciding whether to accept it.
Answer in plain, friendly words, three or four short sentences at most. No code, no jargon, no file paths unless they
ask. Talk only about this fix: what went wrong, what the change does, whether it is safe to accept and what happens
after. Accepting merges the fix into their copy; their robot uses it from its next run. The fix cannot place orders or
change money settings: orders always wait for the member's tap.
Never give investment or financial advice, never say what to buy, sell or hold, and never comment on markets, funds or
returns. If the question is about any of that, about their money or account, or about anything you can't answer from
the fix itself, set can_answer to false.
Reply with ONLY a JSON object: {"answer": "...", "can_answer": true|false}`,
    user: `What went wrong: ${run.diagnosis || "(not recorded)"}\nFix title: ${pr?.title || run.pr_title || ""}\n` +
          `Fix description:\n${String(pr?.body || "").slice(0, 3000)}\n\nThe change:\n${diff}\n\nThe member asks:\n${question}`,
  };
}

export function parseAnswer(text) {
  const s = String(text || "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return { answer: "", can_answer: false };
  try {
    const j = JSON.parse(s.slice(a, b + 1));
    const answer = String(j.answer || "").trim().slice(0, 1500);
    return { answer, can_answer: j.can_answer === true && answer.length > 0 };
  } catch { return { answer: "", can_answer: false }; }
}
