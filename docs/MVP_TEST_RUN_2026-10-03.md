# MVP re-walk after E26, 2026-10-03

The three intake paths of [USER_FLOWS.md](USER_FLOWS.md), walked again in a real browser as an organizer and as a vendor, after epic E26 ("The user flows hold") fixed the bugs of the [2026-09-30 usage run](MVP_TEST_RUN_2026-09-30.md).
Run on `fix/mvp-e2e-testing` on 2026-10-03, with the same real Google Form exports.
Defects the re-walk found were fixed during it, each first reproduced in a Playwright spec that failed; they are bugs 48 to 53 in [MVP_BUGS.md](MVP_BUGS.md).

## Summary

**All three intake paths now complete with real exports.**

| Path | 2026-09-30 | 2026-10-03 |
| --- | --- | --- |
| P1 CSV intake, form by hand (2023 export) | Completed only once a days column was added to the file by hand, then could not be assigned | 277 of 294 rows imported with no change to the file, all 277 placed on a plan with no tiers |
| P2 Started from last year's Google Form (March 2026 export) | 0 of 250 rows imported; 84 after every workaround | 225 of 250 imported, 217 of 220 approved placed, published, checked in, archived |
| P3 Online intake | A new vendor could not apply, and no vendor could see a verdict after close | A new vendor applied on a phone, kept their sign-in across a reload, and read "Approved" after close |

Each row that does not import says why, and the reasons are ones an organizer would expect: blank rows, a row with its columns shifted, a test row, a row with no name, two applicants the form stopped questioning once they said they were not students, and applicants whose only answers were options the organizer left out on the proposal, which the proposal warned of before confirming.

**What the re-walk found** was smaller than before, and is fixed:

