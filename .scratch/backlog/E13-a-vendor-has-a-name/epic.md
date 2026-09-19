---
id: E13
title: A vendor has a name
type: epic
status: done
blocked_by: []
pr: [70]
---

## Outcome

Every application carries the vendor's name, and every screen that shows a vendor shows it.

## Why now

The product identifies vendors by email address and nothing else - the vendor list, its search box
("Filter by email..."), the vendor detail panel, the unassigned-vendors panel and the occupied
tables on the Tables view. A market of 232 vendors is a list of 232 gmail addresses.

The names are not missing from the world, only from the product: the committed Fall 2025 export
carries **Full Legal Name** and **Preferred Name** as columns 4 and 5, and Conventioner drops both
because it has nowhere to put them.

Resolved by
[readable-journey ticket 02](../../wayfinding/readable-journey/issues/02-which-answer-names-a-vendor.md).
Read that answer before taking any story; `F01` changes the essential contract and the reasoning
matters.

## The one idea

**`essential_full_name`: one field, required, asked unconditionally, person only.**

One field and never split - the names organizers already collect arrive whole, and splitting them
means guessing wrong on every `van der Berg` and mononym. Asked unconditionally because identity
does not depend on the market plan, which makes it the first essential question not gated on an
offering.

## Out of scope

- **A trading name.** `Paper & Pine` rather than `Ana Rivera` is a real thing a table map might
  want, and the Fall 2025 export has no column for one. Additive; it waits.
- **Renaming `FormHasFieldsGuard`** for what it actually protects. `F01/S02` keeps it working;
  rewriting a precondition is a larger act.
