"""Build the waitlist welcome email (Supabase edge function `waitlist-welcome`) from the house template.

Every email follows ops/lms_email.py (v2 "Night"). The edge function runs in Deno and can't import Python, so this
script renders the welcome variants here and writes them into ops/supabase/functions/waitlist-welcome/email.js as
fixed templates; the function only swaps in the recipient's unsubscribe link. Change the words HERE, run

    python3 ops/build_welcome_email.py            # writes email.js and previews in ops/out/welcome-*.html
    python3 ops/build_welcome_email.py --check    # exit 1 if email.js is stale (CI)

then deploy the function (Supabase MCP deploy_edge_function, or `supabase functions deploy waitlist-welcome`).
Any change goes to Amit as a preview first and is deployed only when he says "send" (Amit, 1 Nov 2026).

1 Nov 2026: moved onto the house template; numbered steps, ticks, the pink founding banner and a line from Amit (options B, D, E, F)
were Amit's picks. Earlier the same day: (Amit: "needs to conform to the same template ... no robot on this"),
and the test drive date is Monday 7 December.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import lms_email as L  # noqa: E402

SITE = "https://myrobotisa.com"
SRC = "email-welcome"
UNSUB = "@@UNSUB@@"   # replaced per recipient by email.js with the unsubscribe link
OUT_JS = HERE / "supabase" / "functions" / "waitlist-welcome" / "email.js"


def link(path):
    base, _, hash_ = path.partition("#")
    return SITE + base + ("&" if "?" in base else "?") + "src=" + SRC + ("#" + hash_ if hash_ else "")


QUOTE = ("I built this robot to run my own ISA, and I approve its plan from my phone each week. "
         "The test drive lets you watch how it thinks before you spend a penny.")

FOOT = ("You're getting this because you signed up at myrobotisa.com. We're @myrobotisa on YouTube, Instagram and "
        "TikTok. Questions? Just reply to this email. Not you, or changed your mind? " + UNSUB +
        " Software and a course, not financial advice. Capital at risk.")


def _with_preheader(html, text):
    return html.replace("<body ", "<body ", 1).replace(
        "\n<table role=\"presentation\" class=\"mri-page\"",
        f'\n<div style="display:none;max-height:0;overflow:hidden;opacity:0;">{L.esc(text)}</div>'
        "\n<table role=\"presentation\" class=\"mri-page\"", 1)


def launch(newsletter):
    # Layout "2b", approved by Amit on 1 Nov 2026 ("send"): website-style hero with the megaphone robot, Does it need
    # me?, the test drive as ticks, numbered next steps, the pink founding banner and a line from Amit. No newsletter
    # card and no bottom buttons, exactly as he approved it (`newsletter` no longer changes the email).
    blocks = [
        {"heading": "Does it need me?", "status": ("Not yet", "muted"), "accent": True,
         "prose": ["Not until Monday 7 December. We'll email you that morning with one link to start."]},
        {"heading": "Your free test drive", "status": ("7 Dec", "green"),
         "ticks": ["£10,000 of pretend money, on your own robot dashboard",
                   "Seven real past market weeks, one a day",
                   "Good weeks and bad, with the stock names hidden",
                   "Nothing to install, nothing to pay. Then you decide."]},
        {"heading": "What happens next",
         "steps": [("Mon 7 December", "Your free 7-day test drive starts. One link in your inbox that morning."),
                   ("January 2027", "Sales open. £99 for the first 100 founding members, then £199. You'll hear first."),
                   ("April 2027", "Tax on savings goes up. Inside an ISA, interest stays tax-free.")]},
        {"banner": {"text": "Founding members: £99, not £199.", "sub": "First 100 only, when sales open in January. Plus your first year of Robot Care free, worth £120.",
                    "link": ("What you get", link("/what-you-get.html"))}},
        {"quote": {"text": QUOTE, "by": "Amit, founder", "img": L.MRI_LOGO}},
    ]
    html = L.render("You're on", "Welcome to My Robot I.S.A.",
                    ["Your free test drive starts ", ("Monday 7 December", "gain"), "."], blocks,
                    footnote=FOOT, brand=L.MRI_BRAND, internal=False, label="Welcome", mood=L.MOODS["welcome"],
                    hero={"accent": "the list", "button": ("Open the demo", link("/demo/"), True)})
    text = ("WELCOME TO MY ROBOT I.S.A.\nYou're on the list\nYour free test drive starts Monday 7 December.\n"
            f"Open the demo: {link('/demo/')}\n\n"
            "DOES IT NEED ME?\nNot until Monday 7 December. We'll email you that morning with one link to start.\n\n"
            "YOUR FREE TEST DRIVE\n- £10,000 of pretend money, on your own robot dashboard\n- Seven real past market weeks, one a day\n"
            "- Good weeks and bad, with the stock names hidden\n- Nothing to install, nothing to pay. Then you decide.\n\n"
            "WHAT HAPPENS NEXT\n1. Mon 7 December: your free 7-day test drive starts. One link in your inbox that morning.\n"
            "2. January 2027: sales open. £99 for the first 100 founding members, then £199. You'll hear first.\n"
            "3. April 2027: tax on savings goes up. Inside an ISA, interest stays tax-free.\n\n"
            f"FOUNDING MEMBERS: £99, NOT £199. First 100 only, when sales open in January. Plus your first year of Robot Care free, worth £120. What you get: {link('/what-you-get.html')}\n\n"
            f"\"{QUOTE}\"\nAmit, founder\n\n--\n"
            + FOOT.replace(UNSUB, "Unsubscribe: " + UNSUB + "."))
    return {"subject": "You're on the list: your test drive starts 7 December",
            "html": _with_preheader(html, "Your free test drive starts Monday 7 December. Here's what happens next."),
            "text": text}


def newsletter_only():
    # Same look as the launch welcome (layout 2b), with the newspaper robot.
    blocks = [
        {"heading": "Does it need me?", "status": ("Nothing to do", "green"), "accent": True,
         "prose": ["No. The first one lands in your inbox. No tips, no signals, no hard sell."]},
        {"heading": "Want the free test drive?", "status": ("7 Dec", "green"),
         "ticks": ["£10,000 of pretend money, on your own robot dashboard",
                   "Seven real past market weeks, one a day, from Monday 7 December",
                   "Nothing to install, nothing to pay"],
         "link": ("Join the test drive", link("/join.html"))},
        {"quote": {"text": QUOTE, "by": "Amit, founder", "img": L.MRI_LOGO}},
    ]
    html = L.render("You're on", "Welcome to My Robot I.S.A.",
                    "Every fortnight: what the robot did, what it learned, and what's new.", blocks,
                    footnote=FOOT, brand=L.MRI_BRAND, internal=False, label="Welcome", mood=L.MOODS["newsletter"],
                    hero={"accent": "the newsletter", "button": ("Open the demo", link("/demo/"), True)})
    text = ("WELCOME TO MY ROBOT I.S.A.\nYou're on the newsletter\nEvery fortnight: what the robot did, what it learned, and what's new.\n"
            f"Open the demo: {link('/demo/')}\n\n"
            "DOES IT NEED ME?\nNo. The first one lands in your inbox. No tips, no signals, no hard sell.\n\n"
            "WANT THE FREE TEST DRIVE?\n- £10,000 of pretend money, on your own robot dashboard\n"
            "- Seven real past market weeks, one a day, from Monday 7 December\n- Nothing to install, nothing to pay\n"
            f"Join the test drive: {link('/join.html')}\n\n"
            f"\"{QUOTE}\"\nAmit, founder\n\n--\n"
            + FOOT.replace(UNSUB, "Unsubscribe: " + UNSUB + "."))
    return {"subject": "You're in: the My Robot I.S.A. newsletter",
            "html": _with_preheader(html, "Every fortnight: what the robot did and what it learned."), "text": text}


def build():
    t = {"launch": launch(False), "newsletter": newsletter_only()}   # since layout 2b, launch(True) == launch(False)
    for v in t.values():
        assert v["html"].count(UNSUB) == 1 and v["text"].count(UNSUB) == 1
    js = ("// GENERATED by ops/build_welcome_email.py from ops/lms_email.py (the house email template). Do not edit by hand:\n"
          "// change the words in the builder, re-run it, preview to Amit, deploy on his \"send\".\n"
          f"const T = {json.dumps(t, ensure_ascii=False)};\n\n"
          "const esc = (s) => String(s).replace(/[&<>\"']/g, (c) => ({ \"&\": \"&amp;\", \"<\": \"&lt;\", \">\": \"&gt;\", '\"': \"&quot;\", \"'\": \"&#39;\" }[c]));\n\n"
          "export function buildWelcome(row, unsubUrl) {\n"
          "  const t = row.launch_list ? T.launch : T.newsletter;\n"
          f"  const a = `<a href=\"${{esc(unsubUrl)}}\" style=\"color:{L.MUTED};text-decoration:underline;\">Unsubscribe</a>.`;\n"
          f"  return {{ subject: t.subject, html: t.html.replace(\"{UNSUB}\", a), text: t.text.replace(\"{UNSUB}\", unsubUrl) }};\n"
          "}\n")
    return t, js


def main():
    t, js = build()
    if "--check" in sys.argv:
        ok = OUT_JS.exists() and OUT_JS.read_text() == js
        print("email.js up to date" if ok else "email.js is stale: run python3 ops/build_welcome_email.py")
        sys.exit(0 if ok else 1)
    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    OUT_JS.write_text(js)
    out = HERE / "out"
    out.mkdir(exist_ok=True)
    for k, v in t.items():
        (out / f"welcome-{k}.html").write_text(v["html"].replace(UNSUB, '<a href="#">Unsubscribe</a>.'))
    print(f"wrote {OUT_JS.relative_to(HERE.parent)} and ops/out/welcome-*.html")


if __name__ == "__main__":
    main()
