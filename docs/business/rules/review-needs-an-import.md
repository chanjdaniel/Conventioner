---
layer: business
kind: rule
describes:
  - back-end/guards.py#ResponsesImportedGuard
  - back-end/csv_import.py#first_import_blockers
  - back-end/csv_import.py#enter_review
  - front-end/src/utils/marketGuide.ts#stageActions
verified: 2026-10-31
sources:
  - brain-dump/2026-10-19#1
  - brain-dump/2026-10-19#4
  - brain-dump/2026-10-19#19
  - brain-dump/2026-10-19#20
  - E32/F02/S01
  - E32/F02/S02
  - E38/F04/S01
  - E38/F04/S03
---

# Review needs an import

On the Google Form path a market enters Review by its first import, confirmed and written, and in no other way: the move from Draft is refused until a response has been imported, "Nothing has been imported yet. Import your Google Form's responses first.", with "Import responses" as the rail's fix.
A late export is a "Redo import" under the rail's More…, which reads the whole responses file again while the market stays in Review.

**Serves:** [Vendors come in from the organizer's own Google Form](../intents/vendors-come-in-from-the-organizers-own-google-form.md) and [The market's phase says what to do next](../intents/the-markets-phase-says-what-to-do-next.md).

## Why

An organizer on the Google Form path already holds the responses when the market leaves draft; there is no form of the market's own taking applications, so a review with nothing imported is a review of nothing, and the import is what begins it ([ADR 0016](../../adr/0016-one-stage-for-applications-and-review.md)).

**The first import takes the move itself.**
The import runs in Draft, and before it reads a row it judges the move into Review less its own wait, so a setup that would keep the market out ("This market has no location. …") is said on the import before a file is picked, and nothing is written.
Once the rows are written the import takes `draft -> applications` through the one judged move, under the person importing; leaving the import before that keeps the market a draft.
Market Setup settles at that moment, as on leaving Draft by any move ([the setup settles on leaving draft](the-setup-settles-on-leaving-draft.md)).
"Reopen for Editing" is refused once anything has been imported: "N applications are already in, so this market cannot return to draft. The questions are fixed once anyone has applied or been imported." ([the form locks at the first application](the-form-locks-at-the-first-application.md)).

**A late export is "Redo import"**, which opens the import; the page says the whole file is read again, new rows added and changed ones updated, and the market stays in Review ([H2j](../flows/import.md#h2j-import-after-review-has-begun)).
No move touches an application, so every verdict given so far stays, except as [ADR 0011](../../adr/0011-re-import-upserts-on-market-and-email.md) says of a changed answer the assignment reads.
The review screen offers no import on either path: on this one the import is the rail's, and an own-form market takes nothing from a file.

A market whose vendors apply on its own page is never asked: nobody imports into one, and it enters the stage by opening applications.

## Who may

Importing and moving the market are an Admin's ([what each role may do](what-each-role-may-do.md)); an Editor is offered no "Import responses" and no "Redo import", and the import itself says why.

## Where it is kept

- `ResponsesImportedGuard` in [`back-end/guards.py`](../../../back-end/guards.py) is on `draft -> applications`, an entry invariant of the stage; it passes for a form market and for any market with an application ([the guards and the phase move](../../implementation/modules/guards.md)).
- `first_import_blockers` and `enter_review` in [`back-end/csv_import.py`](../../../back-end/csv_import.py) judge the move before the import writes and take it after ([the CSV import](../../implementation/modules/csv-import.md)).
- `stageActions` in [`front-end/src/utils/marketGuide.ts`](../../../front-end/src/utils/marketGuide.ts) offers "Redo import" in Review to an Admin.
- How the screens show it is [the lifecycle](../flows/lifecycle.md) and [the Google Form path](../flows/the-google-form-path.md).

## Superseded

"Import responses" once moved the market into an Import phase at the click, Begin Review stepped through Applications Closed into Review, and "Import more responses" walked back to importing (E32/F02/S01, E32/F02/S02); the three phases are one stage now, entered by the first import (E38/F04).
