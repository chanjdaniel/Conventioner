# Map: Who sees a rejection, and when

Status: closed

Charted and closed 2026-10-20, over Discord, from a research pass on how rejections are shown today.

## Destination

A verdict is the review's record and settles with the review.
What an applicant is told never gives away a decision before results are published, and after them says only whether they have a table.
An organizer can still seat anyone by hand, deliberately and warned, and every seated person is someone the market has a record of.
The way is clear when nothing remains to decide before that can be built; `E36` in `.scratch/backlog/` is the by-product.

## Notes

**Evidence.**
[`walk/research.md`](walk/research.md) is the research report: who sees a rejection, where, and what it does downstream, with the gaps ranked.
[`walk/state-review.md`](walk/state-review.md) is every phase on each intake path, read as mutable, settled or not yet available, with where today conflicted with the decisions below.
Both were read from `dev` at `c34652ba` and cite the code line by line; they go stale as `E36` lands, the decisions do not.

**The two risks that started it.**
A rejected vendor could stay seated, go live and check in: verdicts stayed open after a run, a hand placement took any address, and a pin for someone not approved was silently orphaned without blocking anything.
And before publication, "Under Review" against "Submitted" told an applicant a rule had rejected them, the moment they submitted.

**Skills every session should consult.**
`grilling` and `domain-modeling` by default.
`AGENTS.md` is authoritative on **The Phase Rail**, **Placements, Pins and the Trail**, **Intake Mode** and **The Solver Reads Applications**.

## Decisions so far

- [02: who sees a rejection, and when](issues/02-who-sees-a-rejection-and-when.md) - verdicts lock on entering assignment with no way back, a mistake is fixed with a warned hand placement, Publish Results waits for a current run and ends re-runs, and an applicant reads "Submitted" before it and one of two outcomes after.

## Not yet specified

- Rejections are not separable by source on the organizer's side (a person's or a rule's), research 6.6.
- An applicant who changes their answers after a rule rejected them, research 6.7; the window for changing answers closes before assignment, so it reaches no seat.

## Out of scope

- Waitlist applications (a reapplication prefilled from the main one).
  The data model has a `waitlist` type and a link to the main application; nothing creates one and the solver reads main applications only.
- Outcome emails: nothing is sent when results are published, and these decisions do not add one.
- An offers or decline flow: `vendor_refused` is unreachable today, and folds into "You did not get assigned" until one exists.
