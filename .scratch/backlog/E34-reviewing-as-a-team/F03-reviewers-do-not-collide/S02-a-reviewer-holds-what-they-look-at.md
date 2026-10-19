---
id: E34/F03/S02
title: A reviewer holds the application they are looking at
type: story
status: in-progress
blocked_by: [E34/F03/S01]
pr: []
---

## What to build

Opening an application in the one-by-one review places a claim on it, renewed while it stays open and released on a verdict, on moving on, or after five idle minutes.
Moving to the next application asks the server for the next undecided one nobody else holds, so two reviewers walk different cards.
An application another reviewer holds says so ("Alex is looking at this") wherever it is listed.
A claim never refuses a verdict on its own: `S01` is what keeps verdicts consistent.

## As built

- A claim is `held_by` (`MarketPerson`) and `held_until` on the application, a five-minute lease (`api/applications.py`: `claim_next_for_review`, `renew_claim`, `release_claim`).
- `POST /markets/:id/review/next` hands out the next undecided application in arrival order after the one moved on from, that nobody else holds, claiming it with a write conditioned on the claim it read, and lets go of the reviewer's others. `PUT`/`DELETE .../claim` renew it (every minute, `useReviewClaims`) and let it go (leaving the review).
- Any new status lets the claim go; a claim never refuses a verdict.
- The organizer's view serves `heldBy` while the claim stands. When every card left is held, the review says by whom and offers to look again; the bulk view (`F04/S01`) shows each holder.
- A reader (below EDITOR) walks the queue locally and holds nothing.
- The test fake's `mongo_matches` now compares a sub-document by equality, as Mongo does, rather than reading any dict as operators.

## Acceptance criteria

- [x] Two reviewers pressing Next together are shown different applications.
- [x] A claim lapses five minutes after its holder stops, and the application is offered again.
- [ ] A held application shows its holder in the bulk view.
