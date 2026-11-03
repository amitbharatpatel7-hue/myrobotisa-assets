-- 3 Nov 2026 (lessons audit item 4): a member's Claude fix starts on an @claude COMMENT by the repo owner
-- (kit claude-fix.yml), not on a new issue, so "Try it on purpose" now says to comment on the issue.
-- Applied to the live database on 3 Nov 2026.
update lesson_guides set data = jsonb_set(data, '{steps,6,d}', to_jsonb('In your repo on GitHub, open Issues → New issue, give it any title (Hello Claude is fine) and press Submit. Then, on that issue, add a comment: @claude what does send_email.py do? and press Comment. Within a couple of minutes Claude replies on the issue. That''s the same Claude that will mend a failed run.'::text))
where id = 'qs-claude' and data->'steps'->6->>'t' = 'Try it on purpose';
