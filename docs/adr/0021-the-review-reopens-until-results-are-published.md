---
layer: implementation
kind: adr
describes:
  - back-end/guards.py#ResultsNotPublishedGuard
  - back-end/guards.py#AssignmentNotBeforeReviewGuard
  - back-end/assignment/made_from.py
  - back-end/api/markets.py#review_is_open
  - back-end/api/markets.py#taking_applications_update
  - front-end/src/components/PhaseRail.vue
verified: 2026-11-03
sources:
  - T191
  - T207
status: accepted
---

# The review reopens until results are published

The nodes it constrains: [verdicts settle on entering assignment](../business/rules/verdicts-settle-on-entering-assignment.md), [the guards and the phase move](../implementation/modules/guards.md), [the market lifecycle](../business/flows/lifecycle.md), [what an assignment was made from](../implementation/modules/made-from.md) and [Publish results waits for the allocation](../business/rules/publish-results-waits-for-the-allocation.md).

## Context

[ADR 0013](0013-verdicts-settle-with-the-review-and-results-settle-the-allocation.md) settled the verdicts on entering `assignment`, with no way back, and rejected a way back from `assignment` to the review because it would reopen every verdict to fix one.
On the QC walk Daniel met the cost of that: an organizer who began assignment before the review was really finished could not change a verdict given too fast, or an automatic rejection set too loosely, and the only fix was by hand, seat by seat, with nothing on screen saying even that.
Daniel chose to let the market go back until applicants have read their results (T191's finding F16, answered as Q09's option b).
What made a way back unsafe in ADR 0013 is what an applicant has been told, and before results are published they have been told nothing: they read "Submitted" whatever the review says.

## Decision

**A new edge, `assignment -> applications`, offered as "Back to review".**
It carries the stage's entry invariants, which pass on any market past draft, and one guard of its own, `ResultsNotPublishedGuard` in [`back-end/guards.py`](../../back-end/guards.py): it refuses once `results_published` is set, reading the flag, never the phase, and names no remedy, since no page reopens the review.
A Google Form market never publishes results, so its way back stays open for the whole of Assignment.
Who may take it is the table's Move the phase row, as for every move.

**The review stays closed in Assignment.**
`review_is_open` in [`back-end/api/markets.py`](../../back-end/api/markets.py) asks whether Assignment still lies ahead of the phase, not whether the stage can be reached, since the new edge reaches it from `assignment` itself.
It is still derived from the table: open in `draft` and `applications`, closed in `assignment`, `offers`, `market_days` and `archived`, and every reader (a verdict, an undo, a claim, choosing reviewers, the automatic rejections) follows with no edit of its own.

**Applying stays closed on the way back.**
Entering the stage from `assignment` sets a form market's `applicationsStopped` in the phase writer's one update (`taking_applications_update`), where entering it from `draft` clears it; a Google Form market is left as it is.
So [ADR 0016](0016-one-stage-for-applications-and-review.md) stays true: Begin assignment closed the form, and Take applications again under More… is the organizer's way to reopen it ([taking applications](../business/flows/taking-applications.md)).

**The move asks first.**
The phase rail's `AppDialog` ([`PhaseRail.vue`](../../front-end/src/components/PhaseRail.vue)) says what it does before the review reopens: verdicts and automatic rejections can change, the allocated tables are kept but must be allocated again before results are published (on a Google Form market, before the market is published), a seat placed by hand stays even for a vendor then rejected, and on a form market applications stay closed.
It confirms by its edge, not by `transitionNeedsConfirmation`, which confirms only what cannot be undone.

**The stored run is kept, and out of date until the next run.**
Placements, pins and the run's fingerprints stay as they are: the move writes nothing to the assignment.
A run records, beside the rules, the plan and the approved applications, a fourth group, `review`: how many times the market has entered the review stage, from its phase record ([`back-end/assignment/made_from.py`](../../back-end/assignment/made_from.py)).
So the move back makes the stored run out of date whether or not a verdict changed, and Assignments says "The review was reopened after tables were allocated." until tables are allocated again ([an assignment knows when it is out of date](../business/rules/an-assignment-knows-when-it-is-out-of-date.md)).
A run recorded before the group existed is not known to be out of date by it; a real change of verdict still shows through the approved applications.

**Results and going live wait for the new run.**
Publish results already refuses an out-of-date run, and the `review` group joins what it reads.
A Google Form market has no Publish results, so a new guard, `AssignmentNotBeforeReviewGuard` (`assignment_after_review`), is an entry invariant of `market_days`, ahead of `ResultsPublishedGuard`, its fix "Allocate tables".
It reads only the `review` group, never the approved applications, so it stays cheap and never refuses a market for a plan or rule edit made after publishing, when runs are refused.

**A pin stays the override it was.**
A seat placed by hand for a vendor the reopened review rejects is ADR 0013's override: a re-run keeps it, Assignments marks it "not approved", and nothing blocks Begin assignment on it.
The orphaned-pin guard checks the seat, never the vendor, and is unchanged.

## Consequences

- A verdict can change after Begin assignment, until results are published; from then on, as ADR 0013 decided, a seat placed or freed by hand is the only way to change who has a table.
- The cost of going back is the allocation, and the confirm says so up front.
- A market that went back cannot publish results or go live on tables allocated before the reopened review, so a vendor rejected in it does not keep a seat the solver gave them; the Assignments page says why ([the result is out of date](../business/flows/assignment-and-result.md#j5-the-result-is-out-of-date)).
- A form market comes back with its form stopped, so no new applicant arrives unless the organizer takes applications again.
- An applicant reads "Submitted" throughout, as ADR 0013 decided, since nothing is published before the review is.
- The move is an ordinary one: the phase record and the market's history record it as `move-phase`, with nothing else written.

## Considered and rejected

- **No way back, with the reason said** (Q09 a): it explains the dead end without removing it, and the fix stays seat by seat.
- **Back at any phase before market days** (Q09 c): once results are published an applicant has read whether they have a table, and a reopened verdict would change what they were told.
- **A blocker on Begin assignment for a pin of a vendor the reopened review rejects**: it could be cleared only by approving the vendor again, since a seat is freed only in Assignment, so the pin stays the marked override instead.
- **Reopening applying on the way back**: going back is for fixing the review, and reopening the applicant form unasked would let new applicants in; Take applications again is one choice away.
