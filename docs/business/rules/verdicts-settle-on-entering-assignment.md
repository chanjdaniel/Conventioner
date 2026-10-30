---
layer: business
kind: rule
describes:
  - back-end/api/markets.py#review_is_open
  - back-end/api/markets.py#verdict_refusal
  - back-end/app.py#_reviewer_on
verified: 2026-10-30
sources:
  - wayfinding/rejection-visibility/02
  - wayfinding/what-to-show-and-when/02
  - brain-dump/2026-10-19#24
  - E34/F01/S01
  - E36/F01/S01
  - E38/F06/S01
---

# Verdicts settle on entering assignment

Approving, rejecting, asking for a follow-up and claiming a card are open while the market can still get back to `applications`, the stage where applications are reviewed, and closed from `assignment` on, with no way back.
From there a verdict is the review's record, and a mistake is fixed with a seat placed or freed by hand ([ADR 0013](../../adr/0013-verdicts-settle-with-the-review-and-results-settle-the-allocation.md)).

**Serves:** [Reviewing applications as a team](../intents/reviewing-applications-as-a-team.md).

## Why

The assignment is computed from the approved applications, and nothing leaves `assignment` backwards, so a verdict changed after it would describe a review that no longer matches the seats.
The seat is what the vendor experiences: a rejected applicant seated by hand has a table, and an approved one freed has none, which is what [placements](../../implementation/modules/placements.md) are for.
The automatic rejections settle by the same rule, since a rule and a reviewer judge the same applications.
"Needs follow-up" is a verdict too, and settles with the others; entering `assignment` already needs every application approved or rejected.

**Review is rolling.**
Verdicts are open from the first application on, so an organizer decides as applications arrive; applications arrive and are reviewed in one stage ([ADR 0016](../../adr/0016-one-stage-for-applications-and-review.md)), and Begin Assignment is where deciding has to be finished.

**It is derived from the transition table, never listed**: `review_is_open` asks whether any route of `VALID_TRANSITIONS` leads back to `applications` (`route_between`), so a phase added or an edge moved decides it with no edit here.
Today that is open in `draft` and `applications`, and closed in `assignment`, `offers`, `market_days` and `archived`.

## Who may

An EDITOR (E34/F01/S01): a verdict records who gave it, and is not one of the admin actions.
Changing one already approved or rejected is an Admin's, the table's change row asked on top of this gate (E38/F06/S01, [what each role may do](what-each-role-may-do.md)), so it closes with the review as giving one does.
An archived market refuses anyone.

## Where it is kept

- `verdict_refusal` in [`back-end/api/markets.py`](../../../back-end/api/markets.py) is the archived rule, the table's Give verdicts and follow-ups row and `review_is_open`; the market read serves its parts apart, the row's answer in `actionRefusals` and the close of the review as `verdictsSettledReason`, and every review screen gives verdicts only when neither refuses, exactly what the write takes.
- `_reviewer_on` in [`back-end/app.py`](../../../back-end/app.py) is the one gate of every review write (a verdict, a selection's verdicts, a follow-up's owner, a claim), and answers a refusal with a 403 in its words; a verdict and a selection's then ask the change row of each application already approved or rejected (`_change_refused`).
- `review_is_open` reads the table kept by [the guards](../../implementation/modules/guards.md); the verdict itself is stored on [the application document](../../implementation/data/application-document.md#statuses).
- `back-end/tests/test_a_verdict_says_who.py` pins it in every phase, and holds the verdicts' lock and the automatic rejections' lock equal in each.
- Several reviewers at once are kept apart by a claim, and a verdict is written only on what its reviewer saw ([ADR 0014](../../adr/0014-reviewers-claim-and-a-verdict-is-a-conditional-write.md)); a follow-up is [needs follow-up](needs-follow-up.md), and a rule's rejection [automatic rejections](automatic-rejections.md).
