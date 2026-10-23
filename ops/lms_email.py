"""The shared email theme for every project — v2 "Night" (23 Oct 2026).

Single source of truth for the HTML all of the automated emails use: My Robot I.S.A., Stock Boom Hunter, Points Per Pound,
Clipped Daily, Last Man Standing and the ops tasks. It lives in this PUBLIC repo because a scheduled task fetches with no
credentials, so a raw URL in any of the private code repos returns 404 and the module never loads.

v2 (Amit, 23 Oct 2026: "Sample D — I like, it's more in keeping with our theme ... change all emails to this theme,
including the internal ones to me, and flag (Internal) in the subject"):
  * deep purple page, plum cards, white text, green accents, a brand tile + wordmark above the first card, uppercase
    condensed headings (Impact on Apple/Windows, falling back to Arial Narrow Bold);
  * dark-mode safe: `color-scheme: light only` declared in both metas and in :root, and every coloured block carries a
    `bgcolor` attribute as well as the inline background longhand, so Apple Mail and Outlook leave the colours alone;
  * `subject()` prefixes "(Internal) " unless `internal=False` — only emails to members or customers pass False.

Public surface (unchanged from v1, two optional additions):

    render(title, eyebrow_text, subtitle, blocks, cta=None, footnote=None, brand=None, buttons=None, mood=None)
    subject(project, type_, detail, internal=True)
    london(ts=None)

`blocks` is a list of dicts, each one card: `heading`, optional `status` (label, kind), and one of `prose` (str or list),
`table` ({"headers": [...], "rows": [[...]]}), `pills` (list of str or (label, kind)), or `kv` (list of (label, value)).
A block may set `accent: True` to draw it with a green left rule (use for the one thing that needs the reader).
`kind` for a pill is green / amber / red / muted. `buttons` is a list of (label, url, primary_bool) shown under the cards.
`tone="up"` turns the headline green (a gain); `subtitle` and prose paragraphs may be lists of strings and (text, "gain")
pairs so successes read in bold green. A `days` block ([(label, change), ...]) draws a week strip. `internal` (default True) puts a green INTERNAL badge beside the wordmark: pass internal=False for anything a member,
customer or player receives (same rule as subject()). `brand` is (tile_letter, wordmark, pink_suffix[, logo_url]); with a logo_url the tile is that image (the website's mark), else a green
tile with the letter. `mood` is an image URL shown beside the headline (the robot moods live at myrobotisa.com/email/robot-*.png;
use `mood_for(change)`). A block may carry `more: {"summary": "Show the funds", "items": [...]}`: a show/hide list (<details>, which
Apple Mail opens and closes; Gmail ignores the tag and simply shows the list).

    python3 ops/lms_email.py --demo   # writes sample emails to files
"""
from __future__ import annotations

import argparse
import html
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

LONDON = ZoneInfo("Europe/London")

# ---------------------------------------------------------------- theme (v2 Night)
PAGE = "#34003B"        # deep purple page
CARD = "#4B1155"        # plum card
CARD_DEEP = "#3E0A47"   # inset panels / table header
GREEN = "#00E87A"
PINK = "#EA00AB"
INK = "#FFFFFF"
MUTED = "#D9C6DE"
HAIRLINE = "#5E2468"
ON_GREEN = "#34003B"
AMBER_FG, AMBER_BG = "#FFD27A", "#5A3A0E"
RED_FG, RED_BG = "#FF8FB0", "#5C1236"
GREEN_FG, GREEN_BG = "#00E87A", "#14402C"
MUTED_FG, MUTED_BG = "#D9C6DE", "#5A2366"

CARD_RADIUS = 18
PANEL_RADIUS = 14

FONT_STACK = "Poppins,-apple-system,'Segoe UI',Helvetica,Arial,sans-serif"
HEAD_STACK = "Impact,'Arial Narrow Bold',sans-serif"
MONO_STACK = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"

