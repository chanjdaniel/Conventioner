---
id: E10/F03/S01
title: Assignment Results is a tab, and Done is gone
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

`Assignment Results` joins Application Form, Market Setup and Applications as a fourth tab on the
market, rather than a route the organizer is navigated to by pressing Assign.

**`Done` is removed.**
Publishing is a transition on the rail; "I have finished looking at this" is what leaving a page
already is.
Removing it deletes blocker B2 outright - `handleDone()` and its `market_days` post go with it.

The button row keeps **Download CSV** and **Send to Discord**, which are the two things there that
are actually actions, and loses Back along with Done.

## Acceptance criteria

- [ ] Assignment Results is reachable as a tab from any market screen, in any phase.
- [ ] No control on it posts a phase transition.
- [ ] `handleDone()` and the `assignment-results-done-button` testid are gone, along with the e2e
      steps that used them.
- [ ] A market with no computed assignment shows the tab with an empty state, not an error.
- [ ] The layout fixes in `E09/F06/S02` still hold once it is a tab.
