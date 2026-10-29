// member-account: the logic, with every outside call passed in (29 Oct 2026, D28). index.ts wires the real calls;
// test/core_test.mjs drives this with stubs. Plain JS so Deno and Node both run it.
//
// Actions (POST JSON, signed-in member unless noted):
//   email-start {email}   send a code to the new address
//   email-confirm {code}  move the sign-in to the new address; tell the old one
//   delete-start          send a code to the member's own address
//   delete-confirm {code} schedule the deletion for 7 days on; email the date and a cancel link
//   delete-cancel         keep the account
//   github-switch {token} move the membership to the GitHub account the token belongs to; the old one leaves the org
//   purge                 (no sign-in: the hourly job) finish deletions whose 7 days are up
// GET ?cancel=<token>     (no sign-in: the email's button) keep the account, then back to the members area
import * as mail from "./emails.js";

export const CODE_TTL_MIN = 60;
const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,24}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEMBERS = "https://myrobotisa.com/members/";

const ok = (body) => ({ status: 200, body: { ok: true, ...body } });
const no = (status, error, code) => ({ status, body: { ok: false, error, code } });

export const codeHash = (sha, uid, purpose, code) => sha(`mri-acct:${uid}:${purpose}:${code}`);
export function newCode(rand) {   // 6 digits, never starting with 0 so it reads the same everywhere
  return String(100000 + (rand() % 900000));
}
const digits = (s) => String(s || "").replace(/\D/g, "").slice(0, 6);

function codeProblem(r) {
  if (r.reason === "expired") return no(410, "That code has run out (they last an hour). Press Send a new code.", "expired");
  if (r.reason === "tries") return no(429, "Too many wrong tries for that code. Press Send a new code.", "tries");
  if (r.reason === "none") return no(409, "There's nothing waiting for a code. Start again.", "none");
  const left = Number(r.left);
  return no(400, "That code isn't right. Use the newest email from us" + (left >= 1 ? ` (${left} ${left === 1 ? "try" : "tries"} left).` : "."), "wrong");
}
function putProblem(p) {
  if (p === "same") return no(400, "That's already your sign-in email. Type the new address you want to use.", "same");
  if (p === "taken") return no(409, "That email is already used for another membership. If it's yours too, email hello@myrobotisa.com and we'll sort it out.", "taken");
  if (p === "busy") return no(429, "You've asked for a lot of codes in the last hour. Wait a bit, or use the newest code you were sent.", "busy");
  if (p === "owner") return no(403, "The owner account can't be deleted from here.", "owner");
  return no(404, "We couldn't find your membership. Sign out and in again, or email hello@myrobotisa.com.", "not-member");
}

