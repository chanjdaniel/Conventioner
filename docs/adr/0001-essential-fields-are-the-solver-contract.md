---
layer: implementation
kind: adr
verified: 2026-10-21
status: accepted
---

# Essential fields are exactly what the solver reads

The essential-question set and the assignment solver's inputs were designed independently and had drifted apart: the solver read a table-choice and a table-sharing partner that no essential question supplied, while two essential questions it ranked - section and table type - were read by nothing.
The per-date question had also diverged in meaning, storing plain availability on one side and a substring-matched string of acceptable tiers on the other.
We decided that the essential set is defined *by* what the solver reads: an input the solver reads must have an essential question, and a question about placement that the solver ignores does not belong in the set.
Three essential questions are not about placement, and the solver does not read them: the full name and the preferred name, since every market must know whom it places, and the vendor's request, which is for whoever stands at the door.
Every solver input (`SOLVER_RELEVANT_KEYS` in `back-end/essential_fields.py`) is answered by an essential question; the table-share question's one answer fills two of them, `essential_table_share_email` and `essential_table_share_also`.

## Consequences

- `essential_table_choice` and an optional `essential_table_share_email` are added; the per-date question splits into plain availability plus one global tier question.
  The table-share answer is read into a first address and any further ones (`essential_table_share_also`), both solver inputs.
- **Tier filters, section prefers.** Tier is a hard constraint because it determines what the applicant pays for a table on a given day, so a vendor is never placed at a tier they did not accept, even if that leaves them unassigned. Section is a placement preference: a vendor gets their highest-ranked section still available, and is never left unassigned merely because a preferred section filled up.
- Rankings are *total* (a permutation of the offering), which excludes nothing - so a ranking can only ever be a preference, never a filter. That is why section cannot be enforced the way tier is.
- Honouring section preference inverted the solver's table-driven loop into a vendor-driven one (`best_table_for` in `back-end/assignment/assignment.py`), which moved existing assignment outputs.
- The tier substring match (a tier named `A` matched an answer of `AB`) is designed out rather than ported, since set membership replaces it.

## Considered and rejected

- **Per-date tier selection**, preserving today's shape. More expressive, but forces the applicant UI into a dates x tiers grid and multiplies the CSV mapping problem by the same factor, for a case that is rare.
- **Adding `table_type` to `SectionObject`**, which would have been symmetric with the `tier` and `location` a section already carries. Rejected as domain-wrong: table type is a property of an individual table, and any table in any section may be any type, so only a floorplan can describe it. Table type is stubbed to a single type until the floorplan ships.
- **Demoting section and table-type rankings to ordinary custom fields**, which would also have made the contract true. Rejected because both are real vendor preferences worth honouring; the contract was fixed by teaching the solver to read them rather than by dropping them.
