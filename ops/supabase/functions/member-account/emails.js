// The account emails (29 Oct 2026, D28), in email theme v2 "Night" (stock-boom-hunter CLAUDE.md, Email house style):
// brand tile + wordmark, plum card, condensed uppercase heading, I.S.A.-pink eyebrow, dark-mode safe ("light only"
// twice plus bgcolor on every coloured block). Member mail: no INTERNAL badge, subject without the (Internal) prefix.
const GREEN = "#00E87A", PAGE = "#34003B", CARD = "#4B1155", INSET = "#3E0A47", INK = "#FFFFFF", MUTED = "#D9C6DE", PINK = "#EA00AB";
const BODY = "Poppins,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const HEAD = "Impact,'Anton','Arial Narrow Bold',sans-serif";
const bg = (c) => `bgcolor="${c}" style="background:${c};background-color:${c};`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const P = (t, muted) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${muted ? MUTED : INK};">${t}</p>`;
const subject = (detail) => `[My Robot I.S.A. · Account] ${detail}`;
const london = (iso) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });

function shell({ pre, title, inner, footer }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only">
<style>:root{color-scheme:light only;supported-color-schemes:light only}</style><title>${esc(title)}</title></head>
<body ${bg(PAGE)}margin:0;padding:0;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(pre)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ${bg(PAGE)}"><tr><td align="center" style="padding:28px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;font-family:${BODY};color:${INK};">
<tr><td style="padding:0 0 16px;"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td width="40" height="40" style="width:40px;height:40px;"><img src="https://myrobotisa.com/avatar.png" width="40" height="40" alt="" style="display:block;width:40px;height:40px;border-radius:11px;border:2px solid ${GREEN};"></td>
<td style="padding-left:10px;font-family:${HEAD};font-size:22px;letter-spacing:.02em;text-transform:uppercase;color:${INK};">My Robot <span style="color:${PINK}">I.S.A.</span></td>
</tr></table></td></tr>
<tr><td ${bg(CARD)}border-radius:18px;padding:24px 26px;">
<div style="font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${PINK};margin:0 0 8px;">Your account</div>
<h1 style="margin:0 0 12px;font-family:${HEAD};font-size:30px;line-height:1.1;font-weight:400;text-transform:uppercase;letter-spacing:.01em;color:${INK};">${esc(title)}</h1>
${inner}
</td></tr>
<tr><td style="padding:18px 6px 0;font-size:12px;line-height:1.6;color:${MUTED};">${footer || "Questions? Reply to this email."} · <a href="https://myrobotisa.com/members/" style="color:${GREEN};">myrobotisa.com/members</a><br>Not financial advice. Investing puts your capital at risk.</td></tr>
</table></td></tr></table></body></html>`;
}
const codeBox = (code) => { const c = String(code); const s = c.slice(0, 3) + " " + c.slice(3);
  return { s, html: `<div style="font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:36px;font-weight:800;letter-spacing:.18em;color:${GREEN};padding:14px 18px;border:2px solid ${GREEN};border-radius:14px;display:inline-block;margin:0 0 16px;">${s}</div>` }; };
const button = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 16px;"><tr><td ${bg(GREEN)}border-radius:999px;"><a href="${esc(href)}" style="display:inline-block;padding:13px 24px;font-family:${BODY};font-size:15px;font-weight:800;color:#14002A;text-decoration:none;">${esc(label)}</a></td></tr></table>`;
const inset = (rows) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" ${bg(INSET)}border-radius:14px;margin:0 0 16px;"><tr><td style="padding:14px 16px;font-size:14px;line-height:1.6;color:${INK};">${rows}</td></tr></table>`;

export function emailCode(code) {
  const c = codeBox(code);
  return { subject: subject(`${c.s} confirms your new email`),
    html: shell({ pre: "Type it into the members area to finish the change.", title: "Confirm your new email",
      inner: P("You asked to sign in to My Robot I.S.A. with this address. Type this code into the members area to finish:") + c.html +
        P("It works once and lasts an hour. Didn't ask for this? Ignore it: nothing changes without the code.", true) }),
    text: `Confirm your new email: ${c.s}\n\nType it into the members area to finish. It works once and lasts an hour.\nDidn't ask for this? Ignore it: nothing changes without the code.\n\nmyrobotisa.com/members` };
}

