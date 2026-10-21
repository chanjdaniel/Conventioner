---
layer: implementation
kind: adr
verified: 2026-10-22
sources:
  - wayfinding/v0-1-0/01
  - wayfinding/real-market-readiness/02
  - wayfinding/the-order-of-the-work/04
  - wayfinding/the-order-of-the-work/map
  - E01
  - E02
  - E19
status: accepted
---

# Essential fields are exactly what the solver reads

The essential-question set and the assignment solver's inputs were designed independently and had drifted apart: the solver read a table-choice and a table-sharing partner that no essential question supplied, while two essential questions it ranked - section and table type - were read by nothing.
The per-date question had also diverged in meaning, storing plain availability on one side and a substring-matched string of acceptable tiers on the other.
We decided that the essential set is defined *by* what the solver reads: an input the solver reads must have an essential question, and a question about placement that the solver ignores does not belong in the set.
Three essential questions are not about placement, and the solver does not read them: the full name and the preferred name, since every market must know whom it places, and the vendor's request, which is for whoever stands at the door.
Every solver input (`SOLVER_RELEVANT_KEYS` in `back-end/essential_fields.py`) is answered by an essential question; the table-share question's one answer fills two of them, `essential_table_share_email` and `essential_table_share_also`.

The glossary concept: [Essential question](../business/concepts/essential-question.md).

## Consequences

- `essential_table_choice` and an optional `essential_table_share_email` are added; the per-date question becomes two answers that must agree, the dates a vendor is available and, per date, the tiers they accept.
  The table-share answer is read into a first address and any further ones (`essential_table_share_also`), both solver inputs.
- **One stored shape, one way of asking.** The applicant form asks the dates and tiers as one grid, a row per market date with its tiers and "Not available", the way a real Google Form asks it; no organizer setting chooses another shape, since two would mean two applicant forms, two sets of messages and two specs for answers the storage cannot tell apart.
  What is stored does not depend on how a form asked: `reconciled_dates_and_tiers` turns a grid, or one flat list of tiers, into the per-date answer and the list of dates, and the import calls the same function rather than keeping a copy.
  Stored answers were already in that shape, so nothing was migrated for it.
- **[Tier filters, section prefers](../business/rules/tier-filters-section-prefers.md).** Tier is a hard constraint because it determines what the applicant pays for a table on a given day, so a vendor is never placed at a tier they did not accept, even if that leaves them unassigned. Section is a placement preference: a vendor gets their highest-ranked section still available, and is never left unassigned merely because a preferred section filled up.
- Rankings are *total* (a permutation of the offering), which excludes nothing - so a ranking can only ever be a preference, never a filter. That is why section cannot be enforced the way tier is.
- Preferences are honoured as placement, not as an objective to optimise nor as a tie-break: among the tables a vendor may take, they get the best-ranked one still open.
- Honouring section preference inverted the solver's table-driven loop into a vendor-driven one (`best_table_for` in `back-end/assignment/assignment.py`), which moved existing assignment outputs.
- The tier substring match (a tier named `A` matched an answer of `AB`) is designed out rather than ported, since set membership replaces it.
- The contract is kept by [essential fields](../implementation/modules/essential-fields.md), and read by [the assignment solver](../implementation/modules/assignment-solver.md) through its one seam, `vendor_input.py`.

## Considered and rejected

- **Adding `table_type` to `SectionObject`**, which would have been symmetric with the `tier` and `location` a section already carries. Rejected as domain-wrong: table type is a property of an individual table, and any table in any section may be any type, so only a floorplan can describe it. Table type is stubbed to a single type until the floorplan ships.
- **A table-sharing partner as a reference from one application to another**, the better model in the end, but it needs every row to resolve to an application, which an imported row's typed address cannot promise; the partner is an essential answer holding an address instead ([table-share pairing](../business/rules/table-share-pairing.md)).
- **Demoting section and table-type rankings to ordinary custom fields**, which would also have made the contract true. Rejected because both are real vendor preferences worth honouring; the contract was fixed by teaching the solver to read them rather than by dropping them.

## Evidence

Read at the solver's consumption sites when the contract was reconciled: the solver read the vendor's address, an optional number of days, one answer per market date holding the tiers acceptable that day, a table choice and a sharing partner, and the organizer's priority columns.
Of those, only the address and the number of days had an essential question; the table choice and the partner had none, and the per-date answer meant tiers on the solver's side and plain availability on the form's.
The section and table-type rankings, both essential questions, were read by nothing.

## Superseded

- One tier question for the whole market, with per-date tier selection rejected as forcing the applicant into a dates by tiers grid for a rare case (wayfinding/v0-1-0/01).
  A real Google Form asks the tiers per day and promises the price per day, so the tiers are answered per date (wayfinding/real-market-readiness/02), and the applicant form asks them as that one grid (wayfinding/the-order-of-the-work/04).
