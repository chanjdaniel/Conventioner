---
id: E02/F01/S03
title: Honour the organizer's max assignments per vendor
type: story
status: done
blocked_by: [E02/F01/S02]
pr: []
---

## What to build

An organizer sets "max assignments per vendor" to six, and vendors can be assigned six days.

Today they can set it, watch it save, and get four.
The setting already exists on the market's assignment options, is already rendered and clamped to the market's date count in the setup UI, and is already persisted through the schema.
The solver has simply never read it: a hard-coded four-day ceiling wins everywhere, and the same constant is duplicated in the validator.

So this is not new configuration.
It is connecting a control that currently lies, and deleting the constant behind the lie.

The cap stays a concept, because an organizer-configured ceiling on how many days one vendor may take is legitimate.
What goes is the idea that the ceiling is four regardless of what anyone asked for.

A vendor's own stated appetite still caps them independently, and the lower of the two wins.

## Acceptance criteria

- [ ] The solver reads the market's max-assignments-per-vendor setting
- [ ] The hard-coded four-day constant is gone from the solver and from the validator, with no remaining duplicate
- [ ] A vendor is capped by the lower of the market setting and their own stated number of dates wanted
- [ ] A vendor who asked for more days than the market allows is capped at the market setting
- [ ] A market with the setting unset has a defined, documented behaviour rather than an accidental one
- [ ] A vendor wanting twelve dates is not capped at one
- [ ] Backend tests cover the market cap, the vendor cap, the two interacting, and the unset case
- [ ] The setup UI's existing clamp still agrees with what the solver now enforces

## Notes

The old parse read one character of the answer, so `"12"` became `1`.
The essential-fields contract stores this as an integer, so a naive retype of that expression raises, and the surrounding bare `except` swallows the raise into the global default.
That is how one wrong answer becomes a different wrong answer; the typed vendor from S01 is what makes it impossible.
