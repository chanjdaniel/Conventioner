---
layer: business
kind: rule
describes:
  - back-end/guards.py#ResponsesImportedGuard
  - back-end/guards.py#PASSED_THROUGH
  - back-end/guards.py#path_moves
  - front-end/src/utils/marketGuide.ts#pathTransitionLabel
verified: 2026-10-22
sources:
  - brain-dump/2026-10-19#1
  - brain-dump/2026-10-19#4
  - brain-dump/2026-10-19#19
  - brain-dump/2026-10-19#20
  - E32/F02/S01
  - E32/F02/S02
---

# Review needs an import

On the Google Form path, Begin Review is refused until at least one response has been imported: "Nothing has been imported yet. Import your Google Form's responses first.", with "Import responses" as the fix.
The import is that path's collection, so the moves around it are the import's: "Import responses" leaves draft and lands on the import, and "Import more responses" takes a market in review back to importing in one move, every verdict kept.

**Serves:** [Vendors come in from the organizer's own Google Form](../intents/vendors-come-in-from-the-organizers-own-google-form.md) and [The market's phase says what to do next](../intents/the-markets-phase-says-what-to-do-next.md).

## Why

An organizer on the Google Form path already holds the responses when the market leaves draft; there is no form of the market's own taking applications, so a review with nothing imported is a review of nothing.
For the same reason "the form is closed" is never a stage of theirs: the path reads Draft, Import, Review, and Begin Review from Import is one move that steps through `applications_closed` rather than stopping there.

**"Import responses" moves the market at the click** (`draft -> applications_open`) and lands on the import, so the step that leaves draft is the step that brings vendors in.
"Reopen for Editing" undoes it while nothing has been imported, and is refused once anything has: "N applications are already in, so this market cannot return to draft. The questions are fixed once anyone has applied or been imported." ([the form locks at the first application](the-form-locks-at-the-first-application.md)).

**A late export is "Import more responses"**, under More… on the rail in Review: one move back through `applications_closed` to importing, where the later export is brought in ([H2j](../flows/import.md#h2j-import-after-review-has-begun)).
No move touches an application, so every verdict given so far stays; what a re-import does to an application already here is [ADR 0011](../../adr/0011-re-import-upserts-on-market-and-email.md).
Review itself offers no import: importing while applications are being decided would change who has applied under the reviewers.

A market whose vendors apply on its own page is never asked: nobody imports into one, and its review begins with whatever has arrived.

## Who may

The moves are an Admin's, as every phase move is ([what each role may do](what-each-role-may-do.md)).

## Where it is kept

- `ResponsesImportedGuard` in [`back-end/guards.py`](../../../back-end/guards.py) is on `applications_closed -> review`, the edge both routes into review cross, so a Google Form market stepping through the closed phase and one already standing in it meet the same rule; it passes for a form market and for any market with an application ([the guards and the phase move](../../implementation/modules/guards.md)).
- `PASSED_THROUGH` names `applications_closed` for the Google Form path, and `path_moves` turns that into Begin Review as one move of two steps, and back from review a move of two steps to importing; the market read serves both, and the rail keeps no copy.
- `pathTransitionLabel` in [`front-end/src/utils/marketGuide.ts`](../../../front-end/src/utils/marketGuide.ts) names the moves on this path: "Import responses" from Draft, "Import more responses" back from Review.
- How the screens show it is [the lifecycle](../flows/lifecycle.md) and [the Google Form path](../flows/the-google-form-path.md).
