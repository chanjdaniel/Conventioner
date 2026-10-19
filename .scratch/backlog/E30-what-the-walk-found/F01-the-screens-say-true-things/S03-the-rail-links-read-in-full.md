---
id: E30/F01/S03
title: The rail's links read in full and point at the right page
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

- **On market days, a form market's rail carries two links** (application page and check-in page) and both truncate past reading ("localhost:5…", "localhost:518…").
  Each reads in full, or wraps, at 1280px and up, and stays usable at the phone width Attendance supports.
- **An archived market that ran keeps its check-in page link** - the record its archive dialog promises stays up - and drops the application page link, which no longer takes anyone anywhere useful.
  Today it is the reverse.

## Acceptance criteria

- [x] At 1280 and 1440, both links on a market-days form market are readable whole (screenshot `form-market_days-landing`).
- [x] An archived market that ran shows the check-in record link and not the application link; one that never ran shows neither.
- [x] Covered by an e2e on the rail in both phases.
