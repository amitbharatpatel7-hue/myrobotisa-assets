// member-account: the logic, with every outside call passed in (29 Oct 2026, D28). index.ts wires the real calls;
// test/core_test.mjs drives this with stubs. Plain JS so Deno and Node both run it.
//
// Actions (POST JSON, signed-in member unless noted):
//   email-start {email}      send a code to the new address
//   email-confirm {code}     move the sign-in to the new address; tell the old one, with a "put it back" link
//   delete-start             send a code to the member's own address
//   delete-confirm {code}    schedule the deletion for 7 days on; email the date and a Keep my account link
//   delete-cancel            keep the account
//   github-switch {token}    move the membership to the GitHub account the token belongs to; the old one leaves the org
//   keep-token {token}       (no sign-in) Keep my account, from the email, after a tap on the page
//   undo-check {token}       (no sign-in) what the "not you? put it back" link would do
//   undo {token}             (no sign-in) put the sign-in email back, after a tap on the page
//   purge                    (no sign-in: the hourly job) finish deletions whose 7 days are up
// GET ?cancel=<token> and ?undo=<token> (the email buttons) only redirect to the members page, which asks for a tap:
// link scanners in mail apps open every link, so a GET never changes anything (independent review, 29 Oct 2026).
import * as mail from "./emails.js";

const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,190}\.[a-z]{2,24}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MEMBERS = "https://myrobotisa.com/members/";

const ok = (body) => ({ status: 200, body: { ok: true, ...body } });
const no = (status, error, code) => ({ status, body: { ok: false, error, code } });

export const codeHash = (sha, uid, purpose, code) => sha(`mri-acct:${uid}:${purpose}:${code}`);
export function newCode(rand) {   // 6 digits, never starting with 0 so it reads the same everywhere
  return String(100000 + (rand() % 900000));
}
const digits = (s) => String(s || "").replace(/\D/g, "").slice(0, 6);
const log = (d, ...a) => (d.log || console.error)("member-account:", ...a);

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
  if (p === "deleting") return no(409, "Your account is due to be deleted, so it can't change now. Press Keep my account first, then try again.", "deleting");
  return no(404, "We couldn't find your membership. Sign out and in again, or email hello@myrobotisa.com.", "not-member");
}
async function keepResult(d, r) {
  if (r.status === "kept") { await d.send(r.email, mail.kept(), "account_kept").catch(() => false); return ok({ kept: true }); }
  if (r.status === "too-late") return no(409, "It's too late to keep it: the deletion is already under way. Email hello@myrobotisa.com if that's a mistake.", "too-late");
  return no(404, "There's no deletion waiting, so there's nothing to cancel. If you can still sign in, your account is fine.", "none");
}

