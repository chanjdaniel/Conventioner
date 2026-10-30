---
layer: business
kind: rule
describes:
  - back-end/api/vendor_info.py
  - front-end/src/components/UpdateInfoDialog.vue
  - front-end/src/components/AnswerUpdateNote.vue
  - front-end/src/utils/answerUpdates.ts
verified: 2026-10-30
sources:
  - E41/F01/S01
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
The answers the assignment reads (the [essential questions](../concepts/essential-question.md), [essential fields](../../implementation/modules/essential-fields.md)) are not updated yet: the dialog shows them read-only and the server refuses them; updating them is an Admin's (Q13), a later story (E41/F01/S02).

## How it works

- "Update info" in [the vendor drawer](../flows/vendor-drawer.md) opens a dialog of the vendor's own questions, each in its question's control, with Save and Cancel ([`UpdateInfoDialog.vue`](../../../front-end/src/components/UpdateInfoDialog.vue)); Cancel and Escape change nothing.
- Each answer that differs from what the vendor wrote shows "They wrote: ..." beside it, with "Use their answer", which puts their answer back; saved, that takes the update away.
- An answer is held to what the form holds the vendor's to, with the form's own message.
- While the review is open, the [automatic rejections](automatic-rejections.md) judge the answers as updated, as they judge a vendor's own save: an update past a rule returns the application to undecided, and one that meets a rule rejects it.
  From assignment on, the rules have settled with the verdicts ([verdicts settle on entering assignment](verdicts-settle-on-entering-assignment.md)), so an update stands and the verdict stays.
- The drawer and the review card say "Updated by <address>, <when>; they wrote <their answer>" under an updated answer ([`AnswerUpdateNote.vue`](../../../front-end/src/components/AnswerUpdateNote.vue)).
- A [re-import](../../implementation/modules/csv-import.md) writes the file's answers as the vendor's own and leaves every update standing.

## Where it is kept

The write is [`back-end/api/vendor_info.py`](../../../back-end/api/vendor_info.py), sent by the drawer through `updateVendorInfo` in [`answerUpdates.ts`](../../../front-end/src/utils/answerUpdates.ts), which also holds the words above.
How an update is stored and the one reader of the answers: [the application document](../../implementation/data/application-document.md#an-organizers-update-of-an-answer).
What it records: [the market's history](../../implementation/data/history.md#what-each-write-records).
`back-end/tests/test_updating_vendor_info.py`, `front-end/src/__tests__/updatingVendorInfo.test.ts` and `front-end/e2e/updating-vendor-info.spec.ts` pin it.
