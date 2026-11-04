#!/usr/bin/env python3
"""Site checks (29 Oct 2026, Amit): the cheap, no-browser half of the PR checks.

1. Every inline script in docs/**/*.html parses (node --check).
2. The members area's three version numbers agree: <meta name="mri-version"> in
   docs/members/index.html, docs/members/version.json and the cache name in docs/members/sw.js.

The browser half is ops/members_sidebar_test.mjs, run by .github/workflows/checks.yml.
Run locally: python3 tools/site_checks.py
"""
import json
import pathlib
import re
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
JS_TYPES = {"", "text/javascript", "application/javascript", "module"}
SCRIPT = re.compile(r"<script(?P<attrs>(?![^>]*\bsrc=)[^>]*)>(?P<body>.*?)</script>", re.S | re.I)
TYPE = re.compile(r"""\btype\s*=\s*["']?([^"'\s>]+)""", re.I)

failures = []
checked = 0
tmp = pathlib.Path(tempfile.mkdtemp())
for page in sorted(DOCS.rglob("*.html")):
    text = page.read_text(encoding="utf-8", errors="replace")
    for i, m in enumerate(SCRIPT.finditer(text)):
        t = TYPE.search(m.group("attrs"))
        kind = (t.group(1) if t else "").lower()
        if kind not in JS_TYPES or not m.group("body").strip():
            continue
        f = tmp / f"s{checked}.{'mjs' if kind == 'module' else 'js'}"
        f.write_text(m.group("body"))
        checked += 1
        r = subprocess.run(["node", "--check", str(f)], capture_output=True, text=True)
        if r.returncode:
            line = text[: m.start()].count("\n") + 1
            failures.append(f"{page.relative_to(ROOT)}: script starting at line {line} does not parse:\n{r.stderr.strip()[:600]}")

idx = (DOCS / "members/index.html").read_text()
meta = re.search(r'<meta name="mri-version" content="(\d+)">', idx)
vjson = json.loads((DOCS / "members/version.json").read_text()).get("version")
sw = re.search(r'"mri-members-v(\d+)"', (DOCS / "members/sw.js").read_text())
versions = {"index.html meta": meta and meta.group(1), "version.json": vjson, "sw.js cache": sw and sw.group(1)}
if len(set(versions.values())) != 1 or None in versions.values():
    failures.append(f"members area versions disagree: {versions} (bump all three together)")

# hub D36: the email module merges on green checks, and every scheduled email loads it from main, so prove it still renders.
try:
    import importlib.util
    spec = importlib.util.spec_from_file_location("lms_email", ROOT / "ops/lms_email.py")
    mail = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mail)
    block = {"heading": "Does it need me?", "status": ("Yes", "green"), "accent": True, "prose": ["Yes."],
             "button": ("Review", "https://myrobotisa.com/", True), "small": "Small."}
    health = {"heading": "Health", "status": ("Check", "amber"), "health": [("warn", "T", "Now", "Robot", "You")], "checks": []}
    for internal in (True, False):
        html = mail.render("Title", "Eyebrow", "Sub", [block, health], brand=mail.MRI_BRAND, internal=internal)
        html = html["html"] if isinstance(html, dict) else html
        for needed in ("color-scheme", "Review", "Small.", "Robot", "bgcolor"):
            if needed not in html:
                failures.append(f"lms_email.render lost {needed!r} (internal={internal})")
except Exception as e:  # noqa: BLE001
    failures.append(f"lms_email.py doesn't render: {e!r}")

# Every internal notice needs its robot for every project, or internal mail shows a broken image (hub DECISIONS D37).
theme = (ROOT / "ops/lms_email.py").read_text()
notices = re.findall(r'"(\w+)": "#[0-9A-F]{6}"', theme[theme.index("NOTICES = {"):theme.index("_NOTICE_BY_TYPE")])
if len(notices) != 6:
    failures.append(f"expected six notices in lms_email.py, found {notices}")
for project in ("isa", "sbh", "lms", "dtl"):
    for notice in notices:
        if not (DOCS / f"email/notice/{project}-{notice}.png").is_file():
            failures.append(f"docs/email/notice/{project}-{notice}.png is missing")
# An internal email must use the notice robot for its project, whatever the caller passes (hub DECISIONS D37).
for brand, project in ((mail.SBH_BRAND, "sbh"), (mail.MRI_BRAND, "isa"), (mail.DTL_BRAND, "dtl"), (("L", "Last Man", "Standing", mail.LMS_LOGO), "lms")):
    html = mail.render("Title", "Eyebrow", "Sub", [{"heading": "H", "status": ("x", "red"), "accent": True, "prose": ["P"]}], brand=brand, mood=mail.MOODS["calm"])
    for needed in (f"email/notice/{project}-red.png", "border:2px solid #FF4D7A"):
        if needed not in html:
            failures.append(f"internal render for {project} lost {needed}")

print(f"{checked} inline scripts parsed; members area version {versions['version.json']}")
if failures:
    print("\n\n".join(failures))
    sys.exit(1)
print("site checks passed")
