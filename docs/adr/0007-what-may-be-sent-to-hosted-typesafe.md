---
layer: implementation
kind: adr
describes:
  - back-end/typesafe_client.py
  - back-end/csv_proposal.py#_team_column_state
  - back-end/csv_proposal.py#_ceiling_state
  - back-end/csv_proposal.py#_shape
  - back-end/csv_proposal.py#_team_candidates
verified: 2026-10-22
sources:
  - wayfinding/the-form-started-from-a-csv/01
  - wayfinding/the-form-started-from-a-csv/02
  - wayfinding/the-form-started-from-a-csv/03
  - wayfinding/the-form-started-from-a-csv/04
  - wayfinding/the-form-started-from-a-csv/map
  - E24/F02/S03
status: accepted
---

# What may be sent to hosted TypeSafe

## Context

Starting a market from its Google Form's responses reads every column into a proposal ([the CSV proposal and start](../implementation/modules/csv-proposal-and-start.md)).
The rules decide almost everything from the values, but two judgements are left to text a rule reads badly: whether a free-text column after the form's last certain question is one of its questions or a column the organizer's team added, and what ceiling on days per vendor a heading states in words the rules do not recognise.
TypeSafe's hosted Jev model answers both better than the rules, measured on a held-out test set: 85% against 70% on the first, 95% against 50% on the second, with no costly error added and about a second a file.
Every local model that helped missed the budget set in advance on memory (none fit in 3 GB), so the help, if any, is a third party's.

A response export is personal data: names, addresses, Discord handles, links to timetables carrying student numbers, and other people's addresses in "who would you share a table with?".
Every critical column is near-unique, so no pattern list catches what identifies someone; uniqueness does.
And TypeSafe keeps what it is sent for no fixed period, with a right to derive telemetry from it.

## Decision

**What may be sent is ticket 01's rule, narrowed to what ticket 04 measured: a heading, how many answered, how many are distinct, and a shape - never a value.**
The tickets are the form-started-from-a-CSV map's, named in `sources`.

- A request is one column, never a row, so values from different columns never meet.
- The team-column question sends the column's heading, the share of rows that answered it, the share of answers that are distinct, and a typical answer's shape computed on the server ("email addresses", "links", "numbers", "prose, around 80 characters"); never an answer, not even a smallest or largest, since in a free-text column one value can be a phone or student number.
- The ceiling question sends the question's own text, which is the organizer's words.
- A heading that itself holds an email, link, handle or phone number is never sent, and its question is not asked.
- Ticket 01 also allowed the answers at least 3 applicants share; the 0.8 threshold was not measured with them, so none are sent.
- **The key is optional and never a boot requirement.** `TYPESAFE_API_KEY` is read through `configured_secret()` when asked for, never at import, so a blank or published placeholder is no key; no key means the rules alone.
- An answer is taken at probability 0.8 or above and never below, on the pinned model `jev-1.13.0`; a failure, a timeout past 5 seconds or an answer below the threshold leaves the rules' answer, and the row says why it is worth a look ("Couldn't reach TypeSafe", "Could be a column your team added").

## Consequences

- The organizer is told once, on the upload step, and only when a key is set: column headings and a description of the shape of their answers are sent to TypeSafe, and individual vendors' answers never leave Conventioner.
  There is no consent box, which would train organizers to click through a box about data that identifies nobody.
- [`back-end/csv_proposal.py`](../../back-end/csv_proposal.py) builds every state sent (`_team_column_state`, `_ceiling_state`, `_shape`, and the candidates in `_team_candidates`); [`back-end/typesafe_client.py`](../../back-end/typesafe_client.py) only carries it, over plain HTTP, since the SDK is pre-1.0 and needs a newer Pydantic than the back end runs.
- Sending a value later, for accuracy, means re-measuring the threshold with it and narrowing this ADR in a new one; the proposal's privacy view of values (answers at least 3 applicants gave) is for the rules on the server, not for TypeSafe.
- TypeSafe can only make a column less uncertain: it never overrides a confident rule, and its answer is a pre-filled choice the organizer sees and can change.
- [Releasing](../RELEASING.md#optional-hosted-typesafe) lists the variable for a deployment; it is not among the boot requirements.

## Considered and rejected

- **Headers plus a handful of values with personal-looking ones withheld**: no pattern catches a name, a business name or a bare handle.
- **The values several applicants share (ticket 01's own allowance)**: safe by uniqueness, but unmeasured at the threshold the answers are taken at.
- **A local model**: Kev-0.8B, the best, lifted the ceiling question to 90% but needed 4.5 to 5.4 GB beside the back end; it is the pick should one be wanted.
- **TypeSafe required**: nothing it helps with is worth refusing to boot, and the rules alone are a complete proposal.

## Evidence

Every column of the five exports was profiled in aggregate, no value printed: the direct identifiers (names, emails, Discord, business names, social links, per-second timestamps), the Drive links to proof of affiliation, the partners' addresses, the free text and the organizers' notes were each 0.91 to 1.00 unique, and only 7 to 16 values a column carried an `@`, so uniqueness separates them where patterns do not; option columns were 0.00 to 0.03 unique.
TypeSafe's own terms, checked against its documentation, give no fixed retention period and a perpetual right to derive telemetry from what it is sent, zero retention only for enterprise customers; its SDKs were two weeks old and pre-1.0.
The rules alone left two judgements: on wordings written blind by a session that never saw them, a team's column after the questions was told from a question 70% of the time, and a ceiling in prose read 50%.
On the held-out third, judged once at thresholds frozen beforehand, hosted Jev took them to 85% and 95%, added no costly error there or on the corpus's real headings, and answered a file's few questions in about a second, at a small fraction of a cent.
The local candidates either added nothing (Laya, whose own base checkpoints are near chance zero-shot) or helped only past the budget set in advance: Kev-0.8B and decider-2b lifted the ceiling to 90% in 3.7 to 5.4 GB of memory, and SemIf on a 4B model took about 30 seconds a file.
