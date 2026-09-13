---
id: E02/F03/S01
title: Place vendors in their highest-ranked available section
type: story
status: ready
blocked_by: [E02/F01/S02]
pr: []
---

## What to build

A vendor who ranked one section above another, and who could be placed in either, gets the one they ranked higher.

Section preference has been collected since the essential-fields contract shipped and has never been read by anything.
F01 puts it on the typed vendor but changes no placement, so without this story the epic ends with the solver holding a field it still ignores.

It is honoured as a **placement preference**: not an optimisation objective, and not a tie-break.
When a vendor can go in several sections, they get their highest-ranked one still available.
No vendor goes unassigned because a preferred section filled up, and no vendor is displaced from a table they would otherwise have had.

That follows necessarily from rankings being total.
A ranking is a permutation of the whole offering, so it excludes nothing and therefore cannot act as a filter.
Contrast tier, which F01 makes a hard filter, because the tier determines the price the applicant pays.

**Expect assignment outputs to move and solver tests to churn.**
The solver is table-driven: it walks tables and picks the highest-priority valid vendor for each.
A vendor's own ranking cannot influence which table they reach under that shape, so the loop is inverted or a pre-pass added, and either changes tie-breaking by construction.
That churn is the whole reason this is its own feature: F01's diff should contain no placement changes, and this one's should contain nothing else.

Whether to invert the loop or add a pre-pass is an implementation choice for this story.
No data is needed either way; a table already knows its section.

## Acceptance criteria

- [ ] A vendor with a clear section preference and multiple valid options is placed in their highest-ranked available section
- [ ] A vendor whose top section is full is still placed, in their next-best available section
- [ ] No vendor is left unassigned as a result of preference
- [ ] No vendor loses a placement they would have received before, purely to satisfy another vendor's preference
- [ ] Preference never overrides tier, which stays a hard filter
- [ ] Preference never overrides priority order: a higher-priority vendor is still placed first
- [ ] The characterisation tests S02 built are updated with their output changes explained, not silently re-baselined
- [ ] Backend tests cover a satisfied preference, a contended one, and a full top choice
- [ ] An e2e story asserts a vendor lands in their preferred section

## Notes

Table type is stubbed to a single hard-coded type for the MVP, and the applicant is not asked to rank it while fewer than two types exist.
That is a deliberate stub, not an oversight: the field and the solver's handling of it stay in place, and only a real offering is missing until the floorplan GUI ships.
Do not treat it as a second preference to wire up here.

Half-table pairing and the per-section half-table proportion interact with placement.
Preference must not silently defeat either.

The solver had no behavioural tests of its own before this epic; F01/S02 is where that safety net
gets built.
If it did not get built there, build it here before touching the loop, because an inversion with
nothing pinning the old behaviour is an unreviewable diff.
