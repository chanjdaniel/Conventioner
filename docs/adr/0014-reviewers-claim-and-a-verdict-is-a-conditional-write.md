---
layer: implementation
kind: adr
describes:
  - back-end/api/applications.py#update_application_status
  - back-end/api/applications.py#claim_next_for_review
  - back-end/api/applications.py#CLAIM_LEASE
  - back-end/api/applicants.py#review_selection
  - front-end/src/utils/reviewClaims.ts
verified: 2026-10-30
sources:
  - brain-dump/2026-10-19#11
  - brain-dump/2026-10-19#23
  - E34/F03
  - E34/F03/S01
  - E34/F03/S02
  - E34/F04/S02
  - E38/F06/S01
  - E38/F07/S04
  - E38/F07/S02
status: accepted
---

# Reviewers claim what they look at, and a verdict is a conditional write

The glossary concept: [Application](../business/concepts/application.md).

## Context

A team of organizers reviews a market's applications at the same time, from different places.
A verdict was an unconditional write, so when two landed on one application the last one won, silently, and nothing said who had given either.
Each reviewer's queue was their own browser's copy of the undecided applications, so two reviewers starting together walked the same cards in the same order and duplicated each other's work.
The [automatic rejections](../business/rules/automatic-rejections.md) and an import write statuses too, beside the reviewers, from requests nobody is watching.

## Decision

**Both: a claim, so reviewers do not meet, and a conditional write, so a meeting cannot lose a verdict.**

**A reviewer holds the card they look at.**
A claim is `held_by` and `held_until` on the application, a five-minute lease (`CLAIM_LEASE` in [`back-end/api/applications.py`](../../back-end/api/applications.py)).
`POST /markets/:id/review/next` hands the reviewer the next undecided application, in arrival order after the one they moved on from (which keeps its place when a verdict on it was what moved them on), that nobody else holds (`claim_next_for_review`); taking it is a write conditioned on the claim it read, so two reviewers asking at once are handed different cards, and the reviewer's other claims are let go.
The open card renews its claim every minute while the reviewer is active and stops after five idle minutes, so a card left open on an unattended screen lapses ([`front-end/src/utils/reviewClaims.ts`](../../front-end/src/utils/reviewClaims.ts)); leaving the review lets it go, and any new status lets it go on the server.
Hand-outs can overlap (a Next pressed again, a verdict, a refresh), and their answers can come back in either order, so only the newest is taken: an answer to one a later hand-out overtook holds nothing and is not put up, and its card, claimed on the server all the same, is let go once the newest hand-out has answered, unless that is the card now held; one that answers after the reviewer has left lets its card go (E38/F07/S04).
Someone who gives no verdicts walks the queue locally and holds nothing.

**A verdict is written only on what the reviewer saw.**
Every review sends `seen` with its verdict: the status, the verdict's time and the answers' time it showed.
`update_application_status` writes only if all three are still those (`if_unchanged_since`); otherwise the verdict is refused with a 409 naming who changed it and to what ("<email> approved this application since you opened it.", an automatic rejection, or "Its answers changed since you opened it."), with the application as it stands, and the card stays on it until the reviewer decides again.
The automatic rejections write through the same condition, so a person's verdict that lands while a rule is judging is never overwritten.
For a reviewer who may not change a verdict (E38/F06/S01), the write also refuses an application already approved or rejected (`unless_decided`), so one decided between their look and their write is this same 409, never written over.

**A claim never refuses a verdict; the condition is the guarantee.**
The claim keeps reviewers apart in the ordinary case, and says who holds a card ("<email> is looking at this."); the conditional write is what holds when a claim has lapsed, when a card was opened from a link, or when a verdict comes from the All view.
A verdict on a selection (`review_selection` in [`back-end/api/applicants.py`](../../back-end/api/applicants.py)) writes each ticked application as one verdict is: one another reviewer holds is not written, one changed since is skipped with who changed it, and one already at that status is skipped, so a follow-up is never handed to a new owner by being marked again; one already approved or rejected is skipped, for someone who may not change a verdict, with the change row's sentence; the answer lists what was written and why each other was not.

## Consequences

- Every writer of an application's status that may race a reviewer must pass what it read; one that writes unconditionally can overwrite a verdict silently again.
  An application is stored with `verdict_at: null` until its first verdict, and the condition reads null and absent alike.
- The claim is advisory: a reviewer can still be refused a verdict, so the review must always be able to show the application as it now stands.
- A card left idle for five minutes can be handed to another reviewer; the first reviewer's verdict on it is still taken, unless the other has changed it since, when it is refused like any other.
- The organizer's view serves `heldBy` while a claim stands, so the All view names the holder on the row, refuses to tick it, and reads the list again every 30 seconds while the tab is in view.
- The hold is who is looking at a card now, never whose share it is: an application dealt to a chosen reviewer carries that as `reviewer` beside the hold, a chosen reviewer is handed their share first, under the same conditioned claim, and a deal never moves a hold ([ADR 0020](0020-an-application-is-dealt-to-one-reviewer.md), [the review is dealt among chosen reviewers](../business/rules/the-review-is-dealt-among-chosen-reviewers.md)).
- A claim is not a change, so [the market's history](../implementation/data/history.md) records none; the verdict it leads to, and a selection's as one entry, are recorded.
- What a reviewer saw is three fields that already exist, so no version counter was added to the application document ([the application document](../implementation/data/application-document.md)).
- Who may review, and until when, is the verdicts' own rule ([verdicts settle on entering assignment](../business/rules/verdicts-settle-on-entering-assignment.md)); the review screens are [reviewing applications](../business/flows/review.md), and a follow-up's owner is [needs follow-up](../business/rules/needs-follow-up.md).

## Considered and rejected

- **The last write wins**, the state before: two reviewers lost each other's verdicts, and nobody could tell.
- **A claim alone**: a lapsed claim, a card opened from a link, the All view and the automatic rejections all write without one, so it would leave every one of those races open.
- **A conditional write alone**: no verdict is lost, but two reviewers are still handed the same cards and one of them is refused on every card they share.
- **A claim that refuses a verdict**, a true lock: a card left open on a tab nobody watches would strand its application until the lease ran out, and the verdict the second reviewer gives is as good as the first's.
- **A version counter on the application**: the status, the verdict's time and the answers' time already say what a reviewer saw, and a counter would need every writer to bump it.
