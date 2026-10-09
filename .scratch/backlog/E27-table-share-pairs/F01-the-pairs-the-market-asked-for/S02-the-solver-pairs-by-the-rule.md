---
id: E27/F01/S02
title: The solver pairs by the market's rule
type: story
status: done
blocked_by: [E27/F01/S01]
pr: [93]
---

## What to build

The pairing in `best_table_for` / `get_table_share_vendor` (`back-end/assignment/assignment.py`) seats a named partner after checking only that the partner is available, accepts the tier, has room under their limit and is free that date.
It never checks the partner's table choice.

The rule, decided in ticket 08 of the November 2026 dry-run map:

- **A pair needs both applicants to exist**, identified by the address `S01` stores, **and both to accept a half table**: Half or Either, never Full only.
  A full-only vendor is never put on half a table because someone named them.
- **One-way is enough.** If A names B, they are a pair whether or not B named anyone.
- **A person's own request wins.** If A names B and B names C, B is paired with C (when C is valid), and A gets an ordinary half-table match.
- Everything that already holds for a placement still holds for both: the date, the tier for that date, the vendor's own day limit, the priority order and the half-table share.

Write the behaviour into `back-end/tests/test_assignment_behaviour.py` first, against the solver's own inputs, before changing the solver.

## Acceptance criteria

- [x] A names B, both Half: seated at one table on every date both are placed.
- [x] A names B, B names nobody: seated together (one-way).
- [x] A names B, B is Full only: not paired; A is matched as an ordinary half table and B gets a full table.
- [x] A names B, B names C, all Half: B sits with C; A is matched otherwise.
- [x] A names an address that is no applicant's: A is matched as an ordinary half table.
- [x] A pair never puts either vendor on a date, at a tier, or beyond a limit their own answers rule out.
- [x] Pytest in `test_assignment_behaviour.py` covers each case above.

## As built

The review found the edges the rule did not state, now pinned in `TestATableShareRequest`: a chain (A names B, B names C, C names D) seats A with B and C with D; a ring is broken at its first address so it still seats a pair; two who name the same person do not take turns with them (the earlier applicant is their partner on every date); a pair keeps to the half-table share; and the open half of a pinned table never splits a pair.
Found on the way: the solver never read the organizer's half-table share and ran every market at 30%.
It reads it now, keeping 30% when unset, and the plan screen says so.
