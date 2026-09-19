---
id: E09/F04/S04
title: The importer says what it cannot know
type: story
status: in-progress
blocked_by: []
pr: []
---

## What to build

A Google Forms **checkbox question** exports one column with the selected option labels
**comma-joined**. When those labels themselves contain commas - and an organizer is free to name a
section "Hall A, west end" - the export is ambiguous to any reader, because Google threw the
separator information away.

> **Correction, found while building this.** The ticket claimed a market *date* label
> (`Saturday, November 21, 2026`) is such a label. It is not: the long spelling with its two commas
> is how the **applicant form** renders a date, while what an imported column is matched against is
> the stored `2026-08-01`. Dates therefore never trigger this warning, and the targets that do are
> the ones the organizer names themselves - sections, tiers, and their own multi-select questions.
> A date heading the organizer wrote by hand is still resolved on the reconciliation screen, which
> is that screen's job rather than this warning's.

Today the product splits on commas anyway and produces fragments, every one of them reported as
"did not match your market" with no explanation of why.

**At the mapping step, when a target's offering contains any label with a comma and a single
comma-split column is mapped to it, say that the column cannot be split reliably, and why.**

**Warn, do not block.** The value-reconciliation screen already refuses to advance until every
unmatched value is resolved by hand, so nothing wrong imports silently either way. Blocking would
strand an organizer whose only copy of the data is that file. The warning turns mystery fragments
into an explained choice, and names the two fixes they can actually make: re-export the question as
a grid, or rename the options.

**Do not try to parse it.** Greedy matching of the offering's labels against the raw cell was
considered and rejected in
[ticket 05](../../../wayfinding/readable-journey/issues/05-match-before-splitting.md): organizers
name tiers and sections freely, so `Gold` inside `Gold Plus` breaks longest-match, and the failure
is silent and wrong rather than loud and right.

## Acceptance criteria

- [ ] A single column mapped to a target whose offering has comma-bearing labels produces a warning
      at the mapping step, naming the target and the reason.
- [ ] A **grid** mapping produces no warning - the option comes from the header and nothing is
      split. This is the shape the real Fall 2025 export uses and it must stay quiet.
- [ ] A single column mapped to a target whose labels contain no commas produces no warning.
- [ ] The warning does not prevent advancing to the preview.

## Notes

The finding that prompted this came from a synthetic fixture that used a shape Google Forms does not
produce for that question; the real export uses the grid path and never hits it. The case is still
producible, which is why this exists, but it is **not** on the common path. Size the work
accordingly.
