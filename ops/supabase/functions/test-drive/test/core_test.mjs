// test-drive rules, no network:  node ops/supabase/functions/test-drive/test/core_test.mjs
import assert from "node:assert/strict";
import { handle, unlocked, londonMidnight, OPENS } from "../core.js";
import { memoryStore } from "./memory.mjs";

const DAYS = [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, holdings: [{ label: "Stock A" }] }));
const REV = [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, shares: [{ label: "Stock A", name: "Secret " + day }] }));
const T = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (s) => Date.parse(s);
let passed = 0; const t = async (n, f) => { await f(); passed++; console.log("ok  ", n); };

await t("a member's link waits for 7 December, London time", async () => {
  const S = memoryStore(DAYS, REV); S.add(T(1));
  let r = await handle({ method: "GET", token: T(1) }, S, at("2026-12-06T23:59:00Z"));
  assert.equal(r.body.state, "soon"); assert.equal(S.rows.get(T(1)).started_at, null);
  r = await handle({ method: "GET", token: T(1) }, S, at("2026-12-07T00:00:00Z"));
  assert.equal(r.body.state, "open"); assert.equal(r.body.unlocked, 1);
});
await t("a member can't time-travel or reset", async () => {
  const S = memoryStore(DAYS, REV); S.add(T(2));
  const r = await handle({ method: "GET", token: T(2), now: "2027-01-01T00:00:00Z" }, S, at("2026-12-08T09:00:00Z"));
  assert.equal(r.body.unlocked, 1);
  assert.notEqual((await handle({ method: "POST", token: T(2), action: "reset" }, S, at("2026-12-08T09:00:00Z"))).body.state, "reset");
});
await t("one new day each London calendar day, never more than seven; a missed day waits", async () => {
  const S = memoryStore(DAYS, REV); S.add(T(3));
  const seen = [];
  for (const d of ["2026-12-09T22:00:00Z", "2026-12-10T08:00:00Z", "2026-12-11T00:01:00Z", "2026-12-14T12:00:00Z", "2027-02-01T12:00:00Z"])
    seen.push((await handle({ method: "GET", token: T(3) }, S, at(d))).body.unlocked);
  assert.deepEqual(seen, [1, 2, 3, 6, 7]);
});
await t("only opened days are sent; no reveal before the day is finished", async () => {
  const S = memoryStore(DAYS, REV); S.add(T(4));
  let r = await handle({ method: "GET", token: T(4) }, S, at("2026-12-07T10:00:00Z"));
  assert.equal(r.body.days.length, 1); assert.equal(r.body.reveals.length, 0);
  assert.ok(!JSON.stringify(r.body).includes("Secret"));
  r = await handle({ method: "POST", token: T(4), action: "done", day: 2 }, S, at("2026-12-07T11:00:00Z"));
  assert.equal(r.status, 403); assert.match(r.body.error, /Tuesday 8 December/);
  r = await handle({ method: "POST", token: T(4), action: "done", day: 1 }, S, at("2026-12-07T11:00:00Z"));
  assert.deepEqual(r.body.done, [1]); assert.equal(r.body.reveals[0].shares[0].name, "Secret 1");
  assert.ok(!JSON.stringify(r.body).includes("Secret 2"));
});
await t("days are finished in order, and finishing twice changes nothing", async () => {
  const S = memoryStore(DAYS, REV); S.add(T(5), "sim");
  const now = "2026-12-20T10:00:00Z";
  await handle({ method: "GET", token: T(5), now: "2026-12-07T10:00:00Z" }, S);
  assert.equal((await handle({ method: "POST", token: T(5), action: "done", day: 3, now }, S)).status, 409);
  await handle({ method: "POST", token: T(5), action: "done", day: 1, now }, S);
  const r = await handle({ method: "POST", token: T(5), action: "done", day: 1, now }, S);
  assert.deepEqual(r.body.done, [1]);
});
await t("the link's ?t= is read as the token (the live bug of 6 Nov: every link said it was incomplete)", async () => {
  const S = memoryStore(DAYS, REV); S.add(T(8), "preview");
  assert.equal((await handle({ method: "GET", t: T(8) }, S)).body.state, "open");
});
await t("bad and unknown links get a plain answer", async () => {
  const S = memoryStore(DAYS, REV);
  assert.equal((await handle({ method: "GET", token: "abc" }, S)).status, 400);
  assert.equal((await handle({ method: "GET", token: T(9) }, S)).status, 404);
});
await t("London midnight is right in GMT and BST", async () => {
  assert.equal(new Date(londonMidnight("2026-12-07")).toISOString(), "2026-12-07T00:00:00.000Z");
  assert.equal(new Date(londonMidnight("2026-07-01")).toISOString(), "2026-06-30T23:00:00.000Z");
  assert.equal(unlocked(at("2026-06-30T23:30:00Z"), at("2026-07-01T22:59:00Z")), 1);   // both 1 July in London
  assert.equal(OPENS, "2026-12-07");
});
console.log(`${passed} passed`);
