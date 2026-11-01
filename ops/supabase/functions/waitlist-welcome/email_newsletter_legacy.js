// The newsletter-only welcome as live in v29 (before 1 Nov 2026), kept until Amit approves the new one in the house
// layout (build_welcome_email.newsletter_only). Only used for rows with launch_list = false. Delete once he says send.
const SITE = "https://myrobotisa.com";
const GREEN = "#00E87A", PINK = "#EA00AB", DEEP = "#34003B", CARD = "#4B1155", INK = "#FFFFFF", MUTED = "#D9C6DE";
const BODY = "Poppins,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const HEAD = "Impact,'Anton','Arial Narrow Bold',sans-serif";
const bg = (c) => `bgcolor="${c}" style="background:${c};background-color:${c};`;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function link(path, src) {
  const [base, hash] = path.split("#");
  return SITE + base + (base.includes("?") ? "&" : "?") + "src=" + src + (hash ? "#" + hash : "");
}

function shell(preheader, inner, unsubUrl) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">
<style>:root{color-scheme:light only;supported-color-schemes:light only}</style>
<title>My Robot I.S.A.</title></head>
<body ${bg(DEEP)}margin:0;padding:0;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ${bg(DEEP)}">
<tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;font-family:${BODY};color:${INK};">
<tr><td style="padding:0 0 16px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td width="40" height="40" style="width:40px;height:40px;"><img src="https://myrobotisa.com/avatar.png" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border-radius:11px;border:2px solid ${GREEN};"></td>
<td style="padding-left:10px;font-family:${HEAD};font-size:22px;letter-spacing:.02em;text-transform:uppercase;color:${INK};">My Robot <span style="color:${PINK}">I.S.A.</span></td>
</tr></table></td></tr>
${inner}
<tr><td style="padding:18px 4px 0;font-size:14px;line-height:1.6;color:${INK};">
<b>Watch it work:</b> <a href="https://www.youtube.com/@myrobotisa" style="color:${GREEN};font-weight:800;">YouTube</a> &middot; <a href="https://www.instagram.com/myrobotisa/" style="color:${GREEN};font-weight:800;">Instagram</a> &middot; <a href="https://www.tiktok.com/@myrobotisa" style="color:${GREEN};font-weight:800;">TikTok</a><br>
<span style="font-size:13px;color:${MUTED};">News goes on the socials first, then in the newsletter.</span>
</td></tr>
<tr><td style="padding:22px 4px 0;font-size:12px;line-height:1.6;color:${MUTED};">
You're getting this because you signed up at myrobotisa.com. Not you, or changed your mind? <a href="${esc(unsubUrl)}" style="color:${MUTED};text-decoration:underline;">Unsubscribe</a>.<br>
Not financial advice. Investing puts your capital at risk.<br>
My Robot I.S.A. &middot; <a href="mailto:hello@myrobotisa.com" style="color:${MUTED};">hello@myrobotisa.com</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

function step(when, text) {
  return `<tr><td style="padding:0 0 14px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
<td valign="top" style="width:92px;padding:2px 10px 0 0;font-size:13px;font-weight:800;color:${GREEN};">${when}</td>
<td valign="top" style="font-size:15px;line-height:1.55;color:${INK};">${text}</td>
</tr></table></td></tr>`;
}

const H1 = `margin:0 0 12px;font-family:${HEAD};font-size:32px;line-height:1.08;font-weight:400;text-transform:uppercase;letter-spacing:.01em;color:${INK};`;
const BTN = `display:inline-block;background:${GREEN};background-color:${GREEN};color:${DEEP};font-weight:800;font-size:15px;text-decoration:none;padding:12px 22px;border-radius:999px;`;

