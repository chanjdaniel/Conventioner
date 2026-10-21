---
layer: business
kind: rule
describes:
  - back-end/application_write.py#record_application_answers
  - back-end/essential_fields.py#validated_essential_answers
verified: 2026-10-22
sources:
  - wayfinding/real-market-readiness/03
  - wayfinding/claims-and-room/03
  - wayfinding/readable-journey/05
  - E01/F06
  - E26/F02/S03
  - E26/F03/S01
  - bug/24
  - bug/29
  - bug/45
---

# What an import may leave unasked

"Number of dates you want" is required of an applicant online, and not of an imported row: no answer is an answer, meaning no personal limit.
Such a vendor is bounded by the dates they can attend and the organizer's ceiling ([the ceiling on dates per vendor](max-assignments-ceiling.md)).

Every other question the market asks is required of an import as of an applicant ([an incomplete application refuses the run](an-incomplete-application-refuses-the-run.md)).
A question the market does not ask is no import target at all: a ranking of one section, or a question whose offering is empty, has no column to map, since a column mapped to it would be thrown away (`import_targets` reads `asked_essential_keys()`).
A ranking or the request, on either path, can instead be switched off for the whole market, which stops it being asked at all ([essential fields](../../implementation/modules/essential-fields.md)).

**Serves:** [Vendors come in from the organizer's own Google Form](../intents/vendors-come-in-from-the-organizers-own-google-form.md) and [Every approved vendor gets a table by the market's rules](../intents/every-approved-vendor-gets-a-table-by-the-markets-rules.md).

## Why

Most real Google Forms never asked how many dates a vendor wants (bug 24).
Refusing those rows made the import unable to take a real organizer's responses; inventing a limit would answer for the vendor.
The online form always asks, so an applicant always answers.

**Only a ranking may be switched off, and the request.**
The solver gives a vendor their best-ranked option still open and never excludes anyone for a ranking, so a ranking nobody was asked, stored empty and alike for everyone, changes nothing but the tie-break; the solver never reads the request at all.
Available dates, tier preference and table choice decide where or whether a vendor is placed, so a default there would invent a commitment the applicant never made, and the solver would act on it.
Giving every applicant the same ranking without recording that nobody was asked was rejected: it puts a made-up answer where the applicant's own answers live, which is what [an incomplete application refuses the run](an-incomplete-application-refuses-the-run.md) exists to prevent.

**It is recorded on the market's form, not on the import's mapping**: whether a market asks vendors to rank its sections is a fact about the market, and must hold for its own application page too.
A question switched off stays off through later edits of the form, and the applicant form then asks no ranking (bugs 29 and 45).
On the form it is read by `asked_essential_keys()`, so which questions are asked stays one statement, read by the applicant's validator, the import and the solver alike.

A tier is still a property of a section, so a market offering three tiers needs three sections, and still asks the tier question.

## Where it is kept

- The import's only door to it is `record_application_answers(imported=True)` in [`back-end/application_write.py`](../../../back-end/application_write.py), the write every row of [the CSV import](../../implementation/modules/csv-import.md) goes through, which validates with `limit_required=False`; the applicant path never passes it.
- `validated_essential_answers` in [`back-end/essential_fields.py`](../../../back-end/essential_fields.py) then stores the missing answer as `None`, and the solver reads `max_dates` None as no personal limit ([the assignment solver](../../implementation/modules/assignment-solver.md)).
- The switch is `unaskedEssentials` on the application form, held to `UNASKABLE_ESSENTIAL_KEYS` by `unaskable_essential_error` ([essential fields](../../implementation/modules/essential-fields.md)); from the import, "Stop asking it" switches one off through [the form amendment](../../implementation/modules/form-amendment.md) while nobody has applied ([importing a Google Form's responses](../flows/import.md#h2f-stop-asking-a-preference-the-form-never-asked)).
- The cases are `test_no_personal_limit_is_bounded_by_the_market_cap` and `test_no_personal_limit_and_no_cap_is_every_date_they_can_attend` in [the assignment behaviour suite](../../implementation/testing/assignment-behaviour-suite.md).

## Evidence

The re-walk of 2026-10-03 imported two real Google Form exports into markets with two sections and no section question; neither import stopped, and on the first the section preference, switched off, stayed off.
