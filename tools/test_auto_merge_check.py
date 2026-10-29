#!/usr/bin/env python3
"""Tests for tools/auto_merge_check.py. Run: python3 tools/test_auto_merge_check.py"""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from auto_merge_check import reasons_to_wait  # noqa: E402

SHA = "abc123"
BODY = "Menu label.\n\nhttps://claude.ai/code/session_016igd8A9Cpud8r3aCLojCcb"


def pr(**kw):
    base = {"user": {"login": "amitbharatpatel7-hue"}, "state": "open", "draft": False, "head": {"sha": SHA}, "body": BODY}
    base.update(kw)
    return base


def f(name, patch='@@ -1 +1 @@\n-<a>What\'s new</a>\n+<a>Your updates</a>', **kw):
    d = {"filename": name, "patch": patch, "additions": 1, "deletions": 1, "status": "modified"}
    d.update(kw)
    return d


cases = [
    ("menu label merges", pr(), [f("docs/members/index.html"), f("docs/members/sw.js"), f("docs/members/version.json")], True),
    ("claude[bot] merges", pr(user={"login": "claude[bot]"}, body="x"), [f("docs/members/index.html")], True),
    ("Amit's own PR waits", pr(body="my change"), [f("docs/members/index.html")], False),
    ("someone else waits", pr(user={"login": "stranger"}), [f("docs/members/index.html")], False),
    ("draft waits", pr(draft=True), [f("docs/members/index.html")], False),
    ("stale sha waits", pr(head={"sha": "new"}), [f("docs/members/index.html")], False),
    ("DECISION NEEDED waits", pr(body=BODY + "\nDECISION NEEDED: pick a name"), [f("docs/members/index.html")], False),
    ("workflow waits", pr(), [f(".github/workflows/auto-merge.yml")], False),
    ("merge rule waits", pr(), [f("tools/auto_merge_check.py")], False),
    ("terms waits", pr(), [f("docs/terms.html")], False),
    ("isa rules waits", pr(), [f("docs/isa-rules.html")], False),
    ("email template waits", pr(), [f("ops/lms_email.py")], False),
    ("menu test merges", pr(), [f("ops/members_sidebar_test.mjs")], True),
    ("menu test with stubbed sign-in merges", pr(), [f("ops/members_sidebar_test.mjs", patch="+ access_token: jwt, supabase.co")], True),
    ("database folder waits", pr(), [f("ops/supabase/functions/x/index.ts", patch="+// comment")], False),
    ("moving a legal page waits", pr(), [f("docs/old.html", previous_filename="docs/privacy.html", status="renamed")], False),
    ("supabase call waits", pr(), [f("docs/members/index.html", patch="+  sb.rpc('my_robot_care_fixes')")], False),
    ("sign-in waits", pr(), [f("docs/members/index.html", patch="-  await verifyOtp(code)")], False),
    ("new outside script waits", pr(), [f("docs/index.html", patch='+<script src="https://x.example/a.js"></script>')], False),
    ("new fetch waits", pr(), [f("docs/members/index.html", patch="+ fetch('/x')")], False),
    ("payments wait", pr(), [f("docs/members/index.html", patch="+ stripe.redirectToCheckout()")], False),
    ("unchanged context line is ignored", pr(), [f("docs/members/index.html", patch=" sb.rpc('x')\n-<b>a</b>\n+<b>b</b>")], True),
    ("big PR waits", pr(), [f("docs/members/index.html", additions=300, deletions=200)], False),
    ("unshowable diff waits", pr(), [f("docs/members/index.html", patch=None)], False),
    ("new image merges", pr(), [f("docs/shots/a.png", patch=None, status="added")], True),
]

bad = 0
for name, p, files, want_merge in cases:
    why = reasons_to_wait(p, files, SHA)
    ok = (not why) == want_merge
    bad += not ok
    print(("ok  " if ok else "FAIL"), name, "" if ok else why)
print("all passed" if not bad else f"{bad} failed")
sys.exit(1 if bad else 0)
