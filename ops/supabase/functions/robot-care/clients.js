// Robot Care, the real clients (24 Oct 2026): GitHub App, Anthropic and the Supabase store.
// 28 Oct 2026 (D25 stage 1): the GitHub client can read a pull request, its files and checks, and merge it (pinned to the
// head commit it checked); the store can post a member Message. Shared by robot-care, robot-care-accept and robot-care-ask.
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const b64urlStr = (s) => b64url(new TextEncoder().encode(s));
const UA = "my-robot-isa-robot-care";

// GitHub hands out App keys as PKCS#1 ("BEGIN RSA PRIVATE KEY"); WebCrypto only imports PKCS#8, so wrap it (25 Oct 2026).
function derLen(n) { if (n < 128) return [n]; const b = []; while (n > 0) { b.unshift(n & 255); n >>= 8; } return [0x80 | b.length, ...b]; }
function pkcs1to8(p1) {
  const alg = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const oct = [0x04, ...derLen(p1.length)], ver = [0x02, 0x01, 0x00];
  const body = ver.length + alg.length + oct.length + p1.length;
  return new Uint8Array([0x30, ...derLen(body), ...ver, ...alg, ...oct, ...Array.from(p1)]);
}
export function pemToPkcs8(pem) {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  return /BEGIN RSA PRIVATE KEY/.test(pem) ? pkcs1to8(der) : der;
}

