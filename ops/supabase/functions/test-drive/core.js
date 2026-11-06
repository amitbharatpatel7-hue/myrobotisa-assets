// test-drive (6 Nov 2026, hub D41): one link per person, seven real past weeks, one a day, names revealed at the end
// of each day. Pure logic; index.ts wires it to the database. Rules:
//  - A member's link works from Monday 7 December 2026 (London). Preview and sim links work any time.
//  - Day 1 opens the first time the link is used; day N opens on the (N-1)th London calendar day after that. A missed
//    day waits: it is still there the next time.
//  - A day's data (shares as Stock A, B, C) comes only once it has opened. Its reveal (who they were) comes only once
//    the visitor has finished that day. Nothing secret is ever in the page.
//  - "now" and "reset" are honoured only on preview and sim links, so the simulations can travel through time.
export const OPENS = "2026-12-07";
export const DAYS = 7;

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
export const londonDate = (ms) => fmt.format(new Date(ms));
const dnum = (s) => Math.floor(Date.parse(s + "T12:00:00Z") / 86400000);
const addDays = (s, n) => new Date((dnum(s) + n) * 86400000).toISOString().slice(0, 10);

// The instant London's clock reads 00:00 on date s (GMT or BST).
export function londonMidnight(s) {
  const guess = Date.parse(s + "T00:00:00Z");
  for (const off of [0, -3600000]) if (londonDate(guess + off) === s && londonDate(guess + off - 1) !== s) return guess + off;
  return guess;
}

export function unlocked(startedMs, nowMs) {
  if (startedMs == null) return 0;
  return Math.max(1, Math.min(DAYS, dnum(londonDate(nowMs)) - dnum(londonDate(startedMs)) + 1));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const out = (status, body) => ({ status, body });

// req: { method, token, day?, action?, now? }   store: { get, start, done, reset, days, reveals }
export async function handle(req, store, realNow = Date.now()) {
  const token = String(req.token || req.t || "").trim().toLowerCase();   // the link carries ?t=
  if (!UUID.test(token)) return out(400, { error: "This link isn't complete. Open it from your email again." });
  const row = await store.get(token);
  if (!row) return out(404, { error: "We don't recognise this link. Open it from your test drive email." });
  const free = row.kind !== "member";
  let now = realNow;
  if (free && req.now != null && !Number.isNaN(Date.parse(req.now))) now = Date.parse(req.now);
  if (free && req.action === "reset") { await store.reset(token); return out(200, { state: "reset" }); }
  if (!free && now < londonMidnight(OPENS))
    return out(200, { state: "soon", opens: OPENS, opens_at: new Date(londonMidnight(OPENS)).toISOString() });

  let started = row.started_at ? Date.parse(row.started_at) : null;
  if (started == null) { started = now; await store.start(token, new Date(now).toISOString()); }
  const open = unlocked(started, now);
  let done = row.done || [];

  if (req.method === "POST" && req.action === "done") {
    const day = Number(req.day);
    if (!Number.isInteger(day) || day < 1 || day > DAYS) return out(400, { error: "That day doesn't exist." });
    if (day > open) return out(403, { error: `Day ${day} opens on ${openDate(started, day)}.` });
    if (day > 1 && !done.includes(day - 1) ) return out(409, { error: `Finish day ${day - 1} first.` });
    done = await store.done(token, day);
  }
  const days = await store.days(open);
  const reveals = await store.reveals(done.filter((d) => d <= open));
  const next = open < DAYS ? new Date(londonMidnight(addDays(londonDate(started), open))).toISOString() : null;
  return out(200, { state: "open", unlocked: open, done, days, reveals, next_opens_at: next, started_at: new Date(started).toISOString() });
}

export function openDate(startedMs, day) {
  const d = new Date(Date.parse(addDays(londonDate(startedMs), day - 1) + "T12:00:00Z"));
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });
}
