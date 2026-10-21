---
layer: business
kind: flow
describes:
  - front-end/src/components/market/MarketAssignmentTab.vue
  - front-end/src/components/ResultSummary.vue
verified: 2026-10-22
sources:
  - wayfinding/the-assignment-tab/01
  - wayfinding/the-assignment-tab/02
  - wayfinding/the-assignment-tab/map
  - E12
  - E22/F02
  - E22/F03
  - E31/F03/S05
  - E27
  - E34/F05/S01
  - E35/F02/S01
  - E35/F03
  - E36/F02/S03
  - E36/F04
  - bug/7
  - bug/23
  - bug/39
  - bug/42
---

# The assignment and its result

**Who:** the market's Editor, Admin or owner sets the rules and runs the assignment; publishing results is an Admin's ([what each role may do](../rules/what-each-role-may-do.md)).
**Where they start:** the Assignment tab, which [Begin Assignment](review.md#i5-begin-assignment) lands on.

The Assignment tab holds three pages: Assignment (the rules and the run, [`MarketAssignmentTab.vue`](../../../front-end/src/components/market/MarketAssignmentTab.vue)), Result (by table, under its summary, [`ResultSummary.vue`](../../../front-end/src/components/ResultSummary.vue)) and Vendors (by vendor, [vendors](vendors.md)).
Before a run the rail says "Set the rules and run the assignment."; after it, "Check the result, then publish the market: that puts the check-in page up, and cannot be undone."
**Setting the rules and running them is one page; reading and changing what they produced is another.**
The first is called Assignment because that is the organizers' word for the whole job; what it sets are the assignment rules, and what the solver produces is the assignment, read on Result ([Assignment](../concepts/assignment.md)).
An organizer's result is who sits where, which is the tables; so Result is the tables, with every seat editable in place, under a summary strip of the figures that sum them up, and the old Tables screen is Result (its address redirects there, [every market page has an address](../../implementation/conventions/every-market-page-has-an-address.md#old-addresses)).
A run lands on Result.
Running again asks nothing: every hand placement is kept as a pin, the button says so before the click ([J9](placing-by-hand.md#j9-run-again-keeping-hand-placements)), and in Assignment nothing has yet been sent to anyone.
Before the first run Result and Vendors say "Nothing assigned yet." with a link to set the rules and run them, or, where the phase refuses a run, why, in the server's words; where a run can still happen the tables are drawn below it, so a seat can be given first.

How the solver places vendors is [the assignment solver](../../implementation/modules/assignment-solver.md); changing a seat by hand is [placing by hand](placing-by-hand.md).

**Task:** "Give each approved vendor their tables, putting current students first, and no vendor more than 3 days."

## J1. Priority rules

**Status:** Works (walked live; a multi-select and a blank answer read from the code as of E34/F05/S01).
Under "Assignment Priority", "Add a rule", choose a question (form questions with a fixed set of answers, "When the application arrived", "Application type"), then add answers best first; unlisted answers sort last, or where "<All others>" is placed.
A question that measures (a date, a number) asks which end comes first instead of a list of answers.
An applicant who chose several answers is placed by their best; one who answered nothing sorts behind everyone who did.
Rules apply in order; "×" (a button named "Remove rule N") removes one.
The full order of turns is [priority and tie-breaks](../rules/priority-and-tie-breaks.md).
Covered by: `market-pipeline.spec.ts`, `the-assignment-tabs-pages.spec.ts`, `the-rules-table-lines-up.spec.ts`.

## J2. Assignment options

**Status:** Works (walked live; the blank share read from the code as of E27, `assignment-options.spec.ts`).
Under "Assignment Options", "Max assignments per vendor" ("The most dates any one vendor can be given. Leave blank for no ceiling.", at most the number of market dates) and "Max half table proportion per section (%)" (0 to 100; "Leave blank for 30%, the default.").
Assign stays disabled only while a value is out of range: "Correct the assignment options above to run the assignment."
Covered by: `assignment-options.spec.ts`.

### J2a. No ceiling on dates

**Status:** Works (re-walked live on 2026-10-03; bug 7).
Leave "Max assignments per vendor" blank ("No ceiling") and run with no limit ([the ceiling on dates per vendor](../rules/max-assignments-ceiling.md)).
Covered by: `assignment-options.spec.ts`.

## J3. Run the assignment

**Status:** Works (re-walked live on 2026-10-03, with and without tiers; bug 23).
"Assign" lands on Result.
Dates fill one at a time, in the order the plan holds them, so later days can end up nearly empty; that is known behaviour, kept as it is (bug 39, [dates fill one at a time, in the plan's order](../rules/dates-fill-in-calendar-order.md)).
Covered by: `market-pipeline.spec.ts`, `the-result-page.spec.ts`, `untiered-plans-assign.spec.ts`.

### J3a. Refused: an approved application is incomplete

**Status:** Works (walked live; the links read from the code as of bug 42's fix).
The whole run is refused: "N approved applications cannot be assigned until their answers are complete:", naming each applicant, each name a link to their application ([an incomplete application refuses the run](../rules/an-incomplete-application-refuses-the-run.md)).
Covered by: `a-refused-run-says-who-and-where.spec.ts`.

### J3b. Refused outside the Assignment phase

**Status:** Works (code; the published case read from the code as of E36/F04/S02).
The button is disabled with the reason; the server refuses too, in every phase but Assignment and in Assignment once results are published ([assign runs only in assignment](../rules/assign-runs-only-in-assignment.md)).

## J4. Read the result

**Status:** Works (walked live; the search, the statistics, the download and the marks read from the code as of E35/F02/S01, E35/F03 and E36/F02/S03).

1. Summary: "N of M vendors placed", "N of M table-days used", "N unassigned" (links to Vendors filtered), "N% satisfaction"; under it, "A table-day is one table on one market date. Satisfaction is the share of the dates vendors asked for, and could have had, that they got."
2. "Statistics" (placements by date, section, tier and table choice) opens a panel under the strip, closed by default and held in the address, rather than a dialog, since it is reading and not a job; "Placement history" ([J13](placing-by-hand.md#j13-placement-history)) and "Download CSV", which names each vendor by full name as well as the name they chose.
3. "Search" ("Name, business, email or table") keeps the tables seating a matching vendor; filters by Date, Section, Tier and Table, shown as removable chips with "Clear all"; "N of M tables" and counts of assigned, partial and empty tables, each a filter of its own.
   There is no list of the free tables: the grid's empty filter shows them where they are.
4. Tables by date then section; each seat shows its occupant's name, or "Vacant" (half a table) / "Unassigned" (a whole free table); a seat held by someone not approved is marked "Not approved".
   A name opens the [vendor drawer](vendor-drawer.md).

Covered by: `the-result-page.spec.ts`, `tables.spec.ts`, `a-search-on-the-results.spec.ts`, `tier2.spec.ts` (CSV export).

## J5. The result is out of date

**Status:** Works (walked live; what can still change read from the code as of E31/F01 and E36/F01).
When the rules, the plan or the approved applications change after a run, a note on the Result page says which: "Your rules changed since this assignment ran. Run it again to bring it up to date." ([an assignment knows when it is out of date](../rules/an-assignment-knows-when-it-is-out-of-date.md)).
Changing an input does not unassign anyone until the run is repeated, and a hand placement is not a change.
The plan settles on leaving Draft and the verdicts on entering Assignment, so in Assignment it is the rules an organizer changes; the plan and the applications change after a run only in the database, as specs do.
The note shows only in Assignment, where running again is possible.
Covered by: `the-result-knows-what-it-was-made-from.spec.ts`.

## J14. The rules close with the assignment

**Status:** Works (walked live; the published case read from the code as of E36/F04/S02).
Once the market can no longer return to Assignment, or its results are published, the priority and options are read only and the page says why ("The assignment for this market is settled. …", or "Results are published, so the assignment is settled: …"); Assign is gone.
Covered by: `the-assignment-rules-close.spec.ts`.

## I7. Publish results

**Status:** Works (re-walked live on 2026-10-03; where and when it is offered, and what a vendor reads, changed since, read from the code as of E36/F04 and E36/F05: `back-end/api/applicants.py`, `results-wait-for-the-allocation.spec.ts`).
On a market whose vendors apply on its own page only, from the Applications page; a Google Form market has nobody to tell, and offers no button.

1. "Publish Results", beside "Tells every applicant, on their application page, whether they have a table.", is offered in Assignment once a current run is stored; until then it is disabled and says why ("Run the assignment first: …", "The assignment is out of date. Run it again before publishing, …").
   In Assignment the rail leads there: Publish Market is disabled with "Applicants have not been told whether they have a table. Publish the results before the market goes live." and "Publish results" as the main button.
2. "Publish results" asks first: 'N applicants will read "You have a table". M will read "You did not get assigned".' and "Publishing cannot be undone, and the assignment cannot be run again after it: seats change only by hand."
3. Confirm: the button becomes "Results Published"; the run and the rules are settled (J3b, J14), and the market can be published (K1).
4. Each applicant reads their outcome on "Your application" ([H3c](applying-online.md#h3c-a-vendor-checks-their-application)).

Covered by: `results-wait-for-the-allocation.spec.ts`, `vendors-see-their-application-after-close.spec.ts`.

## The rules it obeys

- [Assign runs only in assignment](../rules/assign-runs-only-in-assignment.md).
- [Priority and tie-breaks](../rules/priority-and-tie-breaks.md), [the half-table share](../rules/half-table-share.md), [the ceiling on dates per vendor](../rules/max-assignments-ceiling.md), [tier filters, section prefers](../rules/tier-filters-section-prefers.md), [table-share pairing](../rules/table-share-pairing.md) and [dates fill one at a time](../rules/dates-fill-in-calendar-order.md): how the run places.
- [An incomplete application refuses the run](../rules/an-incomplete-application-refuses-the-run.md).
- [An assignment knows when it is out of date](../rules/an-assignment-knows-when-it-is-out-of-date.md).
- [The assignment rules close with the assignment](../rules/the-assignment-rules-close-with-the-assignment.md).
- [Publish Results waits for the allocation](../rules/publish-results-waits-for-the-allocation.md), and [an applicant never reads a verdict early](../rules/an-applicant-never-reads-a-verdict-early.md).

What a run records of its inputs is [what an assignment was made from](../../implementation/modules/made-from.md).
Its specs and gaps are in [walking the flows](../../implementation/testing/walking-the-flows.md#coverage-map).
