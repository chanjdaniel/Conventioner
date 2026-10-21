# MVP user flows: from creating a market to market day

This is the hub of the flows: every organizer and vendor flow the product implements or intends, in plain English, from signing up to the end of a market.
Each group of flows, and each path, is a flow node under [business/flows/](business/flows/README.md), linked to the rules it obeys; this file indexes them by path and by group letter.
Every flow id ("A1", "E7") is a heading in its node, so a record that cites a flow by id finds it through the [index](#index).

Statuses are as of epic E36, read from the code and the specs; a flow walked live says so, on the usage run of 2026-09-30 ([MVP_TEST_RUN_2026-09-30.md](records/MVP_TEST_RUN_2026-09-30.md)) or the re-walk of 2026-10-03 after E26 ([MVP_TEST_RUN_2026-10-03.md](records/MVP_TEST_RUN_2026-10-03.md)).
Intended flows are written as designed, even when something stops them working today, and are gathered again in [Not reachable yet](#not-reachable-yet).
On-screen labels are quoted exactly as the product shows them.

How to walk the flows, for E2E or user testing, what a walk needs, and which specs already walk each one: [walking the flows](implementation/testing/walking-the-flows.md).
Who may do what on a market: [what each role may do](business/rules/what-each-role-may-do.md).
Groups H to L and the path P6 are still in this file, until they move to their nodes; the planned offers flows stay here.

## Status labels

Every flow carries one status, and says whether it was walked live or read from code.
"Walked live" means on the 2026-09-30 usage run, unless the re-walk of 2026-10-03 is named; a status a later epic changed is read from the code and names the code and specs it was read from.
A bug the status once named is cited where its fix changed what a step says.

| Status | Meaning |
| --- | --- |
| **Works** | Does what it should. |
| **Works, with bug N** | Completes, but part of the result is wrong. |
| **Blocked by bug N** | Intended and built, but a bug stops it; the flow describes the intended behaviour and then what happens. |
| **Beta** | Reachable and labelled experimental. |
| **No screen** | Built in the back end, reachable only through the API or a URL nobody links to. |
| **Stubbed** | Deliberately switched off until something else exists. |
| **Not offered** | Refused by a product rule, which the flow names. |
| **Planned** | Intended, not built; the backlog item is named. |

## Index

### The lifecycle and the paths

- [The market lifecycle at a glance](business/flows/lifecycle.md) - the phases on both intake paths, the page each opens on, the moves, and what refuses each
- [The Google Form path](business/flows/the-google-form-path.md) - P1 and P2: vendors apply on the organizer's own Google Form, and its responses are imported
- [The online path](business/flows/the-online-path.md) - P3: vendors apply on the market's own page
- [The mixed path](business/flows/the-mixed-path.md) - P4: an online form plus imported stragglers, not offered
- [P5. Offers](#p5-offers-vendors-accept-or-refuse-their-tables) - planned, below
- [P6. Ending early, or not at all](#p6-ending-early-or-not-at-all) - moving, below

### The flows, by group

- [A. Accounts](business/flows/accounts.md) - A1, A1a, A2 to A5
- [B. Organizations](business/flows/organizations.md) - B1 to B6, with B5a to B5c
- [C. Finding and opening markets](business/flows/finding-a-market.md) - C1 to C5
- [D. Creating a market](business/flows/creating-a-market.md) - D1 to D5
- [E. Planning the market](business/flows/planning.md) - E1 to E8
- [F. Building the application form](business/flows/form-tab.md) - F1 to F6
- [G. Starting from a Google Form's responses](business/flows/starting-from-a-google-form.md) - G1 to G6
- [H. Taking applications](#h-taking-applications) - H1 to H5, H1a, H2a to H2j, H3a to H3e; moving, below
- [I. Reviewing applications](#i-reviewing-applications) - I1 to I7; moving, below
- [J. Assigning tables](#j-assigning-tables) - J1 to J14, J2a, J3a, J3b; moving, below
- [K. Publishing and market days](#k-publishing-and-market-days) - K1 to K5; moving, below; K6 is planned
- [L. Ending and managing a market](#l-ending-and-managing-a-market) - L1 to L5; moving, below
- [M. Offers and outcomes (planned)](#m-offers-and-outcomes-planned) - M1 to M5; planned, below

## Paths still here

### P6. Ending early, or not at all

| Situation | Flows |
| --- | --- |
| Abandon a market before it runs | L2 |
| Remove a market entirely | L5 |
| Wind up an organization and every market in it | [B5a to B5c](business/flows/organizations.md#b5-delete-an-organization) |
| Return a market to draft to fix its form before anyone applies | [F5](business/flows/form-tab.md#f5-reopen-the-market-to-fix-the-form) |

## Flows still here

### H. Taking applications

#### H1. Open applications

**Status:** Works (walked live).

1. Rail: "Open Applications".
2. Expect Applications Open, the Applications tab carrying the dot, the form locked (F4).
3. For a form market, the rail shows "Application page" with the public URL and "Copy" on one line, shortening the address rather than wrapping ([bug 11](records/MVP_BUGS.md#bug-11)).

Covered by: `phase-state-machine.spec.ts`, `phase-rail.spec.ts`.

#### H1a. Refused: the form asks nothing

**Status:** Works (walked live).
With no custom field and a plan offering nothing, "Cannot proceed: The application form asks nothing…".
Covered by: `phase-state-machine.spec.ts`.

#### H2. Import applications from a CSV

Page: Applications, "Import from CSV", allowed in Applications Open and Applications Closed for either intake mode; elsewhere the button is disabled with the reason.
`/markets/<id>/import`, four steps: Upload, Map columns, Preview, Confirm.
Covered by: `csv-import.spec.ts`, `form-amendment.spec.ts`, `market-journey.spec.ts`.

**Task:** "Bring in the applications you collected in your spreadsheet."

##### H2a. First import, everything maps

**Status:** Works (re-walked live on 2026-10-03 for P1 and P2).
On a first import only Timestamp and Email Address are mapped for you, even where a heading matches a question word for word (a usability observation, not a bug).

1. **Upload:** "Choose the CSV your form produced"; the page names the market ("Importing into …").
2. **Map columns:** every column in file order with sample answers, mapped to a question or "Ignore this column"; "Required questions" ticks each one off; "All required questions are mapped."
3. **Preview** ("Preview import"): "N of M rows will be imported", "Each imported row becomes an application awaiting your review.", the first rows as they will be stored, "Where each answer comes from".
4. **Confirm** ("Import N rows"): "Imported N new applications"; "Back to applications" returns to Applications ([bug 16](records/MVP_BUGS.md#bug-16)).
5. Expect N applications, each Open and awaiting review.

For a market started from a Google Form, step 2 opens "Restored from your last import." and needs no decisions.

##### H2b. Answers that match no option

**Status:** Works (re-walked live on 2026-10-03).
Answers are split only where the comma is not inside an option, so "Monday, November 20th" arrives whole and reads as that market date ([bug 27](records/MVP_BUGS.md#bug-27)).
"N values did not match …" lists each unmatched answer with "Choose…" to match it to an option, or "Ignore this value"; "Re-check values" re-runs the check.
Values already decided, including those a Google Form start saved, are listed under "N values already decided - change any that are wrong" and can be changed ([bug 28](records/MVP_BUGS.md#bug-28)).
"N values still need a match." blocks the preview until each is settled.

##### H2c. A question spread over several columns

**Status:** Works (`csv-import.spec.ts`): a tier grid's day headings, in whatever words, are matched to the market's dates, and its cells to tiers ([bug 26](records/MVP_BUGS.md#bug-26)).
Grid questions (one column per option or per day, such as a tier grid) are grouped as one row showing their columns; "Not one question - split" treats them separately.
A column whose options contain commas while its answers are comma-separated says "One column cannot answer … reliably".

##### H2d. A required question has no column

**Status:** Works (walked live).
"Number of dates you want" is not required of a file: a vendor with no answer is limited by their availability and the market's ceiling ([bug 24](records/MVP_BUGS.md#bug-24)).
The preview stays disabled until every required question is mapped; "Required questions" shows which are missing ("Still unmapped: …").
A custom question can be made optional by reopening for editing (F5, before any application exists); an essential constraint cannot be switched off, so the only fix is a new column in the spreadsheet.

##### H2e. Add a question for a column with nowhere to go

**Status:** Works (code), only while no application exists yet.

1. A column that matches nothing shows "This column has nowhere to go…" and "Add a question for it".
2. The dialog lists "Questions this market asks" and offers "Add a question" (Question, Answer key).
3. It warns: "While this runs, this market's public application page is briefly unavailable." and that the form's publication date will be re-dated.
4. Confirm: the market steps back to Draft, the form is written, and the market returns to the phase it started in; "Your upload and your mapping stay exactly as they are."

Refused when it would leave the form asking nothing, or when a guard on the way back would fail; each blocker is named before anything moves.
Covered by: `form-amendment.spec.ts`.

##### H2f. Stop asking a preference the form never asked

**Status:** Works (walked live), only while no application exists yet.
On an online-form market whose form does ask the preference it says the file has no column for it, not that the form never asked ([bug 40](records/MVP_BUGS.md#bug-40)).
"Your form never asked <question>. It is a preference, not a constraint…" with "Stop asking it", which runs the same chain as H2e to switch that essential question off.

##### H2g. Finish a fix that stalled

**Status:** Works (code).
If the H2e/H2f chain stops part way, the dialog says where it stopped and offers "Put the market back".

##### H2h. Import a later export

**Status:** Works (walked live; re-walked on 2026-10-03, where ten repeat submissions folded into their latest rows).
An applicant listed more than once is one application, from their latest row, dated by their first; an unchanged applicant keeps their approval, and "N updated" counts only changed answers ([bugs 34](records/MVP_BUGS.md#bug-34) and [40](records/MVP_BUGS.md#bug-40)).

1. The mapping is restored by column heading; "N columns are new since then." and lost columns are named to map again.
2. The preview also says how many approved applications "will return to review" because their answers changed, and how many existing applications are not in the file ("They will be left exactly as they are.").
3. Confirm: "Imported N new applications, updated M".

A first-come-first-served priority rule with no column mapped to "Submitted at" warns that it "will order nothing".

##### H2i. Rows that cannot be imported

**Status:** Works (re-walked live on 2026-10-03).
The preview lists "N rows will be skipped" with every reason for each row, and confirming writes only the good rows ([bug 5](records/MVP_BUGS.md#bug-5)).
A blank row says "Every column this import reads is empty."; an answer the organizer chose to ignore on a required question says so, rather than that the applicant left it blank, and the fix is on the previous step.

##### H2j. Import after applications close

**Status:** Works (walked live).
In Applications Closed the page says "You can still import the ones you collected elsewhere."
From Review, import is refused until the market returns to Applications Closed.
From Assignment onwards it is refused for good, and says so: "…it takes no more applications and nothing more can be imported." ([bug 42](records/MVP_BUGS.md#bug-42)).

#### H3. Vendors apply online

Only for a market set to "Vendors apply on this market's page", only while Applications Open.
Covered by: `applicant.spec.ts` (sign-in, seeding the application first), `intake-mode.spec.ts`.

##### H3a. A new vendor applies

**Status:** Works (re-walked live on 2026-10-03 on a phone-sized window; [bug 6](records/MVP_BUGS.md#bug-6)).
**Task (vendor):** "Apply to this market."

1. The vendor opens the shared link `/<market-slug>/apply`; "Sign in" names the market.
2. They enter their email, "Send code"; the page says "We've sent a code to <email>." whatever the address.
3. The code arrives; they enter it under "Sign-in code" and choose "Sign in".
4. "Apply for <market>": the essential questions, then "More questions" (the custom ones); "Save application".
5. They land on "Your application" (H3c) with status Submitted.

##### H3b. A returning vendor edits their application

**Status:** Works (re-walked live on 2026-10-03), while applications are open.
Sign in as H3a steps 1 to 3 with an address that already has an application (applied before, or imported); "Your application" offers "Change your answers".
The form opens with their saved answers; they change what they need and "Save application", and land on "Your application" ([bug 21](records/MVP_BUGS.md#bug-21)).
A reload or a direct link in the same tab keeps them signed in; a new tab asks them to sign in again ([bug 36](records/MVP_BUGS.md#bug-36)).
The first applicant save of any kind freezes the essential questions' offering (F1).

##### H3c. A vendor checks their application

**Status:** Works (re-walked live on 2026-10-03, before and after applications closed; [bug 20](records/MVP_BUGS.md#bug-20)).
"Your application" shows "Signed in as", the status, "Submitted <date>", "Your Answers", "Change your answers" while applications are open, and "Sign out".
Statuses a vendor sees: Submitted, Under Review, and after Publish Results (I7) Approved or Not Accepted.
A vendor can sign in and read their application and verdict in every phase after Draft; applying and changing answers stop when applications close.

##### H3d. Codes that fail

**Status:** Works (code).
One attempt per code: a wrong code uses it up; "Code already sent - retry in Ns" and "Resend code in 60s" pace requests; every failure reads "Invalid or expired code." so nothing reveals whether an address applied.
Covered by: `applicant.spec.ts`.

##### H3e. A CSV market's public pages

**Status:** Works (walked live).
`/<slug>/apply`, the sign-in and the dashboard of a CSV market answer exactly as for a market that does not exist.
Covered by: `intake-mode.spec.ts`.

#### H4. Close applications

**Status:** Works (walked live).
"Close Applications": online applications stop; CSV import stays available.
Covered by: `phase-state-machine.spec.ts`.

#### H5. Reopen applications

**Status:** Works (walked live).
From Applications Closed, More…, "Reopen Applications" (the form guard runs again).
Covered by: `phase-state-machine.spec.ts`.

### I. Reviewing applications

Page: Applications.
Reviewing has no phase gate of its own, so it can start as soon as applications arrive; it must be finished before Begin Assignment.

**Task:** "Go through the applications and decide who gets in."

#### I1. Work through the queue

**Status:** Works (walked live).

1. "1 of N to review", a tally ("N reviewed · A approved · R rejected") and one card at a time.
2. A card shows the applicant's email, status, submitted date, the highlighted answers first, then "N more answers" (or "This application carries no answers."); a web address in an answer is a link that opens in a new tab.
3. "Reject" (R), "Skip" (S), "Approve" (A); the keyboard letters work.
4. When the queue is empty: "All N reviewed", "Nothing left to review."

An advisory appears when the form asks only the essential questions, since every card then reads alike.
Covered by: `market-journey.spec.ts` (the only spec that clicks Approve).

#### I2. Change a decision

**Status:** Works (walked live); the list shows only emails, with no search or filter.
"Show N reviewed" lists decided applications with "Approve instead" / "Reject instead".

#### I3. Choose what leads the card

**Status:** Works (walked live).
"Choose what leads the card" on a card edits the highlights (F3) in place.
Covered by: `review-highlights.spec.ts`.

#### I4. Begin review

**Status:** Works (walked live).
From Applications Closed, "Begin Review".

#### I5. Begin assignment

**Status:** Works (walked live).
From Review, "Begin Assignment", refused (each with its message) while any application is unreviewed, when there are none, when an approved applicant named a tier with no tables, or when a pin is orphaned.
Covered by: `phase-state-machine.spec.ts`, `placement-pins.spec.ts`.

#### I6. Return to Applications Closed

**Status:** Works (walked live).
From Review, More…, "Return to Applications Closed", for example to import stragglers.

#### I7. Publish results

**Status:** Works (re-walked live on 2026-10-03), in one click with no confirmation; the vendor read "Approved" after applications closed (H3c).
Form markets only (hidden for CSV markets, and the back end refuses it there and on drafts).

1. "Publish Results" (after at least one review); becomes "Results Published".
2. Each online applicant sees Approved or Not Accepted on "Your application" (H3c).

### J. Assigning tables

The Assignment tab holds three pages: Assignment (rules and run), Result (by table) and Vendors (by vendor).

**Task:** "Give each approved vendor their tables, putting current students first, and no vendor more than 3 days."

#### J1. Priority rules

**Status:** Works (walked live).
"Add a rule", choose a question (form questions with a fixed set of answers, "When the application arrived", "Application type"), then add answers best first; unlisted answers sort last, or where "<All others>" is placed.
Rules apply in order; "×" (a button named "Remove rule N") removes one.
Covered by: `market-pipeline.spec.ts`, `the-assignment-tabs-pages.spec.ts`.

#### J2. Assignment options

**Status:** Works (walked live).
"Max assignments per vendor" (at most the number of market dates; blank for no ceiling) and "Max half table proportion per section (%)" (0 to 100); Assign stays disabled, and says why, until the proportion is set.

##### J2a. No ceiling on dates

**Status:** Works (re-walked live on 2026-10-03; [bug 7](records/MVP_BUGS.md#bug-7)).
Leave "Max assignments per vendor" blank ("No ceiling") and run with no limit.

#### J3. Run the assignment

**Status:** Works (re-walked live on 2026-10-03, with and without tiers; [bug 23](records/MVP_BUGS.md#bug-23)).
"Assign" lands on Result.
Dates fill in calendar order, so later days can end up nearly empty; that is known behaviour, kept as it is ([bug 39](records/MVP_BUGS.md#bug-39)).
Covered by: `market-pipeline.spec.ts`, `the-result-page.spec.ts`.

##### J3a. Refused: an approved application is incomplete

**Status:** Works (walked live).
The whole run is refused, naming the applicants missing a required answer.

##### J3b. Refused outside the Assignment phase

**Status:** Works (code).
The button is disabled with the reason; the server refuses too.

#### J4. Read the result

**Status:** Works (walked live).

1. Summary: "N of M vendors placed", "N of M tables used", "N unassigned" (links to Vendors filtered), "N% satisfaction" (the share of requested, possible dates vendors got).
2. "Statistics" (placements by group) and "Download CSV".
3. Filters by Date, Section, Tier and Table size, shown as removable chips with "Clear all"; counts of assigned, partial and empty tables.
4. Tables by date then section; each seat shows its occupant's name and email, or "Vacant" / "Unassigned".

Covered by: `the-result-page.spec.ts`, `tables.spec.ts`, `tier2.spec.ts` (CSV export).

#### J5. The result is out of date

**Status:** Works (walked live).
When the rules, the plan or the approved applications change after a run, a banner says so with "Run it again".
Changing the plan does not unassign anyone until the run is repeated.
Covered by: `the-result-knows-what-it-was-made-from.spec.ts`.

#### J6. Place a vendor in an empty seat

**Status:** Works (walked live); check-in sends the vendor to the seat placed ([bug 1](records/MVP_BUGS.md#bug-1), K2).
Click "Place someone": choose the vendor ("Every vendor who applied already has a table on this date." when none is left) and, for a half table, the seat; "Place them here".
Warnings name what the placement overrides (not available that date, asked for a whole table, a tier they refused, their date limit); a seat already taken is refused, naming its holder ([bug 32](records/MVP_BUGS.md#bug-32)).
Covered by: `placement-edit.spec.ts`.

#### J7. Swap two vendors

**Status:** Works (walked live).
Click an occupied seat ("Change"), "Swap them with" any vendor seated that date, "Swap seats"; both seats change at once.
The same warnings as J6 apply to both vendors, including a change of table size ([bugs 18](records/MVP_BUGS.md#bug-18) and [32](records/MVP_BUGS.md#bug-32)).
Covered by: `placement-edit.spec.ts`.

#### J8. Free a seat

**Status:** Works (walked live).
"Free this seat" ("Freeing this seat leaves them with no table on this date until they are placed again.").
Covered by: `placement-edit.spec.ts`.

#### J9. Run again, keeping hand placements

**Status:** Works (walked live).
Every hand placement is a pin; "Run again" says "Keeps your N hand placements; places everyone else again." and seats pins first.
Covered by: `placement-pins.spec.ts`.

#### J10. A pin the plan no longer holds

**Status:** Works (`placement-pins.spec.ts`; [bug 31](records/MVP_BUGS.md#bug-31)).
Removing a pinned seat from the plan orphans the pin (never deletes it); it blocks the next Begin Assignment until moved or freed.
In Assignment the result pages mark it, and Publish Market is refused until it is re-placed or freed.
Covered by: `placement-pins.spec.ts`.

#### J11. Browse by vendor

**Status:** Works (re-walked live on 2026-10-03).
Vendors: "Search vendors" and "N of M vendors assigned", counting approved vendors only ([bug 10](records/MVP_BUGS.md#bug-10)); each row shows Assigned or Unassigned and "N / M dates".
Result's "N unassigned" link opens this list filtered, with an "Unassigned only ×" chip to clear the filter.
A vendor's panel shows their Submission, their Assignments per date with "Change placement", or "Not available on this date".
Covered by: `vendors.spec.ts`.

#### J12. Find out why a vendor was not placed

**Status:** Works (walked live); a vendor at their date limit, or at the market's ceiling, is told so ([bug 33](records/MVP_BUGS.md#bug-33)).
An unplaced date on a vendor's panel states the reason the solver could not place them, with a link to place them by hand.

#### J13. Placement history

**Status:** Works (walked live).
A vendor's panel lists each change to their placements: "Swapped Idikit and Utal - now at Front 10 and Back 1", who made it and when; a solver run is one entry.

#### J14. The rules close with the assignment

**Status:** Works (walked live).
Once the market can no longer return to Assignment, the priority and options are locked and the page says why.
Covered by: `the-assignment-rules-close.spec.ts`.

### K. Publishing and market days

#### K1. Publish the market

**Status:** Works (re-walked live on 2026-10-03).
**Task:** "Your assignment is final. Make it live so vendors can find their tables."

1. Rail: "Publish Market".
2. "Publishing puts this market's check-in page on the air…" and "A published market cannot be returned to an earlier phase."; focus starts on Cancel.
3. Expect Market Days, an "Attendance" tab, and "Check-in page" with its URL and "Copy" in the rail.

Refused without a computed assignment: "No assignment has been computed for this market…".
Covered by: `phase-rail.spec.ts`, `phase-state-machine.spec.ts`.

#### K2. A vendor looks up their table and checks in

**Status:** Works (re-walked live on 2026-10-03 on a phone-sized window).
**Task (vendor):** "You are at the market. Find your table and check in."

1. `/<market-slug>/check-in` names the market before anything is typed.
2. Enter the email applied with, "Look up".
3. Expect a greeting by name, then one card per assigned date: table, table size, section, tier, location; today's first.
4. "Check in"; expect "Checked in ✓ <time>" and "Undo".

The cards show the stored assignment, so a vendor placed, swapped or freed by hand is sent where they were put ([bug 1](records/MVP_BUGS.md#bug-1)).
Covered by: `checkin.spec.ts`.

#### K3. Check in on a day that is not today

**Status:** Works (walked live).
"Today is not one of your days at this market. You can still check in for a day below."

#### K4. Undo a check-in

**Status:** Works (walked live).
"Undo" on a checked-in card removes it.
Covered by: `checkin.spec.ts` ("a check-in on the wrong day can be undone").

#### K5. Watch attendance

**Status:** Works (re-walked live on 2026-10-03).
Attendance: vendors (by email) against dates with the check-in time in each cell, or "No check-ins recorded yet."; only vendors who checked in appear, by design, so it does not show who is missing (a usability observation).
Covered by: `checkin.spec.ts`.

### L. Ending and managing a market

#### L1. Archive after market days

**Status:** Works (re-walked live on 2026-10-03).

1. More…, "Archive Market"; "Archiving is permanent…" and "Its check-in page stays up as a record…", focus on Cancel; "Archive".
2. Expect the rail frozen with "This market is archived. It was published and ran its market days." ([bug 8](records/MVP_BUGS.md#bug-8)); every page read only ([bug 30](records/MVP_BUGS.md#bug-30)).
3. The check-in page stays up as a record: "This market has ended. You can still look up where you were placed, and when you checked in.", each date "Checked in" or "Not checked in", and no check-in ([bug 9](records/MVP_BUGS.md#bug-9)).
Covered by: `phase-state-machine.spec.ts`.

#### L2. Abandon a market early

**Status:** Works (walked live).
Archive from any earlier phase; it is read only, and no check-in page is served; the note reads "It was abandoned before it ran.", "It took applications but was never assigned." or "It was assigned but never published…".

#### L3. Manage who has access

**Status:** Works (walked live).
Markets list, "Manage": "Users with access" lists explicit roles with a role dropdown (Owner, Admin, Editor, Viewer); "Add user" (email and role, "Add"); "Remove"; the organization line says "Its members can view it."
The Owner's own dropdown is offered, and changing it is refused with "Cannot change owner's role".
Covered by: `tier2.spec.ts` ("Market role management"), `access-control.spec.ts`.

#### L4. Rename a market

**Status:** Works (walked live in Draft).
Editable in Draft only; afterwards "This market's public web address comes from its name, and it has already been shared, so its name can no longer change."
Covered by: `public-address.spec.ts`.

#### L5. Delete a market

**Status:** Works (walked live).
Owner only: "Delete market" opens "Delete <market>?", which names what goes ("This deletes the market with its applications, its assignment, its check-in records…") and opens on Cancel ([bug 43](records/MVP_BUGS.md#bug-43)).
Everything the market kept beside itself is deleted with it ([bug 47](records/MVP_BUGS.md#bug-47)).
Covered by: `tier2.spec.ts`.

## Planned, not built

### P5. Offers: vendors accept or refuse their tables

**Status:** Planned (backlog `E05`, status proposed).
"MVP ends at 'assignment computed'; the organizer communicates results themselves."
The Send Offers button already exists and is always refused ([M1](#m1-the-solver-records-who-was-assigned)).

| Step | Flows |
| --- | --- |
| As P3 through assignment | P3 |
| The solver records each approved application as assigned or unassigned | M1 |
| Send offers | M2 |
| Vendors are told and accept or refuse | M3, M4 |
| Publish, market day, end | K, L |

### K6. Send offers instead of publishing

**Status:** Planned (E05); the button exists and is always refused.
See [M2](#m2-send-offers).

### M. Offers and outcomes (planned)

Backlog `E05` ("Offers and the applicant-facing flow", status proposed): "An applicant applies through the market's public page, learns the outcome, receives an offer, and accepts or refuses it - and the organizer sees all of that."
None of this is built beyond the pieces named.

#### M1. The solver records who was assigned

**Status:** Planned.
After a run, each approved application becomes Assigned or Unassigned.
Today nothing writes those statuses, so "Send Offers" is always refused while anyone is approved (the Assignment to Offers edge is deadlocked).

#### M2. Send offers

**Status:** Planned; the button exists.
More…, "Send Offers" in Assignment would move applications to Assignment Sent and the market to Offers.

#### M3. A vendor accepts or refuses

**Status:** Planned.
The vendor answers their offer; the application becomes Accepted or Not Accepted, and the organizer sees it.

#### M4. Outcome emails

**Status:** Planned.
Approval, rejection and offer mail; the mailer sends only account mail today.
Before any is sent, E05 requires a decision on imported addresses, which nobody has verified.

#### M5. The market's public page

**Status:** Stubbed.
`/<market-slug>` shows only the market's name; E05 makes it the market's real public page.

## Not reachable yet

Everything intended or built that an organizer or vendor cannot complete through the product today.
No bug blocks a flow any more: the fourteen rows that once stood here for bugs were cleared by E26.

| Flow | Kind | Why | What reaching it takes |
| --- | --- | --- | --- |
| [A5](business/flows/accounts.md#a5-delete-my-account) Delete my account | No screen | API only | A screen |
| [B6](business/flows/organizations.md#b6-transfer-ownership) Transfer an organization | No screen | API only | A screen |
| [C5](business/flows/finding-a-market.md#c5-the-old-start-screen) Old start screen | No screen | `/init` by URL | Remove it, or link it |
| [F6](business/flows/form-tab.md#f6-table-type-preference) Table type preference | Stubbed | One table type in MVP | Assignment that uses several table types |
| [E6](business/flows/planning.md#e6-sections-from-a-floorplan) Floorplan sections | Beta | Experimental | Real-gesture test coverage; several table types in assignment |
| M1 to M4 Offers and outcome mail | Planned | E05 | The epic |
| M5 Public market page | Stubbed | E05 | The epic |

## Bugs found while exploring

The walk behind this document found 21 problems, from check-in sending vendors to the wrong table down to stale copy, and the usage test run with real exports found 23 more (bugs 22 to 44).
Fixing them found three more (45 to 47), and the re-walk after the fixes found the last ones (48 onwards).
They are written up, with reproductions, in [MVP_BUGS.md](records/MVP_BUGS.md); every one is fixed by epic E26 except bug 39, which is kept as known behaviour.
What E26 left as it is, bug 39 and the usability observations, is in [MVP_KNOWN_GAPS.md](MVP_KNOWN_GAPS.md).
The runs' flow-by-flow results are in [MVP_TEST_RUN_2026-09-30.md](records/MVP_TEST_RUN_2026-09-30.md) and [MVP_TEST_RUN_2026-10-03.md](records/MVP_TEST_RUN_2026-10-03.md).
