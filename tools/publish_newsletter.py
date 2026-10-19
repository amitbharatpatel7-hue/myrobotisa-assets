"""Publish newsletter issues on the website a week after subscribers get them.

An approved issue's web page is queued as  queue/newsletter/<YYYY-MM-DD>__<slug>.html,  where the date is
the day it may appear on the site (send date + 7). Every Thursday the publish-newsletter workflow runs this:
each queued page whose date has come moves to docs/newsletter/<slug>.html and gets a row at the top of
docs/newsletter/index.json, which the site's newsletter page lists. The page carries its own title,
<meta name="description"> (the summary) and <meta name="newsletter-sent" content="YYYY-MM-DD">.
Run locally:  python tools/publish_newsletter.py [--today YYYY-MM-DD] [--root DIR]
"""
import argparse, datetime, glob, html, json, os, re, shutil, sys


def meta(page, name):
    m = re.search(r'<meta\s+name="%s"\s+content="([^"]*)"' % re.escape(name), page)
    return html.unescape(m.group(1)) if m else ""


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--today", default=datetime.date.today().isoformat())
    ap.add_argument("--root", default=".")
    a = ap.parse_args(argv)
    q = os.path.join(a.root, "queue", "newsletter")
    out = os.path.join(a.root, "docs", "newsletter")
    os.makedirs(out, exist_ok=True)
    idx_path = os.path.join(out, "index.json")
    idx = json.load(open(idx_path)) if os.path.exists(idx_path) else {"issues": []}
    published = []
    for src in sorted(glob.glob(os.path.join(q, "*__*.html"))):
        day, slug = os.path.basename(src)[:-5].split("__", 1)
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) or day > a.today:
            continue
        page = open(src, encoding="utf-8").read()
        m = re.search(r"<title>(.*?)</title>", page, re.S)
        title = html.unescape(m.group(1).split(" · ")[0].strip()) if m else slug
        entry = {"title": title, "sent": meta(page, "newsletter-sent") or day, "url": f"newsletter/{slug}.html",
                 "summary": meta(page, "description")}
        shutil.move(src, os.path.join(out, slug + ".html"))
        idx["issues"] = [i for i in idx["issues"] if i.get("url") != entry["url"]]
        idx["issues"].insert(0, entry)
        published.append(slug)
    idx["issues"].sort(key=lambda i: i.get("sent", ""), reverse=True)
    json.dump(idx, open(idx_path, "w"), indent=2, ensure_ascii=False)
    open(idx_path, "a").write("\n")
    print("published:", ", ".join(published) if published else "nothing due")
    return published


if __name__ == "__main__":
    sys.exit(0 if main() is not None else 1)
