"""Last Man Standing house style — the shared email theme for every project.

Single source of truth for the HTML all of the automated emails use:
Points Per Pound, Clipped Daily, Last Man Standing and the ops tasks.
It lives in this repo because ppp-assets is the only PUBLIC repo in the
estate — a scheduled task fetches with no credentials, so a raw URL in
any of the private code repos returns 404 and the module never loads.

The theme is brand-neutral: `eyebrow_text` is what names the project
("POINTS PER POUND", "CLIPPED DAILY", ...), so one palette carries all
of them and they read as one system.
No third-party dependencies and no network, so the script or scheduled task
sending an email can fetch this file raw and import it directly.

Modelled on send_email.py in stock-boom-hunter: same theme tokens and the
same small helper vocabulary (esc, pill, eyebrow, section, panel, table) —
but this module knows nothing about signals or trading, only presentation.

Public surface:

    render(title, eyebrow_text, subtitle, blocks, cta=None, footnote=None)
    subject(project, type_, detail)
    london(ts=None)

`blocks` is a list of dicts, each rendered as one white card: a heading,
an optional status pill, and one of `prose` (a string or list of strings),
`table` (`{"headers": [...], "rows": [[...]]}`), or `pills` (a list of
strings or (label, kind) pairs). `kind` for a pill is one of
green/amber/red/muted.

    python3 ops/lms_email.py --demo   # writes a sample digest to a file
"""
from __future__ import annotations

import argparse
import html
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

LONDON = ZoneInfo("Europe/London")

# ---------------------------------------------------------------- theme
# Exactly the tokens in stock-boom-hunter/send_email.py, so every project's
# mail reads as one system.
PAGE = "#F4F2F6"
CARD = "#FFFFFF"
CHROME = "#34003B"
GREEN = "#00E87A"
INK = "#1C0A21"
MUTED = "#7A6B80"
HAIRLINE = "#E9E4ED"
CHROME_SUBTITLE = "#CDBBD6"
AMBER_FG, AMBER_BG = "#7A4E00", "#FFE9B0"
RED_FG, RED_BG = "#C8214F", "#FBE3EA"

CARD_RADIUS = 18
PANEL_RADIUS = 14

FONT_STACK = ("-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, "
              "Helvetica, Arial, sans-serif")

PILL_COLORS = {
    "green": (INK, GREEN),
    "amber": (AMBER_FG, AMBER_BG),
    "red": (RED_FG, RED_BG),
    "muted": (MUTED, HAIRLINE),
}


# ---------------------------------------------------------------- helpers
def london(ts: datetime | None = None) -> str:
    """Render a UTC instant as London local time, zone spelled out, e.g.
    "15 Sep 2026, 14:10 BST". `ts` defaults to now; naive datetimes are
    treated as UTC."""
    if ts is None:
        ts = datetime.now(timezone.utc)
    elif ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts.astimezone(LONDON).strftime("%d %b %Y, %H:%M %Z")


def esc(value) -> str:
    return html.escape(str(value), quote=True)


def pill(label: str, kind: str = "muted") -> str:
    fg, bg = PILL_COLORS.get(kind, PILL_COLORS["muted"])
    return (f'<span style="display:inline-block;padding:3px 10px;'
            f'border-radius:999px;font-size:12px;font-weight:600;'
            f'color:{fg};background:{bg};">{esc(label)}</span>')


def eyebrow(text: str) -> str:
    return (f'<div style="color:{GREEN};font-size:12px;font-weight:700;'
            f'letter-spacing:0.08em;text-transform:uppercase;margin:0 0 8px;">'
            f'{esc(text)}</div>')


def table(headers: list[str], rows: list[list]) -> str:
    th = "".join(
        f'<th align="left" style="padding:8px 12px;'
        f'border-bottom:1px solid {HAIRLINE};font-size:12px;color:{MUTED};'
        f'text-transform:uppercase;letter-spacing:.04em;">{esc(h)}</th>'
        for h in headers)
    body_rows = []
    for row in rows:
        tds = "".join(
            f'<td style="padding:8px 12px;border-bottom:1px solid {HAIRLINE};'
            f'font-size:14px;color:{INK};">{esc(cell)}</td>' for cell in row)
        body_rows.append(f"<tr>{tds}</tr>")
    return (f'<table role="presentation" width="100%" cellpadding="0" '
            f'cellspacing="0" style="border-collapse:collapse;">'
            f'<tr>{th}</tr>{"".join(body_rows)}</table>')


def _pill_row(pills) -> str:
    spans = []
    for item in pills:
        if isinstance(item, (tuple, list)):
            label, kind = item
        else:
            label, kind = item, "muted"
        spans.append(pill(label, kind))
    return " ".join(spans)


def _prose(prose) -> str:
    paragraphs = prose if isinstance(prose, list) else [prose]
    return "".join(
        f'<div style="font-size:14px;color:{INK};line-height:1.5;'
        f'margin:0 0 6px;">{esc(p)}</div>' for p in paragraphs if p)


def _block_body(block: dict) -> str:
    if "table" in block:
        t = block["table"]
        return table(t["headers"], t["rows"])
    if "pills" in block:
        return _pill_row(block["pills"])
    return _prose(block.get("prose", ""))


