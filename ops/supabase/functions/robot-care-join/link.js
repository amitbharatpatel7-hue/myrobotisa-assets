// Shared by github-oauth and robot-care-join (25 Oct 2026): link a member to their verified GitHub login, and invite
// that login to the myrobotisa community org. Never stores or logs GitHub tokens.
export const ORG = "myrobotisa";
export const TEMPLATE = "amitbharatpatel7-hue/my-robot-isa-template";
const UA = "myrobotisa-members";

export function db(url, key) {
  return (path, init = {}) => fetch(`${url}/rest/v1/${path}`, { ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) } });
}

export function userIdFromJwt(auth) {
  // verify_jwt is on for these functions, so the platform has already checked the signature; we only read the subject.
  try { return JSON.parse(atob(auth.replace(/^Bearer /, "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub || null; } catch { return null; }
}

export async function memberByUser(q, uid) {
  if (!uid) return null;
  const r = await q(`members?select=id,email,plan,status,founding_no,github_login,robot_care,robot_care_since,robot_care_until&user_id=eq.${uid}&limit=1`);
  return r.ok ? (await r.json())[0] || null : null;
}

// Save the login on the member's row, unless another member already has it. Returns "linked" | "same" | "different" |
// "taken" | "error". 25 Oct 2026: a member who already has a login and connects a DIFFERENT account keeps the saved one
// ("different"): Robot Care looks after the saved account's copy, and moving it silently broke it. The page offers a
// "Use @new instead" button, which calls robot-care-join with force.
export async function linkLogin(q, member, login, force = false) {
  if (!member || !login) return "error";
  if ((member.github_login || "").toLowerCase() === login.toLowerCase()) return "same";
  if (member.github_login && !force) return "different";
  const t = await q(`members?select=id&github_login=ilike.${encodeURIComponent(login)}&id=neq.${member.id}&limit=1`);
  if (!t.ok) return "error";
  if ((await t.json()).length) return "taken";
  const u = await q(`members?id=eq.${member.id}`, { method: "PATCH", body: JSON.stringify({ github_login: login }) });
  return u.ok ? "linked" : "error";
}

// Invite a GitHub login to the community org. Returns "invited" | "already" | "skipped" | "error:<status>".
export async function inviteToOrg(token, login) {
  if (!token || !login) return "skipped";
  const h = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": UA, "X-GitHub-Api-Version": "2022-11-28" };
  const m = await fetch(`https://api.github.com/orgs/${ORG}/memberships/${encodeURIComponent(login)}`, { headers: h });
  if (m.status === 200) return "already";                       // a member, or an invite is already waiting
  const u = await fetch(`https://api.github.com/users/${encodeURIComponent(login)}`, { headers: h });
  if (!u.ok) return `error:user ${u.status}`;
  const id = (await u.json()).id;
  const r = await fetch(`https://api.github.com/orgs/${ORG}/invitations`, { method: "POST", headers: { ...h, "Content-Type": "application/json" },
    body: JSON.stringify({ invitee_id: id, role: "direct_member" }) });
  if (r.status === 201) return "invited";
  if (r.status === 422) return "already";                      // GitHub's answer when an invite is already pending
  return `error:${r.status}`;
}

// 2 Nov 2026 (D32): early adopters need access to the private template to make their copy. The page accepts the invite
// with the member's own connection, so they never see it. Returns "invited" | "already" | "skipped" | "error:<status>".
// The template is in a personal account, where GitHub gives every collaborator write access whatever is asked for, so this
// is for the few trusted early adopters only: paying members need the template in the org first (January checkout work).
export async function inviteToTemplate(token, login) {
  if (!token || !login) return "skipped";
  const r = await fetch(`https://api.github.com/repos/${TEMPLATE}/collaborators/${encodeURIComponent(login)}`, { method: "PUT",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": UA, "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
    body: JSON.stringify({ permission: "pull" }) });
  if (r.status === 201) return "invited";
  if (r.status === 204) return "already";
  return `error:${r.status}`;
}

// Robot Care's free year: the first 100 founding members, early adopters (D32) and the owner. Everyone else waits for paid Robot Care.
export function careEligible(m) {
  if (m && m.robot_care_until && m.robot_care_until < new Date().toISOString().slice(0, 10)) return false;   // the free year has ended
  if (!m || m.status !== "active") return false;
  if (m.plan === "owner" || m.plan === "early") return true;
  return m.plan === "founding" && Number.isInteger(m.founding_no) && m.founding_no >= 1 && m.founding_no <= 100;
}

// What to write on the row when Robot Care is switched on: the owner has no end date; a founding member's or early
// adopter's free year runs from today. Switching on again inside the year keeps the original dates.
export function careStart(m, today = new Date()) {
  if (m.robot_care && m.robot_care_since) return null;
  const since = today.toISOString();
  if (m.plan === "owner") return { robot_care: true, robot_care_since: since, robot_care_until: null };
  const until = new Date(today); until.setUTCFullYear(until.getUTCFullYear() + 1); until.setUTCDate(until.getUTCDate() - 1);
  return { robot_care: true, robot_care_since: since, robot_care_until: until.toISOString().slice(0, 10) };
}

// Who a GitHub token belongs to, according to GitHub. The token is used for this one call and never stored or logged.
export async function loginFromToken(token) {
  if (!token || !/^[A-Za-z0-9_]{20,255}$/.test(token)) return "";
  const u = await fetch("https://api.github.com/user", { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": UA } });
  return u.ok ? String((await u.json()).login || "") : "";
}