export async function handle(req, d) {
  const { action } = req;

  if (action === "cancel-link") {
    if (!UUID.test(String(req.token || ""))) return { status: 303, location: MEMBERS + "?kept=0#help" };
    const email = await d.store.deleteCancel(null, req.token);
    if (email) await d.send(email, mail.kept(), "account_kept").catch(() => false);
    return { status: 303, location: MEMBERS + (email ? "?kept=1#help" : "?kept=0#help") };
  }

  if (action === "purge") return purge(d);

  const user = req.user;   // {id, email} from the sign-in token, checked by index.ts
  if (!user || !user.id) return no(401, "Your sign-in ran out. Sign in again and try once more.", "signin");

  if (action === "email-start") {
    const email = String(req.email || "").trim().toLowerCase();
    if (!EMAIL.test(email)) return no(400, "That email doesn't look right. Check it and try again.", "bad-email");
    const code = newCode(d.rand);
    const put = await d.store.codePut(user.id, "email", email, await codeHash(d.sha, user.id, "email", code));
    if (put !== "ok") return putProblem(put);
    const sent = await d.send(email, mail.emailCode(code), "account_email_code");
    if (!sent) return no(503, "The email didn't send. Try again in a minute.", "send");
    return ok({ sent_to: email });
  }

  if (action === "email-confirm") {
    const code = digits(req.code);
    if (code.length !== 6) return no(400, "The code is 6 numbers. Copy it from the newest email from us.", "wrong");
    const m = await d.store.member(user.id);
    if (!m) return putProblem("not-member");
    const r = await d.store.codeCheck(user.id, "email", await codeHash(d.sha, user.id, "email", code));
    if (!r.ok) return codeProblem(r);
    const to = r.new_email, old = m.email;
    const a = await d.auth.setEmail(user.id, to);
    if (a === "taken") return putProblem("taken");
    if (a !== "ok") return no(503, "Couldn't change it just now. Nothing has changed: start again in a minute.", "auth");
    try { await d.store.emailSet(user.id, to); }
    catch (e) {
      await d.auth.setEmail(user.id, old);   // put the sign-in back so the two never disagree
      return String(e && e.code) === "23505" ? putProblem("taken") : no(503, "Couldn't change it just now. Nothing has changed: start again in a minute.", "db");
    }
    await d.send(old, mail.emailChanged(old, to), "account_email_changed").catch(() => false);
    return ok({ email: to, old });
  }

  if (action === "delete-start") {
    const m = await d.store.member(user.id);
    if (!m) return putProblem("not-member");
    const code = newCode(d.rand);
    const put = await d.store.codePut(user.id, "delete", null, await codeHash(d.sha, user.id, "delete", code));
    if (put !== "ok") return putProblem(put);
    const sent = await d.send(m.email, mail.deleteCode(code), "account_delete_code");
    if (!sent) return no(503, "The email didn't send. Try again in a minute.", "send");
    return ok({ sent_to: m.email });
  }

  if (action === "delete-confirm") {
    const code = digits(req.code);
    if (code.length !== 6) return no(400, "The code is 6 numbers. Copy it from the newest email from us.", "wrong");
    const r = await d.store.codeCheck(user.id, "delete", await codeHash(d.sha, user.id, "delete", code));
    if (!r.ok) return codeProblem(r);
    const del = await d.store.deleteRequest(user.id);
    if (!del) return putProblem("not-member");
    await d.send(del.email, mail.deleteScheduled(del.due_at, d.cancelUrl(del.cancel_token)), "account_delete_scheduled").catch(() => false);
    return ok({ due_at: del.due_at });
  }

  if (action === "delete-cancel") {
    const email = await d.store.deleteCancel(user.id, null);
    if (email) await d.send(email, mail.kept(), "account_kept").catch(() => false);
    return ok({ kept: !!email });
  }

  if (action === "github-switch") {
    const login = await d.gh.loginFromToken(String(req.token || ""));
    if (!login) return no(400, "GitHub didn't recognise that connection. Press Connect GitHub again.", "token");
    const m = await d.store.member(user.id);
    if (!m) return putProblem("not-member");
    const prev = m.github_login || "";
    if (prev.toLowerCase() === login.toLowerCase()) return ok({ login, previous: prev, same: true });
    if (await d.store.loginTaken(login, m.id)) return no(409, `@${login} is already linked to another membership. If that's you too, email hello@myrobotisa.com.`, "taken");
    if (!(await d.store.setLogin(m.id, login))) return no(503, "That didn't save. Try again in a minute.", "db");
    const invite = m.status === "active" ? await d.gh.invite(login).catch(() => "error") : "skipped";
    const removed = prev ? await d.gh.leave(prev, { check: true }).catch(() => "error") : "none";
    return ok({ login, previous: prev, invite, removed });
  }

  return no(400, "Unknown action.", "action");
}

async function purge(d) {
  const due = await d.store.purgeDue();
  let done = 0;
  for (const row of due) {
    try {
      if (row.github_login) await d.gh.leave(row.github_login, { check: false }).catch(() => "error");
      const p = await d.store.purge(row.user_id);
      if (!p || !p.ok) { await d.store.purgeDone(row.user_id, "purge: " + ((p && p.reason) || "failed")); continue; }
      const a = await d.auth.deleteUser(row.user_id);
      if (a !== "ok") { await d.store.purgeDone(row.user_id, "auth delete: " + a); continue; }
      await d.send(row.email, mail.deleted(!!p.kept_sales_record), "account_deleted").catch(() => false);
      await d.store.purgeDone(row.user_id, null);
      done++;
    } catch (e) {
      await d.store.purgeDone(row.user_id, "error: " + String(e).slice(0, 120)).catch(() => {});
    }
  }
  return ok({ due: due.length, done });
}
