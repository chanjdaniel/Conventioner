---
layer: implementation
kind: adr
describes:
  - back-end/csv_start.py#_example_columns
  - back-end/csv_proposal.py#kept_readings
  - back-end/csv_proposal.py#_names_someone
  - back-end/datatypes.py#ExampleColumn
verified: 2026-10-30
sources:
  - E38/F02
  - E38/F02/S01
status: accepted
---

# What of an applicant's answers the market may keep

## Context

Starting a market from its Google Form's responses read the file into a proposal and let it go: the file was "sent twice and stored never" ([the CSV proposal and start](../implementation/modules/csv-proposal-and-start.md)), and an applicant's answers lived only in their application.
Daniel's 2026-10-29 walk asked for the Questions tab to fill a question's options from that file after the start, and to add a question from a column the start left out, such as a team's own "Status" (E38/F02).
That needs what the file said of each column after the file is gone, so the market has to keep some of the applicants' answers outside their applications.
[ADR 0007](0007-what-may-be-sent-to-hosted-typesafe.md) had already measured which answers identify nobody: an answer at least 3 applicants share, holding no address, link, handle or phone number, since every identifying column of the five exports was near-unique.
It decided that rule for what may be sent to a third party, not for what may be stored.

## Decision

**The market may keep, of an applicant's answers outside their application, only the answers at least 3 applicants gave that name nobody, as a column's options; never a count, a row or who gave them.**

- The start's confirm ([`back-end/csv_start.py`](../../back-end/csv_start.py)) writes them as `exampleColumns` on the market, modelled as `ExampleColumn` in [`back-end/datatypes.py`](../../back-end/datatypes.py): for each column it made a question of the organizer's own or left out, its headings, the key its question has or would have, its label and help text, its type, and both readings of its answers as choices (`_example_columns`, `kept_readings`).
  Who applied, when, and the essential questions are not kept.
- A reading ([`back-end/csv_proposal.py`](../../back-end/csv_proposal.py)) keeps an option only when the Review step keeps it by default (at least `SHARED_BY`, 3, applicants chose it; for a multi-select, at least `OPTION_SHARE` of the answers) and `_names_someone` does not match it.
- `_names_someone` is wider than the proposal's `_identifying`, which stays the filter the rules were measured with: it also finds an address spelled out, a link without its scheme, a handle wherever its `@` sits, a 7-digit phone number and a street address, and of what reads as a phone number it frees only clock times, years, dates and ranges of numbers.
  `SHARED_BY` and that filter together are the guarantee; what no pattern sees (a bare name, a shop's name, a postal code) only `SHARED_BY` guards, and the module node lists it.
- The field is server-owned: only the start writes it, and a create body that carries it is stored without it.

## Consequences

- This reverses the start's stated invariant: the file is still never stored, but what it said of each kept column is.
- Everyone who may read the market reads `exampleColumns`, on the market's read and the Markets list; each of them already reads every application.
- A later import does not refresh it, since the form locks at the first application and nothing reads it after.
- Widening what may be kept narrowed what may be sent: a heading either filter matches is not sent to TypeSafe (ADR 0007's consequences).
- Keeping any other part of an applicant's answers outside their application, or keeping these under a weaker filter, is a new ADR that narrows this one.

## Considered and rejected

- **Keeping the file, or the whole column**: every critical column is near-unique, so the file is personal data the market does not need.
- **Keeping only the type-change readings of the questions the start made**: Daniel asked for a question to be added from a left-out column too, so those columns are kept, under the same filter.
- **No readings for free-text columns**: the riskiest to keep and the least useful as options, but the story asks for every column, and `SHARED_BY` with the filter leaves a free-text column's shared answers naming nobody.
