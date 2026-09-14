---
id: E08/F04
title: Review by triage
type: feature
status: blocked
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

## Blocked, deliberately

**Do not start this until
[ticket 05](../../../wayfinding/real-market-readiness/issues/05-how-custom-fields-reach-a-frozen-form.md)
is resolved.** The form freezes the moment a market leaves `draft`, so today's default is a form
that asks only the essential questions - and then every triage card shows the same answers and the
only rational act is pressing Approve 232 times. Triage is humane only if the cards differ. Built in
that order it is a slower version of the queue it replaces.

## Acceptance criteria

- [ ] A card shows every answer the application holds, including custom fields.
- [ ] Approve, Reject and Skip each work by keyboard and by click.
- [ ] Progress is visible and correct as verdicts are recorded.
- [ ] There is no control anywhere that decides more than one application at once.
- [ ] Reviewing 232 applications does not re-fetch the whole list per verdict (today it does).