MRI_LOGO = "https://myrobotisa.com/avatar.png"
MRI_BRAND = ("R", "My Robot", "I.S.A.", MRI_LOGO)
SBH_BRAND = ("S", "Stock Boom", "Hunter", "https://myrobotisa.com/email/sbh.png")
# v2.4 (23 Oct 2026, approved by Amit): six robot moods, one per kind of day. "steady"/"flat" stay as aliases so older
# callers keep working; the original robot-steady.png / robot-flat.png images stay on the site for emails already sent.
_E = "https://myrobotisa.com/email/"
MOODS = {"up": _E + "robot-up.png", "milestone": _E + "robot-milestone.png", "calm": _E + "robot-calm.png",
         "quiet": _E + "robot-quiet.png", "yourturn": _E + "robot-yourturn.png", "paused": _E + "robot-paused.png"}
MOODS["steady"], MOODS["flat"] = MOODS["calm"], MOODS["quiet"]

PILL_COLORS = {
    "green": (GREEN_FG, GREEN_BG),
    "amber": (AMBER_FG, AMBER_BG),
    "red": (RED_FG, RED_BG),
    "muted": (MUTED_FG, MUTED_BG),
}


# ---------------------------------------------------------------- helpers
def london(ts: datetime | None = None) -> str:
    """A UTC instant as London local time, zone spelled out, e.g. "15 Sep 2026, 14:10 BST". Naive = UTC."""
    if ts is None:
        ts = datetime.now(timezone.utc)
    elif ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(LONDON).strftime("%d %b %Y, %H:%M %Z")


def esc(value) -> str:
    return html.escape(str(value), quote=True)


def _bg(color: str) -> str:
    """bgcolor attribute + both background properties: Outlook drops one or the other."""
    return f'bgcolor="{color}" style="background:{color};background-color:{color};'


def pill(label: str, kind: str = "muted") -> str:
    fg, bg = PILL_COLORS.get(kind, PILL_COLORS["muted"])
    return (f'<span style="display:inline-block;padding:4px 11px;border-radius:999px;font-size:11px;font-weight:800;'
            f'letter-spacing:.06em;text-transform:uppercase;color:{fg};background:{bg};background-color:{bg};'
            f'font-family:{FONT_STACK};white-space:nowrap;">{esc(label)}</span>')


def eyebrow(text: str, color: str = PINK) -> str:
    # v2.3 (23 Oct 2026, Amit): the eyebrow is I.S.A. pink, the same shade as the wordmark; 13px so it reads on plum.
    return (f'<div style="color:{color};font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;'
            f'margin:0 0 8px;font-family:{FONT_STACK};">{esc(text)}</div>')


def table(headers: list[str], rows: list[list]) -> str:
    th = "".join(
        f'<th align="left" style="padding:9px 12px;border-bottom:1px solid {HAIRLINE};font-size:11px;color:{MUTED};'
        f'text-transform:uppercase;letter-spacing:.08em;font-weight:800;font-family:{FONT_STACK};">{esc(h)}</th>'
        for h in headers)
    body = "".join(
        "<tr>" + "".join(
            f'<td style="padding:9px 12px;border-bottom:1px solid {HAIRLINE};font-size:14px;color:{INK};'
            f'font-family:{FONT_STACK};">{esc(c)}</td>' for c in row) + "</tr>"
        for row in rows)
    return (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" {_bg(CARD_DEEP)}'
            f'border-collapse:separate;border-radius:{PANEL_RADIUS}px;overflow:hidden;"><tr>{th}</tr>{body}</table>')


def _pill_row(pills) -> str:
    out = []
    for item in pills:
        label, kind = item if isinstance(item, (tuple, list)) else (item, "muted")
        out.append(pill(label, kind))
    return " ".join(out)


def _prose(prose) -> str:
    paras = prose if isinstance(prose, list) else [prose]
    return "".join(f'<p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:{INK};font-family:{FONT_STACK};">'
                   f'{_segments(p)}</p>' for p in paras if p)


def _kv(pairs) -> str:
    rows = "".join(
        f'<tr><td style="padding:7px 0;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;'
        f'color:{MUTED};font-family:{FONT_STACK};width:44%;vertical-align:top;">{esc(k)}</td>'
        f'<td style="padding:7px 0;font-size:15px;font-weight:700;color:{INK};font-family:{FONT_STACK};">{esc(v)}</td></tr>'
        for k, v in pairs)
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{rows}</table>'