async function appJwt(appId, pem) {
  const der = pemToPkcs8(pem);
  let key;
  try { key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]); }
  catch (e) {
    // Shape only, never key material: which header, how many lines, the DER length and its first 4 (structural) bytes.
    const head = (pem.match(/BEGIN ([A-Z ]+)-----/) || [])[1] || "none";
    const hex = Array.from(der.slice(0, 4)).map((b) => b.toString(16).padStart(2, "0")).join("");
    throw new Error(`v3 key import failed: header=${head} lines=${pem.split("\n").length} chars=${pem.length} der=${der.length} start=${hex} (${String(e?.message || e).slice(0, 60)})`);
  }
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64urlStr(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(appId) }))}`;
  return `${data}.${b64url(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(data)))}`;
}

export function githubApp({ appId, privateKey, api = "https://api.github.com", fetchImpl = fetch }) {
  const tokens = new Map();
  async function token(inst) {
    const t = tokens.get(inst);
    if (t && t.exp > Date.now() + 60000) return t.token;
    const r = await fetchImpl(`${api}/app/installations/${inst}/access_tokens`, { method: "POST",
      headers: { Authorization: `Bearer ${await appJwt(appId, privateKey)}`, Accept: "application/vnd.github+json", "User-Agent": UA } });
    if (!r.ok) throw new Error(`installation token ${r.status} (app ${/^\d+$/.test(String(appId)) ? appId : "not a number"}, installation ${inst}): ${(await r.text()).slice(0, 90)}`);
    const j = await r.json();
    tokens.set(inst, { token: j.token, exp: Date.parse(j.expires_at), permissions: j.permissions || {} });
    return j.token;
  }
  const client = (inst) => {
    const call = async (method, path, body, raw = false) => {
      const r = await fetchImpl(path.startsWith("http") ? path : `${api}${path}`, { method, redirect: "follow",
        headers: { Authorization: `token ${await token(inst)}`, Accept: "application/vnd.github+json", "User-Agent": UA, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) { const e = new Error(`GitHub ${method} ${path.split("?")[0]} ${r.status}`); e.status = r.status; throw e; }
      return raw ? r : r.status === 204 ? null : r.json();
    };
    return {
      async runLog(repo, runId) {
        const jobs = await call("GET", `/repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=20`);
        let out = "";
        for (const j of jobs.jobs.filter((x) => x.conclusion === "failure")) {
          const r = await call("GET", `/repos/${repo}/actions/jobs/${j.id}/logs`, null, true);
          out += `\n##### job: ${j.name}\n` + (await r.text()).replace(/^\S+Z /gm, "").slice(-20000);
        }
        return out || "(no failed job log found)";
      },
      async tree(repo) {
        const t = await call("GET", `/repos/${repo}/git/trees/HEAD?recursive=1`);
        return t.tree.filter((x) => x.type === "blob").map((x) => x.path);
      },
      async file(repo, path) {
        const f = await call("GET", `/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}`);
        return new TextDecoder().decode(Uint8Array.from(atob(f.content.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
      },
      comment: (repo, issue, body) => call("POST", `/repos/${repo}/issues/${issue}/comments`, { body }),
      async openPR(repo, { branch, title, body, files }) {
        const meta = await call("GET", `/repos/${repo}`);
        const base = meta.default_branch;
        const ref = await call("GET", `/repos/${repo}/git/ref/heads/${base}`);
        const head = await call("GET", `/repos/${repo}/git/commits/${ref.object.sha}`);
        const tree = await call("POST", `/repos/${repo}/git/trees`, { base_tree: head.tree.sha,
          tree: Object.entries(files).map(([path, content]) => ({ path, mode: "100644", type: "blob", content })) });
        const commit = await call("POST", `/repos/${repo}/git/commits`, { message: `${title}\n\nProposed by Robot Care (My Robot I.S.A.).`, tree: tree.sha, parents: [ref.object.sha] });
        try { await call("POST", `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: commit.sha }); }
        catch { await call("PATCH", `/repos/${repo}/git/refs/heads/${branch}`, { sha: commit.sha, force: true }); }
        const pr = await call("POST", `/repos/${repo}/pulls`, { title, body, head: branch, base });
        return { url: pr.html_url, number: pr.number };
      },
      // ---- Accept fix (28 Oct 2026)
      async pull(repo, n) { try { return await call("GET", `/repos/${repo}/pulls/${n}`); } catch (e) { if (e.status === 404) return null; throw e; } },
      prFiles: (repo, n) => call("GET", `/repos/${repo}/pulls/${n}/files?per_page=30`),
      async checks(repo, sha) {
        return { runs: await call("GET", `/repos/${repo}/commits/${sha}/check-runs?per_page=100`),
                 combined: await call("GET", `/repos/${repo}/commits/${sha}/status`) };
      },
      // Pinned to the commit that was checked: GitHub refuses (409) if anything was pushed since.
      async merge(repo, n, sha, title) {
        try { const j = await call("PUT", `/repos/${repo}/pulls/${n}/merge`, { sha, merge_method: "squash", commit_title: title });
              return { ok: !!(j && j.merged), status: 200, sha: j && j.sha }; }
        catch (e) { return { ok: false, status: e.status || 0 }; }
      },
      async permissions() { await token(inst); return (tokens.get(inst) || {}).permissions || {}; },
    };
  };
  // The App's public facts (name, slug, granted permissions): no secrets, used by robot-care's GET health check.
  client.appInfo = async () => {
    const r = await fetchImpl(`${api}/app`, { headers: { Authorization: `Bearer ${await appJwt(appId, privateKey)}`, Accept: "application/vnd.github+json", "User-Agent": UA } });
    if (!r.ok) throw new Error(`GitHub /app ${r.status}`);
    const j = await r.json();
    return { slug: j.slug, permissions: j.permissions || {}, events: j.events || [] };
  };
  return client;
}

export function anthropic({ apiKey, model = "claude-sonnet-5-5", fetchImpl = fetch }) {
  return {
    async complete({ system, user, maxTokens = 3000 }) {
      const r = await fetchImpl("https://api.anthropic.com/v1/messages", { method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }) });
      if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 160)}`);
      const j = await r.json();
      return { text: (j.content || []).filter((c) => c.type === "text").map((c) => c.text).join(""), usage: j.usage };
    },
  };
}

export function supabaseStore({ url, serviceKey, fetchImpl = fetch }) {
  const db = (path, init = {}) => fetchImpl(`${url}/rest/v1/${path}`, { ...init,
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal", ...(init.headers || {}) } });
  const since = (ms) => new Date(Date.now() - ms).toISOString();
  const count = async (q) => { const r = await db(`robot_care_runs?select=key&${q}`, { headers: { Prefer: "count=exact", Range: "0-0" } }); return Number((r.headers.get("content-range") || "/0").split("/")[1]) || 0; };
  const CALLED = "outcome=in.(pr,advice,blocked)";
  const rows = async (path) => { const r = await db(path, { headers: { Prefer: "" } }); return r.ok ? await r.json() : null; };
  return {
    db,
    async seen(key) { const r = await db(`robot_care_runs?select=key&key=eq.${encodeURIComponent(key)}&outcome=neq.error&limit=1`); return r.ok && (await r.json()).length > 0; },
    async mark(key, rec) { await db("robot_care_runs", { method: "POST", body: JSON.stringify({ key, ...rec }) }); },
    async counts(login) {
      return { day: await count(`login=eq.${encodeURIComponent(login)}&${CALLED}&at=gte.${since(864e5)}`),
               month: await count(`login=eq.${encodeURIComponent(login)}&${CALLED}&at=gte.${since(30 * 864e5)}`),
               globalDay: await count(`${CALLED}&at=gte.${since(864e5)}`) };
    },
    async toldRecently(login, why) {
      return (await count(`login=eq.${encodeURIComponent(login)}&outcome=eq.skipped&why=eq.${encodeURIComponent(why)}&at=gte.${since(864e5)}`)) > 0;
    },
    async recordInstall(rec) { await db("robot_care_installs", { method: "POST", body: JSON.stringify(rec) }); },
    members: { async byLogin(login) {
      const r = await db(`members?select=status,robot_care,robot_care_until&github_login=eq.${encodeURIComponent(login)}&limit=1`, { headers: { Prefer: "" } });
      return r.ok ? (await r.json())[0] || null : null;
    } },
    // ---- Accept fix (28 Oct 2026)
    // A Message in the members area for the member whose GitHub login this is (kind "action": it needs them).
    async notice(login, { title, body, link_url = "#fixes", link_text = "See the fix" }) {
      const m = (await rows(`members?select=user_id&github_login=ilike.${encodeURIComponent(login)}&user_id=not.is.null&limit=1`) || [])[0];
      if (!m) return false;
      const r = await db("member_notices", { method: "POST", body: JSON.stringify({ user_id: m.user_id, kind: "action", audience: "all",
        title: String(title).slice(0, 120), body: String(body || title).slice(0, 2000), link_url, link_text }) });
      return r.ok;
    },
    async memberByUser(uid) {
      if (!/^[0-9a-f-]{36}$/i.test(String(uid || ""))) return null;
      return (await rows(`members?select=id,user_id,email,first_name,plan,status,github_login,founding_no&user_id=eq.${uid}&limit=1`) || [])[0] || null;
    },
    async run(id) {
      if (!/^\d+$/.test(String(id))) return null;
      return (await rows(`robot_care_runs?select=id,outcome,login,repo,issue,pr,pr_number,pr_title,diagnosis,files,urgent,fix_state&id=eq.${id}&limit=1`) || [])[0] || null;
    },
    async openRuns(login) {
      return await rows(`robot_care_runs?select=id,outcome,login,repo,pr,pr_number,fix_state&outcome=eq.pr&login=ilike.${encodeURIComponent(login)}&or=(fix_state.is.null,fix_state.eq.open,fix_state.eq.declined)&order=at.desc&limit=10`) || [];
    },
    async setState(id, fix_state) {
      const r = await db(`robot_care_runs?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ fix_state, decided_at: new Date().toISOString() }) });
      return r.ok;
    },
    async installation(login) {   // the latest install event for this account; null once uninstalled or suspended
      const last = (await rows(`robot_care_installs?select=installation,action&account=ilike.${encodeURIComponent(login)}&order=at.desc&limit=1`) || [])[0];
      return last && !["deleted", "suspend"].includes(last.action) ? last.installation : null;
    },
    async requests(uid, sinceMs, kind, runId) {
      const q = `robot_care_requests?select=id&user_id=eq.${uid}&at=gte.${since(sinceMs)}` + (kind ? `&kind=in.(${kind})` : "") + (runId ? `&run_id=eq.${runId}` : "");
      const r = await db(q, { headers: { Prefer: "count=exact", Range: "0-0" } });
      if (!r.ok) return null;
      return Number((r.headers.get("content-range") || "/0").split("/")[1]) || 0;
    },
    async logRequest(rec) { const r = await db("robot_care_requests", { method: "POST", body: JSON.stringify(rec) }); return r.ok; },
  };
}