def section(heading: str, body_html: str, status: tuple | None = None) -> str:
    status_html = pill(*status) if status else ""
    head = (
        f'<table role="presentation" width="100%" cellpadding="0" '
        f'cellspacing="0"><tr>'
        f'<td style="font-size:15px;font-weight:700;color:{INK};">'
        f'{esc(heading)}</td>'
        f'<td align="right">{status_html}</td>'
        f'</tr></table>')
    return (f'<tr><td style="padding:20px 24px;">{head}'
            f'<div style="margin-top:10px;">{body_html}</div></td></tr>')


def panel(inner_rows_html: str) -> str:
    return (f'<table role="presentation" width="100%" cellpadding="0" '
            f'cellspacing="0" style="background:{CARD};'
            f'border-radius:{PANEL_RADIUS}px;border:1px solid {HAIRLINE};'
            f'margin:0 0 16px;">{inner_rows_html}</table>')


def _block_html(block: dict) -> str:
    row = section(block.get("heading", ""), _block_body(block),
                   block.get("status"))
    return panel(row)


# ---------------------------------------------------------------- public API
def render(title: str, eyebrow_text: str, subtitle: str, blocks: list[dict],
           cta: tuple[str, str] | None = None,
           footnote: str | None = None) -> str:
    header = (
        f'<table role="presentation" width="100%" cellpadding="0" '
        f'cellspacing="0" bgcolor="{CHROME}" style="background:{CHROME};'
        f'background-color:{CHROME};'
        f'border-radius:{CARD_RADIUS}px;margin:0 0 20px;">'
        f'<tr><td style="padding:28px 28px 24px;">'
        f'{eyebrow(eyebrow_text)}'
        f'<div style="font-size:26px;font-weight:800;color:#FFFFFF;'
        f'margin:0 0 6px;">{esc(title)}</div>'
        f'<div style="font-size:14px;color:{CHROME_SUBTITLE};">'
        f'{esc(subtitle)}</div>'
        f'</td></tr></table>')

    cards = "".join(_block_html(b) for b in blocks)

    footer_bits = []
    if footnote:
        footer_bits.append(
            f'<div style="font-size:13px;color:{MUTED};margin:0 0 10px;">'
            f'{esc(footnote)}</div>')
    if cta:
        label, url = cta
        footer_bits.append(
            f'<a href="{esc(url)}" style="display:inline-block;'
            f'font-size:13px;font-weight:600;color:{CHROME};'
            f'text-decoration:underline;">{esc(label)}</a>')
    footer = (
        f'<table role="presentation" width="100%" cellpadding="0" '
        f'cellspacing="0" bgcolor="{PAGE}" style="background:{PAGE};'
        f'background-color:{PAGE};'
        f'border-radius:{PANEL_RADIUS}px;margin:16px 0 0;">'
        f'<tr><td style="padding:18px 24px;">{"".join(footer_bits)}'
        f'</td></tr></table>') if footer_bits else ""

    body = header + cards + footer

    return (
        '<!doctype html>\n'
        '<html>\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<meta name="color-scheme" content="light only">\n'
        '<meta name="supported-color-schemes" content="light only">\n'
        '<style>:root{color-scheme:light only}</style>\n'
        f'<title>{esc(title)}</title>\n'
        '</head>\n'
        f'<body bgcolor="{PAGE}" style="margin:0;padding:24px;background:{PAGE};'
        f'font-family:{FONT_STACK};">\n'
        '<table role="presentation" width="100%" cellpadding="0" '
        'cellspacing="0" style="max-width:600px;margin:0 auto;">\n'
        f'<tr><td>{body}</td></tr>\n'
        '</table>\n'
        '</body>\n</html>\n')


def subject(project: str, type_: str, detail: str) -> str:
    return f"[{project} · {type_}] {detail}"


# ---------------------------------------------------------------- demo/CLI
def _demo() -> str:
    blocks = [
        {
            "heading": "Drafts waiting for approval",
            "status": ("4 pending", "amber"),
            "table": {
                "headers": ["Episode", "Scheduled", "Status"],
                "rows": [
                    ["GW3 — xG overperformers", "Tue 09:00", "Draft"],
                    ["GW3 — captaincy picks", "Tue 09:00", "Draft"],
                    ["GW4 preview", "Thu 09:00", "Draft"],
                    ["Transfer trap of the week", "Thu 09:00", "Draft"],
                ],
            },
        },
        {
            "heading": "Email types in use",
            "pills": [("Content", "green"), ("Autofix", "amber"),
                      ("Health", "muted"), ("Setup", "muted"),
                      ("Merges", "red")],
        },
    ]
    return render(
        title="4 drafts waiting for a look",
        eyebrow_text="Content",
        subtitle="Tuesday/Thursday publish digest",
        blocks=blocks,
        cta=("Open on GitHub",
             "https://github.com/amitbharatpatel7-hue/points-per-pound/pulls"),
        footnote="Approve or edit each draft before the next render window.",
    )


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--demo", action="store_true",
                     help="write a sample digest to a file")
    ap.add_argument("--out", default="lms_email_demo.html",
                     help="output path for --demo (default: %(default)s)")
    args = ap.parse_args()
    if not args.demo:
        ap.print_help()
        return
    Path(args.out).write_text(_demo())
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
