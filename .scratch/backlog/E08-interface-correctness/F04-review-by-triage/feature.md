---
id: E08/F04
title: Review by triage
type: feature
status: done
blocked_by: [E03/F04]
pr: []
---

## Outcome

An organizer reviews applications one at a time, seeing everything the applicant answered, and
decides each one deliberately.

## Why now

The queue shows an email, a status pill, a date and two buttons, so there is nothing on a card to
decide with. Settled by
[ticket 04](../../../wayfinding/real-market-readiness/issues/04-what-a-reviewer-needs-to-decide.md)
against a three-variant prototype (`prototype/04-review-queue`): **variant B, triage**.

## What to build

- One application at a time, carrying **every** answer it holds - essential questions and custom
  fields alike - not an identifier and a status.
- Progress counted: "12 of 232 to review".
- Approve, Reject, Skip, each with a keyboard shortcut, so a reviewer's hands need not leave the
  keyboard.
- **No bulk action, no selection model, no "approve the rest".** This was offered and declined. No
  application is approved without having been looked at.

## Unblocked 2026-09-14

E03/F04 shipped, so a form can be corrected before anyone applies and triage cards can differ.
The original warning, kept because it is still the reason this order matters:

### Why it was blocked

**Do not start this until
[ticket 05](../../../wayfinding/real-market-readiness/issues/05-how-custom-fields-reach-a-frozen-form.md)
is resolved.** The form freezes the moment a market leaves `draft`, so today's default is a form
that asks only the essential questions - and then every triage card shows the same answers and the
only rational act is pressing Approve 232 times. Triage is humane only if the cards differ. Built in
that order it is a slower version of the queue it replaces.

## Acceptance criteria

- [x] A card shows every answer the application holds, including custom fields.
- [x] Approve, Reject and Skip each work by keyboard and by click.
- [x] Progress is visible and correct as verdicts are recorded.
- [x] There is no control anywhere that decides more than one application at once.
- [x] Reviewing 232 applications does not re-fetch the whole list per verdict (today it does).

## Verified 2026-09-14

Against a 232-application market rebuilt from the real Fall 2025 export, in the browser:

- The card carries every answer: available dates, how many dates, the per-date tier map, table
  choice, table-share partner and section ranking, each under the label the form used, and each
  read back the way the applicant gave it - "Half a table, shared" rather than the stored code,
  "1. Front Row, 2. Middle" rather than an unnumbered list.
- A, R and S record approve, reject and skip; the same three are buttons on the card. The keys are
  ignored while focus is in an input, so typing elsewhere cannot cast a verdict.
- The count read "1 of 232 to review", then "2 of 230 to review" with "2 reviewed · 1 approved ·
  1 rejected" after one approve, one reject and one skip. A skipped application stays in the
  queue, so the number of decisions left never understates the work.
- There is no selection model and no control that acts on more than the card in front of the
  reviewer. The reviewed list underneath re-decides one application at a time, which is how a
  mistaken verdict is corrected.
- One list fetch for the session and one write per verdict. The review endpoint returns the
  application it wrote, and the list is updated from that answer.

Two things came out of review rather than the walkthrough:

- The reviewed list is everything no longer awaiting a verdict, not the two reviewer verdicts.
  An application does not stay at its verdict - assignment, offers and market days each move it
  on - so the narrower reading would have emptied the tab as the market progressed. The verdict
  split in the tally is shown only while verdicts are still on the applications.
- The rendering of an answer belongs to the essential-fields contract, beside the questions it
  renders, because the applicant's own dashboard shows the same answers back. A second copy had
  already drifted from the first within this change.

Beyond what was asked, and kept: an advisory when a market's form asks only the essential
questions, so the reviewer learns at card one rather than card forty that every card reads alike;
and the reviewed list itself, which preserves the re-decide the old queue allowed. Also fixed on
the way past: the Applications tab had no scroll of its own, so the reviewed list spilled out
below the white panel where it could not be reached.

Suites: 900 pytest, 112 vitest, 74 Playwright - all green.
