# 04: CSV column mapping - UX and persistence

Type: prototype
Status: resolved
Blocked by: none

## Question

A Google Forms export has arbitrary headers written by the organizer ("Which days can you attend?").
Charting settled that the organizer maps columns onto the essential-fields contract rather than matching a fixed template.
This ticket decided what that looks like.

## Answer

### Decided before prototyping

- **A dedicated full-width multi-step flow** - upload, map, preview, confirm - reached from the market's applications area. Not a modal and not another section inside `MarketSetupView`, which already carries dates, sections, tiers, priorities and the form builder. Mapping a dozen columns and then reviewing per-value mismatches is too dense for a dialog.
- **The mapping is stored on the market** and pre-filled on re-import, with changed or vanished headers flagged rather than silently re-matched by position. Re-import is the expected case (ticket 05), not the exception.
- **Refuse at the mapping level, tolerate at the row level.** An unmapped required target imports nothing. A single malformed row does not block the other two hundred: the preview shows invalid rows and their reasons *before* committing, and the organizer imports the valid ones or cancels and fixes the source.
  Note the interaction with ticket 02, which rejects incomplete applications before the solver runs - importing broken rows only defers the failure to a worse moment.
- **Cell values auto-match; only unmatched values are hand-mapped.** The distinct values in a column are a small enumerable set, so the organizer is shown precisely the three that could not be placed rather than auditing all forty. This handles the common real case where the form said `Gold Tier` and the market says `Gold`.
- **The `Timestamp` column is an ordinary mapping target**, auto-detected, warning rather than blocking when unmapped. Handed here by ticket 03: `submitted_at` must hold real submission time or a first-come-first-served priority rule silently does nothing.

### The shape: A's ledger, with B's parts

Three variants were built and driven in a browser (see Prototype below).

**Structure comes from A, the column ledger**: one row per CSV column in file order, a "Maps to" select on each row, and a right rail tracking required-target coverage.
A checkbox grid is shown as a banner row with a group-level select and its member columns indented beneath it.

**Two things are taken from B, the target board:**

1. **Explicit shape labels on multi-column targets** - `3 columns · one per option (checkbox grid)` versus `1 column · values split on commas`. This was the clearest treatment of the one-target-many-columns problem in any of the three, and that problem is the one a naive design gets wrong.
2. **Unmatched-value fixes inline, in the row that owns them.** A exiled these to a right rail far from the column they concern; B put them in the owning slot, which is where the organizer is already looking.

C's confidence scoring on candidate columns is worth keeping as a smaller borrowing.

### Why A won, and what it cost

**The pre-fill decision decides the layout.** A filled ledger is scannable - the eye goes to the exceptions - so pre-fill *helps* A. It *undercuts* both alternatives, because their structure is built around the act of assigning:

- B's board opened fully populated, its column pool reading "0 unassigned. Every column is placed." and its left rail an empty panel. The pairing affordance is invisible until you remove a chip.
- C was worse: it opened at "11 of 11 answered", making an eleven-question walkthrough pure ceremony.

Since re-import is the common case rather than the edge case, that asymmetry outweighed C's better first-run experience.

**Cost of the choice**: A is the least guided of the three, so a first-time organizer gets less hand-holding. C's confidence scores are the cheap mitigation.

## Prototype

**Captured on the branch `prototype/csv-mapping` (commit `ce195be9`), which is not merged and must not be.**
It is the primary source behind the decision above; the working tree on `dev` carries none of it.

To drive it: `git checkout prototype/csv-mapping`, then `cd front-end && npm run dev`, then `/prototype/csv-mapping?variant=A|B|C`.
The route is `meta: { public: true }` so no login is needed, and the floating switcher cycles with the arrow keys.

**Do not promote this code.** It was written under prototype constraints - no tests, no error handling, no backend - so E01 rewrites the winning shape properly rather than lifting it.

Two defects observed while driving it, both cosmetic and both in prototype-only code: A's "Available dates (accepts many columns)" select clips its text under the chevron, and the variant switcher overlaps the Vue DevTools button at bottom-centre.

Unblocks ticket 05.
