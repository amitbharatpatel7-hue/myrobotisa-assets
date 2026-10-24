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

v2.5 (23 Oct 2026, approved by Amit) — additive: the same cards as v2.4, plus (v2.5.1) the green tag sits at the right edge and
(v2.5.3, 24 Oct) tag columns are pinned right at 1% width and ticks get an 8px gap, because the iPhone Gmail app enlarges
text and re-shares spare width, which pulled tags in from the edge and butted ticks against their text:
  * render(..., badge="Setup check") replaces the green INTERNAL pill's text (the email type: Health, Setup check, ...);
  * a block can carry `checks` [(status, name, note)] (ok = green tick, bad = amber cross, off = muted dash) and
    `link` (label, url) for one green text link under the card;
  * SBH_BRAND is the Stock Boom Hunter robot (S.B.H. tag) with a one-line STOCK BOOM HUNTER wordmark, and its emails
    use the S.B.H.-tagged mood robots automatically (MOODS_SBH, myrobotisa.com/email/sbh/).
v2.6.1 (24 Oct 2026, approved by Amit: "go ahead with the black theme ... for internal") — internal vs member:
  * every internal=True email (My Robot I.S.A., Last Man Standing, Stock Boom Hunter, the other ops repos) renders in a
    black scheme: near-black page, graphite cards, solid tags, the project's logo top left (MRI avatar, the S.B.H.
    robot, the LMS app icon), an INTERNAL NOTICE tag top right, no wordmark; `badge` (Health, Setup check ...) moves
    into the pink eyebrow; LMS gets L.M.S.-tagged robots (myrobotisa.com/email/lms/); iOS data detectors are off;
  * internal=False (anything a member or player reads) is byte-for-byte the v2.5.3 purple theme, untouched;
  * new blocks: `items` [(tag, kind, title, note, link|None)] numbered rows with the tag pinned right (a tag that
    repeats the card's own tag is dropped), and `tiles` [(label, value, note)] in the website dashboard's tile style;
  * LMS_BRAND / LMS_LOGO added; solid_tag(label, kind) for callers that build their own rows.
v2.6.3 (24 Oct 2026) — the robot is part of the brand: a render with no mood gets the calm robot (up robot when
  tone="up"), tagged for its project; mood=False opts out. Renders that pass a mood are unchanged.
v2.6.2 (24 Oct 2026, Amit chose option C) — Day Trade Lab gets its own logo (the robot with a lab flask, D.T.L. tag,
  DTL_BRAND / DTL_LOGO) and D.T.L.-tagged robots (myrobotisa.com/email/dtl/); detected from the brand or a
  "Day Trade Lab" eyebrow, like the other projects. Member emails unchanged.

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
SBH_BRAND = ("S", "Stock Boom", "Hunter", "https://myrobotisa.com/email/sbh-robot.png")  # v2.5 (23 Oct 2026): the robot mark in the I.S.A. style, S.B.H. tag
# v2.4 (23 Oct 2026, approved by Amit): six robot moods, one per kind of day. "steady"/"flat" stay as aliases so older
# callers keep working; the original robot-steady.png / robot-flat.png images stay on the site for emails already sent.
_E = "https://myrobotisa.com/email/"
MOODS = {"up": _E + "robot-up.png", "milestone": _E + "robot-milestone.png", "calm": _E + "robot-calm.png",
         "quiet": _E + "robot-quiet.png", "yourturn": _E + "robot-yourturn.png", "paused": _E + "robot-paused.png"}
MOODS["steady"], MOODS["flat"] = MOODS["calm"], MOODS["quiet"]
# v2.5 (23 Oct 2026): Stock Boom Hunter emails use the same robots with an S.B.H. tag (myrobotisa.com/email/sbh/);
# render() swaps them in automatically whenever the brand is SBH_BRAND.
MOODS_SBH = {k: v.replace(_E, _E + "sbh/") for k, v in MOODS.items()}

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


# v2.6.1 (Amit, 24 Oct 2026): figures as the website's dashboard tiles (myrobotisa.com/demo): an inset card per figure
# with a small uppercase label, the value in a monospace face, and a muted line under it whose change is coloured.
# Each tile is (label, value, note), where value and note are strings or lists of strings and (text, kind) pairs,
# kind "up" (green) or "down" (red, internal notices only).
TILE_UP, TILE_DOWN = "#00E87A", "#FF6B8A"


def _tile_text(part) -> str:
    parts = part if isinstance(part, list) else [part]
    out = []
    for x in parts:
        if isinstance(x, (tuple, list)):
            c = TILE_UP if x[1] == "up" else TILE_DOWN if x[1] == "down" else INK
            out.append(f'<span style="color:{c};">{esc(x[0])}</span>')
        else:
            out.append(esc(x))
    return "".join(out)


def _tiles(rows) -> str:
    out = []
    for i, r in enumerate(rows):
        label, value, note = r[0], r[1], (r[2] if len(r) > 2 else "")
        out.append(
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" {_bg(CARD_DEEP)}'
            f'border:1px solid {HAIRLINE};border-radius:14px;margin:{0 if i == 0 else 10}px 0 0;"><tr><td style="padding:14px 16px;">'
            f'<div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:{MUTED};font-family:{FONT_STACK};">{esc(label)}</div>'
            f'<div style="margin-top:4px;font-size:22px;font-weight:600;line-height:1.25;color:{INK};font-family:{TILE_MONO};">{_tile_text(value)}</div>'
            + (f'<div style="margin-top:2px;font-size:13px;line-height:1.45;color:{MUTED};font-family:{FONT_STACK};">{_tile_text(note)}</div>' if note else "")
            + '</td></tr></table>')
    return "".join(out)


TILE_MONO = "'IBM Plex Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"


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
    rows = "".join(f'<tr><td valign="top" width="26" style="width:26px;padding:4px 8px 4px 0;font-size:15px;font-weight:900;color:{GREEN};font-family:{FONT_STACK};">&#10003;</td>'
                   f'<td style="padding:4px 0;font-size:15px;line-height:1.5;color:{INK};font-family:{FONT_STACK};">{_segments(t)}</td></tr>' for t in items)
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{rows}</table>'


def _milestone(m: dict) -> str:
    """v2.4: a milestone card body: big green figure, one warm line, and a pill row of what got them there."""
    big = (f'<div style="font-family:{HEAD_STACK};font-size:44px;line-height:1;letter-spacing:.01em;text-transform:uppercase;'
           f'color:{GREEN};margin:2px 0 10px;">{esc(m["big"])}</div>')
    pills = _pill_row(m["pills"]).replace("letter-spacing:.06em;", f"letter-spacing:.06em;border:1px solid {GREEN};") if m.get("pills") else ""
    return big + _prose(m.get("prose", "")) + pills


def _checks(rows) -> str:
    """v2.5 (23 Oct 2026, for the setup check and health emails): one row per check, a mark then the name and a short note.
    status ok = green tick, bad = amber cross (owner mail only; member mail never shows red), off = muted dash."""
    marks = {"ok": ("&#10003;", GREEN), "bad": ("&#10007;", AMBER_FG), "off": ("&ndash;", MUTED)}
    out = []
    for status, name, note in rows:
        m, c = marks.get(status, marks["off"])
        out.append(f'<tr><td valign="top" width="26" style="width:26px;padding:6px 8px 6px 0;font-size:15px;font-weight:900;color:{c};font-family:{FONT_STACK};">{m}</td>'
                   f'<td style="padding:6px 0;font-size:15px;line-height:1.4;color:{INK};font-family:{FONT_STACK};"><b>{esc(name)}</b>'
                   + (f'<br><span style="font-size:13px;color:{MUTED};">{esc(note)}</span>' if note else "") + '</td></tr>')
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{"".join(out)}</table>'


def _link(link) -> str:
    """v2.5: a block can end with one green text link: ("Open the run", url)."""
    label, url = link
    return (f'<div style="margin-top:8px;"><a href="{esc(url)}" style="font-size:14px;font-weight:800;color:{GREEN};'
            f'text-decoration:none;font-family:{FONT_STACK};">{esc(label)} &rarr;</a></div>')


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
    return (_block_body_inner(block) + (_more(block["more"]) if block.get("more") else "")
            + (_link(block["link"]) if block.get("link") else ""))


def _block_body_inner(block: dict) -> str:
    if "spark" in block:
        return _spark(block["spark"]) + ('<div style="height:12px;line-height:12px;">&nbsp;</div>' + _prose(block["prose"]) if block.get("prose") else "")
    if "items" in block:
        st = (block.get("status") or ("",))[0]
        return _items(block["items"], hide=str(st))
    if "checks" in block:
        return _checks(block["checks"]) + ('<div style="height:8px;line-height:8px;">&nbsp;</div>' + _prose(block["prose"]) if block.get("prose") else "")
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
    if "tiles" in block:
        return _tiles(block["tiles"])
    if "kv" in block:
        return _kv(block["kv"])
    return _prose(block.get("prose", ""))


def section(heading: str, body_html: str, status: tuple | None = None) -> str:
    st = pill(*status) if status else ""
    head = (f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
            f'<td style="font-family:{HEAD_STACK};font-size:20px;font-weight:400;letter-spacing:.02em;'
            f'text-transform:uppercase;color:{INK};line-height:1.15;">{esc(heading)}</td>'
            f'<td align="right" width="1%" style="width:1%;vertical-align:top;padding-left:12px;white-space:nowrap;">{st}</td></tr></table>')
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
def _render_core(title: str, eyebrow_text: str, subtitle: str, blocks: list[dict],
           cta: tuple[str, str] | None = None, footnote: str | None = None,
           brand: tuple | None = None,
           buttons: list[tuple] | None = None,
           mood: str | None = None,
           internal: bool = True,
           tone: str | None = None,
           badge: str | None = None) -> str:
    # v2.5: badge overrides the green pill's text (default "Internal"), e.g. "Stock Boom Hunter" on the engine's own emails.
    b = tuple(brand) if brand else ((eyebrow_text.strip()[:1] or "R").upper(), eyebrow_text, "")
    tile, word, suffix = b[0], b[1], b[2]
    if mood and len(b) > 3 and str(b[3]).endswith("sbh-robot.png") and mood.startswith(_E) and "/sbh/" not in mood:
        mood = mood.replace(_E, _E + "sbh/")
    logo = b[3] if len(b) > 3 else None
    suffix_html = ('' if word.endswith('.') else ' ') + '<span style="color:%s">%s</span>' % (PINK, esc(suffix)) if suffix else ""
    stacked = len(word + suffix) > 14   # v2.5.2 (Amit): a long name (Stock Boom Hunter) stays on ONE line, a touch smaller, never wrapping
    if len(b) > 4 and b[4] == "internal":
        # v2.6.1 (Amit, 24 Oct 2026): internal notices carry the project's logo top left and the INTERNAL NOTICE tag top
        # right; no wordmark (the logo, the sender and the eyebrow already say which project it is).
        badge_html = (f'<span style="display:inline-block;padding:5px 10px;border-radius:999px;background:{GREEN};background-color:{GREEN};'
                      f'color:{ON_GREEN};font-size:11px;font-weight:900;letter-spacing:.07em;text-transform:uppercase;font-family:{FONT_STACK};'
                      f'white-space:nowrap;">{esc(badge or "Internal notice")}</span>')
        left = (f'<img src="{esc(logo)}" width="40" height="40" alt="{esc(word)}" style="display:block;width:40px;height:40px;border-radius:11px;border:2px solid {GREEN};">'
                if logo else
                f'<table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="40" height="40" align="center" {_bg(GREEN)}width:40px;height:40px;'
                f'border-radius:11px;color:{ON_GREEN};font-weight:900;font-size:18px;font-family:{FONT_STACK};">{esc(tile or "R")}</td></tr></table>')
        brand_row = (
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;"><tr>'
            f'<td style="vertical-align:middle;">{left}</td>'
            f'<td align="right" style="vertical-align:middle;text-align:right;white-space:nowrap;">{badge_html}</td>'
            f'</tr></table>')
    else:
      brand_row = (
        # v2.5.1 (Amit, 23 Oct 2026): the green tag (Internal / Health / Setup check) sits at the right, lined up with the card's edge.
        f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 16px;"><tr>'
        + (f'<td width="40" height="40" style="width:40px;height:40px;"><img src="{esc(logo)}" width="40" height="40" alt="" '
           f'style="display:block;width:40px;height:40px;border-radius:11px;border:2px solid {GREEN};"></td>' if logo else
           (f'<td width="34" height="34" align="center" {_bg(GREEN)}border-radius:9px;color:{ON_GREEN};font-weight:900;'
           f'font-size:16px;font-family:{FONT_STACK};">{esc(tile)}</td>' if tile else "")) +
        f'<td style="padding-left:{10 if (logo or tile) else 0}px;font-family:{HEAD_STACK};font-size:{18 if stacked else (26 if not (logo or tile) else 22)}px;letter-spacing:{"0" if stacked else ".02em"};text-transform:uppercase;'
        f'color:{INK};{"white-space:nowrap;" if stacked else ""}">{esc(word)}{suffix_html}</td>'
        + (f'<td align="right" width="1%" style="width:1%;padding-left:10px;vertical-align:middle;text-align:right;white-space:nowrap;"><span style="display:inline-block;padding:5px {10 if badge and len(badge) > 10 else 12}px;border-radius:999px;'
           f'background:{GREEN};background-color:{GREEN};color:{ON_GREEN};font-size:{11 if badge and len(badge) > 10 else 12}px;font-weight:900;letter-spacing:{".07em" if badge and len(badge) > 10 else ".14em"};'
           f'text-transform:uppercase;font-family:{FONT_STACK};{"white-space:nowrap;" if badge else ""}">{esc(badge or "Internal")}</span></td>' if (internal or badge) else "") +
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


# v2.6 (24 Oct 2026, Amit): solid tags that read on any dark card, and a numbered "items" block for internal notices.
SOLID_TAGS = {"amber": ("#FFC94D", "#2A1A00"), "red": ("#FF4D7A", "#FFFFFF"), "green": ("#00E87A", "#0A0A0D"), "muted": ("#3A3A44", "#E6E3EC")}


def solid_tag(label: str, kind: str = "amber") -> str:
    bg, fg = SOLID_TAGS.get(kind, SOLID_TAGS["muted"])
    return (f'<span style="display:inline-block;padding:4px 10px;border-radius:999px;font-size:10.5px;font-weight:900;letter-spacing:.08em;'
            f'text-transform:uppercase;color:{fg};background:{bg};background-color:{bg};font-family:{FONT_STACK};white-space:nowrap;">{esc(label)}</span>')


def _items(rows, hide: str = "") -> str:
    """v2.6: numbered rows, each (tag_label, tag_kind, title, note, link_or_None); the tag sits in its own right-hand
    column (1% wide, so every tag lines up on the card's right edge), the link under the note."""
    out = []
    for i, row in enumerate(rows, 1):
        label, kind, title, note = row[0], row[1], row[2], row[3]
        link = row[4] if len(row) > 4 else None
        sep = f"border-top:1px solid {HAIRLINE};" if i > 1 else ""
        a = (f'<div style="margin-top:6px;"><a href="{esc(link[1])}" style="font-size:13.5px;font-weight:800;color:{GREEN};'
             f'text-decoration:none;font-family:{FONT_STACK};">{esc(link[0])} &rarr;</a></div>') if link else ""
        out.append(f'<tr><td valign="top" width="28" style="width:28px;padding:12px 6px 12px 0;{sep}font-family:{HEAD_STACK};font-size:20px;line-height:1.1;color:{MUTED};">{i}</td>'
                   f'<td valign="top" style="padding:12px 0;{sep}font-family:{FONT_STACK};">'
                   f'<div style="font-size:15px;font-weight:700;line-height:1.35;color:{INK};">{esc(title)}</div>'
                   + (f'<div style="margin-top:2px;font-size:13px;line-height:1.45;color:{MUTED};">{esc(note)}</div>' if note else "") + a + '</td>'
                   f'<td valign="top" align="right" width="1%" style="width:1%;padding:12px 0 12px 12px;{sep}white-space:nowrap;">{"" if hide and label.lower() == hide.lower() else solid_tag(label, kind)}</td></tr>')
    return f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{"".join(out)}</table>'


# v2.6 / v2.6.1 (24 Oct 2026, Amit): every internal email (internal=True) for My Robot I.S.A., Last Man Standing,
# Stock Boom Hunter and the other ops repos uses a black scheme so it never looks like a member's email: near-black
# page, graphite cards, solid tags, the project's logo top left and an INTERNAL NOTICE tag top right. The email type the
# caller passed as `badge` (Health, Setup check ...) moves into the pink eyebrow line. Member mail (internal=False)
# is untouched.
LMS_LOGO = "https://myrobotisa.com/email/lms.png"
LMS_BRAND = ("L", "Last Man", "Standing", LMS_LOGO)
DTL_LOGO = "https://myrobotisa.com/email/dtl-robot.png"   # v2.6.2 (Amit, 24 Oct 2026: option C, the lab flask)
DTL_BRAND = ("D", "Day Trade", "Lab", DTL_LOGO)
_INTERNAL = {"PAGE": "#0A0A0D", "CARD": "#17171D", "CARD_DEEP": "#101014", "HAIRLINE": "#2A2A33", "MUTED": "#B9B6C2",
             "ON_GREEN": "#0A0A0D", "MUTED_BG": "#24242C", "GREEN_BG": "#12301F",
             "PILL_COLORS": {"green": ("#0A0A0D", "#00E87A"), "amber": ("#2A1A00", "#FFC94D"), "red": ("#FFFFFF", "#FF4D7A"), "muted": ("#E6E3EC", "#3A3A44")}}


def _project_of(brand, eyebrow_text):
    """'sbh' | 'mri' | 'lms' | 'dtl' | None, from the brand tuple or, failing that, the eyebrow ("Last Man Standing · Autofix")."""
    b = tuple(brand) if brand else ()
    words = (" ".join(str(x) for x in b[1:3]) + " " + (eyebrow_text or "")).lower()
    logo = str(b[3]) if len(b) > 3 and b[3] else ""
    if logo.endswith("sbh-robot.png") or "stock boom" in words:
        return "sbh"
    if logo == MRI_LOGO or "my robot" in words or "i.s.a" in words:
        return "mri"
    if logo == LMS_LOGO or "last man" in words:
        return "lms"
    if logo == DTL_LOGO or "day trade" in words or "day-trade" in words:
        return "dtl"
    return None


def render(title, eyebrow_text, subtitle, blocks, cta=None, footnote=None, brand=None, buttons=None, mood=None,
           internal=True, tone=None, badge=None, scheme=None):
    # v2.6.3 (Amit, 24 Oct 2026: "the robot graphic is part of the brand and should be written into the theme"):
    # every email carries a robot. A caller that names no mood gets the up robot on an up day, otherwise the calm one;
    # the project tag (I.S.A., S.B.H., L.M.S., D.T.L.) is swapped in below as before. mood=False opts out explicitly.
    if mood is None:
        mood = MOODS["up"] if tone == "up" else MOODS["calm"]
    elif mood is False:
        mood = None
    if scheme is None:
        scheme = "internal" if internal else "night"
    if scheme != "internal":
        return _render_core(title, eyebrow_text, subtitle, blocks, cta=cta, footnote=footnote, brand=brand, buttons=buttons,
                            mood=mood, internal=internal, tone=tone, badge=badge)
    proj = _project_of(brand, eyebrow_text)
    base = {"sbh": SBH_BRAND, "mri": MRI_BRAND, "lms": LMS_BRAND, "dtl": DTL_BRAND}.get(proj) or tuple(brand or ((eyebrow_text.strip()[:1] or "R").upper(), eyebrow_text, ""))
    logo = base[3] if len(base) > 3 else None
    if proj == "sbh" and mood and mood.startswith(_E) and "/sbh/" not in mood:
        mood = mood.replace(_E, _E + "sbh/")
    if proj in ("lms", "dtl") and mood and mood.startswith(_E) and f"/{proj}/" not in mood:
        mood = mood.replace(_E + "sbh/", _E).replace(_E, _E + proj + "/")   # the same robots with an L.M.S. / D.T.L. tag
    if badge and badge.lower() not in ("internal", "internal notice") and not eyebrow_text.lower().startswith(badge.lower()):
        eyebrow_text = f"{badge} · {eyebrow_text}"
    if not logo and proj is None and brand and brand[1] and str(brand[1]).lower() not in eyebrow_text.lower():
        eyebrow_text = f"{brand[1]} · {eyebrow_text}"   # a project without a logo is named in the eyebrow instead
    ibrand = (base[0], base[1], base[2] if len(base) > 2 else "", logo, "internal")
    g = globals(); saved = {k: g[k] for k in _INTERNAL}
    try:
        g.update(_INTERNAL)
        html = _render_core(title, eyebrow_text, subtitle, blocks, cta=cta, footnote=footnote, brand=ibrand, buttons=buttons,
                            mood=mood, internal=True, tone=tone, badge="Internal notice")
    finally:
        g.update(saved)
    # v2.6.1: stop iOS Mail turning times, amounts and domains into blue underlined links.
    html = html.replace('<meta name="supported-color-schemes" content="light only">\n',
                        '<meta name="supported-color-schemes" content="light only">\n'
                        '<meta name="format-detection" content="telephone=no,date=no,address=no,email=no,url=no">\n', 1)
    html = html.replace("<style>", "<style>a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important;"
                        "font-size:inherit !important;font-family:inherit !important;font-weight:inherit !important;line-height:inherit !important}", 1)
    return html


def subject(project: str, type_: str, detail: str, internal: bool = True) -> str:
    """'(Internal) [Project · Type] detail' — pass internal=False only for mail to members or customers."""
    return f"{'(Internal) ' if internal else ''}[{project} · {type_}] {detail}"


# ---------------------------------------------------------------- demo/CLI
def _demo_member() -> str:
    return render(
        title="+£12.00 today",
        eyebrow_text="Your robot · Thursday 22 October",
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
