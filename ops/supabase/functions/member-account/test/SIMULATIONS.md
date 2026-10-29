# Account settings: 100 simulated members (29 Oct 2026, D28)

Amit asked for 100 simulations to make the journeys as pain free as possible. `journeys.mjs` runs 100 members through
25 journeys in real Chromium, on the real members page (served as myrobotisa.com/members), with the real
member-account logic and SQL behind it (`emulator.mjs`), Resend's one-address rule, and GitHub's OAuth and workflows
faked to behave as they do. Half the members are on a phone, and many type like people do: capitals and stray spaces,
codes pasted with a space, Enter instead of a click, the wrong GitHub account still signed in.

What the runs found and fixed before this PR:
- An existing lesson-tick handler grabbed every checkbox styled as a tick, so the new boxes would have saved blank
  lesson ticks (page error in 6 of the first 24 runs).
- Two clean-up runs at once could finish the same deletion twice and send two "deleted" emails.
- Two error messages didn't say what to do next; a retry after the Resend step made the member retype the address.
- Long addresses wrapped mid-word on phones.

An independent review then found (all fixed, each with a test in `core_test.mjs`): the purge could act on a GitHub
login another member now holds; mail-app link scanners would have cancelled deletions by opening the email's link
(links now only open the page, and a tap does it); a cancel could race the purge; an unconfirmed robot test was
reported as a success; finished deletions kept the address; and a stolen session could move the sign-in with no way
back (the old address now gets a "not you? put it back" button).

Run it: `PG_MODULE_DIR=<dir with node_modules/pg> node journeys.mjs [count] [seed]` (local Postgres 16, Playwright).
The same 100 also passed on seeds 5 and 6. The last report:

# 100 simulated members, seed 29102026: 100 reached their goal, 0 dead ends, 0 with page errors, 0 saw an unclear error (52s)

| Journey | Runs | Reached goal | Avg actions | Messages members saw |
|---|---|---|---|---|
| email: change it | 8 | 8 | 5.0 | none |
| email: wrong code first | 5 | 5 | 6.0 | That code isn't right. Use the newest email from us (4 tries left). |
| email: code ran out, new code | 4 | 4 | 7.0 | That code has run out (they last an hour). Press Send a new code. |
| email: five wrong, new code | 3 | 3 | 16.0 | That code isn't right. Use the newest email from us (4 tries left). / That code isn't right. Use the newest email from us (3 tries left). / That code isn't right. Use the newest email from us (2 tries left). / That code isn't right. Use the newest email from us (1 try left). / Too many wrong tries for that code. Press Send a new code. |
| email: address on another membership | 4 | 4 | 3.0 | That email is already used for another membership. If it's yours too, email hello@myrobotisa.com and we'll sort it out. |
| email: types the same address | 3 | 3 | 3.0 | That's already your sign-in email. Type the new address you want to use. |
| email: typo in the address | 3 | 3 | 6.0 | That email doesn't look right. Check it and try again. |
| email then robot: Resend already moved | 9 | 9 | 9.0 | none |
| robot: forgot Resend, then fixes it | 7 | 7 | 8.0 | Robot Dash has moved. For your robot's emails there's one step left: finish the change in Resend, then press Change these again. / Resend won't send to rb-m92cab941@example.com yet, so your robot still emails m92cab941@example.com (nothing is broken). Finish the change in Resend: click the links in both emails Resend sent, then try again. / Resend won't send to rb-m0b2a5e6e@example.com yet, so your robot still emails m0b2a5e6e@example.com (nothing is broken). Finish the change in Resend: click the links in both emails Resend sent, then try again. / Resend won't send to rb-m5529cd44@example.com yet, so your robot still emails m5529cd44@example.com (nothing is broken). Finish the change in Resend: click the links in both emails Resend sent, then try again. / Resend won't send to rb-m93893e58@example.com yet, so your robot still emails m93893e58@example.com (nothing is broken). Finish the change in Resend: click the links in both emails Resend sent, then try again. / Resend won't send to rb-md8b9feec@example.com yet, so your robot still emails md8b9feec@example.com (nothing is broken). Finish the change in Resend: click the links in both emails Resend sent, then try again. / Resend won't send to rb-m29a04e90@example.com yet, so your robot still emails m29a04e90@example.com (nothing is broken). Finish the change in Resend: click the links in both emails Resend sent, then try again. / Resend won't send to rb-m4e1bb18e@example.com yet, so your robot still emails m4e1bb18e@example.com (nothing is broken). Finish the change in Resend: click the links in both emails Resend sent, then try again. |
| robot: new Resend account key | 4 | 4 | 6.0 | none |
| robot: copy has its own name | 5 | 5 | 3.0 | none |
| robot: setup check failing for another reason | 3 | 3 | 5.0 | Some of it didn't change: check the line marked in pink above for what to do. / Your robot's setup check is failing for a reason that isn't the address: its email to mcf77ce5f@example.com says what. Fix that first, then move the address. Your robot still emails mcf77ce5f@example.com. / Your robot's setup check is failing for a reason that isn't the address: its email to mbd0ccaa8@example.com says what. Fix that first, then move the address. Your robot still emails mbd0ccaa8@example.com. / Your robot's setup check is failing for a reason that isn't the address: its email to m8ea2d2a0@example.com says what. Fix that first, then move the address. Your robot still emails m8ea2d2a0@example.com. |
| robot: no Robot Dash yet | 3 | 3 | 5.0 | none |
| robot: Robot Dash update fails | 2 | 2 | 5.0 | Some of it didn't change: check the line marked in pink above for what to do. / Robot Dash couldn't be updated just now, so it still opens for m5e9c6586@example.com. Try again in a few minutes. / Robot Dash couldn't be updated just now, so it still opens for m373287f0@example.com. Try again in a few minutes. |
| github: switch account | 6 | 6 | 3.0 | none |
| github: old account still signed in | 5 | 5 | 4.0 | none |
| github: account already on another membership | 2 | 2 | 3.0 | @gh-2f9937 is already linked to another membership. If that's you too, email hello@myrobotisa.com. / @gh-82dc0c is already linked to another membership. If that's you too, email hello@myrobotisa.com. |
| github: first connection | 2 | 2 | 2.0 | none |
| data: download | 5 | 5 | 1.0 | none |
| delete: then keeps it here | 4 | 4 | 6.0 | none |
| delete: keeps it from the email | 3 | 3 | 6.0 | none |
| email: not you? put it back | 2 | 2 | 7.0 | none |
| delete: wrong code, then 7 days pass | 4 | 4 | 6.0 | That code isn't right. Use the newest email from us (4 tries left). |
| delete: changes mind at the code | 3 | 3 | 3.0 | none |
| owner: no delete button | 1 | 1 | 0.0 | none |

Devices: 41 phone, 59 desktop. Human noise (capitals, spaces, Enter, pasted codes with a space): 42.
