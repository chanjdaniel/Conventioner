# MVP usage test run, 2026-09-30

Every path and flow in [USER_FLOWS.md](USER_FLOWS.md), walked in a real browser as an organizer and as a vendor, using five real Google Form exports as the applications.
Run on `dev` at `59677cf8`, on 2026-09-30 (UTC).
Every defect found is written up, with a reproduction and a cause where one was traced, in [MVP_BUGS.md](MVP_BUGS.md): bugs 1 to 21 were retested, and bugs 22 to 44 are new.
Nothing was fixed.

## Summary

**The MVP's headline path did not complete for any of the five real exports.**
Starting a market from last year's Google Form and importing its responses (P2) imported 0 rows from the March 2026 export, and could not reach the preview for the 2024 and spring 2025 exports.
Working round every problem the product lets an organizer work round, the March 2026 export still imported only 84 of 250 applicants.

**The hand-built path (P1) completes only under two conditions the product does not state:** the plan must give every section a tier, and the file must have a "how many days" column.
The 2023 export, which has no such column, imported 287 of 294 rows once one was added in the spreadsheet by hand, then could not be assigned because its sections had no tier.

**Once applications are in, most of the product works.**
Reviewing 250 applications by keyboard, the phase guards, running the assignment, hand placements, pins, the out-of-date banner, publishing, the check-in page, organizations, access and deletion all did what the flows describe, with the defects listed below.

**The most serious new problems:**

