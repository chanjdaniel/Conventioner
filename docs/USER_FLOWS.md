# MVP user flows: from creating a market to market day

This is the hub of the flows: every organizer and vendor flow the product implements or intends, in plain English, from signing up to the end of a market.
Each group of flows, and each path, is a flow node under [business/flows/](business/flows/README.md), linked to the rules it obeys; this file indexes them by path and by group letter.
Every flow id ("A1", "E7") is a heading in its node, so a record that cites a flow by id finds it through the [index](#index).

Statuses are as of epic E36, read from the code and the specs; a flow walked live says so, on the usage run of 2026-09-30 ([MVP_TEST_RUN_2026-09-30.md](records/MVP_TEST_RUN_2026-09-30.md)) or the re-walk of 2026-10-03 after E26 ([MVP_TEST_RUN_2026-10-03.md](records/MVP_TEST_RUN_2026-10-03.md)).
Intended flows are written as designed, even when something stops them working today, and are gathered again in [Not reachable yet](#not-reachable-yet).
On-screen labels are quoted exactly as the product shows them.

How to walk the flows, for E2E or user testing, what a walk needs, and which specs already walk each one: [walking the flows](implementation/testing/walking-the-flows.md).
Who may do what on a market: [what each role may do](business/rules/what-each-role-may-do.md).
The planned offers flows (P5, K6 and group M) are written here, under [Planned, not built](#planned-not-built).

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
- [P6. Ending early, or not at all](business/flows/ending-and-managing-a-market.md#p6-ending-early-or-not-at-all) - abandoning, deleting, winding up an organization, or back to draft

### The flows, by group

- [A. Accounts](business/flows/accounts.md) - A1, A1a, A2 to A5
- [B. Organizations](business/flows/organizations.md) - B1 to B6, with B5a to B5c
- [C. Finding and opening markets](business/flows/finding-a-market.md) - C1 to C5
- [D. Creating a market](business/flows/creating-a-market.md) - D1 to D5
- [E. Planning the market](business/flows/planning.md) - E1 to E8
- [F. Building the application form](business/flows/form-tab.md) - F1 to F6
- [G. Starting from a Google Form's responses](business/flows/starting-from-a-google-form.md) - G1 to G6
- [H. Taking applications](business/flows/taking-applications.md) - H1, H1a, H4, H5; [importing](business/flows/import.md) - H2, H2a to H2j; [applying online](business/flows/applying-online.md) - H3, H3a to H3e
- [I. Reviewing applications](business/flows/review.md) - I1 to I6, with the All view; I7 is with [the assignment](business/flows/assignment-and-result.md#i7-publish-results)
- [J. Assigning tables](business/flows/assignment-and-result.md) - I7, J1 to J5, J2a, J3a, J3b, J14; [placing by hand](business/flows/placing-by-hand.md) - J6 to J10, J13; [vendors](business/flows/vendors.md) - J11, J12, J15; and [the vendor drawer](business/flows/vendor-drawer.md)
- [K. Publishing and market days](business/flows/market-day-door.md) - K1 to K5; [K6](#k6-send-offers-instead-of-publishing) is planned, below
- [L. Ending and managing a market](business/flows/ending-and-managing-a-market.md) - L1 to L5, with P6
- [M. Offers and outcomes (planned)](#m-offers-and-outcomes-planned) - M1 to M5; planned, below
- [N. The market's statistics](business/flows/stats.md) - N1, N2

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
Bug 39 is kept on purpose, as the rule [dates fill one at a time, in the plan's order](business/rules/dates-fill-in-calendar-order.md); the usability observations the runs left, where still open, are proposed work, epic E37 in the team home's backlog.
The runs' flow-by-flow results are in [MVP_TEST_RUN_2026-09-30.md](records/MVP_TEST_RUN_2026-09-30.md) and [MVP_TEST_RUN_2026-10-03.md](records/MVP_TEST_RUN_2026-10-03.md).
