# ppp-assets
## Pull requests: what merges itself (29 Oct 2026, Amit)

Every PR runs **Site checks** (`.github/workflows/checks.yml`): the merge-rule tests, every inline script parses,
the members area's three version numbers agree, and the members menu test in a real browser
(`ops/members_sidebar_test.mjs`). Free: this repository is public.

When the checks pass, **Auto-merge** (`.github/workflows/auto-merge.yml`, always run from `main`) merges a PR from a
Claude session unless it is fundamental. The rule is `tools/auto_merge_check.py`; in short, it waits for Amit when it:

- touches workflows, `tools/`, the email template, `ops/supabase/`, terms, privacy, the ISA rules page, joining or
  accounts, or the domain;
- changes a line about sign-in, tokens or keys, the database, payments, a network call or an outside script;
- is over 400 changed lines, is a draft, or says `DECISION NEEDED:`.

A PR that waits gets a comment saying why. Wording, layout, menu, version bumps and Your updates entries merge themselves.
To make any PR wait, open it as a draft or add a `DECISION NEEDED:` line.
