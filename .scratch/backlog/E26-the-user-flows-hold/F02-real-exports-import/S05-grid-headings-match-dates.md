---
id: E26/F02/S05
title: A tier grid's day headings match dates
type: story
status: done
blocked_by: []
pr: [88]
---


## What to build

A tier grid mapped by hand offers market dates, not tiers, for its day headings, recognises Google-style headings with and without a year, and reads "Not available" as unavailable.

Closes bugs 26 in `docs/MVP_BUGS.md`; each one's reproduction there is the starting E2E.

## Acceptance criteria

- [x] A grid headed "[Saturday, October 3]" imports into a market on 3 October.
- [x] An unmatched heading offers the market's dates to match.
- [x] "Not available" and "None" both mean unavailable.
