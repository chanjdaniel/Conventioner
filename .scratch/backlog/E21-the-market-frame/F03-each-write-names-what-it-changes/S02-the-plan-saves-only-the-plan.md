---
id: E21/F03/S02
title: The plan saves only the plan
type: story
status: done
blocked_by: [E21/F02/S02]
pr: []
---

## What to build

The plan's autosave sends only what the plan screen owns (the plan and the intake mode) through a write that accepts nothing else, instead of the whole market.

An organizer editing dates, tiers, locations, sections or assignment options sees exactly what they see today: "Saving…", then "Plan saved", or the error.
What changes is the wire: the request carries the plan and the intake mode, and the server rejects any other field rather than re-applying over it.

The rules the whole-market PUT enforces on these fields today move with them rather than being rewritten: EDITOR permission, intake mode frozen outside draft, and the plan feeding the essential questions' offering until the form freezes.
Afterwards the store re-fetches the market, as for every other write (F02).

## Acceptance criteria

- [x] The plan autosave calls a plan-only write; nothing in Market Setup calls `PUT /markets/:id`.
- [x] The plan-only write rejects a body that names any field other than the plan and the intake mode.
- [x] It enforces EDITOR permission and refuses an intake-mode change outside draft, with pytest coverage of each.
- [x] The plan save status behaves as before, and the e2e specs covering plan editing pass unchanged in behaviour.
