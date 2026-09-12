---
id: E05
title: Offers and the applicant-facing flow
type: epic
status: proposed
blocked_by: [E02]
pr: []
---

## Outcome

An applicant applies through the market's public page, learns the outcome, receives an offer, and accepts or refuses it - and the organizer sees all of that.

## Not required for MVP

Recorded deliberately so it is not rediscovered.
MVP ends at "assignment computed"; the organizer communicates results themselves, as they do with Google Forms today.

## Why it is on the backlog anyway

Because a verified defect lives here, and a defect with no ticket gets rediscovered the expensive way.

**The `assignment -> offers` transition is deadlocked.**
`NoApprovedApplicationsGuard` blocks the edge while any application is `reviewer_approved`, and only the solver writing `assigned`/`unassigned` could clear that.
Nothing in `back-end/` writes `assigned`, `unassigned`, `assignment_sent`, or `vendor_accepted` - the only non-test occurrences are the enum definition, the sweep that reads `assignment_sent`, and the count endpoint.
There is no "send offers" action at all.

So any market where the organizer approves anyone can never leave the assignment phase.
This shipped in PR #46; its e2e coverage passes only because it seeds those statuses straight into Mongo rather than reaching them through the product.

**The guard is correct.** It is accurately reporting that the solver writeback does not exist.
Relaxing it would convert a loud, accurate failure into a market that silently advances with nobody assigned.
The fix is this epic, not a patch.

## Scope

- Solver writes assignment outcomes back onto applications (`assigned` / `unassigned`)
- An organizer action that sends offers, moving applications to `assignment_sent`
- An applicant-facing accept/refuse path, writing `vendor_accepted` / `vendor_refused`
- Outcome notification email - approval, rejection, offer. The mailer sends only auth mail today
- `MarketHomeView.vue` is a 32-line stub printing the slug; it becomes the market's real public page
- Turning the public applicant surface on via intake mode
