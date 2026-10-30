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
  - front-end/src/utils/reviewers.ts
verified: 2026-10-31
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
The turn carries on from the last deal, so after seven applications among three reviewers the eighth goes to the second reviewer; however a change of reviewers and arrivals interleave, each is dealt in turn and no reviewer is skipped, since every deal holds the market while it reads and writes the turn.
An applicant's own save deals their application and nobody else's, so the history never names a vendor as dealing another's.

**Any change of reviewers deals every open application again**, so a newcomer gets an even share and nothing is stranded with someone removed.
A decided application stays with whoever had it, as the record of whose share it was, and so does a follow-up, unless its owner is a reviewer removed by the change.
**A removed reviewer's follow-ups go back into the pool**, dealt in arrival order with the open applications: each keeps its status and is handed to the reviewer it is dealt to, as its owner and its reviewer, so someone still reaches out, and the history says who held it before.
A follow-up handed to someone who was never a reviewer stays theirs.
Saving the same people again changes nothing and records nothing; choosing no one returns every open application to first come, first served, and leaves every follow-up with its owner.

**A chosen reviewer who no longer holds a role on the market can no longer review here**: their role taken in Manage market, or their place in the organization gone, or their role one the table's row "Be chosen as a reviewer, and then give verdicts and follow-ups" no longer reaches.
Every deal skips them, the panel marks them "Can no longer review here", and their share stays theirs until an Admin removes them, which deals it again as any removal does; nothing removes them silently.
With nobody able, nothing is dealt.

**Being dealt an application is never a lock**: the hold of [ADR 0014](../../adr/0014-reviewers-claim-and-a-verdict-is-a-conditional-write.md) is who is looking at a card now, the reviewer is whose share it is, and a deal never moves a hold.

## Who may

Choosing is the row "Choose reviewers" of [what each role may do](what-each-role-may-do.md) (default Admin), open from draft through the stage where applications are reviewed, and refused once the review has closed on entering Assignment ([verdicts settle on entering assignment](verdicts-settle-on-entering-assignment.md)) and on [an archived market](an-archived-market-is-read-only.md).
A reviewer is chosen from the people the chooser may hand a follow-up to ([needs follow-up](needs-follow-up.md)): everyone with a role on the market to someone in its organization, and only the people the market's roles name to anyone else, so the organization's addresses never reach someone outside it.
Only those whose role reaches the row "Be chosen as a reviewer, and then give verdicts and follow-ups" (default Viewer, so anyone with a role) are offered.
Anyone else's address is refused by name; a current reviewer the chooser is not offered may stay.

**A chosen reviewer decides, whatever their role** (E38/F07/S03): being chosen lets them take the row "Give verdicts and follow-ups", so a chosen Viewer approves, rejects and marks follow-ups on any application, as an Editor does, and changes no verdict already given, which stays the change row's ([what each role may do](what-each-role-may-do.md)).
The owner raising who may be chosen to Editor takes it from the chosen Viewers on that market; a Viewer who is not chosen reads the review and decides nothing.

**Deciding someone else's share is allowed, after a warning** (E38/F07/S03): the server refuses no one who may give verdicts, chosen or not, and the screen says whose it is.
With reviewers chosen, every row and card names its reviewer, and an open application or a follow-up dealt to someone other than the reader says so above its verdict buttons, on every such card and never as a dialog to click through, so helping a reviewer who is behind stays easy; a selection's confirmation counts the ticked ones dealt to others.

## Where it is kept

- The team, and how far the deal has gone, are `reviewTeam` on [the market document](../../implementation/data/market-document.md); whose share an application is, `reviewer` on [the application document](../../implementation/data/application-document.md); [ADR 0020](../../adr/0020-an-application-is-dealt-to-one-reviewer.md) records why.
- `PUT /markets/:id/reviewers` (`choose_reviewers` in [`back-end/api/markets.py`](../../../back-end/api/markets.py)) is the one write of the team, asking [the market's actions](../../implementation/modules/market-actions.md) row `choose-reviewers`; [`back-end/review_team.py`](../../../back-end/review_team.py) deals, and nothing else writes either field.
- The market read serves every reader the reviewers, each with whether they may still review here, and serves whom the reader may choose only to someone who may choose, while the review is open ([one market, from the server](../../implementation/conventions/one-market-from-the-server.md)).
- A choice and the deal it made are entries of [the market's history](../../implementation/data/history.md), worded on Manage market's History and, for one vendor, in their drawer ([reading the market's history](../flows/reading-the-markets-history.md)).
- The Reviewers panel on the Applications tab ([`ReviewersPanel.vue`](../../../front-end/src/components/market/ReviewersPanel.vue)) shows the reviewers and changes them, through one picker ([`ReviewerPicker.vue`](../../../front-end/src/components/market/ReviewerPicker.vue)) and the words [`front-end/src/utils/reviewTeam.ts`](../../../front-end/src/utils/reviewTeam.ts) holds ([reviewing applications](../flows/review.md#dividing-the-review)).
  Whose share each application is, and the warning on deciding another's, are worded by [`front-end/src/utils/reviewers.ts`](../../../front-end/src/utils/reviewers.ts) for the All view's rows, its drawer and One by one's card ([reviewing applications](../flows/review.md#dividing-the-review)).
  The same picker is offered as an own-form market opens applications, in the phase rail's dialog ([the phase rail](../../implementation/modules/phase-rail.md), [taking applications](../flows/taking-applications.md#h1-open-applications)), and on a Google Form market's first import, in its preview step ([`CsvImportView.vue`](../../../front-end/src/views/CsvImportView.vue), [the import](../flows/import.md#h2a-first-import-everything-maps)).
