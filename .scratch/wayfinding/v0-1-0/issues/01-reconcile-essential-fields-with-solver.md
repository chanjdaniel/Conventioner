# 01: Reconcile the essential-fields contract with the solver's inputs

Type: grilling
Status: resolved
Blocked by: none

## Question

`back-end/essential_fields.py` is documented as the single owner of "the answers the assignment algorithm reads directly", and declares five: email, available dates, max dates wanted, ranked section preference, ranked table-type preference.

That claim was false.
The two contracts were designed independently and never reconciled.
What the solver actually read, established by reading the consumption sites:

| Solver input | Source | Essential equivalent |
| --- | --- | --- |
| Vendor email | `email_col_name_idx` | `essential_email` |
| Max days | `max_days_col_name_idx` (optional) | `essential_max_dates` |
| Per-date answer | one column per market date | **semantically different** |
| `table_choice` (full/half/either) | `table_choice_col_name_idx` | **no source** |
| `table_share_email` (partner) | `table_share_email_col_name_idx` | **no source** |
| Priority ordering | arbitrary columns + `enum_priority_order` | no source (ticket 03) |
| - | - | `essential_section_ranking` **unconsumed** |
| - | - | `essential_table_type_ranking` **unconsumed** |

Decide the full field set the solver reads, and therefore what the essential contract must become.

## Answer

**The essential contract becomes seven fields, and every one is read by the solver.**
That property is the point: the contract's justification is that it names the answers the solver reads, so a field it does not read does not belong in it, and a field the solver reads that is missing from it is a defect.

| Field | Required | Solver semantics |
| --- | --- | --- |
| `essential_email` | yes | vendor identity |
| `essential_available_dates` | yes | plain availability - which market days the vendor can attend |
| `essential_tier_preference` | yes | **hard filter**: the set of tiers the vendor accepts |
| `essential_max_dates` | yes | cap on days assigned |
| `essential_section_ranking` | yes | **placement preference**, total ranking, best first |
| `essential_table_type_ranking` | yes | placement preference; **stubbed in MVP** (see below) |
| `essential_table_choice` | yes | full table / half table / either |
| `essential_table_share_email` | **no** | preferred table-sharing partner; empty is normal |

### Decisions

- **Table sharing is in the MVP.** A vendor may name a partner by email; the field is optional.
  An applicant who names nobody and receives a half table may be paired with a stranger - which is already the implemented fallback (`assignment.py:456-470`).
- **`table_choice` is in the MVP.** The half-table model depends on it: every table holds one full-table vendor or two halves.
- **Both become essential fields.** A first-class `Application`-to-`Application` reference is the better eventual model for sharing, but needs identity resolution CSV rows do not have (ticket 05).
- **The per-date answer is split in two.** It was a string of acceptable *tiers* per date, substring-matched against the table's tier. It becomes plain per-date availability plus one global tier question.
  Rejected: preserving per-date tier selection. It is more expressive, but forces the applicant UI into a dates x tiers grid and multiplies ticket 04's mapping problem, for a case that is rare - a vendor wanting different tiers on different days.
- **Tier filters; section prefers.** Tier is a hard constraint: a vendor is never placed at a tier they did not accept, even if that leaves them unassigned, because **the tier determines the price the applicant pays for a table on a given day**. Section is a soft placement preference.
- **Preferences are honoured as placement preference** (not an optimisation objective, not a tie-break): when a vendor can go in several sections, they get their highest-ranked one still available, and no vendor goes unassigned merely because a preferred section filled up.
  This follows necessarily from #45 making rankings *total* - a permutation of the offering excludes nothing, so a ranking cannot be a filter.
- **Section preference is wired into the solver.** No new data is needed: `Table` already carries its `SectionObject`.
- **Table type is per-table, not per-section.** Any table in any section may be any type, so only a floorplan can truly describe it. Rejected: adding `table_type` to `SectionObject`, which would have been symmetric with `tier` and `location` but is domain-wrong.
  **MVP stubs table type to a single hard-coded type**, and the question is not asked while fewer than two types exist. The field and the solver's handling of it stay in place; only a real offering is missing until the floorplan ships.

### Consequences

- **Two fields shipped in #45 change meaning**, and `essential_available_dates` keeps its shape while losing its tier semantics. `essential_table_type_ranking`'s offering stops deriving from the latest floorplan.
- **A latent defect is designed out rather than ported.** The tier check was `table.tier.name in <vendor's answer string>`, a substring match: a tier named `A` matched an answer of `AB`. Set membership over an explicit tier list has no such failure.
- **The largest implied work is inverting the assignment loop.** The solver is table-driven - it walks tables and picks the highest-priority valid vendor for each (`get_valid_vendor:430`). Honouring a vendor's own section ranking requires that ranking to influence which table they reach, which means inverting that loop or adding a pre-pass. Expect existing assignment outputs to move and solver tests to churn. Recorded on ticket 02.
- **Ticket 02 is unblocked** and now has a fixed field set to model.

### Backlog

Nothing created yet; E01 and E02 remain blocked on tickets 04/05 and 02/03 respectively.
The stub is recorded on the map so it is not later mistaken for an oversight.
