# 02: The next step and the live tabs, per phase and path

Type: grilling
Status: resolved
Blocked by: 01

## Question

For each phase of a form market and of a CSV market:

- What is the one next step the rail states, and which page does it link to?
- Which tabs and pages exist on this path at all, and of those, which are live and which are read-only (with what line saying when they matter)?
- What does a phase or tab label say on this path, where its meaning differs between the two (for example "Applications open" on a market whose vendors apply on a Google Form)?

The answer is one table per path, which becomes the single place the product reads both from (as `currentPage` is today).
Settled already: the setup freezes on leaving draft; the statement lives in the rail; each path has a fixed tab set for the market's whole life, Attendance included from draft.

## Settled so far

Round 4 of the grilling, 2026-10-18, against the [walk](../walk/walk.md).

- **Say it before the click.** A forward step the server would refuse is shown disabled, and the rail's statement names the first blocker and links to where it is fixed ("To open applications: give every tier a section with tables -> Market Setup").
  The guards' verdicts are served on the market read, so the rail knows them without trying the move.
- **Leaving draft requires a complete setup**: dates, a location, and every tier with at least one section that has tables.
  A new guard on `draft -> applications_open`, because a setup that freezes incomplete can never be completed; it also catches the CSV start's tiers without tables in draft instead of in review.
- **The CSV path speaks of its Google Form.** Nothing on a CSV market suggests vendors can apply here; the form path keeps "Open Applications" and "Close Applications".
- **Review is rolling, and says so.** Decisions stay live from `applications_open`; the review phase means "nothing more is coming in, finish deciding".
- **Import is the CSV path's, and Publish Results the form path's.** A form market cannot import.
- **Nothing is shown as assigned until a run is stored.** Before one, Result and Vendors say "Nothing assigned yet" and link to Assignment; the solver's unstored preview is not drawn as a result.

## Answer

Resolved 2026-10-18: the tables below, confirmed as drafted in round 5, with the three open points settled beneath them.

The statement is what the rail says; **Forward** is the one step on the rail (disabled with the first blocker when it would be refused); tabs not listed as live are read-only with the line given.

### Form path

| Phase | Statement (links to) | Forward | Live | Read-only, with its line |
|---|---|---|---|---|
| draft | "Plan the market and its application form, then open applications." (Market Setup) | Open Applications | Market Setup, Application Form, Assignment rules | Applications: "Applications arrive here once they open." Result, Vendors: "Nothing assigned yet." Attendance: "Opens when the market is published." |
| applications_open | "Applications are open at <address>. Review them as they arrive; close applications when you stop taking them." (Applications) | Close Applications | Applications (review, Publish Results), Assignment rules | Market Setup: "Fixed when applications opened." Application Form: "Fixed once applications opened." |
| applications_closed | "Applications are closed. Finish deciding, and begin review once no more are coming; until then you can still reopen." (Applications) | Begin Review | as above | as above |
| review | "Decide the N applications still undecided, then begin assignment." (Applications) | Begin Assignment | as above | as above |
| assignment, no run | "Set the rules and run the assignment." (Assignment) | Publish Market, disabled: "Run the assignment first" | Assignment (rules, Assign) | Applications: "Decided; the assignment works from these." Result, Vendors: "Nothing assigned yet." |
| assignment, run | "Check the result, then publish the market: that puts the check-in page up, and cannot be undone." (Result) | Publish Market | Result (change a placement), Assignment (run again) | as above |
| market_days | "Check vendors in at the door." (Attendance) | none until the last date has passed, then Archive | Attendance, Result (change a placement) | Assignment: "Settled; change a single placement on Result." |
| archived | "Archived. The record is at <check-in address>." | none | none | every tab: "This market is archived; it is the record of what happened." |

### CSV path

Where it differs from the form path:

| Phase | Statement (links to) | Forward | Differences in tabs |
|---|---|---|---|
| draft | "Plan the market, from your Google Form's responses or by hand, then start collecting." (Market Setup) | Start Collecting | Applications: "Import opens when you start collecting." |
| applications_open | "Collecting on your Google Form. Import responses as they arrive and review them; say when you are done collecting." (Applications) | Done Collecting | Applications: Import is the primary action; no Publish Results, no application address. |
| applications_closed | "Your Google Form is closed. Import the last responses, then begin review." (Applications) | Begin Review | Import still live. |
| review | as the form path, and "Nothing more can be imported." | Begin Assignment | Import read-only: "Closed once review began; go back to import more." |
| assignment onwards | as the form path | as the form path | as the form path |

### Settled in round 5

- **On a CSV market the Application Form tab is "Questions"** ("what your Google Form asks"), with no applicant preview: it is where the import's targets are defined, and no applicant ever sees it.
- **Archive becomes the forward step once the last market date has passed**, through its existing permanent-action dialog; before that it stays in the menu.
- **Publish Results (form path) is a secondary action on Applications** from the first decision on, with a line saying what it does ("Tells every decided applicant their verdict on their application page"). The rail never names it.
- The assignment rules stay live from draft (they are not setup), and Result keeps "change a placement" live through market days, so a vendor can be moved on the day.

### Settled in round 6

- **Creating a market asks how vendors will apply**, with nothing preselected; it stays changeable on Market Setup while the market is a draft.
  The server keeps its fail-closed default (absent means `csv`) for any market without an answer, but no new market relies on it.
- **The complete-setup guard also refuses market dates that have already passed.**

Built by [E31 What to show, and when](../../../backlog/E31-what-to-show-and-when/epic.md); the walk's plain fixes by [E30 What the walk found](../../../backlog/E30-what-the-walk-found/epic.md).
