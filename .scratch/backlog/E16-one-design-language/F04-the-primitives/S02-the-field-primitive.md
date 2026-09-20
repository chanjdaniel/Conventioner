---
id: E16/F04/S02
title: The field primitive
type: story
status: blocked
blocked_by: [E16/F02, E16/F03]
pr: []
---

## What to build

One `.field` covering input, select and textarea.

Two rules that are not cosmetic:

- **Left-aligned text.** 18 of 27 controls on Market Setup are `text-align: center`, which is why a column of dates is hard to scan and why the new-market dialog's two adjacent fields look unrelated.
- **A select is never narrower than its own longest option.** This is the constraint `E16/F03/S03` fixes for the plan; the primitive is what stops it recurring elsewhere. The measurement to encode: the Tier select offers `Community` (needs 71px) in 34px of text room.

Also settled by this primitive: the new-market dialog's two fields are currently a 38px bordered rect in Outfit and a 22px pill in Inter, with one label centred and one left-aligned (finding H9). Labels are sentence case, left-aligned, above the field.

Non-interactive labels must not be reachable through `.field`. Market Setup's column headers currently wear the same border, inset shadow and centred text as the editable pills beneath them, which is a promise the interface does not keep.

## Acceptance criteria

- [ ] One field height; one border; one focus treatment.
- [ ] No field in the product is centre-aligned.
- [ ] A select's rendered width is at least the width of its longest option, asserted generically rather than per screen.
- [ ] Labels are sentence case and left-aligned everywhere.
- [ ] The inset "pressed" shadow is gone from every field.

## Notes

Blocked on `F02` and `F03`.
