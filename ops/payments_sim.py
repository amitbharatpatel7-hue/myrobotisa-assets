#!/usr/bin/env python3
"""Payments simulation: real Stripe TEST-mode kit payments, end to end, with nobody typing a card (21 Nov 2026).

Why: Claude cannot type card numbers, and Amit should not have to pay by hand fifty times. This pays the way
Stripe's own CLI does in `stripe trigger checkout.session.completed` (create a Checkout Session, attach the test
token tok_visa, confirm the payment page), so Stripe sends our webhook the same events a real buyer causes.

What it proves, per buyer (emails are paysim+<run>-<n>@example.com, so they are easy to find and remove):
  new     one payment                     -> Stripe shows it paid and not refunded
  double  the same email pays twice       -> the second payment is refunded by OUR function, reason "duplicate"
  refund  one payment, then a full refund -> Stripe shows the refund (the database should end that licence)
The database side (member rows, purchases) is checked afterwards by whoever started the run; this job has no
database access on purpose.

Runs only with a test key (sk_test_ or rk_test_): a live key is refused before anything is sent.
Env: STRIPE_TEST_SECRET_KEY, COUNT (default 60), RUN (a tag for the emails), and for the report GITHUB_TOKEN,
GITHUB_REPOSITORY. Standard library only.   python3 ops/payments_sim.py
"""
import json, os, sys, time, urllib.error, urllib.parse, urllib.request

KEY = os.environ.get("STRIPE_TEST_SECRET_KEY", "").strip().strip("'\"").strip()
COUNT = max(1, min(150, int(os.environ.get("COUNT") or 60)))
RUN = "".join(c for c in (os.environ.get("RUN") or str(int(time.time()))) if c.isalnum())[-10:]
SITE = "https://myrobotisa.com"
LOG_TITLE = "Payments simulation log"


def form(obj, prefix=""):
    out = []
    for k, v in obj.items():
        key = f"{prefix}[{k}]" if prefix else str(k)
        if isinstance(v, dict):
            out += form(v, key)
        elif isinstance(v, (list, tuple)):
            for i, x in enumerate(v):
                out += form(x, f"{key}[{i}]") if isinstance(x, dict) else [(f"{key}[{i}]", str(x))]
        elif v is not None:
            out.append((key, str(v)))
    return out


def stripe(method, path, params=None):
    url = "https://api.stripe.com/v1/" + path
    data = None
    if params and method == "GET":
        url += "?" + urllib.parse.urlencode(form(params))
    elif params:
        data = urllib.parse.urlencode(form(params)).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={"Authorization": "Bearer " + KEY})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", "replace")
            if e.code in (409, 429, 500, 502, 503) and attempt < 3:
                time.sleep(2 + attempt * 3)
                continue
            try:
                msg = json.loads(body).get("error", {}).get("message", body)
            except ValueError:
                msg = body
            raise RuntimeError(f"{method} {path.split('?')[0]}: {e.code} {msg[:300]}")
        except urllib.error.URLError as e:
            if attempt < 3:
                time.sleep(2 + attempt * 3)
                continue
            raise RuntimeError(f"{method} {path}: {e}")


def pay(email, price, amount):
    """One kit payment for this email. Returns (session id, payment intent id)."""
    meta = {"item": "kit", "plan": "founding", "waiver_at": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()), "sim": RUN}
    s = stripe("POST", "checkout/sessions", {
        "mode": "payment", "locale": "en-GB", "allowed_payment_method_types": ["card"],
        "line_items": [{"price": price, "quantity": 1}],
        "customer_creation": "always", "customer_email": email,
        "metadata": meta, "payment_intent_data": {"metadata": meta},
        "success_url": SITE + "/members/?welcome=1", "cancel_url": SITE + "/buy.html?checkout=cancelled"})
    stripe("GET", "payment_pages/" + s["id"])
    pm = stripe("POST", "payment_methods", {"type": "card", "card": {"token": "tok_visa"},
                                            "billing_details": {"email": email, "name": "Sim Buyer"}})
    stripe("POST", f"payment_pages/{s['id']}/confirm", {"payment_method": pm["id"], "expected_amount": amount})
    for _ in range(15):
        got = stripe("GET", "checkout/sessions/" + s["id"])
        if got.get("payment_status") == "paid" and got.get("payment_intent"):
            return s["id"], got["payment_intent"]
        time.sleep(2)
    raise RuntimeError("session " + s["id"] + " never showed as paid")


def refunds(pi):
    return stripe("GET", "refunds", {"payment_intent": pi, "limit": 5}).get("data", [])


def wait_for_refund(pi, seconds=90):
    end = time.time() + seconds
    while time.time() < end:
        r = refunds(pi)
        if r:
            return r
        time.sleep(4)
    return []


