---
layer: business
kind: rule
describes:
  - back-end/api/vendor_info.py
  - front-end/src/components/UpdateInfoDialog.vue
  - front-end/src/components/UpdateInfoTheirs.vue
  - front-end/src/components/AnswerUpdateNote.vue
  - front-end/src/utils/answerUpdates.ts
verified: 2026-10-30
sources:
  - E41/F01/S01
  - E41/F01/S02
  - E38/F06/S01
---

# An update is kept beside the vendor's answer

An organizer may update a vendor's answer, and the update is kept beside what the vendor wrote, never over it: it reads in the answer's place wherever the organizer reads the application, says who made it, when and what the vendor wrote, and outlasts a re-import of the market's Google Form and the vendor's own edit.

**Serves:** [Reviewing applications as a team](../intents/reviewing-applications-as-a-team.md) and [Vendors come in from the organizer's own Google Form](../intents/vendors-come-in-from-the-organizers-own-google-form.md).

## Why

A vendor's answer can be misspelt, wrong or out of date, and the organizer is who finds out, often from the vendor by email.
An answer written over would last only until the next re-import, which writes the file's answers again (Daniel, T92 Q12: "fixes method should be generalized for any kind of info correction").
Kept beside it, the update stands, and when what the vendor wrote changes under it the organizer is told ("Their answer changed since your update."), with what they wrote now, and decides again (Q13).
Every update is confirmed before it is kept (Q13: "confirmation required for all edits too"): the dialog shows what the vendor wrote beside each answer changed, and Save is that confirmation (Q26).

## Who may

The row "Update a vendor's info", an Editor by default ([what each role may do](what-each-role-may-do.md)), in any phase until the market is archived ([an archived market is read-only](an-archived-market-is-read-only.md)).
An answer the assignment reads (the dates, how many of them, the tiers on each, the table choice, the table-share partner and the rankings, [essential fields](../../implementation/modules/essential-fields.md)) asks a row of its own as well, "Update info the assignment or price reads", an Admin by default (Q13: "fields assignment reads require admin privileges").
The dialog shows those answers read-only to whoever that row refuses, with its sentence: what the vendor wrote and who updated it still show, with no "Use their answer"; the server refuses them before judging them.
"Number of dates you want" is marked required only where the vendor gave a number, since an imported answer with no limit may stay empty.
The names and the request are [essential questions](../concepts/essential-question.md) the assignment never reads, and are any other answer's.
The row is named for the prices too, but no answer a price reads is behind it yet: that comes with the price groups (E43/F01/S03).

## How it works

- "Update info" in [the vendor drawer](../flows/vendor-drawer.md) opens a dialog of the market's own questions, each in its question's control, and below them the essential questions as the form asks them, with Save and Cancel ([`UpdateInfoDialog.vue`](../../../front-end/src/components/UpdateInfoDialog.vue)); Cancel and Escape change nothing.
- Each answer that differs from what the vendor wrote shows "They wrote: ..." beside it, with "Use their answer", which puts their answer back; saved, that takes the update away ([`UpdateInfoTheirs.vue`](../../../front-end/src/components/UpdateInfoTheirs.vue)).
  The day grid is one question, the dates and the tiers on each together, and the table-share question is answered in words, the address read out of them as the form reads it.
  On a market with no tiers the day grid is the dates alone; the stored empty tier map follows them, so ticking another day adds it without unticking the first.
- An answer is held to what the form holds the vendor's to, with the form's own message: a day ticked with no tiers is refused, judged with the answers the update leaves.
  Only what the update touches is judged, so an answer the vendor gave that the form would now refuse never blocks an update of another.
- The [assignment solver](../../implementation/modules/assignment-solver.md) reads the answers as updated, so the next run places the vendor by them, and an assignment already made reads as [out of date](an-assignment-knows-when-it-is-out-of-date.md); the placement warnings, the empty-tier check, the [table-share notice](table-share-pairing.md) and the vendor's request beside the notes read them too.
- While the review is open, the [automatic rejections](automatic-rejections.md) judge the answers as updated, as they judge a vendor's own save: an update past a rule returns the application to undecided, but only for someone who may overturn an automatic rejection (an Admin or the owner by default, E38/F06/S01; for anyone else the rejection stands), and one that meets a rule rejects it.
  From assignment on, the rules have settled with the verdicts ([verdicts settle on entering assignment](verdicts-settle-on-entering-assignment.md)), so an update stands and the verdict stays.
- The drawer and the review card say "Updated by <address>, <when>; they wrote <their answer>" under an updated answer ([`AnswerUpdateNote.vue`](../../../front-end/src/components/AnswerUpdateNote.vue)).
- A [re-import](../../implementation/modules/csv-import.md) writes the file's answers as the vendor's own and leaves every update standing.

## Where it is kept

The write is [`back-end/api/vendor_info.py`](../../../back-end/api/vendor_info.py), sent by the drawer through `updateVendorInfo` in [`answerUpdates.ts`](../../../front-end/src/utils/answerUpdates.ts), which also holds the words above.
How an update is stored and the one reader of the answers: [the application document](../../implementation/data/application-document.md#an-organizers-update-of-an-answer).
What it records: [the market's history](../../implementation/data/history.md#what-each-write-records).
`back-end/tests/test_updating_vendor_info.py`, `back-end/tests/test_updating_answers_the_assignment_reads.py`, `front-end/src/__tests__/updatingVendorInfo.test.ts`, `front-end/e2e/updating-vendor-info.spec.ts` and `front-end/e2e/updating-answers-the-assignment-reads.spec.ts` pin it.
