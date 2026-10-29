// member-account against the real SQL (29 Oct 2026, D28). No browser, no network.
//   PG_MODULE_DIR=<dir with node_modules/pg> node ops/supabase/functions/member-account/test/core_test.mjs
import assert from "node:assert/strict";
import { buildDb, makeWorld } from "./emulator.mjs";
import * as mail from "../emails.js";

buildDb();
const W = makeWorld();
let passed = 0;
const t = async (name, f) => { await f(); passed++; console.log("ok  ", name); };
const as = (m) => ({ id: m.uid, email: m.email });

try {
  await t("email change: code to the new address, then sign-in user and row move together; old address told", async () => {
    const a = await W.addMember();
    let r = await W.call({ action: "email-start", user: as(a), email: "  New.Alice@Example.com " });
    assert.equal(r.status, 200); assert.equal(r.body.sent_to, "new.alice@example.com");
    const code = W.lastCode("new.alice@example.com", "account_email_code"); assert.match(code, /^\d{6}$/);
    r = await W.call({ action: "email-confirm", user: as(a), code: code.slice(0, 3) + " " + code.slice(3) });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.email, "new.alice@example.com");
    assert.equal((await W.one("select email from members where user_id=$1", [a.uid])).email, "new.alice@example.com");
    assert.equal((await W.one("select email from auth.users where id=$1", [a.uid])).email, "new.alice@example.com");
    assert.equal(W.sent(a.email, "account_email_changed").length, 1, "the old address hears about it");
    r = await W.call({ action: "email-confirm", user: as(a), code });
    assert.equal(r.body.code, "none", "a code works once");
  });

  await t("email change refuses: bad address, same address, an address on another membership or sign-in", async () => {
    const a = await W.addMember(), b = await W.addMember();
    assert.equal((await W.call({ action: "email-start", user: as(a), email: "not-an-email" })).body.code, "bad-email");
    assert.equal((await W.call({ action: "email-start", user: as(a), email: a.email.toUpperCase() })).body.code, "same");
    assert.equal((await W.call({ action: "email-start", user: as(a), email: b.email })).body.code, "taken");
    await W.q("insert into auth.users(email) values ('orphan@example.com')");
    assert.equal((await W.call({ action: "email-start", user: as(a), email: "orphan@example.com" })).body.code, "taken");
    assert.equal(W.sent(b.email, "account_email_code").length, 0, "no code is sent to a taken address");
  });

  await t("wrong codes count down, five wrong locks the code, a new code resets; an hour-old code has run out", async () => {
    const a = await W.addMember(), to = "x" + a.email;
    await W.call({ action: "email-start", user: as(a), email: to });
    let r = await W.call({ action: "email-confirm", user: as(a), code: "000001" });
    assert.equal(r.body.code, "wrong"); assert.match(r.body.error, /4 tries left/);
    for (let i = 0; i < 4; i++) r = await W.call({ action: "email-confirm", user: as(a), code: "000002" });
    assert.equal(r.body.code, "tries");
    r = await W.call({ action: "email-confirm", user: as(a), code: W.lastCode(to) });
    assert.equal(r.body.code, "tries", "even the right code is refused once locked");
    await W.call({ action: "email-start", user: as(a), email: to });
    await W.timeTravel(a.uid, "code-expired");
    r = await W.call({ action: "email-confirm", user: as(a), code: W.lastCode(to) });
    assert.equal(r.body.code, "expired");
    await W.call({ action: "email-start", user: as(a), email: to });
    r = await W.call({ action: "email-confirm", user: as(a), code: W.lastCode(to) });
    assert.equal(r.status, 200);
  });

  await t("five codes an hour, then 'busy'", async () => {
    const a = await W.addMember();
    for (let i = 0; i < 3; i++) assert.equal((await W.call({ action: "email-start", user: as(a), email: `n${i}${a.email}` })).status, 200);
    for (let i = 0; i < 2; i++) assert.equal((await W.call({ action: "delete-start", user: as(a) })).status, 200);
    assert.equal((await W.call({ action: "email-start", user: as(a), email: "z" + a.email })).body.code, "busy");
  });

  await t("if the row can't move (address taken in the meantime), the sign-in user is put back", async () => {
    const a = await W.addMember(), to = "race" + a.email;
    await W.call({ action: "email-start", user: as(a), email: to });
    const code = W.lastCode(to);
    await W.q("insert into members(email,plan) values ($1,'test')", [to]);   // taken between the code and the confirm
    const r = await W.call({ action: "email-confirm", user: as(a), code });
    assert.equal(r.body.code, "taken");
    assert.equal((await W.one("select email from auth.users where id=$1", [a.uid])).email, a.email);
    assert.equal((await W.one("select email from members where user_id=$1", [a.uid])).email, a.email);
  });

  await t("mail down: nothing pretends to have sent", async () => {
    const a = await W.addMember(); W.mailDown = true;
    try { assert.equal((await W.call({ action: "email-start", user: as(a), email: "m" + a.email })).body.code, "send"); }
    finally { W.mailDown = false; }
  });

  await t("delete: code to own address, 7 days on; the email link only redirects, a tap keeps it; the owner can't", async () => {
    const a = await W.addMember();
    let r = await W.call({ action: "delete-start", user: as(a) }); assert.equal(r.body.sent_to, a.email);
    r = await W.call({ action: "delete-confirm", user: as(a), code: W.lastCode(a.email, "account_delete_code") });
    assert.equal(r.status, 200);
    const days = (new Date(r.body.due_at) - Date.now()) / 864e5; assert.ok(days > 6.99 && days < 7.01, String(days));
    const token = /cancel=([0-9a-f-]{36})/.exec(W.sent(a.email, "account_delete_scheduled")[0].text)[1];
    r = await W.call({ action: "cancel-link", token }); assert.match(r.location, new RegExp("\\?keep=" + token + "#help$"));
    assert.equal(await W.deps.store.deleting(a.uid), true, "opening the link (or a mail scanner opening it) changes nothing");
    r = await W.call({ action: "keep-token", token }); assert.equal(r.body.kept, true);
    r = await W.call({ action: "keep-token", token }); assert.equal(r.body.code, "none");
    r = await W.call({ action: "keep-token", token: "nonsense" }); assert.equal(r.body.code, "none");
    await W.call({ action: "delete-start", user: as(a) });
    await W.call({ action: "delete-confirm", user: as(a), code: W.lastCode(a.email, "account_delete_code") });
    r = await W.call({ action: "delete-cancel", user: as(a) }); assert.equal(r.body.kept, true);
    assert.equal(W.sent(a.email, "account_kept").length, 2);
    const o = await W.addMember({ plan: "owner" });
    assert.equal((await W.call({ action: "delete-start", user: as(o) })).body.code, "owner");
  });

  await t("while a deletion waits, the email and GitHub account can't change", async () => {
    const a = await W.addMember();
    await W.call({ action: "delete-start", user: as(a) });
    await W.call({ action: "delete-confirm", user: as(a), code: W.lastCode(a.email, "account_delete_code") });
    assert.equal((await W.call({ action: "email-start", user: as(a), email: "n" + a.email })).body.code, "deleting");
    assert.equal((await W.call({ action: "github-switch", user: as(a), token: W.addGitHubAccount("dz-" + a.uid.slice(0, 5)) })).body.code, "deleting");
  });

  await t("a cancel can't race the purge: too late once claimed or purged", async () => {
    const a = await W.addMember();
    await W.call({ action: "delete-start", user: as(a) });
    await W.call({ action: "delete-confirm", user: as(a), code: W.lastCode(a.email, "account_delete_code") });
    await W.timeTravel(a.uid, "deletion-due");
    await W.deps.store.purgeDue();                                  // a run has claimed it
    assert.equal((await W.call({ action: "delete-cancel", user: as(a) })).body.code, "too-late");
    await W.deps.store.purge(a.uid);                                 // and purged it; the auth delete hasn't happened yet
    await W.q("update admin.member_deletions set claimed_at = now() - interval '1 hour' where user_id=$1", [a.uid]);
    assert.equal((await W.call({ action: "delete-cancel", user: as(a) })).body.code, "too-late", "purged = too late, even after the claim lapses");
    const r = await W.call({ action: "purge" }); assert.equal(r.body.done >= 1, true, "the next run finishes it");
    assert.equal(W.sent(a.email, "account_kept").length, 0);
  });

  await t("purge: nothing before day 7; after it, data gone, posts kept as Former member, org left, sign-in gone", async () => {
    const a = await W.addMember({ founding_no: 42 }), b = await W.addMember({ plan: "test" });
    for (const m of [a, b]) {
      await W.call({ action: "delete-start", user: as(m) });
      await W.call({ action: "delete-confirm", user: as(m), code: W.lastCode(m.email, "account_delete_code") });
    }
    let r = await W.call({ action: "purge" }); assert.equal(r.body.done, 0, "not due yet");
    await W.timeTravel(a.uid, "deletion-due"); await W.timeTravel(b.uid, "deletion-due");
    r = await W.call({ action: "purge" }); assert.equal(r.body.done, 2);
    const ra = await W.one("select status, first_name, github_login, user_id, founding_no, email from members where email=$1", [a.email]);
    assert.deepEqual([ra.status, ra.first_name, ra.github_login, ra.user_id, ra.founding_no], ["deleted", null, null, null, 42], "founding: sales record kept");
    assert.equal(await W.one("select 1 from members where email=$1", [b.email]), null, "test member: row gone");
    for (const m of [a, b]) {
      assert.equal(await W.one("select 1 from auth.users where id=$1", [m.uid]), null);
      assert.equal(await W.one("select 1 from member_progress where user_id=$1", [m.uid]), null);
      assert.equal(W.org.members.has(m.login.toLowerCase()), false);
      assert.equal(W.sent(m.email, "account_deleted").length, 1);
    }
    const posts = await W.q("select author_name, user_id from community_posts where title like 'Idea from ' || $1 || '%'", [a.uid.slice(0, 6)]);
    assert.deepEqual(posts, [{ author_name: "Former member", user_id: "00000000-0000-0000-0000-000000000000" }]);
    r = await W.call({ action: "purge" }); assert.equal(r.body.due, 0, "done once");
    const sign = await W.one("select 1 from members where email=$1 and status in ('active','lapsed')", [a.email]);
    assert.equal(sign, null, "members-login won't send a code to a deleted member");
  });

  await t("two clean-up runs at once finish each deletion once (one 'deleted' email)", async () => {
    const ms = [await W.addMember(), await W.addMember(), await W.addMember()];
    for (const m of ms) {
      await W.call({ action: "delete-start", user: as(m) });
      await W.call({ action: "delete-confirm", user: as(m), code: W.lastCode(m.email, "account_delete_code") });
      await W.timeTravel(m.uid, "deletion-due");
    }
    const rs = await Promise.all([W.call({ action: "purge" }), W.call({ action: "purge" }), W.call({ action: "purge" })]);
    assert.equal(rs.reduce((a, r) => a + r.body.done, 0), 3);
    for (const m of ms) assert.equal(W.sent(m.email, "account_deleted").length, 1);
  });

  await t("deleting member A never touches member B, who now holds A's old GitHub login", async () => {
    const a = await W.addMember(), b = await W.addMember({ login: null });
    const oldA = a.login;
    await W.call({ action: "github-switch", user: as(a), token: W.addGitHubAccount("a2-" + a.uid.slice(0, 5)) });
    await W.oauthLink(b.uid, oldA); W.org.members.add(oldA.toLowerCase());
    await W.q("insert into robot_care_runs(key,outcome,login) values ($1,'pr',$2)", ["b-run-" + b.uid, oldA]);
    await W.call({ action: "delete-start", user: as(a) });
    await W.call({ action: "delete-confirm", user: as(a), code: W.lastCode(a.email, "account_delete_code") });
    await W.timeTravel(a.uid, "deletion-due"); await W.call({ action: "purge" });
    assert.equal(W.org.members.has(oldA.toLowerCase()), true, "B stays in the org");
    assert.ok(await W.one("select 1 from robot_care_runs where key=$1", ["b-run-" + b.uid]), "B's Robot Care history stays");
    assert.equal(W.org.members.has(("a2-" + a.uid.slice(0, 5)).toLowerCase()), false, "A's current login leaves");
  });

  await t("finished deletions keep no address; an admin note on a sales record is kept", async () => {
    const a = await W.addMember();
    await W.q("update members set note='paid by bank transfer' where user_id=$1", [a.uid]);
    await W.call({ action: "delete-start", user: as(a) });
    await W.call({ action: "delete-confirm", user: as(a), code: W.lastCode(a.email, "account_delete_code") });
    await W.timeTravel(a.uid, "deletion-due"); await W.call({ action: "purge" });
    const d = await W.one("select email, github_login, first_name, done_at from admin.member_deletions where user_id=$1", [a.uid]);
    assert.equal(d.email, "erased"); assert.equal(d.github_login, null); assert.ok(d.done_at);
    assert.match((await W.one("select note from members where email=$1", [a.email])).note, /^paid by bank transfer · Account deleted/);
  });

  await t("'not you? put it back': the old address gets a link; a tap puts both records back, once", async () => {
    const a = await W.addMember(), to = "thief" + a.email;
    await W.call({ action: "email-start", user: as(a), email: to });
    await W.call({ action: "email-confirm", user: as(a), code: W.lastCode(to) });
    const token = /undo=([0-9a-f-]{36})/.exec(W.sent(a.email, "account_email_changed")[0].text)[1];
    let r = await W.call({ action: "undo-link", token }); assert.match(r.location, /\?undo=/);
    assert.equal((await W.one("select email from members where user_id=$1", [a.uid])).email, to, "the GET changes nothing");
    r = await W.call({ action: "undo-check", token }); assert.equal(r.body.old_email, a.email);
    r = await W.call({ action: "undo", token }); assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await W.one("select email from members where user_id=$1", [a.uid])).email, a.email);
    assert.equal((await W.one("select email from auth.users where id=$1", [a.uid])).email, a.email);
    assert.equal(W.sent(a.email, "account_email_restored").length, 1);
    assert.equal((await W.call({ action: "undo", token })).body.code, "used");
    const b = await W.addMember(), tb = "x" + b.email;
    await W.call({ action: "email-start", user: as(b), email: tb });
    await W.call({ action: "email-confirm", user: as(b), code: W.lastCode(tb) });
    const tok2 = /undo=([0-9a-f-]{36})/.exec(W.sent(b.email, "account_email_changed")[0].text)[1];
    await W.q("update admin.member_email_undo set created_at = now() - interval '8 days' where token=$1", [tok2]);
    assert.equal((await W.call({ action: "undo", token: tok2 })).body.code, "old");
  });

  await t("github switch: new login saved and invited, old one leaves the org; same/taken/foreign tokens refused", async () => {
    const a = await W.addMember(), b = await W.addMember();
    const tok = W.addGitHubAccount("alice-new");
    let r = await W.call({ action: "github-switch", user: as(a), token: tok });
    assert.equal(r.status, 200); assert.equal(r.body.previous, a.login); assert.equal(r.body.removed, "removed"); assert.equal(r.body.invite, "invited");
    assert.equal(W.org.members.has(a.login.toLowerCase()), false); assert.equal(W.org.members.has("alice-new"), true);
    r = await W.call({ action: "github-switch", user: as(a), token: tok }); assert.equal(r.body.same, true);
    r = await W.call({ action: "github-switch", user: as(a), token: b.token }); assert.equal(r.body.code, "taken");
    assert.equal(W.org.members.has(b.login.toLowerCase()), true, "can't kick another member out");
    r = await W.call({ action: "github-switch", user: as(a), token: "gho_madeup" }); assert.equal(r.body.code, "token");
    W.org.members.add("amitbharatpatel7-hue");
    assert.equal(await W.deps.gh.leave("amitbharatpatel7-hue"), "admin", "never an org admin");
  });

  await t("download my data: own data only", async () => {
    const a = await W.addMember({ first_name: "Priya" }), b = await W.addMember({ first_name: "Other" });
    const j = (await W.asUser(a.uid, "select my_data_export() j"))[0].j;
    assert.equal(j.membership.first_name, "Priya"); assert.equal(j.moonshotters_posts.length, 1);
    assert.deepEqual(j.progress.map((x) => x.step), ["QuickStart step 1", "Lesson 1"], "steps in words, not codes");
    const postId = (await W.one("select id from community_posts where user_id=$1", [b.uid])).id;
    await W.asUser(a.uid, "insert into community_votes(post_id) values ($1)", [postId]);
    await W.q("insert into member_notices(title,body) values ('Welcome to the test drive','hi')");
    const nid = (await W.one("select max(id) id from member_notices")).id;
    await W.q("insert into member_notice_reads(user_id,notice_id) values ($1,$2)", [a.uid, nid]);
    const j2 = (await W.asUser(a.uid, "select my_data_export() j"))[0].j;
    assert.equal(j2.moonshotters_votes[0].idea, "Idea from " + b.uid.slice(0, 6), "votes by idea name");
    assert.equal(j2.messages_read[0].title, "Welcome to the test drive", "messages by title");
    assert.doesNotMatch(JSON.stringify(j), /Other/);
    await assert.rejects(W.asUser(a.uid, "select acct_purge($1)", [b.uid]), /permission denied/, "members can't call the service functions");
    await assert.rejects(W.asUser(a.uid, "select * from admin.member_codes"), /permission denied/);
  });

  await t("signed-out and unknown actions", async () => {
    assert.equal((await W.call({ action: "email-start", user: null, email: "a@b.co" })).status, 401);
    const a = await W.addMember();
    assert.equal((await W.call({ action: "nope", user: as(a) })).status, 400);
  });

  await t("emails: dark-mode safe, member subjects, no unescaped addresses", async () => {
    const all = [mail.emailCode("123456"), mail.emailChanged("a@x.com", "b<c>@x.com"), mail.deleteCode("654321"),
      mail.deleteScheduled(new Date().toISOString(), "https://x/y?cancel=1"), mail.kept(), mail.deleted(true)];
    for (const m of all) {
      assert.match(m.subject, /^\[My Robot I\.S\.A\. · Account\] /); assert.doesNotMatch(m.subject, /Internal/);
      assert.equal((m.html.match(/light only/g) || []).length >= 3, true);
      assert.doesNotMatch(m.html, /b<c>/); assert.ok(m.text.length > 40);
    }
    assert.match(mail.emailCode("123456").subject, /123 456/);
  });
} finally { await W.close(); }
console.log(`\n${passed} passed`);
