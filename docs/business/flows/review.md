---
layer: business
kind: flow
describes:
  - front-end/src/components/application/ApplicationMonitor.vue
  - front-end/src/components/application/ApplicationsAll.vue
  - front-end/src/components/market/MarketApplicationsTab.vue
  - front-end/src/components/application/ListFreshness.vue
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
---

# Reviewing applications

**Who:** the market's Editor, Admin or owner gives verdicts; a Viewer reads the queue with Next and decides nothing; moving the market (I4 to I6) is an Admin's ([what each role may do](../rules/what-each-role-may-do.md)).
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

**Status:** Works (walked live; follow-ups, held cards and the giver read from the code as of E34/F01 to E34/F03: `needs-a-follow-up.spec.ts`, `a-reviewer-holds-what-they-look-at.spec.ts`, `reviewers-do-not-collide.spec.ts`, `a-verdict-says-who.spec.ts`).

The queue is triage: one application at a time, carrying every answer it holds, decided from the keyboard, with progress counted, so each verdict is given on a person rather than on a population.

1. "1 of N to review", a tally ("N reviewed · A approved · R rejected") and one card at a time, in the order the applications arrived.
2. A card shows the applicant's email, status, submitted date, the highlighted answers first, then "N more answers" (or "This application carries no answers."); a web address in an answer is a link that opens in a new tab.
   A table-share request that needs attention shows above the answers, so it is never inside the "N more answers" disclosure, and the vendor's notes below them.
   An answer an organizer updated reads as updated, with "Updated by <address>, <when>; they wrote <their answer>" under it ([an update is kept beside the vendor's answer](../rules/an-update-is-kept-beside-the-vendors-answer.md)).
3. "Reject" (R), "Needs follow-up" (S), "Next" (N), "Approve" (A); the keyboard letters work.
4. "Needs follow-up" opens "Needs a follow-up": "<email>'s application waits until someone reaches out.", "Who will follow up" (anyone with a role on the market, the organization's owner, admins and members included, or, to a reviewer from outside the organization, only the people the market's roles name; the reviewer unless they choose another; nothing is sent to them) and "Their notes: what is needed (optional)"; "Mark for follow-up".
   A follow-up waits out of the queue, and "Include the N follow-ups" brings them back; on its card "Followed up by" hands it to someone else.
5. When the queue is empty: "All N reviewed", "Nothing left to review." (or "Nothing else to review; N need a follow-up.").

Two reviewers at once are never handed the same card: the card a reviewer has open is held for them while they work on it, until they have been idle for five minutes and its lease runs out, and another reviewer reads "<email> is looking at this." on it; when every card left is open with someone else, "Every application left is open with another reviewer: …" with "Look again".
A verdict on a card someone else changed since it was opened is refused on the card, naming them: "<email> approved this application since you opened it.", with "Back to the queue" ([ADR 0014](../../adr/0014-reviewers-claim-and-a-verdict-is-a-conditional-write.md)).
Someone who gives no verdicts walks the queue with Next and holds nothing, and is told when the card on screen is open with someone else.
An advisory appears when the form asks only the essential questions, since every card then reads alike.
Covered by: `market-journey.spec.ts`, `needs-a-follow-up.spec.ts`, `a-reviewer-holds-what-they-look-at.spec.ts`, `reviewers-do-not-collide.spec.ts`, `a-verdict-says-who.spec.ts`, `result-and-review-read-cleanly.spec.ts`, `the-list-says-when-it-was-read.spec.ts`.

## I2. Change a decision

**Status:** Works (walked live; the giver read from the code as of E34/F01/S01).
"Show N reviewed" lists decided applications by email, each with its verdict and who gave it, and "Approve instead" on a rejection or "Reject instead" on an approval.
A follow-up is not listed here: it is decided from its own card, or from All.
From Assignment on the list only reads.
Covered by: `the-all-view.spec.ts` ("a verdict changes while the review is open, then the drawer only shows it").

## The All view

**Status:** Works (read from the code as of E34/F04 and E38/F05: `the-all-view.spec.ts`, `the-list-says-when-it-was-read.spec.ts`; Export, E42/F01/S03: `exporting-from-the-applications-tab.spec.ts`).

1. "All" lists every application by name and email, its highlighted answers on one line, its status, who gave the verdict, "Followed up by <email>" and who has it open.
2. "Filter": "Any status", "Open" (every application not decided yet, `?status=undecided` in the address), "Needs follow-up", "Approved", "Rejected", and "Mine: the follow-ups I own"; a line under it says what Open and Needs follow-up mean, and "N of M" says how many show.
3. A row opens the [vendor drawer](vendor-drawer.md) with the application's status and Reject, Needs follow-up and Approve above its tabs.
   Its "Update info" updates the vendor's answers, and the list is read again once it saves.
4. Tick rows and give one verdict to the selection: "N applications selected", then Reject, Needs follow-up or Approve, confirmed by count ("Approve N applications?"): "Each is written only if it is still as you see it here; any that another reviewer has changed or has open is skipped, and said so."
   "Select all" ticks every row the filter and Mine show, and none they hide; it leaves the rows another reviewer has open, and says so ("N applications not selected: another reviewer has them open.").
   A row another reviewer has open cannot be ticked, and a filter that hides a ticked row unticks it.
   A follow-up given to a selection is owned by the reviewer who gave it.
5. The answer: "N applications approved; K skipped:" and each skipped one with why ("<email> has it open.", "Already approved.", or who changed it).
6. "Export", after "N of M", opens the vendor export on the filter and Mine ([J15](vendors.md#j15-export-the-vendors-to-a-csv)), in every phase the view shows: "Open" as Open, a verdict as its status, "Approved" with Added by hand too, since the All view lists a vendor added by hand as approved, and Mine as the follow-ups the one exporting owns.
   So the review's lists (approved, rejected, needs follow-up) leave as a CSV before assignment as well as after.

A selection is only ever the rows ticked, one by one or by Select all, which ticks the rows on screen: each is in front of the reviewer and counted in the confirmation, and nothing past them is decided.
The list is not paged, so the rows shown are every match today; if it ever is paged, Select all still means the rows shown.
The list is read again every 30 seconds while the tab is in view, quietly, which moves its "Updated" time too; every verdict given from it, and every Refresh, re-reads the market, so the rail's count moves.

## I3. Choose what leads the card

**Status:** Works (walked live).
"Choose what leads the card" on a card edits the highlights ([F3](form-tab.md#f3-what-a-reviewer-reads-first)) in place, without moving off the card.
Covered by: `review-highlights.spec.ts`.

## I4. Enter the review

**Status:** Works (read from the code as of E38/F04/S01: `market-journey.spec.ts`, `every-move-lands.spec.ts`).
An own-form market enters by "Open Applications" ([taking applications](taking-applications.md#h1-open-applications)); a Google Form market by its first import, confirmed and written, which takes the move itself, so the import's done step reads "This market is now in Review: …" and leads to the review with "Go to the review" ([review needs an import](../rules/review-needs-an-import.md)).
Covered by: `market-journey.spec.ts`, `every-move-lands.spec.ts`.

## I5. Begin assignment

**Status:** Works (walked live; the follow-up blocker read from the code as of E34/F02/S01).
From Review or Applications, "Begin Assignment", disabled before the click with the rail naming the first blocker:

- any application undecided or needing a follow-up: "N applications are still awaiting review and N applications need a follow-up. Every application must be approved or rejected before the market can enter Assignment.", with "Finish deciding" leading back to the review;
- none at all: "There are no applications for this market. …";
- an approved applicant named a tier with no tables, naming the tier and the applicants;
- a hand placement names a seat the plan no longer has ([J10](placing-by-hand.md#j10-a-pin-the-plan-no-longer-holds)).

It lands on Assignment, and the verdicts settle there; an own-form market's application page closes with it.
Covered by: `phase-state-machine.spec.ts`, `needs-a-follow-up.spec.ts`, `placement-pins.spec.ts`.

## I6. Bring in a late export

**Status:** Works (read from the code as of E38/F04/S03: `a-late-export.spec.ts`).
On the Google Form path, More…, "Redo import": the import reads the whole responses file again, and the market stays in Review ([H2j](import.md#h2j-import-after-review-has-begun)).
Covered by: `a-late-export.spec.ts`.

Publishing the results, I7, is a step of the assignment: [the assignment and its result](assignment-and-result.md#i7-publish-results).

## The rules it obeys

- [Verdicts settle on entering assignment](../rules/verdicts-settle-on-entering-assignment.md).
- [Needs follow-up](../rules/needs-follow-up.md): the third verdict, with an owner.
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
