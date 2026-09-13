---
id: E02/F01/S04
title: Refuse a zero cap on assignments per vendor
type: story
status: done
blocked_by: [E02/F01/S03]
pr: []
---

## What to build

An organizer cannot set "max assignments per vendor" to zero.

Found while wiring that setting in F01/S03. The setup screen treats a negative or non-numeric
entry as "no limit" and clamps anything above the market's date count down to it, but it accepts
zero and stores it. The solver honours it literally, so the market assigns nobody.

Nobody means zero assignments per vendor when they type it into a field whose other values are
all "how many days may one vendor have". It is a typo or a misreading of the field, and the
result is a market that runs assignment successfully and places no one.

The floor belongs with the ceiling that is already there: a value below one is no limit, exactly
as a negative one already is.

## Acceptance criteria

- [ ] Entering zero leaves the setting unset rather than storing a cap of zero
- [ ] Entering a negative number still leaves it unset, as it does today
- [ ] The existing clamp to the market's date count is unchanged
- [ ] A frontend test covers zero, negative, above-the-ceiling, and an ordinary value

## Notes

Deliberately not folded into F01/S03: the repo's convention is that work discovered mid-story
becomes a sibling story rather than growing the current one.

Low severity. The failure is visible - every vendor shows as unassigned - rather than silent, so
this is a correctness tidy-up, not a defect the epic is blocked on.

Done as its own slice rather than deferred, because a feature is only `done` when every child
story is, and parking one small story would have left E02 complete with an asterisk.
