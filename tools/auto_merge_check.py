#!/usr/bin/env python3
"""Which site PRs merge themselves (29 Oct 2026, Amit: "only ones making fundamental changes need me").

1 Nov 2026 (hub DECISIONS D30, Amit: "only review important things that affect production"): 30 of the
last 31 site PRs waited for him. Narrowed: ops/supabase/* and tools/* merge freely (merging deploys
nothing there; deploying a function is a separate step that needs his "deploy it"); the line scan keeps
only sign-in, keys, payments and new scripts; the size cap goes from 400 to 1,500 lines. Merges show in
his daily digest.

A PR merges itself after the Site checks pass only if ALL of these hold:
  - it is Claude's: opened by claude[bot], or by the repo owner with a https://claude.ai/code/session_ link
    in the body (a Claude session pushes with Amit's token);
  - it is open, not a draft, and the checks ran on its current head commit;
  - its body has no "DECISION NEEDED:" line;
  - it touches no guarded file (GUARDED below);
  - no changed line touches sign-in, accounts, payments, the database or a new outside script (SENSITIVE);
  - it is small enough to read in one go (MAX_LINES changed lines).
Anything else waits for Amit, with a comment on the PR saying why.

Run by .github/workflows/auto-merge.yml from main, so a PR can't loosen the rule it is judged by.
Tests: python3 tools/test_auto_merge_check.py
"""
import fnmatch
import re

OWNER = "amitbharatpatel7-hue"
MAX_LINES = 1500

# path patterns (fnmatch) and why they wait for Amit
GUARDED = [
    (".github/*", "workflows, including this merge rule"),
    ("tools/auto_merge_check.py", "this merge rule"),
    ("tools/test_auto_merge_check.py", "this merge rule's tests"),
    ("ops/supabase/migrations/*", "the live database schema"),
    ("docs/terms.html", "legal: terms"),
    ("docs/privacy.html", "legal: privacy"),
    ("docs/isa-rules.html", "what the site says about ISA rules (financial promotion)"),
    ("docs/join.html", "joining and payment"),
    ("docs/account/*", "member accounts"),
    ("docs/CNAME", "the domain"),
    ("docs/_config.yml", "how GitHub Pages builds the site"),
]

# changed lines matching these wait for Amit, wherever they are
SENSITIVE = [
    (re.compile(r"/auth/v1/"), "sign-in calls"),
    # 4 Nov 2026 (hub D36): a page using the member's own session token to call our functions is ordinary. What matters is a
    # secret, or anything sent to a host that isn't ours (the rule after next).
    (re.compile(r"service_role|api[_-]?key\s*[:=]|sk-ant-|sk_live_", re.I), "a secret key"),
    (re.compile(r"verifyOtp|signInWith|signOut|navigator\.credentials|PublicKeyCredential|webauthn", re.I), "sign-in"),
    (re.compile(r"stripe|payment_intent|price_id", re.I), "payments"),
    (re.compile(r"""<script[^>]*\bsrc\s*=\s*["']?(https?:)?//""", re.I), "a script loaded from another site"),
    (re.compile(r"""fetch\(\s*[`"']https?://(?![\w.-]*(myrobotisa\.com|supabase\.co)\b)""", re.I), "data sent to another site"),
    (re.compile(r"application/ld\+json", re.I), "a search summary with markup in it"),
]

# browser tests stub the database and sign-in on purpose, so their lines aren't scanned (their paths still are)
UNSCANNED = ["ops/*_test.mjs"]

# A page's search summary (schema.org JSON-LD) is data browsers never run: one line of FAQ wording. Its text
# mentions Supabase and payments (the security and cost answers), so any FAQ edit used to wait for Amit
# (#24, #29, 1 Nov 2026). Exempt only a line that is exactly one ld+json block with no other tag inside it.
LD_JSON_LINE = re.compile(r'^\s*<script type="application/ld\+json">[^<]*</script>\s*$')

SESSION = re.compile(r"https://claude\.ai/code/session_\w+")


def is_claudes(pr):
    login = (pr.get("user") or {}).get("login", "")
    if login == "claude[bot]":
        return True
    return login == OWNER and bool(SESSION.search(pr.get("body") or ""))


def changed_lines(patch):
    for line in (patch or "").splitlines():
        if line.startswith(("+++", "---")):
            continue
        if line.startswith(("+", "-")):
            yield line[1:]


def reasons_to_wait(pr, files, checked_sha):
    """[] means merge; otherwise each item is a plain-words reason it waits for Amit."""
    why = []
    if not is_claudes(pr):
        why.append("it wasn't opened by a Claude session")
    if pr.get("state") != "open":
        why.append("it isn't open")
    if pr.get("draft"):
        why.append("it's a draft")
    if (pr.get("head") or {}).get("sha") != checked_sha:
        why.append("new commits arrived after the checks ran")
    if re.search(r"^\s*DECISION NEEDED:\s*(money|legal|release|live data)\b", pr.get("body") or "", re.M | re.I):   # hub D36
        why.append("it says DECISION NEEDED")
    total = 0
    touched, guarded = {}, {}
    for f in files:
        name = f.get("filename", "")
        for path in filter(None, [name, f.get("previous_filename")]):
            for pat, what in GUARDED:
                if fnmatch.fnmatch(path, pat):
                    guarded.setdefault(what, [])
                    if path not in guarded[what]:
                        guarded[what].append(path)
                    break
        if f.get("patch") is None and f.get("status") != "removed" and not name.endswith((".png", ".jpg", ".mp4", ".webp", ".gif")):
            why.append(f"{name}'s change is too big for GitHub to show, so it can't be checked")
        total += f.get("additions", 0) + f.get("deletions", 0)
        if any(fnmatch.fnmatch(name, pat) for pat in UNSCANNED):
            continue
        for line in changed_lines(f.get("patch")):
            if LD_JSON_LINE.match(line):
                continue
            for rx, what in SENSITIVE:
                if rx.search(line):
                    touched.setdefault(what, [])
                    if name not in touched[what]:
                        touched[what].append(name)
    for what, names in guarded.items():
        more = f" and {len(names) - 3} more" if len(names) > 3 else ""
        why.append(f"it changes {what} ({', '.join(names[:3])}{more})")
    for what, names in touched.items():
        more = f" and {len(names) - 3} more" if len(names) > 3 else ""
        why.append(f"it changes {what} ({', '.join(names[:3])}{more})")
    if total > MAX_LINES:
        why.append(f"it changes {total} lines (over {MAX_LINES})")
    return list(dict.fromkeys(why))


if __name__ == "__main__":
    import json
    import os
    import subprocess
    import sys

    repo, number, sha = os.environ["REPO"], os.environ["PR"], os.environ["HEAD_SHA"]

    def api(path, *args):
        out = subprocess.run(["gh", "api", *args, path], capture_output=True, text=True, check=True).stdout
        return json.loads(out) if out.strip() else None

    pr = api(f"repos/{repo}/pulls/{number}")
    files = api(f"repos/{repo}/pulls/{number}/files?per_page=100", "--paginate")
    why = reasons_to_wait(pr, files, sha)
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as fh:
            fh.write(f"merge={'false' if why else 'true'}\n")
            fh.write("why<<EOF\n" + "\n".join(f"- {w}" for w in why) + "\nEOF\n")
    print("merge" if not why else "waits for Amit:\n" + "\n".join(f"- {w}" for w in why))
    sys.exit(0)
