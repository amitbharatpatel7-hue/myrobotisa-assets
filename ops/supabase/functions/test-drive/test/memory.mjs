// An in-memory stand-in for the two test-drive tables, with the same rules as 2026-11-06-test-drive.sql:
// started_at is set only once, done holds each day once in order, days/reveals come back in day order.
export function memoryStore(days, reveals) {
  const rows = new Map();
  const S = {
    rows,
    add(token, kind = "member") { rows.set(token, { kind, started_at: null, done: [] }); return token; },
    get: async (t) => (rows.has(t) ? structuredClone(rows.get(t)) : null),
    start: async (t, iso) => { const r = rows.get(t); if (r.started_at == null) r.started_at = iso; },
    done: async (t, d) => { const r = rows.get(t); r.done = [...new Set([...r.done, d])].sort((a, b) => a - b); return [...r.done]; },
    reset: async (t) => { const r = rows.get(t); r.started_at = null; r.done = []; },
    days: async (n) => days.filter((d) => d.day <= n),
    reveals: async (ds) => reveals.filter((r) => ds.includes(r.day)),
  };
  return S;
}