export async function handle(req, d) {
  const action = String(req.action || "");

  // ---- the email buttons: GET only redirects; the page asks for a tap, then posts keep-token / undo
  if (action === "cancel-link" || action === "undo-link") {
    const key = action === "cancel-link" ? "keep" : "undo";
    const t = UUID.test(String(req.token || "")) ? String(req.token) : "bad";
    return { status: 303, location: `${MEMBERS}?${key}=${t}#help` };
  }
  if (action === "keep-token") {
    if (!UUID.test(String(req.token || ""))) return no(404, "That link doesn't work any more. Sign in and check Help and membership.", "none");
    return keepResult(d, await d.store.deleteCancel(null, req.token));
  }
  if (action === "undo-check" || action === "undo") {
    if (!UUID.test(String(req.token || ""))) return no(404, "That link doesn't work any more. Email hello@myrobotisa.com and we'll help.", "used");
    const c = await d.store.emailUndo(req.token, false);
    if (!c.ok) {
      if (c.reason === "old") return no(410, "That link is more than 7 days old. Email hello@myrobotisa.com and we'll put it right.", "old");
      if (c.reason === "taken") return no(409, "That address is now used by another membership. Email hello@myrobotisa.com and we'll sort it out.", "taken");
      if (c.reason === "moved") return no(409, "The sign-in email has changed again since. Email hello@myrobotisa.com and we'll put it right.", "moved");
      return no(404, "That link has already been used, so the address is already back. Email hello@myrobotisa.com if something's still wrong.", "used");
    }
    if (action === "undo-check") return ok({ old_email: c.old_email, new_email: c.new_email });
    const a = await d.auth.setEmail(c.user_id, c.old_email);
    if (a !== "ok") return no(503, "Couldn't put it back just now. Email hello@myrobotisa.com straight away and we'll do it for you.", "auth");
    let r = null;
    try { r = await d.store.emailUndo(req.token, true); } catch (e) { r = null; }
    if (!r || !r.ok) {
      const back = await d.auth.setEmail(c.user_id, c.new_email);
      if (back !== "ok") log(d, "UNDO SPLIT: sign-in and members row disagree for", c.user_id);
      return no(503, "Couldn't put it back just now. Email hello@myrobotisa.com straight away and we'll do it for you.", "db");
    }
    await d.send(c.old_email, mail.emailRestored(c.old_email), "account_email_restored").catch(() => false);
    return ok({ email: c.old_email });
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
    let set;
    try { set = await d.store.emailSet(user.id, to); }
    catch (e) {
      const back = await d.auth.setEmail(user.id, old);   // put the sign-in back so the two never disagree
      if (back !== "ok") {
        log(d, "EMAIL SPLIT: sign-in moved but the members row didn't for", user.id);
        return no(503, "Something went wrong part-way. Email hello@myrobotisa.com from either address and we'll put it right today.", "split");
      }
      return String(e && e.code) === "23505" ? putProblem("taken") : no(503, "Couldn't change it just now. Nothing has changed: start again in a minute.", "db");
    }
    await d.send(old, mail.emailChanged(old, to, d.undoUrl(set.undo_token)), "account_email_changed").catch(() => false);
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

  if (action === "delete-cancel") return keepResult(d, await d.store.deleteCancel(user.id, null));

  if (action === "github-switch") {
    const login = await d.gh.loginFromToken(String(req.token || ""));
    if (!login) return no(400, "GitHub didn't recognise that connection. Press Connect GitHub again.", "token");
    const m = await d.store.member(user.id);
    if (!m) return putProblem("not-member");
    if (await d.store.deleting(user.id)) return putProblem("deleting");
    const prev = m.github_login || "";
    if (prev.toLowerCase() === login.toLowerCase()) return ok({ login, previous: prev, same: true });
    if (await d.store.loginTaken(login, m.id)) return no(409, `@${login} is already linked to another membership. If that's you too, email hello@myrobotisa.com.`, "taken");
    if (!(await d.store.setLogin(m.id, login))) return no(503, "That didn't save. Try again in a minute.", "db");
    const invite = m.status === "active" ? await d.gh.invite(login).catch(() => "error") : "skipped";
    const removed = prev ? await d.gh.leave(prev).catch(() => "error") : "none";
    return ok({ login, previous: prev, invite, removed });
  }

  return no(400, "Unknown action.", "action");
}

// The hourly job. Each deletion is claimed first (acct_purge_due), so two runs never finish the same one. Order: the
// data (acct_purge, which re-checks it wasn't kept and reads the member's CURRENT GitHub login), then the GitHub org
// (only if no member holds that login now), then the sign-in user, then the last email. A run that stops part-way
// records why in detail and the next run carries on.
async function purge(d) {
  const due = await d.store.purgeDue();
  let done = 0;
  for (const row of due) {
    try {
      const p = await d.store.purge(row.user_id);
      if (!p || !p.ok) { await d.store.purgeDone(row.user_id, "purge: " + ((p && p.reason) || "failed")); continue; }
      if (p.login) { const g = await d.gh.leave(p.login).catch((e) => "error:" + e); if (/^error/.test(g)) log(d, "org leave", p.login, g); }
      const a = await d.auth.deleteUser(row.user_id);
      if (a !== "ok") { await d.store.purgeDone(row.user_id, "auth delete: " + a); continue; }
      await d.send(p.email, mail.deleted(!!p.kept_sales_record), "account_deleted").catch(() => false);
      await d.store.purgeDone(row.user_id, null);
      done++;
    } catch (e) {
      await d.store.purgeDone(row.user_id, "error: " + String(e).slice(0, 120)).catch(() => {});
    }
  }
  return ok({ due: due.length, done });
}
