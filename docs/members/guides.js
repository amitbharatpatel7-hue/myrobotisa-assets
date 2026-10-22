// Step-by-step guides for the members area (22 Oct 2026). One entry per QuickStart step and per lesson.
// Each step: t (title), d (what to do, plain English), img (screenshot under guide/, optional), stuck (what to do if it doesn't look like that, optional).
// Screenshots: schematic for now, swapped for exact screen captures one by one without touching this file's shape.
window.GUIDES = {
  "qs-1": { title: "Copy the code", kind: "QuickStart step 1", mins: 3, steps: [
    { t: "Make a free GitHub account", d: "GitHub is the free website that stores the code and runs it for you on its computers. If you haven't got an account, make one at github.com with the email you use for this members area. Nothing to download.", stuck: "GitHub asks for a plan: pick Free. It never needs a card." },
    { t: "Open the robot's template", d: "Use the link on the Your copy of the code page here. It opens the robot's template on GitHub, with a green Use this template button top right.", img: "gh-use-template.png", stuck: "No green button? You're signed out of GitHub, or you're on the wrong page. Sign in, then use the link again." },
    { t: "Use this template → Create a new repository", d: "Press the green button and choose Create a new repository. Give it any name you like (my-robot-isa is fine).", img: "gh-use-template.png" },
    { t: "Set it to Private", d: "This matters: your copy will hold your keys. Choose Private, then press Create repository.", img: "gh-use-template.png", stuck: "Made it Public by mistake? Settings → scroll to the bottom → Change visibility → Private. Do it before adding any keys." },
    { t: "Done", d: "You own a copy of the same code Amit runs. It can't do anything yet, because it has no keys. That's step 2." }
  ]},
  "qs-2": { title: "Your Trading 212 key, practice account first", kind: "QuickStart step 2", mins: 8, steps: [
    { t: "Switch the Trading 212 app to Practice", d: "Open the Trading 212 app. Tap your profile, then switch to the Practice account. Everything in this course happens there until Day 13, so you can't lose a penny while you learn.", img: "t212-api.png", stuck: "Can't see Practice? It's under the account switcher at the top of the app. It may ask you to set it up first: say yes, it's pretend money." },
    { t: "Settings → API → create a key", d: "In the app: Settings, then API (beta). Create a key. Tick Account, Portfolio and Orders (execute). Leave everything else unticked.", img: "t212-api.png", stuck: "No API option? Update the app. The API lives in the app's settings, not the website." },
    { t: "Copy the key and the secret", d: "It shows two things once: a key and a secret. Copy each one straight from the app. Don't paste them anywhere in between (a note, a message, a terminal): that's how a line break sneaks in.", stuck: "Closed it before copying? Delete that key and make a new one. Keys are free." },
    { t: "Add them to your copy on GitHub", d: "Your repository → Settings → Secrets and variables → Actions → New repository secret. Name: T212_API_KEY, Secret: the key. Then again: T212_API_SECRET with the secret.", img: "gh-new-secret.png", stuck: "Secrets show as hidden after saving: that's right, nobody can read them back, not even you." },
    { t: "One variable: T212_ENV = practice", d: "Same page, Variables tab → New repository variable. Name: T212_ENV, Value: practice. Variables are plain text; that's fine, this one isn't secret.", img: "gh-new-variable.png" },
    { t: "Leave order mode alone", d: "It defaults to approve: the robot proposes, you tap yes. It can't place an order without you. Next, your email key." }
  ]},
  "qs-3": { title: "Your email key", kind: "QuickStart step 3", mins: 5, steps: [
    { t: "Make a free Resend account", d: "Resend is the service the robot uses to email you. Sign up at resend.com with the address you want the reports to reach." },
    { t: "API Keys → Create", d: "In Resend: API Keys, then Create. Name it anything. Permission: Sending access is enough. Copy the key: it's shown once.", img: "resend-key.png" },
    { t: "Add it to GitHub", d: "Your repository → Settings → Secrets and variables → Actions → New repository secret: RESEND_API_KEY. Then the Variables tab → New repository variable: NOTIFY_TO, set to your own email address.", img: "gh-new-secret.png" },
    { t: "No domain needed", d: "Resend's test sender delivers to the address on your Resend account, which is all the robot needs. Next: the setup check, which confirms it all works." }
  ]},
  "qs-4": { title: "Run the setup check", kind: "QuickStart step 4", mins: 5, steps: [
    { t: "Actions → Setup check → Run workflow", d: "On your repository, open the Actions tab. Pick Setup check in the list, then press the green Run workflow button.", img: "gh-actions-setup.png", stuck: "Actions tab says workflows are disabled? Press the green I understand my workflows, go ahead and enable them button once." },
    { t: "Confirm with the second Run workflow", d: "A small sheet slides in. Leave it on main and press Run workflow at the bottom. Nothing happens until you do.", img: "gh-run-workflow-sheet.png" },
    { t: "Read the email", d: "A minute or two later you get an email. Green ticks for what works. If something is red it says exactly which key and exactly what to do. Fix it, run it again.", img: "daily-email.png", stuck: "No email after five minutes? Check junk, then check NOTIFY_TO is spelt right and RESEND_API_KEY was saved as a secret, not a variable." },
    { t: "Actions → Weekly signals → Run workflow", d: "All green? Run Weekly signals the same way. The robot pulls prices, works out what it would hold, writes its plan and emails it: waiting for your approval.", img: "gh-actions-weekly.png" },
    { t: "Tap Approve", d: "Open that email and tap Approve. That's your first paper trade: placed by the robot, said yes to by you. The orders queue at the practice account and fill when the market opens.", img: "proposals-email.png" }
  ]},
  "qs-5": { title: "Optional extras", kind: "QuickStart step 5", mins: 5, steps: [
    { t: "Error alerts (Sentry, free)", d: "Make a free account at sentry.io. Settings → Auth Tokens → Create. Add it to GitHub as the secret SENTRY_AUTH_TOKEN. If a run dies in the night you get a message that says where and why." },
    { t: "Claude fixes failed runs (needs a Claude subscription)", d: "In the Claude app, run claude setup-token and add the result as the secret CLAUDE_CODE_OAUTH_TOKEN. A failed run then gets a fix proposed as a pull request you approve from your phone. It never changes the money settings on its own." },
    { t: "Or skip both for now", d: "The robot runs fine without them. You can add either on any day. Last step: your app on your phone." }
  ]},
  "qs-6": { title: "Your app on your phone, Mac or PC", kind: "QuickStart step 6", mins: 10, steps: [
    { t: "Make a free Cloudflare account", d: "Your dashboard is a web page only you can open. It runs on a free Cloudflare account behind a sign-in only your email can pass." },
    { t: "A second Trading 212 key, read only", d: "In the Trading 212 app make one more key, this time ticking only Account, Portfolio and Metadata. The dashboard never gets the key that can place orders.", img: "t212-api.png" },
    { t: "Actions → Dashboard setup", d: "On GitHub run Dashboard setup. It walks you through connecting Cloudflare and asks for that read-only key. At the end it gives you your address.", img: "gh-actions-setup.png" },
    { t: "Open it on your phone and add it to the home screen", d: "Open the address, sign in with the code sent to your email, then add it to your Home Screen (iPhone: the share button, then Add to Home Screen; Mac Safari: File → Add to Dock). From then on it opens like any app.", img: "demo-overview-phone.png" },
    { t: "Paste the address here", d: "Members area → Your dashboard → paste the address and save. Open my dashboard then takes you straight there, inside this app.", img: "members-dash-link.png" }
  ]},
  "day-1": { title: "Rules, not tips", kind: "Lesson 1", mins: 3, steps: [
    { t: "Watch the lesson", d: "Three minutes: what a robot ISA actually is, what it isn't, and the one habit that makes the whole thing work." },
    { t: "Open the demo dashboard", d: "Try the demo from the home page: it's made-up data, but the screens are the same as yours. Find the Orders tab and the Reports tab.", img: "demo-overview-phone.png" },
    { t: "Find the one file", d: "In your copy on GitHub, open universe.json. You don't need to understand it yet; just see that the rules live in one place.", img: "gh-edit-universe.png" }
  ]},
  "day-2": { title: "Get it running", kind: "Lesson 2", mins: 30, steps: [
    { t: "Watch the lesson", d: "What the pieces of the code are called, why nothing runs on your laptop, and how to ask Claude for help." },
    { t: "Ask Claude the three questions", d: "Point Claude at your copy and ask: Explain what signals.py does in plain English. Show me where the robot decides to sell. What would happen if I set the satellite slice to zero?" },
    { t: "Run your first full week", d: "Actions → Weekly signals → Run workflow. Open the email. This time read it before you approve: what it wants to hold, what it wants to sell, and why.", img: "proposals-email.png" },
    { t: "Read the evening email", d: "That evening you get the daily email: value, cash, what's open. Calm is good. Calm is the point.", img: "daily-email.png" }
  ]},
  "day-3": { title: "Data you can trust", kind: "Lesson 3", mins: 20, steps: [
    { t: "Watch the lesson", d: "Where the prices come from and how the robot makes sure every number is real." },
    { t: "Open the price file", d: "In your copy: data/prices_weekly.json. Find the fund with the biggest weight in your core and eyeball its last few rows against the chart in your app." },
    { t: "Ask Claude what happens when it's stale", d: "Ask: what happens if this file is three weeks old on a Sunday? Then find the max_data_age_days line in universe.json that makes it so.", img: "gh-edit-universe.png" }
  ]},
  "day-4": { title: "Make it yours", kind: "Lesson 4", mins: 40, steps: [
    { t: "Watch the lesson", d: "universe.json line by line: what each number does, which to leave alone, and how to change the rest safely." },
    { t: "Pick your risk profile, on purpose", d: "Read the three bundles (cautious, balanced, adventurous) in universe.json and choose. This is one of the three decisions the course asks of you.", img: "gh-edit-universe.png" },
    { t: "Make one change, with a reason", d: "On GitHub press the pencil, change one number (sat_weight is the one to start with), write one line saying why, commit. Or ask Claude to do it as a pull request.", img: "gh-edit-universe.png", stuck: "The run refused the file? Read the sentence: the validator names the line. Put it back, change one thing at a time." },
    { t: "Run the setup check", d: "Actions → Setup check. Watch the validator pass. The next run uses your change.", img: "gh-actions-setup.png" }
  ]},
  "day-5": { title: "Backtest honestly", kind: "Lesson 5", mins: 45, steps: [
    { t: "Watch the lesson", d: "How to test rules on the past, and the three ways people cheat without noticing." },
    { t: "Run the backtest", d: "Ask Claude to run engine.py on your universe, or run it yourself. It writes an equity curve and a trade list." },
    { t: "Read the worst run first", d: "How far it fell from a high, and how many months it took to get back. Write both down. Then ask Claude to delete the five best trades and run again." },
    { t: "The honest question", d: "Would you have sat through that worst run, approving on a Monday? If not, the rules are too hot for you, whatever the return says." }
  ]},
  "day-6": { title: "Paper money first", kind: "Lesson 6", mins: 25, steps: [
    { t: "Watch the lesson", d: "Why the practice account is the best teacher you'll get, what it can't teach, and how long to stay on it." },
    { t: "Match the order history to the ledger", d: "Open the practice order history in the Trading 212 app. Match each order to a line in state/live_state.json in your copy. They should agree exactly.", img: "demo-orders-phone.png" },
    { t: "Anything that doesn't match", d: "That's not a disaster, that's the job. Write it down and ask Claude what happened." }
  ]},
  "day-7": { title: "The plumbing", kind: "Lesson 7", mins: 25, steps: [
    { t: "Watch the lesson", d: "What happens between the robot saying buy and the broker saying done: rounding, minimum sizes, the fund mapping and market hours." },
    { t: "Run Broker check", d: "Actions → Broker check → Run workflow. Read the output: every fund in your core and the UK line it maps to.", img: "gh-actions-setup.png" },
    { t: "Ask Claude where it rounds", d: "Ask: show me where the robot rounds a quantity, and what happens if the exchange changes its rule to two decimals. The answer should point at one function." }
  ]},
  "day-8": { title: "Done means it happened", kind: "Lesson 8", mins: 25, steps: [
    { t: "Watch the lesson", d: "The difference between sending an order and knowing it filled." },
    { t: "Open the ledger", d: "state/live_state.json in your copy. Find last week's orders and match each one to the broker app's history." },
    { t: "Follow a rejection", d: "Ask Claude: what happens in fills.py if the broker says rejected? Follow the answer to where the email gets written.", img: "daily-email-pending.png" }
  ]},
  "day-9": { title: "Make it explain itself", kind: "Lesson 9", mins: 20, steps: [
    { t: "Watch the lesson", d: "Logs that tell you the reason, not just that something needs you." },
    { t: "Break it on purpose", d: "Change your RESEND_API_KEY secret to nonsense. Run the setup check. Read the failure: it should name the key and say what to do.", img: "gh-actions-setup.png" },
    { t: "Put the key back", d: "Paste the real key again and run the check once more. Then find the Failure log issue in your copy and read what it wrote." }
  ]},
  "day-10": { title: "Keys and secrets", kind: "Lesson 10", mins: 25, steps: [
    { t: "Watch the lesson", d: "The five keys your robot holds, what each can do, and the four habits that keep them safe." },
    { t: "Check the scopes on your broker key", d: "In the Trading 212 app, open the key you made in the QuickStart. It should have Account, Portfolio and Orders, nothing more.", img: "t212-api.png" },
    { t: "Rotate the Resend key", d: "Make a new key in Resend, paste it into GitHub, delete the old one. Ten minutes, nothing breaks, and now you know it.", img: "resend-key.png" }
  ]},
  "day-11": { title: "It runs while you sleep", kind: "Lesson 11", mins: 20, steps: [
    { t: "Watch the lesson", d: "The schedule, the reminders, and the one email a day worth reading." },
    { t: "Translate the schedule", d: "Open the .github/workflows folder and ask Claude to translate every cron line to UK time in one go." },
    { t: "An inbox rule", d: "In your email app, file the daily email into a folder and let only the Sunday plan and anything with rejected or halt in the subject through to your alerts.", img: "daily-email-full.png" }
  ]},
  "day-12": { title: "Limits and an off switch", kind: "Lesson 12", mins: 15, steps: [
    { t: "Watch the lesson", d: "The rules that keep you in control whatever the market does, and how to stop everything from your phone." },
    { t: "Test the switch: halt", d: "Actions → Halt trading → Run workflow → halt. Check the HALT file appears in your copy. The go-live gate checks that you've done this.", img: "gh-halt.png" },
    { t: "Then resume", d: "Run it again with resume. The file goes. Nothing was sold either way." },
    { t: "Write down today's room before the halt", d: "It's the one line in the evening email that matters.", img: "daily-email-full.png" }
  ]},
  "day-13": { title: "Small and real", kind: "Lesson 13", mins: 20, steps: [
    { t: "Watch the lesson", d: "The gate you have to pass before real money, the switch itself, and how small to start. The decision is yours." },
    { t: "Run the gate", d: "Run ops/golive.py, or ask Claude to run it, and read the five lines. Fail or skipped is a to-do list, not a verdict." },
    { t: "All pass? Wait a week anyway", d: "The gate doesn't expire. If and when you choose to go live: a live key with the same scopes, the same two secrets, T212_ENV set to live, and smaller than you think.", img: "t212-api.png" }
  ]},
  "day-14": { title: "Keep an honest record", kind: "Lesson 14", mins: 30, steps: [
    { t: "Watch the lesson", d: "How to review what the robot did without fooling yourself." },
    { t: "Build your monthly review", d: "Ask Claude for a one-page monthly review from the three files: worst run, satellite hit rate, idle cash, rejections, and one line per week from the signals reports. Save it as a template in your copy." },
    { t: "Run it on the first of every month", d: "Three questions: did it follow the rules, did the plumbing work, would I still choose this risk profile? Only the third can lead to a change, and only after four weeks." }
  ]}
};
