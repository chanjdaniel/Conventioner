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

## Before any mail is sent: imported emails are unverified

**An imported applicant's email address is asserted by the organizer. A form applicant's is proven.**

The form path issues a login-code challenge, so the applicant demonstrably controls the address.
CSV import has no such step - the address is transcribed from a spreadsheet - and nothing on the `Application` document records the difference.

This is harmless today only because intake mode keeps the public applicant surface off for CSV markets, so an imported applicant never logs in.
It stops being harmless the moment this epic ships: offer and outcome mail would go to addresses nobody has verified, at whatever volume a market has vendors.
A single mistyped address in a spreadsheet becomes a bounce at best, and mail to a stranger at worst.

Decide the handling before the first notification is sent. Ticket 05 deliberately declined to add a `source` field, on the grounds that intake mode already says how an application arrived - so the information is available, but the decision about what to do with it is not made.

## Scope

- Solver writes assignment outcomes back onto applications (`assigned` / `unassigned`)
- An organizer action that sends offers, moving applications to `assignment_sent`
- An applicant-facing accept/refuse path, writing `vendor_accepted` / `vendor_refused`
- Outcome notification email - approval, rejection, offer. The mailer sends only auth mail today
- `MarketHomeView.vue` is a 32-line stub printing the slug; it becomes the market's real public page
- Turning the public applicant surface on via intake mode
