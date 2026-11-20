-- Lesson 12, "Ask your robot": one more question, with the result of the market pause study
-- (stock-boom-hunter research/market_pause, decision D47). Amit, 20 Nov 2026: "let's do it all now".
-- APPLIED to the live project on 20 Nov 2026 from a Claude session and checked with a read-only query (5 items).
-- It adds one item at position 2 of the "When to pause" step and removes nothing. Safe to run twice: the last
-- condition stops a second insert.
update lesson_guides
set data = jsonb_insert(data, '{steps,3,lx,try,items,1}', '["Wouldn''t pausing early in a fall save me money?", "We tested six ways of pausing in a falling market. Selling early missed more growth than it saved, and freezing switched off my stops. So I keep following my rules."]'::jsonb),
    updated_at = now()
where id = 'day-12'
  and data->'steps'->3->>'t' = 'When to pause'
  and data->'steps'->3->'lx'->'try'->>'type' = 'ask'
  and not (data->'steps'->3->'lx'->'try'->'items')::text like '%six ways of pausing%';
