---
layer: implementation
kind: module
describes:
  - front-end/src/components/application/AmendFormDialog.vue
  - front-end/src/views/CsvImportView.vue#amendAvailability
verified: 2026-10-29
sources:
  - wayfinding/the-order-of-the-work/07
  - wayfinding/the-order-of-the-work/map
  - wayfinding/claims-and-room/map
  - wayfinding/claims-and-room/03
  - E20/F03
  - E20/F03/S01
  - E20
  - E38/F04/S01
---

# The form amendment

[`AmendFormDialog.vue`](../../../front-end/src/components/application/AmendFormDialog.vue) fixes the application form from inside the import (E20/F03).
When the column mapping shows the form asked the wrong thing, the organizer used to follow printed instructions out of the import, losing their upload on the way; the dialog writes the form and the import keeps the file, the mapping and the step meanwhile.

## Sharp edges

**It writes through the one form writer**, `PUT /markets/:id/application-form` (`save_application_form`), the ordinary writer meeting the ordinary lock, so the D9 lock stays unbypassable ([the form locks at the first application](../../business/rules/the-form-locks-at-the-first-application.md)).
A Google Form market's first import runs while it is a draft ([ADR 0016](../../adr/0016-one-stage-for-applications-and-review.md)), the one phase the form is writable in, so no phase moves.
Once anything is imported the market is in Review and its questions are fixed; the import reads the lock the market read serves (`applicationFormLockReason`, `amendAvailability` in [`CsvImportView.vue`](../../../front-end/src/views/CsvImportView.vue)) and says it where the offer would have been, rather than offering and failing.

**It mirrors the one refusal an organizer can cause**: turning every question off while adding none leaves a form that asks nothing, which could not enter Review (`FormHasFieldsGuard`), so the dialog says so before Save.

**It answers both of the import's dead ends**: a column with nowhere to go, which adds a question for it, and a preference the Google Form never asked, which switches that question off.
After the save the import inspects the file again, so a new question is offered as a target and a switched-off one leaves the required list, and the organizer's own column choices and value decisions are put back.

**Its save records as the form builder's does**, one `change-form` entry of kind `form` in [the market's history](../data/history.md), since it is the same write.

## Why

- [The form locks at the first application](../../business/rules/the-form-locks-at-the-first-application.md): a form found wrong before the first import is fixed here, through the lock rather than around it.
- [What an import may leave unasked](../../business/rules/what-an-import-may-leave-unasked.md): switching off a ranking the Google Form never asked is the same save.

`front-end/e2e/form-amendment.spec.ts` pins it.

What the organizer does instead, when they leave the import to fix the form, is edit it on the form tab, which a draft allows ([F2](../../business/flows/form-tab.md#f2-custom-questions)).
The fix from inside the import, as the organizer meets it, is [H2e and H2f](../../business/flows/import.md#h2e-add-a-question-for-a-column-with-nowhere-to-go).

## Superseded

It was a back-end chain (`api/form_amendment.py`, E20/F03/S01) that walked a market from Import or Applications Closed down to draft, wrote the form and walked it back, with pre-flight over every hop and a resume for a walk that stalled between two; with one stage entered by the first import, no market reaches the import with no application except in draft, so the walk had nothing left to do (E38/F04/S01).

The glossary concept it serves: [Phase](../../business/concepts/phase.md).
