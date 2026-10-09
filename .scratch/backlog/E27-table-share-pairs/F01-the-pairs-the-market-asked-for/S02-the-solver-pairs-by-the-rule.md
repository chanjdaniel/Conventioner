---
id: E27/F01/S02
title: The solver pairs by the market's rule
type: story
status: todo
blocked_by: [E27/F01/S01]
pr: []
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

- [ ] A names B, both Half: seated at one table on every date both are placed.
- [ ] A names B, B names nobody: seated together (one-way).
- [ ] A names B, B is Full only: not paired; A is matched as an ordinary half table and B gets a full table.
- [ ] A names B, B names C, all Half: B sits with C; A is matched otherwise.
- [ ] A names an address that is no applicant's: A is matched as an ordinary half table.
- [ ] A pair never puts either vendor on a date, at a tier, or beyond a limit their own answers rule out.
- [ ] Pytest in `test_assignment_behaviour.py` covers each case above.
