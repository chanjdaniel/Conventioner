---
layer: business
kind: rule
describes:
  - back-end/application_write.py#record_application_answers
  - back-end/essential_fields.py#validated_essential_answers
verified: 2026-10-22
sources:
  - E26/F02/S03
  - bug/24
---

# What an import may leave unasked

"Number of dates you want" is required of an applicant online, and not of an imported row: no answer is an answer, meaning no personal limit.
Such a vendor is bounded by the dates they can attend and the organizer's ceiling ([the ceiling on dates per vendor](max-assignments-ceiling.md)).

Every other question the market asks is required of an import as of an applicant ([an incomplete application refuses the run](an-incomplete-application-refuses-the-run.md)).
A ranking or the request, on either path, can instead be switched off for the whole market, which stops it being asked at all ([essential fields](../../implementation/modules/essential-fields.md)).

## Why

Most real Google Forms never asked how many dates a vendor wants (bug 24).
Refusing those rows made the import unable to take a real organizer's responses; inventing a limit would answer for the vendor.
The online form always asks, so an applicant always answers.

## Where it is kept

- The import's only door to it is `record_application_answers(imported=True)` in [`back-end/application_write.py`](../../../back-end/application_write.py), the write every row of [the CSV import](../../implementation/modules/csv-import.md) goes through, which validates with `limit_required=False`; the applicant path never passes it.
- `validated_essential_answers` in [`back-end/essential_fields.py`](../../../back-end/essential_fields.py) then stores the missing answer as `None`, and the solver reads `max_dates` None as no personal limit ([the assignment solver](../../implementation/modules/assignment-solver.md)).
- The cases are `test_no_personal_limit_is_bounded_by_the_market_cap` and `test_no_personal_limit_and_no_cap_is_every_date_they_can_attend` in [the assignment behaviour suite](../../implementation/testing/assignment-behaviour-suite.md).
