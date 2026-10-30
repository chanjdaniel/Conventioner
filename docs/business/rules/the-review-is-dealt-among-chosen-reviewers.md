---
layer: business
kind: rule
describes:
  - back-end/review_team.py
  - back-end/api/markets.py#choose_reviewers
  - back-end/api/markets.py#reviewer_candidates
  - back-end/review_team.py#deal_arrivals
  - front-end/src/components/market/ReviewersPanel.vue
  - front-end/src/components/market/ReviewerPicker.vue
  - front-end/src/utils/reviewTeam.ts
verified: 2026-10-30
sources:
  - E38/F07
  - E38/F07/S01
  - E38/F07/S02
  - E38/F07/S03
---

# The review is dealt among chosen reviewers

An Admin or the owner may choose who reviews a market's applications, and every open application is then dealt to one of them, so each reviewer has a share before anyone starts.
With no reviewers chosen, everyone reviews first come, first served, as before.

**Serves:** [Reviewing applications as a team](../intents/reviewing-applications-as-a-team.md).

## Why

A team of four starting on 200 applications had no way to say "these 50 are yours", and nobody could tell afterwards who was meant to decide which.
Dealing the open applications divides the work before anyone starts, and the record of whose share each was answers the question afterwards.

**The deal is round robin, in the order the applications arrived**, to the reviewers in the order their addresses sort, so the deal is the same whoever chose them and the team can predict it.
It never counts what each reviewer has left open: being quick earns nobody more (Daniel: "we don't want to punish our viewer for being fast").
Seven open applications among three reviewers deal three, two and two, the extra one to the first in address order.

**Each application that arrives open is dealt to the next reviewer in turn**: an applicant's submission, every import ([the CSV import](../../implementation/modules/csv-import.md)), and an application the [automatic rejections](automatic-rejections.md) return to open when the rules are saved, the form is saved or a vendor's info is updated.
An application a rule rejects as it arrives is decided, so it is not dealt until the rules return it to open.
The turn carries on from the last deal, so after seven applications among three reviewers the eighth goes to the second reviewer, and two applicants submitting at once take different turns.

**Any change of reviewers deals every open application again**, so a newcomer gets an even share and nothing is stranded with someone removed.
A decided application stays with whoever had it, as the record of whose share it was, and so does a follow-up, unless its owner is a reviewer removed by the change.
**A removed reviewer's follow-ups go back into the pool**, dealt in arrival order with the open applications: each keeps its status and is handed to the reviewer it is dealt to, as its owner and its reviewer, so someone still reaches out, and the history says who held it before.
A follow-up handed to someone who was never a reviewer stays theirs.
Saving the same people again changes nothing and records nothing; choosing no one returns every open application to first come, first served, and leaves every follow-up with its owner.

**A chosen reviewer who no longer holds a role on the market can no longer review here**: their role taken in Manage market, or their place in the organization gone.
Every deal skips them, the panel marks them "Can no longer review here", and their share stays theirs until an Admin removes them, which deals it again as any removal does; nothing removes them silently.
With nobody able, nothing is dealt.

**Being dealt an application is never a lock**: the hold of [ADR 0014](../../adr/0014-reviewers-claim-and-a-verdict-is-a-conditional-write.md) is who is looking at a card now, the reviewer is whose share it is, and a deal never moves a hold.

## Who may

Choosing is the row "Choose reviewers" of [what each role may do](what-each-role-may-do.md) (default Admin), open from draft through the stage where applications are reviewed, and refused once the review has closed on entering Assignment ([verdicts settle on entering assignment](verdicts-settle-on-entering-assignment.md)) and on [an archived market](an-archived-market-is-read-only.md).
A reviewer is chosen from the people the chooser may hand a follow-up to ([needs follow-up](needs-follow-up.md)): everyone with a role on the market to someone in its organization, and only the people the market's roles name to anyone else, so the organization's addresses never reach someone outside it.
Anyone else's address is refused by name; a current reviewer the chooser is not offered may stay.

## Where it is kept

- The team, and how far the deal has gone, are `reviewTeam` on [the market document](../../implementation/data/market-document.md); whose share an application is, `reviewer` on [the application document](../../implementation/data/application-document.md); [ADR 0020](../../adr/0020-an-application-is-dealt-to-one-reviewer.md) records why.
- `PUT /markets/:id/reviewers` (`choose_reviewers` in [`back-end/api/markets.py`](../../../back-end/api/markets.py)) is the one write of the team, asking [the market's actions](../../implementation/modules/market-actions.md) row `choose-reviewers`; [`back-end/review_team.py`](../../../back-end/review_team.py) deals, and nothing else writes either field.
- The market read serves every reader the reviewers, each with whether they may still review here, and serves whom the reader may choose only to someone who may choose.
- A choice and the deal it made are entries of [the market's history](../../implementation/data/history.md), worded on Manage market's History and, for one vendor, in their drawer ([reading the market's history](../flows/reading-the-markets-history.md)).
- The Reviewers panel on the Applications tab ([`ReviewersPanel.vue`](../../../front-end/src/components/market/ReviewersPanel.vue)) shows the reviewers and changes them, through one picker ([`ReviewerPicker.vue`](../../../front-end/src/components/market/ReviewerPicker.vue)) and the words [`front-end/src/utils/reviewTeam.ts`](../../../front-end/src/utils/reviewTeam.ts) holds ([reviewing applications](../flows/review.md#dividing-the-review)).