def _more(more: dict) -> str:
    items = "".join(f'<li style="margin:4px 0;font-size:14px;line-height:1.5;color:{INK};font-family:{FONT_STACK};">{esc(i)}</li>'
                    for i in more.get("items", []))
    return (f'<details style="margin-top:10px;"><summary style="cursor:pointer;font-size:13px;font-weight:800;color:{GREEN};'
            f'font-family:{FONT_STACK};list-style:none;">&#9656; {esc(more.get("summary", "Show more"))}</summary>'
            f'<ul style="margin:8px 0 0;padding-left:18px;">{items}</ul></details>')


def _segments(sub) -> str:
    """Subtitle as a string, or a list of strings and (text, kind) pairs; kind "gain" is bold green (celebrate every
    success), "note" is muted. Losses are never red in member mail: say them plainly in the normal colour."""
    if isinstance(sub, str):
        return esc(sub)
    out = []
    for part in sub:
        text, kind = part if isinstance(part, (tuple, list)) else (part, "")
        out.append(f'<span style="color:{GREEN};font-weight:800;">{esc(text)}</span>' if kind == "gain" else esc(text))
    return "".join(out)


def _days(days) -> str:
    """A week strip: one tile per day, green for an up day, plum for a down or flat day (never red), amount beneath."""
    cells = []
    for label, chg in days:
        up = chg is not None and chg > 0
        bgc = GREEN_BG if up else MUTED_BG
        fg = GREEN if up else MUTED
        amt = "" if chg is None else (("+" if chg > 0 else "\u2212" if chg < 0 else "") + f"£{abs(chg):,.2f}")
        cells.append(f'<td align="center" valign="top" style="padding:0 3px;vertical-align:top;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
                     f'<tr><td align="center" {_bg(bgc)}border-radius:10px;padding:8px 2px;font-size:11px;font-weight:800;letter-spacing:.06em;'
                     f'text-transform:uppercase;color:{fg};font-family:{FONT_STACK};">{esc(label)}</td></tr>'
                     f'<tr><td align="center" style="padding-top:6px;font-size:12px;font-weight:700;color:{fg};font-family:{FONT_STACK};">{esc(amt)}</td></tr>'
                     f'</table></td>')
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;"><tr>{"".join(cells)}</tr></table>'


def _spark(sp: dict) -> str:
    """v2.4 (23 Oct 2026, approved by Amit): the pot over time as a row of thin bars built from table cells
    (no images, so it shows in every mail app). Latest bar green, the rest soft plum; start and end labelled beneath."""
    vals = [float(v) for v in sp["values"]]
    lo, hi = min(vals), max(vals); rng = (hi - lo) or 1.0
    cells = []
    for i, v in enumerate(vals):
        h = 10 + round((v - lo) / rng * 50)
        c = GREEN if i == len(vals) - 1 else "#7A3A86"
        cells.append(f'<td valign="bottom" style="padding:0 1px;height:62px;"><div style="height:{h}px;line-height:{h}px;font-size:1px;'
                     f'background:{c};background-color:{c};border-radius:3px 3px 0 0;">&nbsp;</div></td>')
    labels = (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
              f'<td style="padding-top:6px;font-size:12px;color:{MUTED};font-family:{FONT_STACK};">{esc(sp.get("start", ""))}</td>'
              f'<td align="right" style="padding-top:6px;font-size:12px;font-weight:800;color:{GREEN};font-family:{FONT_STACK};">{esc(sp.get("end", ""))}</td></tr></table>')
    return (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed;"><tr>{"".join(cells)}</tr></table>'
            + labels)


def _did(items) -> str:
    """v2.4: "What the robot did" as short ticked lines, so a member sees the work in one glance."""
    rows = "".join(f'<tr><td valign="top" style="width:22px;padding:4px 0;font-size:15px;font-weight:900;color:{GREEN};font-family:{FONT_STACK};">&#10003;</td>'
                   f'<td style="padding:4px 0;font-size:15px;line-height:1.5;color:{INK};font-family:{FONT_STACK};">{_segments(t)}</td></tr>' for t in items)
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{rows}</table>'


