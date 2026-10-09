# 01: What is built and working today?

Type: task
Status: resolved
Blocked by: -

## Question

Before the run's scope can be chosen: which of the paths in `docs/USER_FLOWS.md` are built, which were last seen working with a real export, what has changed since, and does this file's shape fit what the import expects?

## Answer

Resolved AFK on 2026-10-09 against `dev` at `ea29bb67`.

### The paths

| Path | Built | Last walked | Result then |
| --- | --- | --- | --- |
| P1 CSV intake, form built by hand | Yes | 2026-10-03, 2023 export | 277 of 294 imported, all placed |
| P2 CSV intake, started from the Google Form | Yes | 2026-10-03, March 2026 export | 225 of 250 imported, 217 of 220 approved placed, published, checked in, archived |
| P3 Online intake | Yes | 2026-10-03 | A new vendor applied on a phone and read their verdict |
| P4 Online form plus imported stragglers | Yes | 2026-09-30 | Works |
| P5 Offers | **No** (`E05`) | - | - |
| P6 Ending early | Yes | 2026-09-30 | Works |

Every bug both runs found is fixed (`E26`, bugs 1 to 53 in `docs/MVP_BUGS.md`).
What still stands is listed in `docs/MVP_KNOWN_GAPS.md`, and several of those items will be met on this run:

- **Attendance cannot say who is missing** (gap 3): it lists only vendors who have checked in, by email.
- **The review card puts the applicant's name last** (gap 4), and **the reviewed list is emails only** (gap 5).
- **Publish Results is one click** (gap 6), with no confirmation.
- **Result counts table-days as "tables"** (gap 7).
- **The solver fills market dates in calendar order** (gap 1, kept on purpose): with three days and most vendors wanting two, Wednesday and Thursday fill before Friday is reached.
- **The calendar has no month or year jump** (gap 8): only matters on P1, where the plan's dates are entered by hand.

### What changed since the re-walk

Four merges, none touching a flow:

- `#89` lookup indexes at boot (`back-end/lookup_indexes.py`).
- `#90` dependency updates: Flask 3.0 to 3.1, flask-cors 4 to 6, pymongo 4.6 to 4.18, python-dotenv, front-end lockfile. **Not yet walked in a browser**; the running back-end image already carries these versions.
- `#91` the test reset clears the placement trail and deletion records.
- `#92` a stray screenshot removed.

CI (`Test`, including the Playwright suite) is green on `dev` HEAD.

### This file against the import

The proposal rules (`csv_proposal.proposal`, no TypeSafe, nothing written) were run on the file inside the back-end container:

- 212 rows, 33 columns, 212 responses, parsed without error.
- **Dates:** Wednesday 18, Thursday 19 and Friday 20 November, read from the tier grid's headings; the year (2026) inferred from the timestamps and weekdays.
- **Tiers:** Gold and Silver. The grid's "None" means unavailable that day; no applicant answered None on all three days.
- **Essential questions:** full name, preferred name, the three-day tier grid, "Maximum number of days you wish to booth" (1, 2 or 3 days), half or full table, and "share a table with".
- **Not asked, so declared through "not asked":** section preference and table-type preference.
- **Left out:** the organizer's `Status` column, and the second `Email Address` column, which repeats the first.
- **Market ceiling:** none stated in the file; each vendor's own limit is at most 3, which is every day there is.
- The other 20 columns become the organizer's own questions (UBC affiliation, Discord, business name and links, what they sell, video and portfolio links, four certifications, club membership).

### Shape of the demand, for judging the result

- **The organizer has already reviewed in the sheet:** 165 Accepted, 10 In progress, 1 Dispute, 1 withdrew, 35 blank.
- Of the 165 Accepted: 61 want a full table, 60 either, 44 half.
  Per day, 121, 119 and 136 are available (Wednesday to Friday), and their wanted table-days total 350.
- One applicant answered that they are not a UBC student; it is the one marked withdrew.
- 5 applicants want more days than they are available for.