export function emailChanged(old, to) {
  return { subject: subject("Your sign-in email has changed"),
    html: shell({ pre: "From now on you sign in with " + to + ".", title: "Your sign-in email has changed",
      inner: P(`You now sign in to My Robot I.S.A. with <b>${esc(to)}</b> instead of ${esc(old)}. Your lessons, ticks, passkeys and membership all moved with it.`) +
        P("<b>Was this you?</b> Then there's nothing to do. Your robot's own emails are separate: the members area showed you how to move those too.") +
        P(`<b>Not you?</b> Reply to this email straight away and we'll lock the account and put it back.`, true) }),
    text: `Your sign-in email has changed.\n\nYou now sign in with ${to} instead of ${old}. Everything moved with it.\nNot you? Reply to this email straight away and we'll lock the account and put it back.\n\nmyrobotisa.com/members` };
}

export function deleteCode(code) {
  const c = codeBox(code);
  return { subject: subject(`${c.s} is your code to delete your account`),
    html: shell({ pre: "Only needed if you asked to delete your account.", title: "Your code to delete your account",
      inner: P("You asked to delete your My Robot I.S.A. account. Type this code into the members area to confirm:") + c.html +
        P("Nothing is deleted straight away: you get 7 days to change your mind. Didn't ask for this? Ignore it and sign in to check your account.", true) }),
    text: `Your code to delete your account: ${c.s}\n\nType it into the members area to confirm. Nothing is deleted straight away: you get 7 days to change your mind.\nDidn't ask for this? Ignore it.\n\nmyrobotisa.com/members` };
}

export function deleteScheduled(dueIso, cancelUrl) {
  const on = london(dueIso);
  return { subject: subject(`Your account will be deleted on ${on}`),
    html: shell({ pre: "Changed your mind? One tap keeps it.", title: "Your account will be deleted",
      inner: P(`We'll delete your members account on <b>${esc(on)}</b>. Until then everything works as normal.`) +
        button(cancelUrl, "Keep my account") +
        inset(`<b>What goes:</b> your sign-in, name, passkeys, lesson ticks, Messages, Robot Care requests and your place in the members' space on GitHub.<br><b>What stays:</b> ideas and replies you posted to the Moonshotters stay up, shown as "Former member". If you bought from us, a basic sales record stays for six years because the law asks us to.`) +
        P("<b>Your robot is yours.</b> Your copy of the code lives in your own GitHub and keeps running. To stop it, open your copy on GitHub, then Settings, and at the very bottom Delete this repository. Or keep it: it carries on without us.") +
        P("Want a copy of your data first? Sign in and press Download my data in Help and membership.", true) }),
    text: `Your account will be deleted on ${on}.\n\nChanged your mind? Keep it: ${cancelUrl}\n\nWhat goes: your sign-in, name, passkeys, lesson ticks, Messages, Robot Care requests and your place in the members' space on GitHub.\nWhat stays: your Moonshotters ideas and replies, shown as "Former member"; a basic sales record for six years if you bought from us.\n\nYour robot is yours: your copy lives in your own GitHub and keeps running. To stop it, open it on GitHub, Settings, then Delete this repository at the bottom.\n\nmyrobotisa.com/members` };
}

export function kept() {
  return { subject: subject("Your account is staying"),
    html: shell({ pre: "Nothing will be deleted.", title: "Your account is staying",
      inner: P("You cancelled the deletion, so nothing will be deleted. Everything carries on exactly as before.") +
        P("If you ever want to leave, it's in Help and membership, under Delete my account.", true) }),
    text: "Your account is staying. You cancelled the deletion, so nothing will be deleted.\n\nmyrobotisa.com/members" };
}

export function deleted(keptSales) {
  return { subject: subject("Your account has been deleted"),
    html: shell({ pre: "Thanks for being part of it.", title: "Your account has been deleted",
      inner: P("As you asked, your members account is gone: your sign-in, name, passkeys, lesson ticks, Messages and Robot Care requests.") +
        P("Your Moonshotters ideas and replies stay up as \"Former member\"." + (keptSales ? " A basic sales record stays for six years, because the law asks us to keep it." : "")) +
        P("Your copy of the robot is still in your own GitHub, and it's still yours. Thanks for being part of it: you're welcome back any time.", true),
      footer: "Questions? Reply to this email" }),
    text: `Your account has been deleted.\n\nYour Moonshotters ideas and replies stay up as "Former member".${keptSales ? " A basic sales record stays for six years, because the law asks us to keep it." : ""}\nYour copy of the robot is still in your own GitHub, and it's still yours.\n\nQuestions? Reply to this email.` };
}