def _milestone(m: dict) -> str:
    """v2.4: a milestone card body: big green figure, one warm line, and a pill row of what got them there."""
    big = (f'<div style="font-family:{HEAD_STACK};font-size:44px;line-height:1;letter-spacing:.01em;text-transform:uppercase;'
           f'color:{GREEN};margin:2px 0 10px;">{esc(m["big"])}</div>')
    pills = _pill_row(m["pills"]).replace("letter-spacing:.06em;", f"letter-spacing:.06em;border:1px solid {GREEN};") if m.get("pills") else ""
    return big + _prose(m.get("prose", "")) + pills


def mood_for(change: float | None) -> str:
    """Robot for the headline: arms up on a gain, shield-and-tick on a dip, cup of tea when flat or unknown."""
    if change is None or abs(change) < 0.005:
        return MOODS["quiet"]
    return MOODS["up"] if change > 0 else MOODS["calm"]


def scenario(change: float | None, paused: bool = False, to_approve: int = 0, milestone: str | None = None) -> dict:
    """v2.4: one template, six kinds of day. Picks, in priority order, paused > your turn > milestone > good day > calm dip
    > quiet day, and returns what changes with it: key, robot image, headline tone ("up" = green) and the lead card's job.
    Everything else in the email (holdings, checks, room before the halt, week strip, trend) stays where members expect it."""
    if paused:
        key = "paused"
    elif to_approve:
        key = "yourturn"
    elif milestone:
        key = "milestone"
    elif change is not None and change > 0.005:
        key = "up"
    elif change is not None and change < -0.005:
        key = "calm"
    else:
        key = "quiet"
    lead = {"paused": "why it paused, that your money is safe, and the one thing to do",
            "yourturn": "the orders waiting for you and the deadline",
            "milestone": "the milestone card", "up": "what the robot did today",
            "calm": "a quieter day: the rules held, still ahead since the start", "quiet": "nothing happened, nothing to do"}[key]
    return {"key": key, "robot": MOODS[key], "tone": "up" if key in ("up", "milestone") else None, "lead": lead}


def _block_body(block: dict) -> str:
    return _block_body_inner(block) + (_more(block["more"]) if block.get("more") else "")


def _block_body_inner(block: dict) -> str:
    if "spark" in block:
        return _spark(block["spark"]) + ('<div style="height:12px;line-height:12px;">&nbsp;</div>' + _prose(block["prose"]) if block.get("prose") else "")
    if "did" in block:
        return _did(block["did"])
    if "milestone" in block:
        return _milestone(block["milestone"])
    if "days" in block:
        return _days(block["days"]) + ('<div style="height:14px;line-height:14px;">&nbsp;</div>' + _prose(block["prose"]) if block.get("prose") else "")
    if "table" in block:
        return table(block["table"]["headers"], block["table"]["rows"])
    if "pills" in block:
        return _pill_row(block["pills"])
    if "kv" in block:
        return _kv(block["kv"])
    return _prose(block.get("prose", ""))


def section(heading: str, body_html: str, status: tuple | None = None) -> str:
    st = pill(*status) if status else ""
    head = (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
            f'<td style="font-family:{HEAD_STACK};font-size:20px;font-weight:400;letter-spacing:.02em;'
            f'text-transform:uppercase;color:{INK};line-height:1.15;">{esc(heading)}</td>'
            f'<td align="right" style="vertical-align:top;">{st}</td></tr></table>')
    return f'<tr><td style="padding:20px 24px;">{head}<div style="margin-top:12px;">{body_html}</div></td></tr>'


def panel(inner_rows_html: str, accent: bool = False) -> str:
    rule = f"border-left:4px solid {GREEN};" if accent else ""
    return (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" {_bg(CARD)}'
            f'border-radius:{CARD_RADIUS}px;margin:0 0 14px;{rule}">{inner_rows_html}</table>')


def button(label: str, url: str, primary: bool = True) -> str:
    bg, fg, bd = (GREEN, ON_GREEN, GREEN) if primary else ("transparent", INK, INK)
    return (f'<a href="{esc(url)}" style="display:inline-block;background:{bg};background-color:{bg};color:{fg};'
            f'border:2px solid {bd};font-weight:800;font-size:14px;text-decoration:none;padding:11px 20px;'
            f'border-radius:999px;margin:6px 8px 6px 0;font-family:{FONT_STACK};">{esc(label)}</a>')


