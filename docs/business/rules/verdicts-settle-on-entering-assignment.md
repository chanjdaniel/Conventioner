---
layer: business
kind: rule
describes:
  - back-end/api/markets.py#review_is_open
  - back-end/api/markets.py#verdict_refusal
  - back-end/api/markets.py#review_closed_reason
  - back-end/app.py#_reviewer_on
verified: 2026-11-03
sources:
  - wayfinding/rejection-visibility/02
  - wayfinding/what-to-show-and-when/02
  - brain-dump/2026-10-19#24
  - E34/F01/S01
  - E36/F01/S01
  - E38/F06/S01
  - E38/F10/S01
  - T207
  - T263
---

# Verdicts settle on entering assignment

Approving, rejecting, asking for a follow-up, undoing one within its window, and claiming a card are open while Assignment still lies ahead of the market, and closed from `assignment` on.
From there a verdict is the review's record ([ADR 0013](../../adr/0013-verdicts-settle-with-the-review-and-results-settle-the-allocation.md)).
Until results are published, on either path, Back to review takes the market from `assignment` back to `applications`, the stage where applications are reviewed, and the review opens again there ([ADR 0021](../../adr/0021-the-review-reopens-until-results-are-published.md)); once the review can no longer reopen (results published, or a Google Form market that went live before it could publish them), a mistake is fixed with a seat placed or freed by hand.

**Serves:** [Reviewing applications as a team](../intents/reviewing-applications-as-a-team.md).

## Why

The assignment is computed from the approved applications, so a verdict changed while the market is in `assignment` would describe a review that no longer matches the seats; going back to the review first makes the change a review again, and its tables are then allocated again.
The seat is what the vendor experiences: a rejected applicant seated by hand has a table, and an approved one freed has none, which is what [placements](../../implementation/modules/placements.md) are for.
The automatic rejections settle by the same rule, since a rule and a reviewer judge the same applications.
"Needs follow-up" is a verdict too, and settles with the others; entering `assignment` already needs every application approved or rejected.

**Review is rolling.**
Verdicts are open from the first application on, so an organizer decides as applications arrive; applications arrive and are reviewed in one stage ([ADR 0016](../../adr/0016-one-stage-for-applications-and-review.md)), and Begin assignment is where deciding has to be finished.

**It is derived from the transition table, never listed**: `review_is_open` asks whether a route of `VALID_TRANSITIONS` still leads to `assignment` from a phase other than `assignment` itself (`route_between`), so a phase added or an edge moved decides it with no edit here.
Ahead, not merely reachable: asking whether the stage can be reached would open the review in Assignment, since Back to review reaches the stage from there.
Today that is open in `draft` and `applications`, and closed in `assignment`, `offers`, `market_days` and `archived`.

## What a closed review says

Wherever the review is closed, the server says why and what to do instead, in the words of where the market stands (`review_closed_reason`, T207):

- In `assignment` while results are not published: "The review is closed while tables are allocated. To change a verdict, choose Back to review under More… on the phase rail; tables are then allocated again."
- Once results are published, in any phase but `archived`: "The review closed when results were published. To change who has a table, place or free a seat on Assignments."
- In `offers` or `market_days` with no results published, a Google Form market that went live before it could publish them: "The review closed when the market went live. To change who has a table, place or free a seat on Assignments."
- In `archived`: the archived refusal, as every write there says.

Published comes before the phase, since no way back is left once applicants have read their results.
The automatic rejections say the same in their own subject ("The automatic rejections are closed while tables are allocated. To change a rule, …", "The automatic rejections closed when results were published. …", "… closed when the market went live. …"), and choosing reviewers refuses with "The review is closed, so its reviewers no longer change." followed by the review's reason.
The Applications tab says the reason once, over both views, where the review's controls were ([reviewing applications](../flows/review.md)); the verdict buttons and the reviewers panel go on the same served reason with no words of their own, and the fixed rules say their own subject's reason (`rejectionRulesLockReason`).

## Who may

An EDITOR (E34/F01/S01): a verdict records who gave it, and is not one of the admin actions.
Changing one already approved or rejected is an Admin's, the table's change row asked on top of this gate (E38/F06/S01, [what each role may do](what-each-role-may-do.md)), so it closes with the review as giving one does.
An archived market refuses anyone.

## Where it is kept

- `verdict_refusal` in [`back-end/api/markets.py`](../../../back-end/api/markets.py) is the archived rule, the table's Give verdicts and follow-ups row and `review_closed_reason`, which asks `review_is_open` and tells the closed cases apart in one place (`_why_the_review_is_closed`); the market read serves its parts apart, the row's answer in `actionRefusals` and the close of the review as `verdictsSettledReason`, and every review screen gives verdicts only when neither refuses, exactly what the write takes.
- `_reviewer_on` in [`back-end/app.py`](../../../back-end/app.py) is the one gate of every review write (a verdict, a selection's verdicts, a follow-up's owner, a claim, and an undo of a verdict or a selection's), and answers a refusal with a 403 in its words ([an exception never reaches a client](../../implementation/conventions/an-exception-never-reaches-a-client.md)); a verdict and a selection's then ask the change row of each application already approved or rejected (`_change_refused`).
- `review_is_open` reads the table kept by [the guards](../../implementation/modules/guards.md); the verdict itself is stored on [the application document](../../implementation/data/application-document.md#statuses).
- `back-end/tests/test_a_verdict_says_who.py` pins it in every phase, published or not, with each reason's words, and holds the verdicts' lock and the automatic rejections' lock equal in each; `front-end/e2e/the-closed-review-says-why.spec.ts` reads the tab's line in Assignment, once published, and on a Google Form market that went live.
- Several reviewers at once are kept apart by a claim, and a verdict is written only on what its reviewer saw ([ADR 0014](../../adr/0014-reviewers-claim-and-a-verdict-is-a-conditional-write.md)); a follow-up is [needs follow-up](needs-follow-up.md), and a rule's rejection [automatic rejections](automatic-rejections.md).
