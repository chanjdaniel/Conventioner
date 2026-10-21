---
layer: business
kind: rule
describes:
  - back-end/api/markets.py#review_is_open
  - back-end/api/markets.py#verdict_refusal
  - back-end/app.py#_reviewer_on
verified: 2026-10-22
sources:
  - E34/F01/S01
  - E36/F01/S01
---

# Verdicts settle on entering assignment

Approving, rejecting, asking for a follow-up and claiming a card are open while the market can still get back to `review`, and closed from `assignment` on.
From there a verdict is the review's record, and a mistake is fixed with a seat placed or freed by hand.

## Why

The assignment is computed from the approved applications, and nothing leaves `assignment` backwards, so a verdict changed after it would describe a review that no longer matches the seats.
The seat is what the vendor experiences: a rejected applicant seated by hand has a table, and an approved one freed has none, which is what [placements](../../implementation/modules/placements.md) are for.
The automatic rejections settle by the same rule, since a rule and a reviewer judge the same applications.

**It is derived from the transition table, never listed**: `review_is_open` asks whether any route of `VALID_TRANSITIONS` leads back to `review` (`route_between`), so a phase added or an edge moved decides it with no edit here.
Today that is open in every phase up to and including `review`, and closed in `assignment`, `offers`, `market_days` and `archived`.

## Who may

An EDITOR (E34/F01/S01): a verdict records who gave it, and is not one of the admin actions.
An archived market refuses anyone.

## Where it is kept

- `verdict_refusal` in [`back-end/api/markets.py`](../../../back-end/api/markets.py) is the role check and `review_is_open`; the market read serves it per person as `verdictLockReason`, so every review screen offers exactly what the write takes.
- `_reviewer_on` in [`back-end/app.py`](../../../back-end/app.py) is the one gate of every review write (a verdict, a selection's verdicts, a follow-up's owner, a claim), and answers a refusal with a 403 in its words.
- `review_is_open` reads the table kept by [the guards](../../implementation/modules/guards.md); the verdict itself is stored on [the application document](../../implementation/data/application-document.md#statuses).
- `back-end/tests/test_a_verdict_says_who.py` pins it in every phase.
