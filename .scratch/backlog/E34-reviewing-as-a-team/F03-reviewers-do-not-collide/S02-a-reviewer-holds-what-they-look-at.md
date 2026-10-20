---
id: E34/F03/S02
title: A reviewer holds the application they are looking at
type: story
status: done
blocked_by: [E34/F03/S01]
pr: [#111]
---

## What to build

Opening an application in the one-by-one review places a claim on it, renewed while it stays open and released on a verdict, on moving on, or after five idle minutes.
Moving to the next application asks the server for the next undecided one nobody else holds, so two reviewers walk different cards.
An application another reviewer holds says so ("Alex is looking at this") wherever it is listed.
A claim never refuses a verdict on its own: `S01` is what keeps verdicts consistent.

## As built

- A claim is `held_by` (`MarketPerson`) and `held_until` on the application, a five-minute lease (`api/applications.py`: `claim_next_for_review`, `renew_claim`, `release_claim`).
- `POST /markets/:id/review/next` hands out the next undecided application in arrival order after the one moved on from, that nobody else holds.
  It claims it with a write conditioned on the claim it read, and lets go of the reviewer's others.
  A reviewer opening a named application (a link from the Vendors drawer) asks for it with `want`, and is handed it unless someone else holds it.
- `PUT`/`DELETE .../claim` renew it and let it go (leaving the review).
  `useReviewClaims` renews every minute while the reviewer is active, and stops after five idle minutes, so a card left open on an unattended screen lapses.
- Any new status lets the claim go; a claim never refuses a verdict.
- The organizer's view serves `heldBy` while the claim stands.
  When every card left is held, the review says by whom and offers to look again.
- A reader (no verdicts to give) walks the queue locally with Next and N, holds nothing, and is told when the card on screen is open with someone else.
- The bulk view (`F04/S01`) shows each holder on its row and in the drawer, and reads the list again every 30 seconds while the tab is in view.
- The test fake's `mongo_matches` now compares a sub-document by equality, as Mongo does, rather than reading any dict as operators.

## Acceptance criteria

- [x] Two reviewers pressing Next together are shown different applications.
- [x] A claim lapses five minutes after its holder stops, and the application is offered again.
- [x] A held application shows its holder in the bulk view.