def _block_html(block: dict) -> str:
    if "milestone" in block:
        inner = section(block.get("heading", ""), _block_body(block), block.get("status"))
        return (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" {_bg(GREEN_BG)}'
                f'border-radius:{CARD_RADIUS}px;margin:0 0 14px;border:2px solid {GREEN};">{inner}</table>')
    return panel(section(block.get("heading", ""), _block_body(block), block.get("status")), block.get("accent", False))


# ---------------------------------------------------------------- public API
def render(title: str, eyebrow_text: str, subtitle: str, blocks: list[dict],
           cta: tuple[str, str] | None = None, footnote: str | None = None,
           brand: tuple | None = None,
           buttons: list[tuple] | None = None,
           mood: str | None = None,
           internal: bool = True,
           tone: str | None = None) -> str:
    b = tuple(brand) if brand else ((eyebrow_text.strip()[:1] or "R").upper(), eyebrow_text, "")
    tile, word, suffix = b[0], b[1], b[2]
    logo = b[3] if len(b) > 3 else None
    suffix_html = ' <span style="color:%s">%s</span>' % (PINK, esc(suffix)) if suffix else ""
    brand_row = (
        f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;"><tr>'
        + (f'<td width="40" height="40" style="width:40px;height:40px;"><img src="{esc(logo)}" width="40" height="40" alt="" '
           f'style="display:block;width:40px;height:40px;border-radius:11px;border:2px solid {GREEN};"></td>' if logo else
           f'<td width="34" height="34" align="center" {_bg(GREEN)}border-radius:9px;color:{ON_GREEN};font-weight:900;'
           f'font-size:16px;font-family:{FONT_STACK};">{esc(tile)}</td>') +
        f'<td style="padding-left:10px;font-family:{HEAD_STACK};font-size:22px;letter-spacing:.02em;text-transform:uppercase;'
        f'color:{INK};">{esc(word)}{suffix_html}</td>'
        + (f'<td style="padding-left:10px;vertical-align:middle;"><span style="display:inline-block;padding:5px 12px;border-radius:999px;'
           f'background:{GREEN};background-color:{GREEN};color:{ON_GREEN};font-size:12px;font-weight:900;letter-spacing:.14em;'
           f'text-transform:uppercase;font-family:{FONT_STACK};">Internal</span></td>' if internal else "") +
        f'</tr></table>')
    mood_td = (f'<td width="96" align="right" style="width:96px;padding:14px 18px 14px 0;vertical-align:middle;">'
               f'<img src="{esc(mood)}" width="96" height="96" alt="" style="display:block;width:96px;height:96px;"></td>') if mood else ""
    header = panel(
        f'<tr><td style="padding:24px 26px;">{eyebrow(eyebrow_text)}'
        f'<div style="font-family:{HEAD_STACK};font-size:32px;font-weight:400;letter-spacing:.01em;text-transform:uppercase;'
        f'line-height:1.08;color:{GREEN if tone == "up" else INK};margin:0 0 8px;">{esc(title)}</div>'
        f'<div style="font-size:14px;color:{MUTED};font-family:{FONT_STACK};">{_segments(subtitle)}</div></td>{mood_td}</tr>')
    cards = "".join(_block_html(b) for b in blocks)
    btns = (f'<div style="margin:4px 0 6px;">' + "".join(button(*b) for b in buttons) + "</div>") if buttons else ""
    foot = []
    if footnote:
        foot.append(f'<div style="font-size:12px;line-height:1.6;color:{MUTED};margin:0 0 8px;font-family:{FONT_STACK};">{esc(footnote)}</div>')
    if cta:
        label, url = cta
        foot.append(f'<a href="{esc(url)}" style="font-size:13px;font-weight:700;color:{GREEN};font-family:{FONT_STACK};">{esc(label)} &rarr;</a>')
    footer = f'<div style="padding:16px 6px 0;">{"".join(foot)}</div>' if foot else ""
    body = brand_row + header + cards + btns + footer
    return (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<meta name="color-scheme" content="light only">\n'
        '<meta name="supported-color-schemes" content="light only">\n'
        '<style>:root{color-scheme:light only;supported-color-schemes:light only}'
        f'@media (prefers-color-scheme: dark){{body,.mri-page{{background:{PAGE} !important;background-color:{PAGE} !important}}}}'
        '@media only screen and (max-width:480px){.mri-pad{padding:16px 10px !important}}</style>\n'
        f'<title>{esc(title)}</title>\n</head>\n'
        f'<body {_bg(PAGE)}margin:0;padding:0;font-family:{FONT_STACK};">\n'
        f'<table role="presentation" class="mri-page" width="100%" cellpadding="0" cellspacing="0" {_bg(PAGE)}">'
        f'<tr><td align="center" class="mri-pad" style="padding:28px 16px;">\n'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">\n'
        f'<tr><td>{body}</td></tr>\n</table>\n</td></tr></table>\n</body>\n</html>\n')