| Bug | What happens | Who it hurts |
| --- | --- | --- |
| [22](MVP_BUGS.md#bug-22) | A password-reset link opened while signed out bounces to sign-in before the form appears | Every organizer who forgets a password |
| [24](MVP_BUGS.md#bug-24) | The import requires "Number of dates you want", which three of the five real forms never asked | P1 and P2 |
| [23](MVP_BUGS.md#bug-23) | A plan with an untiered section crashes the assignment; adding tiers later places nobody | P1 |
| [25](MVP_BUGS.md#bug-25) | The plan re-saves itself every 0.6 s after any edit, overwriting a second editor's changes | Every organizer team |
| [26](MVP_BUGS.md#bug-26), [27](MVP_BUGS.md#bug-27), [28](MVP_BUGS.md#bug-28) | Tier grids cannot be matched by hand, answers split at commas inside options, and value decisions cannot be seen or undone | Every import |
| [29](MVP_BUGS.md#bug-29) | Editing a custom field switches Section preference back on, blocking the import | P2 |
| [30](MVP_BUGS.md#bug-30) | Archived markets can still be edited, including the seats of a market that ran | Every archive |

Retested bugs 1 to 21 all still stand where retested; bugs 20 and 21, found from code before, now reproduce live.

## How it was run

- **Stack:** the treehouse slot-1 Docker stack (front end on port 5183, back end on 5010), `DISABLE_EMAIL=true`, seeded by `scripts/seed_fixture.sh`.
- **Browser:** Chromium through the Playwright MCP, viewport 1440 by 900.
- **Accounts:** `e2e@example.com` as the organizer; `e2e-noorg@example.com` as a second person (organization member, Viewer, then a person with no organization); vendors signed in with codes planted in `applicant_login_challenges`, because no email is sent.
- **Method:** every step was done through the product's own controls.
  Repetitive steps were scripted, still through the page: reviewing 250 and 277 cards with the R, S and A keys, mapping ten columns, and matching values.
  The vendor side ran in a separate browser context from the organizer.
- **Could not be completed:** registration (the stack has real reCAPTCHA keys and scored the automated browser as a bot), anything that needs an email to arrive, and floorplan section grouping (a lasso gesture the existing spec also drives through store state).

### Data

The five exports are the files in `.scratch/examples/markets/` of the primary checkout.
They are untracked and hold real applicants' names, emails and answers, so they were copied to the git-ignored `.playwright-mcp/examples/`, and nothing from them is quoted in this report or in MVP_BUGS.md.

| File used here | Source file | Responses | Columns | Notable shape |
| --- | --- | --- | --- | --- |
| `march-2026.csv` | "UBC Makers Market Application - March 2026 (Responses) - MM Applications.csv" | 250 | 35 | Team status column; tier grid over 5 days; "how many days"; certification checkboxes |
| `fall-2025.csv` | "Application - Fall 2025 (Responses) - Form Responses 1.csv" | 237 | 30 | As March 2026; its anonymised copy in `back-end/tests/test_data/google_forms/` was walked before this run, so it was not rerun |
| `2024.csv` | "Copy of UBC Makers Market Application 2024 (Responses) - Form Responses 1.csv" | 359 | 30 | Tier grid over 4 days; no "how many days"; three blank trailing columns |
| `spring-2025-screening.csv` | "Spring 2025 Application (Responses) - Screening.csv" | 237 | 28 | No Timestamp column; team screening columns; no "how many days" |
| `untitled-year.csv` | "UBC Makers Market Application (Responses) - Form Responses 1.csv" (2023) | 294 | 12 | No tier grid; days as one comma-separated question; no "how many days"; 9 repeat applicants |

Small hand-written files were added where a real one could not isolate a behaviour: `tiny.csv` (5 rows, for bug 29), `untitled-year-with-days.csv` and `untitled-year-later.csv` (the 2023 export with a days column added, and a "later export" with 3 changed, 5 dropped and 2 new rows), and `harbour-stragglers*.csv` (5 vendors for an online-form market, with Google-style, year-bearing and ISO grid headings).

## Paths

| Path | Result | Markets | What stopped it |
| --- | --- | --- | --- |
| P1 CSV intake, form by hand | Completes only with tiers and a days column | Makers Market Fall 2023; Guard Test Market | [24](MVP_BUGS.md#bug-24) at the import, [23](MVP_BUGS.md#bug-23) at the assignment; along the way [25](MVP_BUGS.md#bug-25), [27](MVP_BUGS.md#bug-27), [28](MVP_BUGS.md#bug-28), [34](MVP_BUGS.md#bug-34), [35](MVP_BUGS.md#bug-35) |
| P2 CSV intake, started from last year's Google Form | Fails for all five exports | Spring Makers Market 2026; P2 2024 Export; P2 Spring 2025 Screening | [2](MVP_BUGS.md#bug-2), [3](MVP_BUGS.md#bug-3), [4](MVP_BUGS.md#bug-4), [24](MVP_BUGS.md#bug-24), [27](MVP_BUGS.md#bug-27), [28](MVP_BUGS.md#bug-28), [29](MVP_BUGS.md#bug-29); walked on to archive with the 84 applicants that did import |
| P3 Online intake | Blocked for new vendors; verdicts unreachable after close | Harbour Night Market | [6](MVP_BUGS.md#bug-6), [20](MVP_BUGS.md#bug-20), [21](MVP_BUGS.md#bug-21), [36](MVP_BUGS.md#bug-36) |
| P4 Online form plus imported stragglers | Works | Harbour Night Market | Tier grid headings must be ISO dates ([26](MVP_BUGS.md#bug-26)) |
| P5 Offers | Not built (E05) | none | |
| P6 Ending early | Works | Scratch Unasked Test; Pier Collective | [8](MVP_BUGS.md#bug-8), [30](MVP_BUGS.md#bug-30) |

### The five exports through P2

| Export | Proposal (G3 to G5) | Import of the same file (H2a) | What stopped it |
| --- | --- | --- | --- |
| March 2026 | Year asked and answered; 6 essential questions, 21 of the organizer's own, 2 left out | 0 of 250; 84 of 250 after reopening for editing, loosening the form and "Stop asking it" | Checkboxes ([2](MVP_BUGS.md#bug-2)), table choice ignored ([3](MVP_BUGS.md#bug-3)), rare answers ([4](MVP_BUGS.md#bug-4)), an option with commas ([27](MVP_BUGS.md#bug-27)), Section preference switched back on ([29](MVP_BUGS.md#bug-29)); none of the saved "ignore" decisions can be undone ([28](MVP_BUGS.md#bug-28)) |
| Fall 2025 | Not rerun; the anonymised copy was walked before | 0 of 237 (anonymised copy) | [2](MVP_BUGS.md#bug-2), [3](MVP_BUGS.md#bug-3), [4](MVP_BUGS.md#bug-4) |
| 2024 | Year asked; ceiling "At most 3 days" read from the grid heading; "answered by 360 of 359" | Preview never enabled | "Number of dates you want" required, no column ([24](MVP_BUGS.md#bug-24)) |
| Spring 2025 | Year asked; ceiling "At most 2 days"; no Timestamp, so first-come-first-served cannot order, and nothing says so | Preview never enabled | [24](MVP_BUGS.md#bug-24) |
| 2023 (as P1) | Not started from the file | 287 of 294 once a days column was added by hand; 7 rows have no email | [24](MVP_BUGS.md#bug-24), then day answers split at commas ([27](MVP_BUGS.md#bug-27)) |

## Flow results

"Pass" means the flow did what USER_FLOWS.md describes.
"Pass, with" means it completed but part of the result was wrong.
"Blocked" means a bug stopped it.
"Partly" means only part could be walked, and says why.

### A. Accounts

| Flow | Result | Notes |
| --- | --- | --- |
| A1 Register | Partly | Mismatched passwords refused ("Passwords do not match"); submission refused by reCAPTCHA on this stack; the verification page redirects to sign-in ([22](MVP_BUGS.md#bug-22)) |
| A1a Resend verification | Not walked | Needs a mailer |
| A2 Sign in and out | Pass | "Invalid credentials" on a wrong password; a market link opened while signed out lands on the dashboard after sign-in, not the market |
| A3 Sign-in code | Partly | Code requested and refused as expected; says "OTP" ([42](MVP_BUGS.md#bug-42)); code box unlabelled ([44](MVP_BUGS.md#bug-44)) |
| A4 Reset password | Blocked | Request works; a real reset link bounces to sign-in ([22](MVP_BUGS.md#bug-22)) |
| A5 Delete account | No screen | |

### B. Organizations

| Flow | Result | Notes |
| --- | --- | --- |
| B1 Create | Pass | |
| B2 Add admin or member | Pass, with [37](MVP_BUGS.md#bug-37) | "User not found" for an unknown address; the member saw the organization's market as a Viewer, but with every editing control live |
| B3 Remove | Pass | Removes at once, with no confirmation |
| B4 Rename | Pass | |
| B5a Delete, no markets | Pass | |
| B5b Delete, drafts only | Pass | Preview lists the market destroyed; focus starts on Cancel |
| B5c Delete, markets under way | Pass | Refused, naming four markets (as text, not links) |
| B6 Transfer | No screen | |

### C. Finding and opening markets

| Flow | Result | Notes |
| --- | --- | --- |
| C1 Dashboard | Pass, with [42](MVP_BUGS.md#bug-42) | "Previously opened" works; the no-organization text promises something the next screen does not do |
| C2 Markets list | Pass, with [14](MVP_BUGS.md#bug-14) | |
| C3 Open by address | Pass | Unknown id message; old addresses redirect (the floorplan redirect keeps a redundant `?marketId=`) |
| C4 Navigation menu | Pass, with [43](MVP_BUGS.md#bug-43) | |
| C5 Old start screen | Still reachable | `/init`, old styling |

### D. Creating a market

| Flow | Result | Notes |
| --- | --- | --- |
| D1 From scratch | Pass | Enter pressed in the first moment after the dialog opens is ignored while organizations load |
| D2 From a Google Form | Pass | |
| D3 Several organizations | Pass | "Select organization", Create disabled until one is chosen |
| D4 No organization | Differs from the doc | The dialog refuses and links to `/organizations` (intended, per `new-market-org.spec.ts`); USER_FLOWS corrected; dashboard copy wrong ([42](MVP_BUGS.md#bug-42)) |
| D5 Name already an address | Pass | "Another market already uses the web address /pier-draft-market…" for "Pier Draft Márket" |

### E. Planning

| Flow | Result | Notes |
| --- | --- | --- |
| E1 Dates | Pass, with [25](MVP_BUGS.md#bug-25) | November 2023 took 34 clicks back from September 2026; no warning that the dates are past |
| E2 Tiers | Pass, with [25](MVP_BUGS.md#bug-25) | |
| E3 Locations | Pass, with [25](MVP_BUGS.md#bug-25) | |
| E4 Sections | Pass, with [23](MVP_BUGS.md#bug-23), [25](MVP_BUGS.md#bug-25) | A section with no tier is accepted and later crashes the run |
| E5 How vendors apply | Pass | Frozen after Draft |
| E6 Floorplan (beta) | Partly | Upload, calibrate and table types work; Auto-Place placed one table and the calibration labels are inverted ([38](MVP_BUGS.md#bug-38)); grouping by lasso not driven |
| E7 Plan after Draft | Pass, with [30](MVP_BUGS.md#bug-30) | Edits after Draft mark the result out of date; archived markets accept edits too |
| E8 Form readiness card | Pass, with [16](MVP_BUGS.md#bug-16) | |

### F. Application form

| Flow | Result | Notes |
| --- | --- | --- |
| F1 Essential questions | Pass, with [29](MVP_BUGS.md#bug-29), [17](MVP_BUGS.md#bug-17) | Unticking "Ask this" works until a custom field is edited |
| F2 Custom questions | Pass | Invalid Select and `essential_` keys refused with reasons |
| F3 What a reviewer reads first | Pass | Walked from the review card (I3) |
| F4 Form lock | Pass | "Application form can only be edited while the market is in draft phase. Current phase: Applications Closed." |
| F5 Reopen to fix the form | Pass | Worked with no applications; refused with 279 ("…so this market cannot return to draft") |
| F6 Table type | Not walked | Stubbed |

### G. Starting from a Google Form

| Flow | Result | Notes |
| --- | --- | --- |
| G1 From the dialog | Pass | Three exports |
| G2 From a draft | Pass | |
| G3 Upload and year | Pass | All three exports named weekdays that confirmed the year |
| G4 Review the proposal | Pass, with [4](MVP_BUGS.md#bug-4), [24](MVP_BUGS.md#bug-24), [27](MVP_BUGS.md#bug-27), [41](MVP_BUGS.md#bug-41) | Says "Not asked" for a question the import then requires |
| G5 Confirm | Pass | The import it prepares fails (P2) |
| G6 Cancel | Pass | |

### H. Taking applications

| Flow | Result | Notes |
| --- | --- | --- |
| H1 Open | Pass, with [11](MVP_BUGS.md#bug-11) | |
| H1a Refused, asks nothing | Pass | |
| H2a First import | Blocked for P2; Pass, with [5](MVP_BUGS.md#bug-5), [35](MVP_BUGS.md#bug-35), [40](MVP_BUGS.md#bug-40) for P1 | Only Timestamp and Email are suggested, even for identically worded questions |
| H2b Unmatched values | Pass, with [27](MVP_BUGS.md#bug-27), [28](MVP_BUGS.md#bug-28), [43](MVP_BUGS.md#bug-43) | "Full table" and "Half table" had to be matched by hand |
| H2c Grid questions | Blocked by [26](MVP_BUGS.md#bug-26) when mapped by hand | |
| H2d Required question with no column | Blocked by [24](MVP_BUGS.md#bug-24) | The block is shown ("Still unmapped: …"), with no way through |
| H2e Add a question for a column | Not walked | |
| H2f Stop asking a preference | Pass | "Fix the form", "Save and carry on"; recovered from bug 29 |
| H2g Finish a stalled fix | Not walked | |
| H2h Later export | Pass, with [34](MVP_BUGS.md#bug-34), [40](MVP_BUGS.md#bug-40) | Mapping restored; new, updated, returning-to-review and absent counts shown |
| H2i Skipped rows | Blocked by [5](MVP_BUGS.md#bug-5) | 166 empty applications written |
| H2j Import after close | Pass, with [42](MVP_BUGS.md#bug-42) | Allowed in Applications Closed; the refusal in Review and Assignment gives impossible advice |
| H3a New vendor applies | Blocked by [6](MVP_BUGS.md#bug-6) | |
| H3b Returning vendor edits | Pass, with [21](MVP_BUGS.md#bug-21), [36](MVP_BUGS.md#bug-36) | Imported vendor; sign-in lands on the empty form |
| H3c Vendor checks application | Pass while open; Blocked by [20](MVP_BUGS.md#bug-20) after close | "Your Application" has no link back to the form |
| H3d Codes that fail | Partly | "Resend code in 59s" seen; a wrong vendor code not tried |
| H3e CSV market's public pages | Pass | Identical to a nonexistent market's |
| H4 Close | Pass | |
| H5 Reopen | Pass | |

### I. Reviewing

| Flow | Result | Notes |
| --- | --- | --- |
| I1 Queue | Pass | R, S and A keys; 250 and 277 cards |
| I2 Change a decision | Pass | "Reject instead" in the reviewed list |
| I3 What leads the card | Pass | |
| I4 Begin review | Pass | |
| I5 Begin assignment | Pass | Refused with "6 applications are still awaiting review…" |
| I6 Return to Applications Closed | Pass | |
| I7 Publish results | Pass for the organizer | One click; the vendor sees "Approved" only while applications are open ([20](MVP_BUGS.md#bug-20)) |

### J. Assigning

| Flow | Result | Notes |
| --- | --- | --- |
| J1 Priority rules | Pass | The second rule offers the question the first already uses |
| J2 Options | Pass, with [13](MVP_BUGS.md#bug-13) | |
| J2a No ceiling | Blocked by [7](MVP_BUGS.md#bug-7) | |
| J3 Run | Pass; crashes with [23](MVP_BUGS.md#bug-23) | 84 of 84 placed; dates fill in calendar order ([39](MVP_BUGS.md#bug-39)) |
| J3a Refused, incomplete | Pass | Named the empty application approved by mistake |
| J3b Refused outside Assignment | Not walked | |
| J4 Result | Pass | Statistics, filters, CSV (reflects hand edits) |
| J5 Out of date | Pass, with [31](MVP_BUGS.md#bug-31) | |
| J6 Place | Pass, with [32](MVP_BUGS.md#bug-32) | Availability warning shown; tier and date-limit overrides silent |
| J7 Swap | Pass, with [18](MVP_BUGS.md#bug-18), [32](MVP_BUGS.md#bug-32) | |
| J8 Free a seat | Pass | |
| J9 Run again keeping pins | Pass | "Keeps your 1 hand placement…" |
| J10 Orphaned pin | Fails, [31](MVP_BUGS.md#bug-31) | Nothing flags it once in Assignment |
| J11 By vendor | Pass, with [10](MVP_BUGS.md#bug-10) | Search works; no "Unassigned only" control exists (doc corrected) |
| J12 Why not placed | Fails for capped vendors, [33](MVP_BUGS.md#bug-33) | Right for unavailable dates and taken tiers |
| J13 History | Pass | Swap and placement entries, and one entry per run |
| J14 Rules close | Pass | |

### K. Publishing and market days

| Flow | Result | Notes |
| --- | --- | --- |
| K1 Publish | Pass, with [42](MVP_BUGS.md#bug-42) | Focus on Cancel; the dialog's promise is untrue while bug 1 stands |
| K2 Check in | Fails for hand-edited vendors, [1](MVP_BUGS.md#bug-1) | Right for untouched vendors |
| K3 Not today | Pass | |
| K4 Undo | Pass | |
| K5 Attendance | Pass | See usability notes |
| K6 Send offers | Not built | |

### L. Ending and managing

| Flow | Result | Notes |
| --- | --- | --- |
| L1 Archive after market days | Pass, with [8](MVP_BUGS.md#bug-8), [9](MVP_BUGS.md#bug-9), [30](MVP_BUGS.md#bug-30) | |
| L2 Archive early | Pass, with [8](MVP_BUGS.md#bug-8), [30](MVP_BUGS.md#bug-30) | |
| L3 Access | Pass | Owner cannot be demoted ("Cannot change owner's role"), but the dropdown is offered |
| L4 Rename | Pass | |
| L5 Delete | Pass, with [43](MVP_BUGS.md#bug-43) | |

### M. Offers (planned)

M1 to M4 are not built; M5 shows the market's name and slug only, as documented.

## Usability observations

Not defects, but things a user test is likely to surface.

- **Attendance** lists only vendors who have checked in, by email, with no table and no count; on market day an organizer cannot see who is missing, and cannot check someone in themselves.
- **Reviewed list:** 250 rows of emails, with no search, no names, no status filter and no sign of which applications are empty.
- **Review card:** the applicant's name and the essential answers sit at the bottom, after every custom answer, until the organizer chooses what leads the card.
- **Publish Results** is one click, with no confirmation and no word on what vendors will see or what happens to decisions made afterwards.
- **"Your Application"** has no way back to the form, and signing in from the apply link skips it.
- **The calendar** has no month or year jump, and accepts dates in the past without comment.
- **The import** keeps the column mapping only once an import is confirmed, so an organizer who goes back to fix their spreadsheet maps every column again.
- **The import** suggests only Timestamp and Email, even where a column's heading is word for word a question's label.
- **Result** calls table-days "tables" ("174 of 250 tables used" for a 50-table plan over 5 days), and rounds 209 of 210 dates to "100% satisfaction".
- **Removing** an organization member takes effect at once, with no confirmation.
- **The spring 2025 export** has no Timestamp column, so first-come-first-served cannot order it, and neither the proposal nor the rules say so.

## Corrections made to USER_FLOWS.md

- Path and flow statuses updated from this run, with the new bugs linked, and flows marked "walked live" where this run walked them.
- G4: the rare-option rule is a share of answers for a multi-select, not "fewer than 3".
- D4: a person with no organization is sent to create one; the dialog does not make one.
- E6: the wall editor is on Edit Layout, not Place Tables; Auto-Place places one table per type.
- H3b: signing in from the apply link lands on the form; "Your Application" has no link to it.
- J11: there is no "Unassigned only" control.
- "Not reachable yet" gains A4, P1 without tiers, imports without a days column and hand-mapped tier grids.

## Test markets left on the slot-1 stack

These are gone from the stack as of 2026-10-03; the re-walk's markets are listed in [MVP_TEST_RUN_2026-10-03.md](MVP_TEST_RUN_2026-10-03.md).

| Market | Id | State | Used for |
| --- | --- | --- | --- |
| Spring Makers Market 2026 | `5fba113b-11bc-4848-ab8c-c605014b9f20` | Archived | P2 with the March 2026 export, through to archive |
| Makers Market Fall 2023 | `cffe537d-2a72-42dc-bc97-1e1303ce6476` | Assignment, empty assignment | P1 with the 2023 export; bugs 23, 25, 27, 28, 34 |
| P2 2024 Export | `3d31a653-6cae-488d-a164-4c2a7ec3d7cd` | Applications Open | Bug 24 |
| P2 Spring 2025 Screening | `6597da40-2c71-4ef9-8544-6f70f9a5346d` | Applications Open | Bug 24 |
| Harbour Night Market | `dcba4484-0f21-4554-9708-36630dafcadc` | Applications Closed | P3, P4, bugs 6, 20, 21, 26, 36 |
| Guard Test Market | `15a9d8e0-44e8-43a8-9bf5-758934a9b08c` | Assignment | J5, J6, J9, J10, bug 31 |
| Scratch Unasked Test | `e7374a0d-bc9e-4850-aec1-a12fc58d8fac` | Archived | Bug 29, L2, bug 30 |
| Seed Market 212938 | `772f2032-4fab-4b22-baba-57f630167719` | Draft | E6 |

"Pier Draft Market", "Race Test Renamed" and the organizations "Pier Collective Society" and "Empty Org" were deleted as part of B5 and L5.
Screenshots from the run are in the git-ignored `.playwright-mcp/` (`t01` to `t91`).
