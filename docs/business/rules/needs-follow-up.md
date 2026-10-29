---
layer: business
kind: rule
describes:
  - back-end/api/applications.py#reassign_follow_up_owner
  - back-end/api/markets.py#follow_up_owner
  - back-end/api/permissions.py#people_with_market_role
  - back-end/api/permissions.py#follow_up_owners_for
  - back-end/guards.py#AllApplicationsReviewedGuard
  - front-end/src/components/application/FollowUpDialog.vue
verified: 2026-10-30
sources:
  - brain-dump/2026-10-19#9
  - brain-dump/2026-10-19#21
  - brain-dump/2026-10-19#22
  - E34/F02
  - E34/F02/S01
  - T15
  - decision/2026-10-22
---

# Needs follow-up

"Needs follow-up" is a stored status a reviewer gives an application that cannot be decided until someone reaches out to the vendor; it has an owner, and it blocks Begin Assignment as an undecided application does.
It is marked like a verdict, by someone, and the application waits out of the review queue until it is approved or rejected.

**Serves:** [Reviewing applications as a team](../intents/reviewing-applications-as-a-team.md).

## Why

An application that needs a question answered cannot be approved or rejected yet; passed over, it is found again only by chance, and nobody knows whose it is to chase.
A follow-up is a decision that the application cannot be decided yet, so it is recorded with who marked it and who will reach out, and the market cannot be assigned while one is open.
"Next" still passes over a card and records nothing.

**The owner is whoever marked it, unless they name someone else**, and it can be handed on at any time to anyone with a role on the market, by [the role rule](what-each-role-may-do.md): the people Manage market lists, and the market's organization's owner, admins and members, who can all see the market to work on it.
An organization's admins run its markets, so they review them too; an owner drawn from the market's own roles alone would leave the admin reviewing silently replaced by the market's owner, and refused when choosing themselves.
Members are included, as an explicit Viewer is.
**Who is offered them depends on who asks** ([decision of 2026-10-22](../../records/DECISION_2026-10-22.md)): someone in the organization - its owner, an admin or a member - is offered everyone above, while an Editor from outside it, there by a role on the market alone, is offered only the people the market's roles name, so the organization's addresses never reach a volunteer given one market.
The server takes as owner only the people that requester is offered.
Nothing is sent to the owner; the All view's "Mine" filter is how they find their follow-ups.

**It is not undecided to the automatic rejections**: a rule never judges a follow-up, since a person has looked at it and decided it needs more.

**The applicant reads "Submitted"**, as for every other status, until results are published ([an applicant never reads a verdict early](an-applicant-never-reads-a-verdict-early.md)); entering `assignment` needs every follow-up resolved, so none is left when they are.

## Who may

An Editor marks one, hands it on and resolves it, as with every verdict; it settles with the other verdicts on entering `assignment` ([verdicts settle on entering assignment](verdicts-settle-on-entering-assignment.md)).
They name as its owner one of the people they are offered: everyone with a role on the market if they are in its organization, only the people the market's roles name if not.

## Where it is kept

- The status `needs_follow_up`, its giver in `verdict_by` and its owner in `follow_up_owner` are on [the application document](../../implementation/data/application-document.md#statuses); `update_application_status` writes the owner with the status and clears it with any other.
- It is marked through the verdict endpoint, and `PUT /markets/:id/applications/:id/follow-up-owner` hands it on (`reassign_follow_up_owner` in [`back-end/api/applications.py`](../../../back-end/api/applications.py), written only while the application still needs one); an owner must be someone `follow_up_owner` in [`back-end/api/markets.py`](../../../back-end/api/markets.py) finds among the people that requester is offered, the very list the market read serves them, and anyone else answers 400: "A follow-up's owner must have a role on this market.", or, to someone outside the organization, "You can hand a follow-up only to someone named in this market's roles." whoever the address belongs to, so the answer never tells them an organization address from a stranger's.
- The read of one market serves those people's addresses as `peopleOnMarket`, a fact [derived on the market](../../implementation/conventions/one-market-from-the-server.md) (`follow_up_owners_for` in [`back-end/api/permissions.py`](../../../back-end/api/permissions.py): to someone in the organization, `people_with_market_role`, the market's roles and then its organization's people, each once; to anyone else, the market's roles alone), and serves it only to someone who may give a verdict - an Editor or above, by the verdict's own gate - so a Viewer reads an empty list; `role_emails` stays the market's own roles, which Manage market lists.
- `AllApplicationsReviewedGuard` in [`back-end/guards.py`](../../../back-end/guards.py) counts follow-ups apart from the undecided, so Begin Assignment's reason names them: "1 application needs a follow-up".
- [`FollowUpDialog.vue`](../../../front-end/src/components/application/FollowUpDialog.vue) asks who follows up, offering `peopleOnMarket` (read through `verdictActions.ts`) with the reviewer chosen when they are among them, and what is needed; the box opens on the vendor's note as it stands, and is saved to [their notes](vendor-notes.md) only when changed, so nothing there is written over unseen.
- On the review card's "Followed up by" (`ApplicationMonitor.vue`) an Editor or above gets the select to hand it on; a Viewer - whose `peopleOnMarket` is empty - reads the recorded owner as plain text (the address, or a dash when the application records none) instead of an empty disabled select.
  The select always names the recorded owner: when they are not among the people this reader is offered - an organization admin with no market role owns it, and an Editor from outside the organization opens the card - they lead the list as its current choice, so the box never reads blank, and choosing them again hands it to no one new.
- Two reviewers marking one card at once meet [ADR 0014](../../adr/0014-reviewers-claim-and-a-verdict-is-a-conditional-write.md); a selection marked at once is owned by the reviewer.
- How it looks in the review is [I1 and the All view](../flows/review.md#i1-work-through-the-queue).

## Superseded

- The review's third verdict was Skip (wayfinding/real-market-readiness/04); it became this status, beside "Next" (brain-dump/2026-10-19#9, E34/F02/S01).
- The applicant was to read "under review" while a follow-up was open (brain-dump/2026-10-19#9); every applicant reads "Submitted" until results are published, so nothing a reviewer or a rule does shows early (E36/F05/S01).
