---
layer: business
kind: flow
verified: 2026-10-22
sources:
  - wayfinding/real-market-readiness/map
  - brain-dump/2026-10-19#1
  - brain-dump/2026-10-19#2
  - brain-dump/2026-10-19#3
  - brain-dump/2026-10-19#4
  - brain-dump/2026-10-19#19
  - brain-dump/2026-10-19#20
  - E24
  - E26
  - E30/F02/S01
  - E31/F03/S01
  - E32/F02
  - E33/F02/S01
  - bug/2
  - bug/3
  - bug/4
  - bug/23
  - bug/24
---

# The Google Form path

A path is one way of running a market from start to finish; this one is for an organizer whose vendors apply on the organizer's own Google Form, so the market's applications come in as that form's exported responses.
**Who:** the organizer, signed in, in an organization.
**Where they start:** the Markets list.
**Serves:** [Vendors come in from the organizer's own Google Form](../intents/vendors-come-in-from-the-organizers-own-google-form.md) and [The market's phase says what to do next](../intents/the-markets-phase-says-what-to-do-next.md).

The path reads Draft, Import, Review, Assignment, Market Days, Archived on the phase rail ([the lifecycle](lifecycle.md)): the organizer already holds the responses when the market leaves draft, so the upload is the collection, and nothing asks them to open or close applications.
"Import responses" leaves draft and lands on the import, Begin Review waits until something has been imported, and a late export is brought in with "Import more responses" from Review, every verdict kept ([review needs an import](../rules/review-needs-an-import.md)).
Every move lands on its phase's page, and a blocked step offers its fix as the main button.
Its two variants differ only in where the plan and the form come from.

## P1. CSV intake, form built by hand

**Task:** "You collect applications with your own spreadsheet. Set up this year's market, bring in the applications, choose who gets in, give them tables, and run check-in on the day."

**Status:** Works (re-walked live on 2026-10-03 with the 2023 export, through assignment; since E32/F02 the path is walked from creation to the result by `market-journey.spec.ts`).
On the re-walk the plan's sections had no tier and the file had no "how many days" column, the two conditions that stopped it on the usage run (bugs 23 and 24).
277 of the file's 294 rows imported: ten repeat submissions folded into each applicant's latest row, and seven blank rows were skipped as blank; all 277 approved vendors were placed.
Every column but Timestamp and Email Address was mapped by hand ([H2a](import.md#h2a-first-import-everything-maps)).

| Step | Flows |
| --- | --- |
| Account and organization | [A2](accounts.md#a2-sign-in-and-sign-out), [B1](organizations.md#b1-create-an-organization) |
| Create the market, choosing "On my own Google Form", and cancel its upload step to build the form by hand | [D1](creating-a-market.md#d1-create-a-market-from-scratch), [G6](starting-from-a-google-form.md#g6-cancel) |
| Plan it by hand (or from a floorplan, [E6](planning.md#e6-sections-from-a-floorplan)) | [E1 to E4](planning.md) |
| Write the questions, and set up the review | [F1](form-tab.md#f1-the-essential-questions), [F2](form-tab.md#f2-custom-questions), [F3](form-tab.md#f3-what-a-reviewer-reads-first) |
| Leave draft with "Import responses", which lands on the import; fix the mapping and the values as needed | [H2a to H2j](import.md) |
| Begin Review, one move, and review | [I4](review.md#i4-begin-review), [I1](review.md#i1-work-through-the-queue), [I2](review.md#i2-change-a-decision) |
| Begin Assignment | [I5](review.md#i5-begin-assignment) |
| Assign and adjust | [J1 to J5](assignment-and-result.md), [J6 to J10 and J13](placing-by-hand.md), [J11 and J12](vendors.md) |
| Publish the market and run market day | [K1 to K5](market-day-door.md) |
| End the market | [L1](ending-and-managing-a-market.md#l1-archive-after-market-days) |

## P2. CSV intake, started from last year's Google Form

**Task:** "You ran this market last year with a Google Form. Use last year's responses to set this year's market up, then bring in this year's responses and run it."

This is the MVP's headline path: "an organizer can take a real Google Forms export from a real market through to a correct, published assignment".

**Status:** Works (re-walked live on 2026-10-03 with the March 2026 export, from creation to archive).
On the re-walk the proposal restored all 29 columns, and the first import previewed 225 of 250 rows where the usage run imported none (bugs 2, 3 and 4).
The 25 it skipped were a blank row, malformed and test rows, and applicants whose only answers were options left out on the proposal of a required question; G4 warned of those before confirming, and "Keep all" would have kept them.
Since E33/F02 the proposal marks no question required, so such an applicant is imported without that answer unless the organizer marks the question required, and the proposal then says how many it would cost ([G4](starting-from-a-google-form.md#g4-review-and-adjust-the-proposal)).
Since E30/F02/S01 the first import says its mapping is the start's: "Mapped when your form was started from this file."
The other four exports were not re-walked live; synthetic files of their shapes are held to a hand-written answer key in [`back-end/tests/test_csv_proposal.py`](../../../back-end/tests/test_csv_proposal.py).

| Step | Flows |
| --- | --- |
| Create the market, choosing "On my own Google Form", which lands on the upload | [D2](creating-a-market.md#d2-create-a-market-that-starts-from-a-google-form), then [G3 to G5](starting-from-a-google-form.md) (or [G2](starting-from-a-google-form.md#g2-from-an-existing-draft) from an existing draft) |
| Finish the plan the file cannot describe: locations, sections, table counts | [E3](planning.md#e3-locations), [E4](planning.md#e4-sections) |
| Adjust the generated questions, and set up the review | [F2](form-tab.md#f2-custom-questions), [F3](form-tab.md#f3-what-a-reviewer-reads-first) |
| Leave draft with "Import responses" and import this year's export: the mapping is the start's, so it should need no decisions | [H2a](import.md#h2a-first-import-everything-maps), [H2h](import.md#h2h-import-a-later-export) for later exports |
| Everything after | as P1 from "Begin Review" |

Intended at the import: every row that answers the required questions imports, "Full table" and "Half table" match the table choices, and ticked certification boxes read as ticked.

## The rules it obeys

- [Intake mode decides how vendors arrive](../rules/intake-mode-decides-how-vendors-arrive.md): importing is this path's, in every phase it imports in.
- [Review needs an import](../rules/review-needs-an-import.md): the import is the collection, so review waits for one.
- [The setup settles on leaving draft](../rules/the-setup-settles-on-leaving-draft.md): the plan is complete before "Import responses".
- [No question is inferred required](../rules/no-question-is-inferred-required.md).
- [What an import may leave unasked](../rules/what-an-import-may-leave-unasked.md): a file with no "how many days" column imports with no personal limit.
- [A gated market answers as absent](../rules/a-gated-market-answers-as-absent.md): this market has no applicant pages.

Its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).

## Superseded

The path was to read Plan, Import, Review, Assign, Market days (brain-dump/2026-10-19#1); only the phases it imports in are renamed, "Import" and, for a market already standing in the closed phase, "Imported", and the others keep the names the online path reads (E32/F02/S01).
