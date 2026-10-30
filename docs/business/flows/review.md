---
layer: business
kind: flow
describes:
  - front-end/src/components/application/ApplicationMonitor.vue
  - front-end/src/components/application/ApplicationsAll.vue
  - front-end/src/components/market/MarketApplicationsTab.vue
  - front-end/src/components/application/ListFreshness.vue
  - front-end/src/components/market/ReviewersPanel.vue
verified: 2026-10-30
sources:
  - wayfinding/v0-1-0/map
  - wayfinding/v0-1-0/08
  - wayfinding/real-market-readiness/04
  - wayfinding/claims-and-room/map
  - wayfinding/readable-journey/map
  - brain-dump/2026-10-19#9
  - brain-dump/2026-10-19#10
  - brain-dump/2026-10-19#11
  - brain-dump/2026-10-19#23
  - brain-dump/2026-10-19#29
  - E19/F03
  - E31/F04/S04
  - E32/F01/S01
  - E32/F02
  - E33/F03/S02
  - E34/F01/S01
  - E34/F02/S01
  - E34/F03
  - E34/F04
  - E36/F01/S01
  - E27/F01/S03
  - bug/42
  - E42/F01/S03
  - bug/43
  - E08/F04
  - E30/F01/S05
  - E32/F01/S02
  - E34/F03/S02
  - E34/F04/S01
  - E34/F04/S02
  - T15
  - E38/F05/S01
  - E38/F05/S02
  - E38/F05/S03
  - E38/F04/S01
  - E38/F06/S01
  - E38/F07/S04
  - E38/F07/S02
  - E38/F07/S03
---

# Reviewing applications

**Who:** the market's Editor, Admin or owner gives verdicts, and so does a reviewer chosen for the review whatever their role, a Viewer included, unless the market's owner raised who may be chosen; a Viewer who is not chosen reads the queue with Next and decides nothing; changing a verdict already given and moving the market (I4 to I6) are an Admin's ([what each role may do](../rules/what-each-role-may-do.md)).
**Where they start:** the Applications page.
**Serves:** [Reviewing applications as a team](../intents/reviewing-applications-as-a-team.md).