export function buildWelcomeLegacy(row, unsubUrl) {
  const src = "email-welcome";
  if (!row.launch_list) {
    // Newsletter-only sign-up
    const subject = "You're in: the My Robot I.S.A. newsletter";
    const inner = `
<tr><td ${bg(CARD)}border-radius:18px;padding:26px 24px;">
<h1 style="${H1}">You're on the newsletter.</h1>
<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${INK};">Every fortnight: what the robot did, what it learned, and what's new. No tips, no signals, no hard sell.</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${INK};">While you wait for the first one, have a look around the dashboard demo.</p>
<a href="${link("/demo/", src)}" style="${BTN}">Open the demo</a>
<p style="margin:22px 0 0;font-size:15px;line-height:1.6;color:${INK};">Questions? Just reply to this email.</p>
</td></tr>`;
    const text = `You're on the newsletter.\n\nEvery fortnight: what the robot did, what it learned, and what's new. No tips, no signals, no hard sell.\n\nOpen the demo: ${link("/demo/", src)}\n\nQuestions? Just reply to this email.\n\nWatch it work: YouTube https://www.youtube.com/@myrobotisa · Instagram https://www.instagram.com/myrobotisa/ · TikTok https://www.tiktok.com/@myrobotisa\n\n--\nUnsubscribe: ${unsubUrl}\nNot financial advice. Investing puts your capital at risk.\nMy Robot I.S.A. · hello@myrobotisa.com`;
    return { subject, html: shell("Every fortnight: what the robot did and what it learned.", inner, unsubUrl), text };
  }

  const subject = "You're on the list: your test drive starts 7 December";
  const nl = row.newsletter ? "" : `
<tr><td style="padding:16px 0 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${PINK};border-radius:16px;"><tr><td style="padding:16px 18px;font-size:14px;line-height:1.55;color:${INK};">
<b>Want the fortnightly newsletter too?</b> What the robot did, what it learned, and what's new. <a href="${link("/#news", src)}" style="color:${GREEN};font-weight:800;">Sign up here</a>.
</td></tr></table></td></tr>`;
  const inner = `
<tr><td ${bg(CARD)}border-radius:18px;padding:26px 24px;">
<h1 style="${H1}">You're on the list.</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:${INK};">Thanks for joining. Here's what happens next.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${step("Mon 7 December", "<b>Your free 7-day test drive starts.</b> A private dashboard on &pound;10,000 of pretend money, replaying seven real past market weeks, one a day. Nothing to install, nothing to pay. We'll email you that morning with one link to start.")}
${step("January 2027", "<b>Sales open.</b> &pound;99 for the first 100 founding members, then &pound;199. You'll hear first.")}
${step("April 2027", `<b>Tax on savings goes up.</b> Interest outside an ISA, above your savings allowance, will be taxed at 24% at the basic rate. Inside an ISA it stays tax-free, and you can still put in &pound;20,000 a year. <a href="${link("/#rules", src)}" style="color:${GREEN};font-weight:700;">What changes</a>`)}
</table>
<p style="margin:6px 0 20px;font-size:15px;line-height:1.6;color:${INK};">Can't wait until 7 December? The dashboard demo shows what you'll get.</p>
<a href="${link("/demo/", src)}" style="${BTN}">Open the demo</a>
<p style="margin:22px 0 0;font-size:15px;line-height:1.6;color:${INK};">Questions? Just reply to this email.</p>
</td></tr>${nl}`;
  const text = `You're on the list.\n\nThanks for joining. Here's what happens next.\n\n` +
    `MONDAY 7 DECEMBER: Your free 7-day test drive starts. A private dashboard on £10,000 of pretend money, replaying seven real past market weeks, one a day. Nothing to install, nothing to pay. We'll email you that morning with one link to start.\n\n` +
    `JANUARY 2027: Sales open. £99 for the first 100 founding members, then £199. You'll hear first.\n\n` +
    `APRIL 2027: Tax on savings goes up. Interest outside an ISA, above your savings allowance, will be taxed at 24% at the basic rate. Inside an ISA it stays tax-free, and you can still put in £20,000 a year. What changes: ${link("/#rules", src)}\n\n` +
    `Can't wait until 7 December? Open the demo: ${link("/demo/", src)}\n\n` +
    (row.newsletter ? "" : `Want the fortnightly newsletter too? Sign up here: ${link("/#news", src)}\n\n`) +
    `Questions? Just reply to this email.\n\nWatch it work: YouTube https://www.youtube.com/@myrobotisa · Instagram https://www.instagram.com/myrobotisa/ · TikTok https://www.tiktok.com/@myrobotisa\n\n--\nUnsubscribe: ${unsubUrl}\nNot financial advice. Investing puts your capital at risk.\nMy Robot I.S.A. · hello@myrobotisa.com`;
  return { subject, html: shell("Your test drive starts Monday 7 December. Here's what happens next.", inner, unsubUrl), text };
}