| Bug | What happened | Where |
| --- | --- | --- |
| [48](MVP_BUGS.md#bug-48) | The import called an answer the organizer chose to ignore "required", and listed a reason per question for a blank row | H2i |
| [49](MVP_BUGS.md#bug-49) | Portfolio and shop links on the review card were plain text | I1 |
| [50](MVP_BUGS.md#bug-50) | A priority rule's controls had no names, and removing a rule or an answer needed a mouse | J1 |
| [51](MVP_BUGS.md#bug-51) | The check-in email field shrank to 22 px under a 44 px button on a phone | K2 |
| [52](MVP_BUGS.md#bug-52) | Every link sat 3 px off its line, native radios and checks were the browser's blue, and "Plan saved" touched the card's corner | many |
| [53](MVP_BUGS.md#bug-53) | The vendor's Full name asked for their name "as you would like it read out", which is Preferred name's question | H3a |

## How it was run

- **Stack:** the treehouse slot-1 Docker stack (front end on port 5183, back end on 5010), `DISABLE_EMAIL=true`.
- **Browser:** Chromium through the Playwright MCP, 1440 by 900 for the organizer and 390 by 844 for the vendor, each in its own browser context.
- **Accounts:** `e2e@example.com` as the organizer, in its organization "Seed Test Org"; a vendor address that had never applied.
  With no mail sent, the vendor's sign-in code was replaced in `applicant_login_challenges` with a known one, the way the specs do.
- **Method:** every step through the product's own controls.
  Repetitive steps were scripted, still through the page: 225 and 277 review cards with the A and R keys, mapping nine columns, and 35 clicks back through the calendar to November 2023.
  P3's plan was written through the plan API, as P1 had just walked the plan's screens; its intake mode, form and phase moves were done on screen.

### Data

The same files as the 2026-09-30 run, from the git-ignored `.playwright-mcp/examples/`: `march-2026.csv` for P2 and `untitled-year.csv` (the 2023 export) for P1.
They hold real applicants' names, emails and answers, so nothing from them is quoted here or in MVP_BUGS.md, and the screenshots stay in the git-ignored `.playwright-mcp/` (`r-p1-*`, `r-p2-*`, `r-p3-*`).

## Paths

### P1. CSV intake, form built by hand

Market "Retest Makers Fall 2023", created from scratch.

| Step | Result |
| --- | --- |
| Plan | Five days found by name on the calendar ("Monday, November 20, 2023"); one location; two sections of 30 with no tier |
| Form | Six questions of the organizer's own; Section preference switched off, and it stayed off |
| Import, map | Every column but Timestamp and Email Address mapped by hand; "All required questions are mapped." with no "how many days" column |
| Import, preview | 277 of 294: ten repeat submissions replaced by the applicant's later row, seven blank rows skipped as blank; day answers such as "Tuesday, November 21st" read as whole dates, "Full table" as a whole table |
| Review | 277 approved by keyboard |
| Assign | 277 of 277 placed, 300 of 300 table-days used, 49% of requested dates given |

Bugs 23 and 24, which stopped this path on the usage run, are fixed; so are 5, 25, 27, 34 and 35, met along the way.

### P2. CSV intake, started from last year's Google Form

Market "Retest March Makers 2026", started from the March 2026 export.

| Step | Result |
| --- | --- |
| Proposal and confirm | Walked before this record began; the proposal restored all 29 columns at the import |
| Import, preview | 225 of 250, with no value left to match; of the 25 skipped, 20 answered a required question only with options left out on the proposal, and the rest are a row with no name, one with shifted columns, a test row, and two applicants the form stopped questioning |
| Review | 225 reviewed by keyboard: 220 approved, 5 rejected |
| Assign | No ceiling, half tables up to 50%, first come first served: 217 of 220 placed, every table used, the three unplaced listed as Unassigned |
| Publish | The confirmation says what publishing puts on the air; the rail then shows the check-in page and its address on one line |
| Check in | On a phone: the vendor's two dates, "Check in", "Checked in ✓", "Undo"; Attendance shows the check-in |
| Archive | "This market is archived. It was published and ran its market days."; the check-in page stays up as a record, with nothing to check in to |

### P3. Online intake

Market "Retest Harbour Night 2026": two dates, two tiers, two sections, "Vendors apply on this market's page".

| Step | Result |
| --- | --- |
| Open | The rail shows the application page and its address |
| Apply | A vendor who had never applied asked for a code, signed in, answered every essential question and one of the organizer's own, and saved |
| Reload | Still signed in, on "Your application", with "Change your answers" |
| Verdict | Approved, applications closed, results published; on reload the vendor read "Approved" |

## Not walked again

- **P4, P5 and P6**, and the flows outside the three paths, stand as the 2026-09-30 run and the E26 specs leave them; USER_FLOWS.md says which.
- **The 2024, spring 2025 and fall 2025 exports.** Their anonymised copies are held to a hand-written answer key in `back-end/tests/test_csv_proposal.py`, and `start-from-csv.spec.ts` takes the fall 2025 copy from proposal to import.
- **Registration, anything that needs an email to arrive, and floorplan section grouping**, for the same reasons as before.

## Still standing: usability observations

The 2026-09-30 run listed things a user test is likely to surface that are not defects.
E26 was scoped to bugs, so these stand, and the re-walk met several again.
Each is written up, with what fixing it would take, in [MVP_KNOWN_GAPS.md](MVP_KNOWN_GAPS.md):

- **The import suggests only Timestamp and Email Address**, even where a heading is word for word a question's label; P1 mapped nine columns by hand.
- **Attendance lists only vendors who have checked in**, by email, so on market day it cannot say who is missing.
- **The review card puts the applicant's name after every answer of the organizer's own** until the market chooses what leads the card.
- **Publish Results is one click**, with no confirmation and no word on what vendors will see.
- **Result counts table-days as "tables"** ("300 of 300 tables used" for a plan of 60 tables over 5 days).
- **The calendar has no month or year jump.**
- **Removing an organization member takes effect at once.**

## Test markets left on the slot-1 stack

| Market | Id | State | Used for |
| --- | --- | --- | --- |
| Retest March Makers 2026 | `747f169d-b689-475f-be00-65f95785add1` | Archived, after Market Days | P2 |
| Retest Makers Fall 2023 | `b975a4c1-63f5-4f3c-812b-5a297aa141cd` | Assignment, assigned | P1 |
| Retest Harbour Night 2026 | `56c97e80-78df-41fb-93b9-55707353780b` | Applications Closed, results published | P3 |

The markets the 2026-09-30 run left on the stack are gone (checked on 2026-10-03).
