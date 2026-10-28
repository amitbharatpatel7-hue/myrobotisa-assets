// Robot Care, the webhook handler (24 Oct 2026).
// 28 Oct 2026 (D25 stage 1): a fix is recorded with its PR number, title, diagnosis and whether it is urgent, the member
// gets a Message in the members area, and the issue comment points to the members area's Accept fix.
import { verifySignature, parseEvent, eligibility, buildPrompt, filesFromLog, parseClaude, guard, applyEdits, costUsd, urgency, LIMITS, FOOTER } from "./core.js";

const json = (status, body) => ({ status, body });
export const FIXES_URL = "https://myrobotisa.com/members/#fixes";

export async function handle({ name, raw, sig, delivery }, deps) {
  if (!(await verifySignature(deps.secret, raw, sig))) return { response: json(401, { error: "bad signature" }) };
  let body;
  try { body = JSON.parse(raw); } catch { return { response: json(400, { error: "bad json" }) }; }
  const ev = parseEvent(name, body);
  if (ev.kind === "ping") return { response: json(200, { ok: true }) };
  if (ev.kind === "install") {
    await deps.store.recordInstall({ installation: ev.installation, account: ev.account, action: ev.action, at: new Date().toISOString() });
    return { response: json(200, { ok: true, recorded: ev.action }) };
  }
  if (ev.kind !== "failure") return { response: json(202, { ignored: ev.why }) };
  return { response: json(202, { accepted: true }), work: fix(ev, deps, delivery) };
}

export async function fix(ev, deps, delivery = "") {
  const key = `${ev.repo}#${ev.runId || "issue-" + ev.issue}`;
  const gh = deps.gh(ev.installation);
  const done = async (outcome, extra = {}) => { await deps.store.mark(key, { outcome, login: ev.owner, repo: ev.repo, issue: ev.issue, delivery, at: new Date().toISOString(), ...extra }); return { outcome, ...extra }; };
  try {
    const member = await deps.members.byLogin(ev.owner);
    const el = eligibility(member, await deps.store.counts(ev.owner), await deps.store.seen(key));
    if (!el.ok) {
      if (el.tell && !(await deps.store.toldRecently(ev.owner, el.why))) await gh.comment(ev.repo, ev.issue, el.tell + FOOTER);
      return await done("skipped", { why: el.why });
    }
    if (!ev.runId) {
      await gh.comment(ev.repo, ev.issue, "Robot Care couldn't find the failed run's link in this issue, so it can't read the log. Open the run from the Actions tab and press Re-run; if it fails again a new issue will carry the link." + FOOTER);
      return await done("no-run");
    }
    const log = await gh.runLog(ev.repo, ev.runId);
    const tree = await gh.tree(ev.repo);
    const files = {};
    for (const p of filesFromLog(log, tree)) files[p] = await gh.file(ev.repo, p);
    let prompt = buildPrompt(ev, log, files);
    let spent = 0, plan = null, problems = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await deps.claude.complete({ ...prompt, maxTokens: 3000 });
      spent += costUsd(res.usage);
      const parsed = parseClaude(res.text);
      if (!parsed.ok) { problems = [parsed.why]; break; }
      plan = parsed.plan;
      if (plan.action === "comment") { problems = []; break; }
      for (const e of plan.edits) { const p = String(e.path || "").replace(/^\.?\//, ""); if (!(p in files) && tree.includes(p)) files[p] = await gh.file(ev.repo, p); }
      const g = guard(plan.edits, files);
      if (g.ok) { problems = []; break; }
      problems = g.problems;
      if (spent > LIMITS.maxUsdPerFix * 0.6) break;
      prompt = { system: prompt.system, user: prompt.user + `\n\nYour previous fix broke these rules: ${problems.join("; ")}. Propose a fix within the rules, or choose "comment".` };
    }
    if (spent > LIMITS.maxUsdPerFix) problems.push(`over the $${LIMITS.maxUsdPerFix} cap`);
    if (!plan || problems.length) {
      const why = problems.join("; ") || "no usable answer";
      await gh.comment(ev.repo, ev.issue, `Robot Care looked at this failure but couldn't propose a safe fix (${why}).` +
        (plan?.diagnosis ? `\n\nWhat it found: ${plan.diagnosis}` : "") + "\n\nA person will look at it: reply here if it keeps failing." + FOOTER);
      return await done("blocked", { why, usd: +spent.toFixed(4) });
    }
    if (plan.action === "comment") {
      await gh.comment(ev.repo, ev.issue, `**What went wrong:** ${plan.diagnosis}\n\n**What to do:** ${plan.comment}` + FOOTER);
      return await done("advice", { usd: +spent.toFixed(4) });
    }
    const next = applyEdits(plan.edits, files);
    const changed = Object.fromEntries(Object.entries(next).filter(([p, s]) => s !== files[p]));
    const title = String(plan.pr_title || `Fix: ${plan.diagnosis}`).slice(0, 90);
    const diagnosis = String(plan.diagnosis || "").slice(0, 2000);
    const urgent = urgency(ev);
    const pr = await gh.openPR(ev.repo, { branch: `robot-care/run-${ev.runId}`, title,
      body: `${plan.pr_body || plan.diagnosis}\n\nFixes the failure in #${ev.issue}.` + FOOTER, files: changed });
    await gh.comment(ev.repo, ev.issue, `**What went wrong:** ${plan.diagnosis}\n\nRobot Care has proposed a fix: ${pr.url}\n` +
      `Accept it in the members area: ${FIXES_URL} (or tap **Merge** here on GitHub). Nothing changes until you do.` + FOOTER);
    const rec = await done("pr", { pr: pr.url, pr_number: pr.number || null, pr_title: title, diagnosis, urgent, fix_state: "open",
      files: Object.keys(changed), usd: +spent.toFixed(4) });
    try {   // a Message in the members area; a failure here never undoes the fix
      await deps.store.notice(ev.owner, { title: urgent ? "Robot Care has an urgent fix for you" : "Robot Care has a fix for you",
        body: (urgent ? "Your robot can't do its main job until this is in. " : "") + (diagnosis || title), link_url: "#fixes", link_text: "See the fix" });
    } catch { /* recorded on the run; the members area lists the fix either way */ }
    return rec;
  } catch (e) {
    return await done("error", { why: String(e?.message || e).slice(0, 200) });
  }
}