Applications arrive and are reviewed in one phase, shown as Review on a Google Form market and Applications on one whose vendors apply on its page ([ADR 0016](../../adr/0016-one-stage-for-applications-and-review.md)).
Verdicts are open from the first application until the market enters Assignment, so reviewing starts as soon as applications arrive and must be finished before Begin Assignment ([verdicts settle on entering assignment](../rules/verdicts-settle-on-entering-assignment.md)).
A line above the review says where the market stands, in words: what arrives ("Every response you imported from your Google Form is here.", "This market is open for applications. New ones keep arriving here." or "This market is not taking applications. No new ones will arrive."); from Assignment on "The review is closed: every verdict settled when the market entered Assignment. …".
How many are left to decide is the rail's to say, as the blocker on Begin Assignment.
The page offers no import on either path ([review needs an import](../rules/review-needs-an-import.md)).
The page has two views ([`MarketApplicationsTab.vue`](../../../front-end/src/components/market/MarketApplicationsTab.vue)), chosen under "How do you want to review?" with a line on what each is: "All" ([`ApplicationsAll.vue`](../../../front-end/src/components/application/ApplicationsAll.vue)), first and the default, and "One by one" ([`ApplicationMonitor.vue`](../../../front-end/src/components/application/ApplicationMonitor.vue)).
The choice is kept in the address: no `view` is All, and a saved `?view=all` still opens it; One by one is `?view=one`, and so is a link to one application (`?application=<id>`, as the Assignment tab's refusal links to it), which opens on its card.
Choosing All drops both `view` and `application`.
Both views say when their list was last read from the server, "Updated just now" or "Updated N minutes ago", ageing on screen, with "Refresh" beside it to read it again at once ([`ListFreshness.vue`](../../../front-end/src/components/application/ListFreshness.vue)).
A refresh is a re-read, not a reset: the All view keeps the ticks of rows still shown, One by one keeps the card up while it is still to decide and moves on from one decided elsewhere, and a refresh that fails says "Could not refresh. The list is as it was last read." and keeps the list.
Both views give verdicts and mark follow-ups through one composable ([`front-end/src/utils/verdictActions.ts`](../../../front-end/src/utils/verdictActions.ts)), so they cannot treat one differently.
Every verdict records who gave it and when, and the review shows it: "Approved by <email>, <date and time>", or "Rejected automatically: <reason>" for one an [automatic rejection](form-tab.md#f3-what-a-reviewer-reads-first) gave as the application arrived.

**Task:** "Go through the applications and decide who gets in."

## I1. Work through the queue

**Status:** Works (walked live; follow-ups, held cards and the giver read from the code as of E34/F01 to E34/F03: `needs-a-follow-up.spec.ts`, `a-reviewer-holds-what-they-look-at.spec.ts`, `reviewers-do-not-collide.spec.ts`, `a-verdict-says-who.spec.ts`; the card's reviewer and warning as of E38/F07/S03: `rowsNameTheirReviewer.test.ts`).

The queue is triage: one application at a time, carrying every answer it holds, decided from the keyboard, with progress counted, so each verdict is given on a person rather than on a population.

1. "1 of N to review", a tally ("N reviewed · A approved · R rejected") and one card at a time, in the order the applications arrived.
2. A card shows the applicant's email, status, submitted date, the highlighted answers first, then "N more answers" (or "This application carries no answers."); a web address in an answer is a link that opens in a new tab.
   A table-share request that needs attention shows above the answers, so it is never inside the "N more answers" disclosure, and the vendor's notes below them.
   With reviewers chosen, "Reviewer: <email>" (or "Reviewer: you") under the status says whose share it is ([dividing the review](#dividing-the-review)).
   An answer an organizer updated reads as updated, with "Updated by <address>, <when>; they wrote <their answer>" under it ([an update is kept beside the vendor's answer](../rules/an-update-is-kept-beside-the-vendors-answer.md)).
3. "Reject" (R), "Needs follow-up" (S), "Next" (N), "Approve" (A); the keyboard letters work.
   Above them, on an open application or a follow-up dealt to another reviewer, someone who may decide it reads "This application is dealt to <email>. If you decide it, its history will say you decided it for them."
4. "Needs follow-up" opens "Needs a follow-up": "<email>'s application waits until someone reaches out.", "Who will follow up" (anyone with a role on the market, the organization's owner, admins and members included, or, to a reviewer from outside the organization, only the people the market's roles name; the reviewer unless they choose another; nothing is sent to them) and, to someone who may write vendor notes, "Their notes: what is needed (optional)"; "Mark for follow-up".
   A chosen Viewer, who writes no notes, marks the follow-up without that box.
   A follow-up waits out of the queue, and "Include the N follow-ups" brings them back; on its card "Followed up by" hands it to someone else.
5. When the queue is empty: "All N reviewed", "Nothing left to review." (or "Nothing else to review; N need a follow-up.").

Two reviewers at once are never handed the same card: the card a reviewer has open is held for them while they work on it, until they have been idle for five minutes and its lease runs out, and another reviewer reads "<email> is looking at this." on it; when every card left is open with someone else, "Every application left is open with another reviewer: …" with "Look again".
A verdict on a card someone else changed since it was opened is refused on the card, naming them: "<email> approved this application since you opened it.", with "Back to the queue" ([ADR 0014](../../adr/0014-reviewers-claim-and-a-verdict-is-a-conditional-write.md)).
If they approved or rejected it, the card offers a verdict only to someone who may change one (below), and tells a reviewer it refuses the row's sentence instead.
Someone who gives no verdicts walks the queue with Next and holds nothing, and is told when the card on screen is open with someone else.
The card on screen is always the one the newest Next, verdict, refresh or load handed over: an answer that comes back late, after a later one was asked for, never puts its card up (the Next race, E38/F07/S04).
An advisory appears when the form asks only the essential questions, since every card then reads alike.
Covered by: `market-journey.spec.ts`, `needs-a-follow-up.spec.ts`, `a-chosen-reviewer-decides.spec.ts`, `a-reviewer-holds-what-they-look-at.spec.ts`, `reviewers-do-not-collide.spec.ts`, `a-verdict-says-who.spec.ts`, `result-and-review-read-cleanly.spec.ts`, `the-list-says-when-it-was-read.spec.ts`.

## I2. Change a decision

**Status:** Works (walked live; the giver read from the code as of E34/F01/S01; who may change one as of E38/F06/S01: `changing-a-verdict-is-its-own-row.spec.ts`).
"Show N reviewed" lists decided applications by email, each with its verdict and who gave it, and "Approve instead" on a rejection or "Reject instead" on an approval.
**Changing a verdict is its own row of the table**, "Change a verdict, or overturn an automatic rejection" (default Admin), on top of giving one ([what each role may do](../rules/what-each-role-may-do.md)): "Approve instead" and "Reject instead", an automatic rejection's included, are offered only to someone it lets change one, and a reviewer it refuses reads its sentence once, above the list: "Only an Admin or the owner may change a verdict or overturn an automatic rejection on this market."
A verdict is approved or rejected: deciding a follow-up is giving one, while sending an approved or rejected application back to needs follow-up is changing one, so the change row asks it too (E38/F06/S01).
A follow-up is not listed here: it is decided from its own card, or from All.
From Assignment on the list only reads.
Covered by: `the-all-view.spec.ts` ("a verdict changes while the review is open, then the drawer only shows it"), `changing-a-verdict-is-its-own-row.spec.ts`.

## The All view

**Status:** Works (read from the code as of E34/F04 and E38/F05: `the-all-view.spec.ts`, `the-list-says-when-it-was-read.spec.ts`; Export, E42/F01/S03: `exporting-from-the-applications-tab.spec.ts`; the reviewer and the warning, E38/F07/S03: `rows-name-their-reviewer.spec.ts`).

1. "All" lists every application by name and email, its highlighted answers on one line, its status, who gave the verdict, with reviewers chosen whose share it is ("Reviewer: <email>", or "Reviewer: you"), "Followed up by <email>" and who has it open.
2. "Filter": "Any status", "Open" (every application not decided yet, `?status=undecided` in the address), "Needs follow-up", "Approved", "Rejected", and "Mine: the follow-ups I own"; a line under it says what Open and Needs follow-up mean, and "N of M" says how many show.
3. A row opens the [vendor drawer](vendor-drawer.md) with the application's status and Reject, Needs follow-up and Approve above its tabs; on an application already approved or rejected, only for someone who may change a verdict, and a reviewer the change row refuses reads its sentence there instead.
   The drawer names the application's reviewer as its row does, and on an open application or a follow-up dealt to another reviewer warns someone who may decide it above the verdicts, as One by one's card does (I1).
   Its "Update info" updates the vendor's answers, and the list is read again once it saves.
4. Tick rows and give one verdict to the selection: "N applications selected", then Reject, Needs follow-up or Approve, confirmed by count ("Approve N applications?"): "Each is written only if it is still as you see it here; any that another reviewer has changed or has open is skipped, and said so."
   "Select all" ticks every row the filter and Mine show, and none they hide; it leaves the rows another reviewer has open, and says so ("N applications not selected: another reviewer has them open.").
   For someone who may not change a verdict it leaves the rows already approved or rejected too, in a clause of their own: "N applications not selected: another reviewer has K open, and M already have a verdict, which only an Admin or the owner may change.", naming whoever the market's table lets change one (`notSelectedLine` in [`front-end/src/utils/reviewQueue.ts`](../../../front-end/src/utils/reviewQueue.ts)).
   A row another reviewer has open cannot be ticked, nor, by someone who may not change a verdict, one already approved or rejected, whose reason the list says once above its rows; a filter that hides a ticked row unticks it, and so does a re-read that shows it decided meanwhile.
   A follow-up given to a selection is owned by the reviewer who gave it.
   When any ticked row is an open application or a follow-up dealt to another reviewer, the confirmation adds "K of them are dealt to other reviewers; their history will say you decided them." (or "1 of them is dealt to another reviewer; its history will say you decided it.").
5. The answer: "N applications approved; K skipped:" and each skipped one with why ("<email> has it open.", "Already approved.", who changed it, or the change row's sentence for one already decided).
6. "Export", after "N of M", opens the vendor export on the filter and Mine ([J15](vendors.md#j15-export-the-vendors-to-a-csv)), in every phase the view shows: "Open" as Open, a verdict as its status, "Approved" with Added by hand too, since the All view lists a vendor added by hand as approved, and Mine as the follow-ups the one exporting owns.
   So the review's lists (approved, rejected, needs follow-up) leave as a CSV before assignment as well as after.

A selection is only ever the rows ticked, one by one or by Select all, which ticks the rows on screen: each is in front of the reviewer and counted in the confirmation, and nothing past them is decided.
The list is not paged, so the rows shown are every match today; if it ever is paged, Select all still means the rows shown.
The list is read again every 30 seconds while the tab is in view, quietly, which moves its "Updated" time too; every verdict given from it, and every Refresh, re-reads the market, so the rail's count moves.

## Dividing the review

**Status:** Works (read from the code as of E38/F07/S03: `choosing-reviewers-deals-the-open-applications.spec.ts`, `removing-a-reviewer.spec.ts`, `each-arrival-is-dealt.spec.ts`, `a-chosen-reviewer-decides.spec.ts`, `rows-name-their-reviewer.spec.ts`).
The rule is [the review is dealt among chosen reviewers](../rules/the-review-is-dealt-among-chosen-reviewers.md).

1. A "Reviewers" panel sits between the line on where the market stands and Publish Results while the review is open, and is gone from Assignment on ([`ReviewersPanel.vue`](../../../front-end/src/components/market/ReviewersPanel.vue)).
   It lists the chosen reviewers' addresses, "(you)" beside the reader's own and "Can no longer review here" beside one who no longer holds a role on the market, or whose role the market's table no longer lets be chosen, or says "No reviewers chosen. Everyone reviews first come, first served."
2. Someone who may choose reviewers (an Admin or the owner, by default) is offered "Choose reviewers", or "Change reviewers" once some are chosen; anyone else reads the panel without it.
3. It opens a dialog: "Saving deals every open application again among the reviewers you choose. Decided applications stay where they are, and so do follow-ups, unless their owner is no longer a reviewer.", then a checkbox for each person the reader may choose, their own marked "(you)", the current reviewers ticked and no one else, and the hint "Choose no one and everyone reviews first come, first served. You can choose reviewers later from the Applications tab." ([`ReviewerPicker.vue`](../../../front-end/src/components/market/ReviewerPicker.vue)).
4. "Save reviewers" deals every open application among the ticked people, re-reads the market and the open view's list, and closes; a refused save keeps the dialog open with its error.
5. The people offered are those whose role the row "Be chosen as a reviewer, and then give verdicts and follow-ups" lets be chosen (any role, by default); once chosen, they give verdicts and follow-ups on any application, a Viewer included, and the frame no longer says the market is read-only to them.
6. The same picker is offered as an own-form market opens applications, and in a Google Form market's first import, on its preview step, so the reviewers can be chosen before the first application arrives ([taking applications](taking-applications.md#h1-open-applications), [the import](import.md#h2a-first-import-everything-maps)).
7. Deciding someone else's share is not refused, to anyone who may give verdicts: every row and card names its reviewer, and an open application or follow-up dealt to someone else carries the warning on its card, in its drawer and in a selection's confirmation, every time and never as a dialog to click through (I1, [the All view](#the-all-view)); the words are [`front-end/src/utils/reviewers.ts`](../../../front-end/src/utils/reviewers.ts)'s.
   A reader who decides nothing sees the reviewer's name only, and with no reviewers chosen none of it shows.

## I3. Choose what leads the card

**Status:** Works (walked live).
"Choose what leads the card" on a card edits the highlights ([F3](form-tab.md#f3-what-a-reviewer-reads-first)) in place, without moving off the card.
Covered by: `review-highlights.spec.ts`.

## I4. Enter the review

**Status:** Works (read from the code as of E38/F04/S01 and E38/F07/S02: `market-journey.spec.ts`, `every-move-lands.spec.ts`, `open-applications-offers-the-reviewers.spec.ts`, `the-first-import-offers-the-reviewers.spec.ts`).
An own-form market enters by "Open Applications", which offers someone who may choose reviewers the choice in the same step, so the review is divided from the first application ([taking applications](taking-applications.md#h1-open-applications)); a Google Form market by its first import, confirmed and written, whose preview step offers the same choice of reviewers ([the import](import.md#h2a-first-import-everything-maps)), and which takes the move itself, so the import's done step reads "This market is now in Review: …" and leads to the review with "Go to the review" ([review needs an import](../rules/review-needs-an-import.md)).
Covered by: `market-journey.spec.ts`, `every-move-lands.spec.ts`, `open-applications-offers-the-reviewers.spec.ts`, `the-first-import-offers-the-reviewers.spec.ts`.

## I5. Begin assignment

**Status:** Works (walked live; the follow-up blocker read from the code as of E34/F02/S01).
From Review or Applications, "Begin Assignment", disabled before the click with the rail naming the first blocker:

- any application undecided or needing a follow-up: "N applications are still awaiting review and N applications need a follow-up. Every application must be approved or rejected before the market can enter Assignment.", with "Finish deciding" leading back to the review;
- none at all: "There are no applications for this market. …";
- an approved applicant named a tier with no tables, naming the tier and the applicants;
- a hand placement names a seat the plan no longer has ([J10](placing-by-hand.md#j10-a-pin-the-plan-no-longer-holds)).

It lands on the Assignment tab's Settings page, and the verdicts settle there; an own-form market's application page closes with it.
Covered by: `phase-state-machine.spec.ts`, `needs-a-follow-up.spec.ts`, `placement-pins.spec.ts`.

## I6. Bring in a late export

**Status:** Works (read from the code as of E38/F04/S03: `a-late-export.spec.ts`).
On the Google Form path, More…, "Redo import": the import reads the whole responses file again, and the market stays in Review ([H2j](import.md#h2j-import-after-review-has-begun)).
Covered by: `a-late-export.spec.ts`.

Publishing the results, I7, is a step of the assignment: [the assignment and its result](assignment-and-result.md#i7-publish-results).

## The rules it obeys

- [Verdicts settle on entering assignment](../rules/verdicts-settle-on-entering-assignment.md).
- [Needs follow-up](../rules/needs-follow-up.md): the third verdict, with an owner.
- [The review is dealt among chosen reviewers](../rules/the-review-is-dealt-among-chosen-reviewers.md): each open application in one reviewer's share, once reviewers are chosen.
- [Automatic rejections](../rules/automatic-rejections.md): the applications a rule rejected arrive decided, with the reason.
- [Review needs an import](../rules/review-needs-an-import.md): on the Google Form path, the first import and Redo import.
- [What each role may do](../rules/what-each-role-may-do.md): verdicts and follow-ups are an Editor's, moves an Admin's.
- [An applicant never reads a verdict early](../rules/an-applicant-never-reads-a-verdict-early.md): nothing decided here reaches the applicant until results are published.
- [An archived market is read-only](../rules/an-archived-market-is-read-only.md).
- [Vendor notes](../rules/vendor-notes.md): the card shows the vendor's request among their answers and the notes below them.
- [An update is kept beside the vendor's answer](../rules/an-update-is-kept-beside-the-vendors-answer.md): the card and the All view read an updated answer in its place.

Its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).

## Superseded

- Imported applications were first to be approved with a bulk-approve action in the old monitor (wayfinding/v0-1-0/map), and how it should look was asked (wayfinding/v0-1-0/08).
  A walk of a real 232-row export showed the card carried nothing to decide on, so the question was closed unanswered and replaced by what a reviewer must see (wayfinding/real-market-readiness/04).
- That answer chose triage with no bulk action at all, so no application could be approved without being looked at (wayfinding/real-market-readiness/04), and bulk approve was ruled out again, twice (wayfinding/readable-journey/map, wayfinding/claims-and-room/map).
  The organizers asked for bulk verdicts, and the All view gives them, on ticked rows only, confirmed by count and written only where each is as the reviewer saw it (brain-dump/2026-10-19#10, E34/F04).
  On the 2026-10-29 walk Daniel chose to add "Select all", which ticks the rows the filter shows under that same count and conditional write (E38/F05/S02).
- Its third verdict, Skip, became "Needs follow-up", a stored status with an owner, beside "Next", which passes over a card and decides nothing (brain-dump/2026-10-19#9, E34/F02/S01).
