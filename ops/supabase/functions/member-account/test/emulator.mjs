// A local stand-in for production (29 Oct 2026, D28): the real member-account logic (core.js) running against the real
// SQL (pg_mirror.sql + the community and account migrations) in a local Postgres, with Supabase Auth, Resend and
// GitHub replaced by in-memory fakes that behave like the real ones in the ways that matter here:
//  - Auth: one user per address; changing to an address another user has is refused.
//  - Resend (the robot's): onboarding@resend.dev only delivers to the address the member's Resend account uses.
//  - GitHub: OAuth returns whichever account is signed in on github.com; the copy's variables, secrets and the two
//    workflows (setup-check, dashboard-setup) behave as the kit's do.
// Used by core_test.mjs (no browser) and journeys.mjs (100 simulated members in Chromium).
import { execFileSync } from "node:child_process";
import { createHash, randomInt, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { handle } from "../core.js";

const require = createRequire(process.env.PG_MODULE_DIR ? path.join(process.env.PG_MODULE_DIR, "x.js") : import.meta.url);
const { Pool } = require("pg");
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SQL_DIR = path.resolve(HERE, "../../..");

export function buildDb() {
  execFileSync("su", ["postgres", "-c", "psql -X -q -v ON_ERROR_STOP=1"], { input: fs.readFileSync(path.join(HERE, "pg_mirror.sql")), stdio: ["pipe", "ignore", "pipe"] });
  const sql = ["2026-10-27-community.sql", "2026-10-29-account.sql", "2026-10-29-account-export-readable.sql"].map((f) => fs.readFileSync(path.join(SQL_DIR, f), "utf8")).join("\n");
  execFileSync("su", ["postgres", "-c", "psql -X -q -v ON_ERROR_STOP=1 -d acct"], { input: sql, stdio: ["pipe", "ignore", "pipe"] });
}

export function makeWorld() {
  const pool = new Pool({ host: "127.0.0.1", user: "postgres", password: process.env.PGPASSWORD || "sim", database: "acct", max: 8 });
  const q = async (text, params = []) => (await pool.query(text, params)).rows;
  const one = async (text, params) => (await q(text, params))[0] || null;
  const asUser = async (uid, text, params = []) => {
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid })]);
      const r = await c.query(text, params);
      await c.query("commit");
      return r.rows;
    } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
  };
  const rpc = async (name, args) => {
    const keys = Object.keys(args), ph = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
    try { return (await one(`select public.${name}(${ph}) as r`, keys.map((k) => args[k]))).r; }
    catch (e) { const err = new Error(e.message); err.code = e.code; throw err; }
  };

  const W = {
    pool, q, one, asUser,
    outbox: [], logs: [],
    org: { members: new Set(), admins: new Set(["amitbharatpatel7-hue"]), invites: new Set() },
    tokens: new Map(),      // GitHub token -> login
    repos: new Map(),       // "owner/name" -> { template, vars:{}, secrets:{}, runs:[], resendKeyFor, otherFailure, dashFails, dashMissing }
    resend: new Map(),      // member's Resend: key -> account email
    clock: 0,
  };
  W.sent = (to, tag) => W.outbox.filter((m) => m.to === to && (!tag || m.tag === tag));
  W.lastCode = (to, tag) => { const m = W.sent(to, tag).at(-1); const x = m && /(\d{3}) (\d{3})/.exec(m.subject); return x ? x[1] + x[2] : null; };

  W.deps = {
    sha: async (s) => createHash("sha256").update(s).digest("hex"),
    rand: () => randomInt(0, 2 ** 31),
    cancelUrl: (t) => `${W.fnBase || "http://fn.local"}/functions/v1/member-account?cancel=${t}`,
    undoUrl: (t) => `${W.fnBase || "http://fn.local"}/functions/v1/member-account?undo=${t}`,
    log: (...a) => { W.logs.push(a.join(" ")); },
    send: async (to, m, tag) => { if (W.mailDown) return false; W.outbox.push({ to, subject: m.subject, text: m.text, html: m.html, tag, at: Date.now() }); return true; },
    store: {
      member: (uid) => one("select id,email,plan,status,github_login from members where user_id=$1 and status in ('active','lapsed')", [uid]),
      codePut: (u, p, e, h) => rpc("acct_code_put", { p_user: u, p_purpose: p, p_new_email: e, p_code_hash: h }),
      codeCheck: (u, p, h) => rpc("acct_code_check", { p_user: u, p_purpose: p, p_code_hash: h }),
      emailSet: (u, e) => rpc("acct_email_set", { p_user: u, p_new_email: e }),
      emailUndo: (t, a) => rpc("acct_email_undo", { p_token: t, p_apply: a }),
      deleting: (u) => rpc("acct_is_deleting", { p_user: u }),
      deleteRequest: (u) => rpc("acct_delete_request", { p_user: u }),
      deleteCancel: (u, t) => rpc("acct_delete_cancel", { p_user: u, p_token: t }),
      purgeDue: () => q("select * from acct_purge_due()"),
      purge: (u) => rpc("acct_purge", { p_user: u }),
      purgeDone: (u, d) => rpc("acct_purge_done", { p_user: u, p_detail: d }),
      loginTaken: async (login, exceptId) => !!(await one(`select 1 from members where lower(github_login)=lower($1) ${exceptId ? "and id<>$2" : ""} limit 1`, exceptId ? [login, exceptId] : [login])),
      setLogin: async (id, login) => { await q("update members set github_login=$2 where id=$1", [id, login]); return true; },
    },
    auth: {
      setEmail: async (uid, email) => {
        const other = await one("select id from auth.users where lower(email)=lower($1) and id<>$2", [email, uid]);
        if (other) return "taken";
        await q("update auth.users set email=$2 where id=$1", [uid, email]); return "ok";
      },
      deleteUser: async (uid) => { await q("delete from auth.users where id=$1", [uid]); return "ok"; },
    },
    gh: {
      loginFromToken: async (t) => W.tokens.get(t) || "",
      invite: async (login) => { if (W.org.members.has(login.toLowerCase())) return "already"; W.org.members.add(login.toLowerCase()); W.org.invites.add(login.toLowerCase()); return "invited"; },
      leave: async (login) => {
        const l = login.toLowerCase();
        if (await W.deps.store.loginTaken(login)) return "kept";
        if (!W.org.members.has(l)) return "none";
        if (W.org.admins.has(l)) return "admin";
        W.org.members.delete(l); W.org.invites.delete(l); return "removed";
      },
    },
  };
  W.call = (req) => handle(req, W.deps);

  // A member with everything a real one has: sign-in user, row, ticks, a post, a vote, a reply, Robot Care history,
  // a GitHub login in the org, a Resend account and a copy of the robot with both addresses set.
  W.addMember = async (o = {}) => {
    const uid = o.uid || randomUUID(), email = (o.email || `m${uid.slice(0, 8)}@example.com`).toLowerCase();
    const login = o.login === null ? null : (o.login || `gh-${uid.slice(0, 6)}`);
    await q("insert into auth.users(id,email) values ($1,$2)", [uid, email]);
    await q(`insert into members(email,user_id,plan,status,first_name,github_login,founding_no,repo_url) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [email, uid, o.plan || "founding", o.status || "active", o.first_name ?? "Sam", login, o.founding_no ?? null,
       login && o.repo ? `https://github.com/${login}/${o.repo}` : null]);
    await q("insert into member_progress(user_id,item) values ($1,'qs:1'),($1,'day:1')", [uid]);
    await asUser(uid, "insert into community_posts(kind,title,body) values ('idea','Idea from " + uid.slice(0, 6) + "','Please add it')");
    if (login) {
      W.org.members.add(login.toLowerCase());
      const tok = "gho_" + uid.replace(/-/g, "").slice(0, 30);
      W.tokens.set(tok, login);
      const key = "re_" + uid.replace(/-/g, "").slice(0, 20);
      W.resend.set(key, o.resendEmail || email);
      const repo = `${login}/${o.repo || "my-robot-isa"}`;
      if (o.copy !== false) {
        const vars = { NOTIFY_TO: o.notify || email, T212_ENV: "practice" };
        if (o.dash !== false) vars.DASHBOARD_EMAIL = o.dash || email;
        W.repos.set(repo.toLowerCase(), { full: repo, template: true, vars, secrets: { RESEND_API_KEY: key }, runs: [],
          otherFailure: !!o.otherFailure, dashFails: !!o.dashFails, dashMissing: !!o.dashMissing });
      }
      return { uid, email, login, token: tok, resendKey: key, repo };
    }
    return { uid, email, login: null };
  };
  // A second GitHub account the member also owns (to switch to).
  W.addGitHubAccount = (login) => { const tok = "gho_" + randomUUID().replace(/-/g, "").slice(0, 30); W.tokens.set(tok, login); return tok; };

  // What the copy's workflows do, as the kit's do.
  W.runWorkflow = (repo, wf) => {
    const r = W.repos.get(repo.toLowerCase());
    if (!r) return null;
    if (wf === "dashboard-setup.yml" && r.dashMissing) return "missing";
    let ok;
    if (wf === "setup-check.yml") {
      const to = r.vars.NOTIFY_TO, acct = W.resend.get(r.secrets.RESEND_API_KEY);
      ok = !r.otherFailure && !!acct && !!to && acct.toLowerCase() === to.toLowerCase();
      if (ok) W.outbox.push({ to, subject: "[My Robot I.S.A. · Setup] all green", tag: "robot_setup_check", at: Date.now() });
    } else if (wf === "dashboard-setup.yml") ok = !r.dashFails;
    else ok = true;
    const run = { id: r.runs.length + 1, wf, status: "completed", conclusion: ok ? "success" : "failure", created_at: new Date().toISOString(), html_url: `https://github.com/${repo}/actions/runs/${r.runs.length + 1}` };
    r.runs.push(run);
    return run;
  };

  // Emulate github-oauth's POST: link the login if the member has none, else report same/different/taken.
  W.oauthLink = async (uid, login) => {
    const m = await one("select id, github_login from members where user_id=$1", [uid]);
    if (!m) return { link: "error", saved: null };
    if ((m.github_login || "").toLowerCase() === login.toLowerCase()) return { link: "same", saved: m.github_login };
    if (m.github_login) return { link: "different", saved: m.github_login };
    if (await W.deps.store.loginTaken(login, m.id)) return { link: "taken", saved: null };
    await q("update members set github_login=$2 where id=$1", [m.id, login]);
    return { link: "linked", saved: login };
  };

  W.timeTravel = async (uid, what) => {
    if (what === "code-expired") await q("update admin.member_codes set expires_at = now() - interval '1 minute' where user_id=$1", [uid]);
    if (what === "deletion-due") await q("update admin.member_deletions set due_at = now() - interval '1 minute' where user_id=$1", [uid]);
  };
  W.close = () => pool.end();
  return W;
}
