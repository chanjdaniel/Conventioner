# 07: What counts as a pass, and what happens to what the run finds?

Type: grilling
Status: resolved
Blocked by: 03

## Question

Two halves:

- **Pass criteria.** What must be true at the end? For example: every row that should import does, and each skipped row says why; every approved vendor is either placed or listed as unassigned with a reason; no vendor is placed at a tier they declined for that day, beyond their own day limit, or on a day they marked None; a half-table pair is seated together where both asked for it.
  Which of these are checked by eye on the screens, and which by reading the stored assignment?
- **Findings.** Fix them during the run, each reproduced first in a failing spec (as on 2026-10-03), or register them in `docs/MVP_BUGS.md` and fix nothing (as on 2026-09-30)?
  The market is five weeks out, which may argue for fixing as found.

## Answer

Decided with the user on 2026-10-09.
The run passes when all of these hold, each checked on screen and against the stored assignment:

1. **All 212 rows import**, and the second import of the same file changes nothing.
2. **No rule is broken:** nobody is placed on a day they answered None, at a tier they did not choose for that day, or on more days than their own limit.
3. **Every approved vendor is placed or says why**, in words the organizer can read.
4. **Pairs sit together**, by the rule in [08](08-how-table-share-pairs-are-read.md).
5. **The order is respected:** nobody left unplaced on a day outranks (students, clubs, timestamp) someone placed at the same tier that day, allowing for the built-in "fewest dates so far go first".

**Findings are fixed as found**, each reproduced first in a failing Playwright spec, as on 2026-10-03; the market is five weeks out.