def report(text):
    print(text)
    tok, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if not tok or not repo:
        return

    def gh(method, path, body=None):
        req = urllib.request.Request("https://api.github.com/repos/" + repo + path, method=method,
                                     data=json.dumps(body).encode() if body else None,
                                     headers={"Authorization": "Bearer " + tok, "Accept": "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    try:
        found = [i for i in gh("GET", "/issues?state=open&per_page=100") if i.get("title") == LOG_TITLE and "pull_request" not in i]
        num = found[0]["number"] if found else gh("POST", "/issues", {
            "title": LOG_TITLE, "body": "Each run of the Payments simulation workflow adds its result here. Test mode only; no real money."})["number"]
        gh("POST", f"/issues/{num}/comments", {"body": text})
    except Exception as e:   # the report is a convenience; the job's own pass or fail is the result
        print("could not post the report:", e)


def main():
    if not (KEY.startswith("sk_test_") or KEY.startswith("rk_test_")):
        # Say what kind of key it is without showing it: only the part before the second underscore, and the length.
        kind = "_".join(KEY.split("_")[:2]) + "_" if KEY.count("_") >= 2 else ("empty" if not KEY else "not a Stripe key")
        hint = {"pk_test_": "that is the PUBLISHABLE key; the Secret key is the one below it, starting sk_test_",
                "sk_live_": "that is a LIVE key; switch Stripe to the sandbox and copy its Secret key",
                "rk_live_": "that is a LIVE restricted key; use a sandbox key",
                "pk_live_": "that is a live publishable key; use the sandbox Secret key",
                "whsec_": "that is the webhook signing secret, not an API key"}.get(kind, "")
        if KEY.startswith("whsec_"):
            kind, hint = "whsec_", "that is the webhook signing secret, not an API key"
        print(f"STRIPE_TEST_SECRET_KEY must start sk_test_ or rk_test_. Found: {kind} ({len(KEY)} characters). {hint} Nothing was sent.")
        return 2
    prices = stripe("GET", "prices", {"active": "true", "lookup_keys": ["kit_founding"]}).get("data", [])
    if not prices:
        print("No active price with lookup key kit_founding.")
        return 2
    price, amount = prices[0]["id"], prices[0]["unit_amount"]

    kinds = ["new", "double", "refund"]
    rows, fails, started = [], [], time.time()
    for n in range(1, COUNT + 1):
        kind, email = kinds[n % 3], f"paysim+{RUN}-{n}@example.com"
        row = {"n": n, "kind": kind, "email": email}
        try:
            row["session"], row["pi"] = pay(email, price, amount)
            if kind == "double":
                time.sleep(3)   # let the first payment make the member before the second arrives
                row["session2"], row["pi2"] = pay(email, price, amount)
            elif kind == "refund":
                time.sleep(3)
                stripe("POST", "refunds", {"payment_intent": row["pi"], "metadata": {"sim": RUN}})
        except Exception as e:
            row["error"] = str(e)
            fails.append(f"{n} {kind}: {e}")
        rows.append(row)

    # Now look at what Stripe holds for each, after our webhook has had time to act.
    for row in rows:
        if "error" in row:
            continue
        try:
            if row["kind"] == "new":
                if refunds(row["pi"]):
                    fails.append(f"{row['n']} new: a first payment was refunded")
            elif row["kind"] == "double":
                if refunds(row["pi"]):
                    fails.append(f"{row['n']} double: the FIRST payment was refunded")
                r2 = wait_for_refund(row["pi2"])
                if not r2:
                    fails.append(f"{row['n']} double: the second payment was not refunded within 90s")
                elif r2[0].get("reason") != "duplicate" or r2[0].get("amount") != amount:
                    fails.append(f"{row['n']} double: refund looks wrong ({r2[0].get('reason')}, {r2[0].get('amount')})")
            else:
                if not refunds(row["pi"]):
                    fails.append(f"{row['n']} refund: Stripe shows no refund")
        except Exception as e:
            fails.append(f"{row['n']} {row['kind']} check: {e}")

    count = {k: sum(1 for r in rows if r["kind"] == k) for k in kinds}
    payments = sum(2 if r["kind"] == "double" else 1 for r in rows if "error" not in r)
    ok = not fails
    lines = [
        f"**{'PASS' if ok else 'FAIL'}** · run `{RUN}` · {COUNT} buyers, {payments} test payments, {int(time.time() - started)}s",
        "",
        f"- new: {count['new']} · pays twice: {count['double']} · refunded: {count['refund']}",
        f"- emails: `paysim+{RUN}-<n>@example.com`",
        f"- problems: {len(fails)}",
    ] + ["  - " + f[:400] for f in fails[:25]]
    report("\n".join(lines))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
