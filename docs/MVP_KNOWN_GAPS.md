# What E26 left as it is

Epic E26 ("The user flows hold") fixed every bug the [2026-09-30 usage run](MVP_TEST_RUN_2026-09-30.md) and the [2026-10-03 re-walk](MVP_TEST_RUN_2026-10-03.md) found, with one exception, and it was scoped to bugs only.
This is everything those runs met that still stands: one behaviour kept on purpose, and the usability observations that were never in scope.
Each item says what happens, where, and what fixing it would take, so it can become backlog work when someone decides it should.

Every item was checked against the product on 2026-10-03, on `fix/mvp-e2e-testing`; the last column of the summary says how.

## Summary

| # | Item | Kind | Flows | Checked |
| --- | --- | --- | --- | --- |
| 1 | [The solver fills market dates in calendar order](#1-the-solver-fills-market-dates-in-calendar-order) | Known behaviour (bug 39) | J3 | Code |
| 2 | [The import suggests only Timestamp and Email Address](#2-the-import-suggests-only-timestamp-and-email-address) | Usability | H2a | Re-walk |
| 3 | [Attendance cannot say who is missing](#3-attendance-cannot-say-who-is-missing) | Usability | K5 | Re-walk |
| 4 | [The review card puts the applicant's name last](#4-the-review-card-puts-the-applicants-name-last) | Usability | I1 | Re-walk |
| 5 | [The reviewed list is emails only](#5-the-reviewed-list-is-emails-only) | Usability | I2 | Code |
| 6 | [Publish Results is one click](#6-publish-results-is-one-click) | Usability | I7 | Re-walk |
| 7 | [Result counts table-days as "tables"](#7-result-counts-table-days-as-tables) | Usability | J4 | Re-walk |
| 8 | [The calendar has no month or year jump](#8-the-calendar-has-no-month-or-year-jump) | Usability | E1 | Re-walk |
| 9 | [The import forgets its mapping until it is confirmed](#9-the-import-forgets-its-mapping-until-it-is-confirmed) | Usability | H2a, H2i | Code |
| 10 | [Removing an organization member takes effect at once](#10-removing-an-organization-member-takes-effect-at-once) | Usability | B3 | Code |
| 11 | [A file with no Timestamp cannot be ordered first come, first served](#11-a-file-with-no-timestamp-cannot-be-ordered-first-come-first-served) | Usability | G4, J1 | Code |

Planned work and features with no screen (offers, outcome email, deleting an account, transferring an organization) are not gaps in what was built; they are listed in [USER_FLOWS.md, Not reachable yet](USER_FLOWS.md#not-reachable-yet).

## Known behaviour

### 1. The solver fills market dates in calendar order

**What happens:** the solver works through the market's dates from first to last.
On each date, every approved vendor who can attend and has not reached their limit gets one turn, those with the fewest dates so far going first, then by the organizer's rules.
A vendor free all week who wants two dates is therefore given the first two they can attend, and is at their limit before the later dates are reached.
When there are more tables than vendors want, the early dates fill and the late ones run thin.

On the usage run's March 2026 market (84 vendors, 5 dates, 50 tables, at most 3 dates each), every vendor was placed and every vendor got every date they could have had, but the dates held 50, 59, 55, 27 and 19 placements from Monday to Friday.

**Why it was kept:** no vendor is placed worse by it: the count of dates each vendor gets, and so satisfaction, is the same either way.
When demand exceeds the tables, as in both markets of the re-walk, every date fills and the order never shows.
Whether a market wants its vendors spread evenly, kept to consecutive days, or front-loaded is a choice about what a market is, and nobody has made it.
Decided with the user on 2026-10-01 ([MVP_BUGS.md, bug 39](MVP_BUGS.md#bug-39)).

**Where it lives:** the date loop in `MarketAssignment`'s placement pass, `back-end/assignment/assignment.py`; the vendor order is `sort_vendors()` in the same file.

**What changing it would take:** decide the rule first.
Two candidates that cost no vendor a date: give each vendor one date per round, choosing the date with the most free tables they can take; or keep the calendar walk and, when a vendor can attend more dates than they want, choose among those by how full each date already is.
Either belongs in `back-end/tests/test_assignment_behaviour.py` before it is built.

## Usability observations

Not defects: the product does what it says.
They are the things a user test is likely to surface.

### 2. The import suggests only Timestamp and Email Address

**What happens:** on a first import, the Map columns step maps Timestamp and Email Address and leaves every other column on "Ignore this column", even where the heading is word for word the question's label.
The re-walk's P1 mapped nine columns by hand, among them "Are you a UBC Student?" against a question of exactly that name.
A later import restores the mapping, and a market started from its Google Form needs no mapping at all, so this costs only a hand-built market's first import.

**What fixing it would take:** suggest the question whose label matches the heading after trimming and ignoring case, and mark the suggestion as one, so the organizer still checks it.
The essential questions need their usual headings recognised too ("Full Name" for Full name).

### 3. Attendance cannot say who is missing

**What happens:** Attendance lists only vendors who have checked in, by email, with a column only for dates on which someone did.
On market day an organizer cannot see who is expected, who has not arrived, or which table is empty, and cannot check a vendor in themselves.

**What fixing it would take:** list every vendor placed on the date, by name and table, with their check-in time or "Not yet", and a count; an organizer check-in would need a decision on who may do it and how it is recorded.

### 4. The review card puts the applicant's name last

**What happens:** a review card shows the organizer's own questions first and the essential answers (name, dates, table choice) after them, so on the March 2026 market the applicant's name was the last of 24 rows.
The market can choose what leads the card ("Choose what leads the card"), and this was deliberate: which answers matter is the market's to say, not a fixed order's.
The default is what an organizer meets first.

**What fixing it would take:** put the applicant's name, or preferred name, in the card's header beside their email, whatever leads the answers.

### 5. The reviewed list is emails only

**What happens:** "Show N reviewed" lists every decided application by email, with its verdict and the action to change it.
There is no name, no search and no filter by verdict, so changing one decision among 220 means scrolling for an address.

**What fixing it would take:** names beside the emails, a search, and a filter by Approved or Rejected.

### 6. Publish Results is one click

**What happens:** on a market whose vendors apply online, "Publish Results" shows every verdict to every applicant at once, with no confirmation and no word on what vendors will see or what happens to a decision changed afterwards.

**What fixing it would take:** a confirmation in the product's dialog that says how many will see Approved and how many Not Accepted, and whether a later change reaches them.

### 7. Result counts table-days as "tables"

**What happens:** the result summary says "300 of 300 tables used" for a plan of 60 tables over 5 dates, because it counts a table once per date.
The usage run also saw "100% satisfaction" for 209 of 210 dates, rounded.

**What fixing it would take:** say "table-days", or "60 tables over 5 dates, every one used on every date"; and round satisfaction down, or show one decimal, so a missed date is never shown as 100%.

### 8. The calendar has no month or year jump

**What happens:** the plan's calendar opens on the current month and moves one month per click; planning the 2023 market from October 2026 took 35 clicks.
It also accepts dates in the past without comment.

**What fixing it would take:** a month and year picker beside the arrows, and a note on a date that has already passed.

### 9. The import forgets its mapping until it is confirmed

**What happens:** the column mapping is saved only when an import is confirmed.
An organizer who reaches the preview, goes off to fix their spreadsheet and uploads it again maps every column again.

**What fixing it would take:** save the mapping when the preview runs, as a draft the next upload restores, without writing any application.

### 10. Removing an organization member takes effect at once

**What happens:** "Remove" beside an admin or a member in Manage organization removes them immediately, with no confirmation; they lose access to every market of the organization that gives them no role of its own.

**What fixing it would take:** a confirmation that names the person and what they lose access to, opening on Cancel as the product's other destructive dialogs do.

### 11. A file with no Timestamp cannot be ordered first come, first served

**What happens:** the spring 2025 export has no Timestamp column, so its applications carry no submission time.
The proposal says nothing about it; the import warns only once a first-come-first-served rule exists, and the rule then orders nothing.

**What fixing it would take:** have the proposal say that the file has no submission times and that "When the application arrived" will not order these applicants.
