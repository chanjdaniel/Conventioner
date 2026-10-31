---
layer: business
kind: flow
verified: 2026-10-31
sources:
  - wayfinding/the-order-of-the-work/11
  - E18/F02/S03
  - E18/F04
  - E31/F01/S01
  - E31/F02
  - E31/F03/S04
  - E32/F01/S01
  - E32/F02/S01
  - E18
  - bug/11
  - E38/F04/S01
  - E38/F04/S02
  - E38/F07/S02
---

# Taking applications

**Who:** the market's Admin or owner, who moves the market and stops or takes applications on the phase rail ([what each role may do](../rules/what-each-role-may-do.md)).
**Where they start:** the phase rail of a market whose vendors apply on its own page.
**Serves:** [Vendors apply on the market's own page](../intents/vendors-apply-on-the-markets-own-page.md) and [The market's phase says what to do next](../intents/the-markets-phase-says-what-to-do-next.md).

These are the online path's moves ([the online path](the-online-path.md)): applications open, and inside the Applications phase the organizer may stop taking them and take them again.
A market whose vendors apply on the organizer's own Google Form enters Review by its first import instead, and has nothing to stop ([the Google Form path](the-google-form-path.md)).
How vendors apply while the market takes applications is [applying online](applying-online.md).

**Applications arrive and are reviewed in one phase** ([ADR 0016](../../adr/0016-one-stage-for-applications-and-review.md)), so one Applications page serves it, and says in words, at its top, where the market stands: "This market is open for applications. New ones keep arriving here." or "This market is not taking applications. No new ones will arrive."; how many are left to decide is the rail's to say.
A verdict can be given from the first application ([review](review.md)); Begin Assignment ends the phase, and with it the applicant form.

## H1. Open applications

**Status:** Works (walked live; where the move lands, and its refusal before the click, read from the code as of E32/F01/S01, E31/F02 and E38/F04/S01: `front-end/src/utils/marketGuide.ts`, `every-move-lands.spec.ts`, `market-journey.spec.ts`; the reviewers offered with it as of E38/F07/S02: `open-applications-offers-the-reviewers.spec.ts`).

1. Rail: "Open Applications", the main button in Draft once the setup is complete ([the setup settles on leaving draft](../rules/the-setup-settles-on-leaving-draft.md)); until then it is disabled and the rail names the first thing missing.
2. For someone who may choose reviewers (an Admin or the owner, by default), it opens a dialog, "Open applications", with a checkbox for each person they may choose, none ticked (or the reviewers chosen in draft before), and the hint "Choose no one and everyone reviews first come, first served. You can choose reviewers later from the Applications tab." ([the review is dealt among chosen reviewers](../rules/the-review-is-dealt-among-chosen-reviewers.md)).
   Its "Open Applications" saves the reviewers when the choice differs from the ones stored, then makes the move; with no one ticked and none chosen before it opens as before, and every application that arrives once reviewers are chosen is dealt to the next in turn.
   A save that is refused keeps the dialog open with its error and makes no move; a move refused after the save shows its blockers on the rail, and the reviewers stay chosen.
   Cancel or Escape closes it and saves nothing.
   Anyone else who may move the market gets the move at once, with no dialog.
3. Expect Applications, landing on the Applications page, which carries the dot; the form is locked from now on ([F4](form-tab.md#f4-the-form-lock)).
4. The rail shows "Application page" with the public address and "Copy" on one line, shortening the address rather than wrapping (bug 11); it stays there in every phase after Draft until the market is archived.
5. The rail says "Applications are open on your application page: review them as they arrive. Every application is decided: Begin Assignment.", or, while one is undecided, "… Finish deciding: …".

Covered by: `phase-state-machine.spec.ts`, `phase-rail.spec.ts`, `every-move-lands.spec.ts`, `market-journey.spec.ts`, `open-applications-offers-the-reviewers.spec.ts`, `openApplicationsOffersTheReviewers.test.ts`.

## H1a. Refused: the form asks nothing

**Status:** Works (code); not reached through the product since E31/F01/S01 (read from `back-end/guards.py` and `phase-state-machine.spec.ts`).
The guard still stands on the move out of Draft: with no custom field, and a plan offering no dates, no tiers and fewer than 2 sections, the move is refused with "The application form asks nothing. …".
Leaving Draft now needs market dates first, and a plan with dates always asks the available-dates question, so a plan that offers nothing is refused by the setup's first blocker instead: the rail reads "To open applications: This market has no market dates. Pick them on Market Setup's calendar."
Covered by: `phase-state-machine.spec.ts` ("a market whose plan offers nothing is blocked, and told to add dates").

## H4. Stop taking applications

**Status:** Works (read from the code as of E38/F04/S02: `back-end/api/applicants.py`, `front-end/src/components/PhaseRail.vue`; `taking-applications-stops-and-resumes.spec.ts`).
In Applications, More…, "Stop taking applications": a fact about the form, not a move, so the market stays in Applications and reviewing goes on.
The application page refuses a new application, or a change to one, in the words a closed market used ("Applications are not currently open for this market. The market is in the Applications Closed phase."), though each vendor can still sign in and read their application ([H3c](applying-online.md#h3c-a-vendor-checks-their-application)).
The rail says "Your application page is not taking applications. …", and the page "This market is not taking applications. No new ones will arrive."
The stop is recorded in [the market's history](../../implementation/data/history.md) under the organizer who made it, as taking applications again is.
Covered by: `taking-applications-stops-and-resumes.spec.ts`, `returning-vendors-edit-their-answers.spec.ts`.

## H5. Take applications again

**Status:** Works (read from the code as of E38/F04/S02; `taking-applications-stops-and-resumes.spec.ts`).
In Applications, while stopped, More…, "Take applications again": the application page takes them again, and nothing else changes.
Begin Assignment closes the form whether or not it was stopped, and there is no way back from Assignment.
A stop belongs to its stay in Applications: Reopen for Editing clears it, so Open Applications afterwards opens the form.
Covered by: `taking-applications-stops-and-resumes.spec.ts`.

## Superseded

- The Applications page was to offer Import in Applications Open and Applications Closed on any market, dropping it in Review (wayfinding/the-order-of-the-work/11); importing is the Google Form path's alone, and its review screen offers none (E31/F03/S04, E38/F04/S03).
- Closing applications was a phase, Applications Closed, between Applications Open and Review, with "Close Applications" and "Reopen Applications" as moves; it is the form's fact inside the one Applications phase now (E38/F04/S02).

## The rules it obeys

- [The setup settles on leaving draft](../rules/the-setup-settles-on-leaving-draft.md): Open Applications waits for dates, a location and tables at every tier.
- [The form locks at the first application](../rules/the-form-locks-at-the-first-application.md): past Draft the form is fixed.
- [Intake mode decides how vendors arrive](../rules/intake-mode-decides-how-vendors-arrive.md): these moves are the online path's.
- [What each role may do](../rules/what-each-role-may-do.md): moving the market, and stopping or taking applications, are an Admin's.

How the rail draws each move and action, and says no before the click, is [the phase rail](../../implementation/modules/phase-rail.md); the moves themselves are in [the lifecycle](lifecycle.md).
Its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
