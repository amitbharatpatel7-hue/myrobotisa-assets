# The free test drive: 100 simulated visitors (6 Nov 2026, hub D41)

Amit: "We defo need to build the test drive and run 100 simulations of it once it has to prove it works."
`journeys.mjs` runs 100 visitors in real Chromium on the real page (`docs/drive/`, served as myrobotisa.com/drive/),
with the real link logic (`core.js`) behind it and a clock the run moves on, so each visitor's week passes in seconds.
55% are on a phone (iPhone 13, iPhone SE, Pixel 7), the rest on a computer.

**Result (seed 7): 100 visitors, all passed.** 567 visits; 87 finished all seven days; 13 gave up after day 2 by
design; 306 played a week through; 83 went back to an earlier day; 121 tried a day before it opened (refused each time).

| Pattern | Visitors | What they do |
|---|---|---|
| Every day | 21 | One visit a day at a random time |
| Twice a day | 18 | Back within hours, including late at night |
| Weekend | 18 | Day 1, then nothing until days 6 to 8 |
| Skipping | 16 | Misses days 3, 6 and 8 |
| Late binge | 14 | Day 1, then everything nine days later |
| Gives up | 13 | Two visits, then stops |

Checked on every visit: no page error; no share's name in the page or in any reply before its day is finished;
the number of open days matches the London calendar (never early); a day can't be finished before it opens or out of
order; the pot carries from one day to the next; the end card shows the real result (read from the days: £10,292.11 against £10,121.96);
nothing wider than the screen. Every tenth visitor also opens the link on 6 December and must see "opens on Monday
7 December" without starting their clock.

**Second run (seed 11, after Amit's test, 6 Nov): 100 visitors, all passed**, on the replay that trades as the engine
does. 573 visits; 86 finished all seven; 14 gave up by design; 312 played a week; 115 early tries refused. It also checks
that every day shows what the robot did at Friday's close.

What the runs and checks found and fixed before this PR:
- The link carries `?t=` but the function read only `token`, so every real link said it was incomplete (found on the
  live function; test added).
- A day counter rounded up, so "Day 2 opens on" named the wrong date (rule test).
- On an iPhone SE the holdings table made the page 49 to 57 px wider than the screen (first 6-visitor run).
- The holdings table showed Friday's figures before the week had played, giving the ending away; the chart's labels
  were too small and overlapped on a phone (screenshots).

Run it: build the days in the hub (`RISK_PROFILE=balanced python ops/test_drive/drive.py <dir>`), then
`DRIVE_DIR=<dir> node ops/supabase/functions/test-drive/test/journeys.mjs 100 7`. The days are not in this public repo
because their reveals name the shares.
- Amit's own test (6 Nov): the same holdings all week, one trade, and no way on from a finished day. The replay now
  trades as the engine does (monthly fund change on days 1 and 6, the stop on day 3, the sale on day 4), every day says
  what the robot did, and a finished day says when the next opens.
