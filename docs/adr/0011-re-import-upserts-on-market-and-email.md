---
layer: implementation
kind: adr
describes:
  - back-end/csv_import.py#_would_return_to_review
  - back-end/csv_import.py#_merge_shape
  - back-end/essential_fields.py#solver_relevant_change
verified: 2026-10-29
sources:
  - wayfinding/v0-1-0/05
  - E01/F03
  - E01/F03/S02
  - E01/F03/S03
  - E32/F02/S02
  - E01
  - bug/34
  - bug/40
status: accepted
---

# A re-import upserts on the market and the address

The glossary concept: [Application](../business/concepts/application.md).

## Context

An organizer imports the same Google Form more than once: the form keeps collecting after the first import, a bad mapping needs redoing, a vendor emails a correction.
By the second import some of those applicants have been reviewed, and a verdict, its giver, a follow-up and a reviewer's hold all live on the application.

The store already says who an applicant is: the unique index on `(market_id, applicant_email, application_type)` allows one main application per address per market ([the application document](../implementation/data/application-document.md#indexes)).
Appending a second application for an address the market already holds is therefore not available, and replacing the market's applications wholesale would destroy every verdict and rotate the ids the review reads.
`find_or_create_application` writes the answers only on insert, so a re-import riding the create path would silently keep every existing applicant's old answers.

## Decision

**A re-import updates each row's main application by the market and the address, and creates one only for an address the market does not hold.**

- **An approved application returns to review only when an answer the solver reads changed** (`_would_return_to_review` in [`back-end/csv_import.py`](../../back-end/csv_import.py), through `solver_relevant_change` in [`back-end/essential_fields.py`](../../back-end/essential_fields.py)).
  A corrected business name or Instagram handle keeps the verdict; a changed availability, tier or table choice sends the vendor back to `open`, because the approval was given on constraints that no longer hold and the solver would otherwise place someone against answers nobody accepted.
  Both sides are compared after normalisation, so a re-export that only reformats a value changes nothing (bug 40); an applicant whose answers are unchanged is not written at all.
- **An application absent from the new file is left exactly as it is**, and counted (`_merge_shape`).
  Absence almost always means the organizer exported a filtered or partial range, not that the applicant withdrew.
- **The preview says all of it before anything is written**: how many are new, updated and unchanged, how many approved applications will return to review because their answers changed, and how many existing applications are not in the file ([importing a Google Form's responses](../business/flows/import.md#h2h-import-a-later-export)).
- **An applicant listed twice in one file is one application**, judged on their latest row and dated by their first (bug 34).
- **An application does not record that it arrived by import.**
  A market takes its vendors one way ([intake mode decides how vendors arrive](../business/rules/intake-mode-decides-how-vendors-arrive.md)), so a `source` field would always equal the market's intake mode, a second copy of a stored fact.

Rejected:

- **Keeping the verdict whatever changed**, which lets an edited answer slip past review entirely.
- **Returning every re-imported application to review**, which can un-approve fifty vendors mid-review and make the organizer redo all of it.
- **A "changed since review" flag beside a kept verdict**: honest, but a flag state and a screen to act on it, for a case the preview already shows.
- **Treating an absent row as a withdrawal**: it would destroy review state on a guess; `cancelled` is for a real withdrawal, which is a deliberate act.

## Consequences

- An application's id, verdict and history survive every import, so a reviewer's work is never undone by a correction that does not touch placement.
- **The set of answers that reopen a review is `SOLVER_RELEVANT_KEYS`**, the essential questions the solver reads ([essential fields](../implementation/modules/essential-fields.md)).
  A custom answer never reopens one, including an answer a priority rule orders by.
- **A late export is a Redo import in Review** (`IMPORT_PHASES`, [the CSV import](../implementation/modules/csv-import.md)): the whole file is read again while the review goes on, so this answer is what keeps rows changing beneath a reviewer harmless, every verdict kept except an approval whose solver answers changed ([review needs an import](../business/rules/review-needs-an-import.md), E38/F04/S03).
  Importing stopped when review began until the import and the review became one stage ([ADR 0016](0016-one-stage-for-applications-and-review.md)).
- Two concurrent writes can still meet on one application; a verdict is written only on the answers the reviewer saw (`if_unchanged_since`), so a re-import's new answers are never approved unseen.
- When a market can take vendors both ways at once, the `source` field becomes a fact of its own; nothing needs it before then.
- So the application does not record that an imported address is the file's word rather than proven by a sign-in code; the intake mode says it, and what to do with it is settled before any mail but a sign-in code is sent ([an imported email is asserted](../business/rules/an-imported-email-is-asserted.md)).
