---
id: E14/F02/S03
title: A count of zero is not a warning
type: story
status: done
blocked_by: []
pr: [75]
---

## What to build

The Tables view's status pills read "6 assigned", "0 partial", "14 empty".
The partial pill renders amber whatever its value, so a market with nothing partially filled still shows a warning-coloured zero drawing the eye to a non-problem.

A count of zero should not be coloured as a condition to act on.

## Acceptance criteria

- [x] A zero-valued status pill is not rendered in a warning colour.
      It falls back to the neutral fill the empty pill already wore.
- [x] A non-zero partial count still reads as something to look at.
      In a test of its own, because the market the first one seeds has nothing partial in it: see
      below.
- [x] Whatever colours are used still meet AA on their background, per `E09/F01/S03`'s contrast contract.
      Measured on the rendered page, not computed on paper: 4.59 assigned, 12.49 partial, 12.49
      empty.

## Notes

Observed during the 2026-09-20 walk; recorded in the report's smaller findings rather than as a numbered one.

## The trap in the obvious fix

A zero pill wants to look quieter, and the reflex is muted text.
`--mm-text-muted` on `--mm-beige` is **4.24**, which is below AA.

`contrast.test.ts` would not have caught it.
It holds only `--mm-black` to the beige ground, and says so in a comment, because `--mm-black` was
the only thing ever set on beige.
So the rule worth carrying forward is in the CSS now: quieten a pill by changing its **fill**, never
by lowering its text.

## Scope judgement

The rule is applied to all three pills, not to partial alone.
Strictly, only amber is a warning colour, so only the partial pill was in breach of the criterion as
written.
But "0 assigned" in the green that means *done* is the same mistake wearing a friendlier face, and
one rule covering every pill needs no explaining to the next reader, where a rule covering one
invites the question of why the others are different.

## The first version of this test proved only half of it

The claim written here first - that the e2e "also fails if the amber is removed outright" - was
false, and saying so cost nothing to check and was not checked.

`seedPublishedMarketWithAssignments` places both its vendors at full tables, so the partial pill in
that test is *always* zero.
A zero partial resolves to the neutral fill either way, so deleting `.count-badge--partial`
altogether left the test green.
Confirmed by doing it.

The amber now has a test of its own, on a market where a table really is half occupied, and
de-ambering the pill fails it.

Getting that market was itself informative.
Seeding a vendor whose answer is `essential_table_choice: 'half'` does **not** produce a partial
table: with five tables and three vendors the solver gave them a whole one, which is correct.
What makes a table partial is a *placement*, so the test hand-places one through
`PUT /markets/{id}/placements` - and that endpoint names the seat (`Half Table (Left)`), not the
preference.