def subject(project: str, type_: str, detail: str, internal: bool = True) -> str:
    """'(Internal) [Project · Type] detail' — pass internal=False only for mail to members or customers."""
    return f"{'(Internal) ' if internal else ''}[{project} · {type_}] {detail}"


# ---------------------------------------------------------------- demo/CLI
def _demo_member() -> str:
    return render(
        title="+£12.00 today",
        eyebrow_text="Your robot · Thursday 23 October",
        subtitle=["£5,260.00 in your ISA · ", ("up £260.00 since you started", "gain"), " (example figures)"],
        tone="up",
        brand=MRI_BRAND,
        mood=mood_for(12.0),
        internal=False,
        blocks=[
            {"heading": "Does it need you?", "status": ("Nothing to do", "green"), "accent": True,
             "prose": ["Nothing today. Next plan: Sunday at 7pm, to approve by 2pm Monday."]},
            {"heading": "Your week so far", "status": ("3 up days", "green"),
             "days": [("Mon", 8.40), ("Tue", -3.10), ("Wed", 15.75), ("Thu", 12.00), ("Fri", None)],
             "prose": [["This week: ", ("+£33.05", "gain"), ". Small steps, every one by the rules."]]},
            {"heading": "What it's holding", "kv": [("Steady funds (core)", "4 funds"), ("Bolder slice (satellite)", "2 shares"),
                                                    ("Cash not invested", "£124.50")],
             "more": {"summary": "Show what's in each", "items": [
                 "Steady funds: Fund A · world, Fund B · world, Fund D · bonds, Fund E · gold",
                 "Bolder slice: Stock E · storage, Stock F · power", "Names are made up for this example."]}},
            {"heading": "Is anything wrong?", "status": ("All good", "green"),
             "prose": ["All checks passed: broker connected, every order confirmed, 6 safety stops checked."]},
            {"heading": "Room before the halt", "status": ("19.2%", "muted"),
             "prose": ["The robot stops itself if your pot falls below £4,250. You're £1,010 above that."]},
        ],
        buttons=[("Open my app", "https://example.com", True)],
        footnote="Core = the steady funds. Satellite = the small, bolder slice. Software and a course, not financial advice; capital at risk.",
    )


def _demo_owner() -> str:
    return render(
        title="2 things need you",
        eyebrow_text="Stock Boom Hunter · Health",
        subtitle=f"Daily digest · {london()}",
        brand=SBH_BRAND,
        blocks=[
            {"heading": "Needs you", "status": ("2", "amber"), "accent": True,
             "table": {"headers": ["What", "Why", "Do"], "rows": [
                 ["Merge PR #298", "Changes a money setting, so auto-merge held it", "Review on GitHub"],
                 ["Answer a member", "Pressed 'I still need help' at 21:31 BST", "Reply from hello@"]]}},
            {"heading": "Robot, today", "status": ("Fine", "green"),
             "pills": [("P&L sent", "green"), ("4 PRs merged", "green"), ("Crons on time", "green"), ("Minutes 3,512", "amber")]},
        ],
        cta=("Open the hub", "https://github.com/amitbharatpatel7-hue/stock-boom-hunter"),
        footnote="Internal. Only what needs you is above the line; everything else is one row of facts.",
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--demo", action="store_true", help="write sample emails")
    args = ap.parse_args()
    if not args.demo:
        ap.print_help(); return
    Path("lms_email_demo_member.html").write_text(_demo_member())
    Path("lms_email_demo_owner.html").write_text(_demo_owner())
    print("wrote lms_email_demo_member.html, lms_email_demo_owner.html")


if __name__ == "__main__":
    main()
