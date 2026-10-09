# Rehearsal of the November 2026 market, 2026-10-09

The UBC Makers Market of 18 to 20 November 2026, rehearsed end to end in a real browser with the organizer's real Google Form export, before the market happens.
Scoped on the wayfinder map [November 2026 dry run](../.scratch/wayfinding/november-2026-dry-run/map.md); its tickets fix the plan, the verdicts, the path and the pass criteria this report checks.
Run on `feat/table-share-pairs` (epic E27, built for this run) on 2026-10-09.
Defects found during the run were fixed as found, each first reproduced in a test that failed.

## Summary

**The rehearsal passes.**
All 212 rows imported, an identical re-import changed nothing, and the stored assignment meets every pass criterion the organizer set: no vendor is placed against their own answers, every vendor left out is told why, every pair who asked to share does, and nobody is passed over by someone they outrank.

| | Result |
| --- | --- |
| Import | 212 of 212 rows; re-import: 0 new, 0 updated, 212 unchanged |
| Review | 211 approved, 1 rejected (165 from the organizer's sheet, 46 stand-ins, 1 withdrawn) |
| Assignment | 207 of 211 vendors placed, 393 placements, 294 of 303 table-days, 88% satisfaction, in under 3 seconds; 209 of 211 on the second run |
| Pairs | 36 table-share requests stand; every one shares on all 63 dates both are placed |
| Publish and check-in | Published; 9 check-ins by 7 vendors across all three days on a phone; Attendance shows all 9 |

**What the run changed in the product**, beyond E27 itself:

| Finding | What happened | Now |
| --- | --- | --- |
| Answers naming two addresses | 5 table-share answers named two addresses and paired nobody | Every address is kept; the first that belongs to an applicant is the partner (decided with the user) |
| Blank half-table share | Assign stayed disabled until the share was typed, while the plan screen says blank means 30% | Blank runs at 30% |
| Pairs split by the half-table share | Two pairs were split on 18 November: Gold had used its share, so the either chooser in each pair got a whole table | The share never blocks a pair (decided with the user) |
| Check-in table wording | "Table: A 1 (Half Table (Left))" on the phone | "Table: A 1, left half" |

The one thing the run shows the market still needs is **Attendance cannot say who is missing** ([known gap 3](MVP_KNOWN_GAPS.md#3-attendance-cannot-say-who-is-missing)): with about 130 vendors a day it lists only those who have checked in, by email.

## Second run: no first-come rule, and the most constrained first among equals

Asked for by the user after reading the first run, where 4 Gold-only vendors were left out while 9 Silver tables sat empty on Wednesday.

- **The rules** became current students first, then any listed club; the first-come rule was removed.
- **The solver gained a built-in tie-break** after "fewest available days": fewest tiers across those days (Gold and Silver on three days is 6, Gold on one day is 1), then earliest submission.
  It only separates vendors the organizer's rules leave equal; with a first-come rule it never runs.

The same path on a fresh market, "UBC Makers Market November 2026 Rehearsal 2": the same plan, 212 of 212 imported, the same verdicts.

| | First run | Second run |
| --- | --- | --- |
| Vendors placed | 207 of 211 | 209 of 211 |
| Placements | 393 | 400 |
| Table-days used | 294 of 303 | 301 of 303 |
| Empty Silver on Wednesday | 9 | 2 |
| Satisfaction | 88% | 90% |

Every pass criterion holds again: no rule broken, every unplaced vendor and short-changed date says why, all 36 pairs together on all 64 dates they share, and every order question explained.
Between the runs 14 vendor-dates moved from Gold to Silver and 9 the other way, 7 vendors gained a day and none lost one.

The 2 still unplaced are alumni or staff in no club who want only Gold on Wednesday.
Every current student outranks them, including students who would also take Silver, so placing them would mean moving a higher-ranked vendor down to Silver against their rank: a policy the market has not chosen (see "Standing").

## How it was run

- **Stack:** the primary Docker stack (front end on 5173, back end on 5000), reset to seed state before the run.
- **Local only:** the back end ran with `DISABLE_EMAIL=true` and no TypeSafe key, checked before the run and after every restart; nothing was sent anywhere.
  The stack had been sending real email before the run (see ticket 02 of the map).
- **Browser:** Chromium through the Playwright MCP, 1440 by 900 for the organizer and 390 by 844 with touch for each vendor, each vendor in a fresh browser context.
- **Account:** `e2e@example.com` as the organizer, in "Seed Test Org".
- **Method:** every step through the product's own controls.
  Repetitive steps were scripted, still through the page: the 212 review verdicts by the A and R keys, and the check-ins by taps.
  The pass criteria were checked against the stored assignment, exported from the API to the git-ignored `.playwright-mcp/`.

### Data

The organizer's export, `.scratch/examples/markets/UBC Makers Market Application - November 2026 (Responses) - Form Responses 1.csv`: 212 responses, 33 columns, git-ignored.
It holds real applicants' names, emails, Discord handles and links, so nothing from it is quoted here, and the screenshots and exports stay in the git-ignored `.playwright-mcp/`.

| Shape | |
| --- | --- |
| Dates | Wednesday 18, Thursday 19, Friday 20 November, as a three-day tier grid with no year |
| Tiers | Gold and Silver; "None" means unavailable that day |
| Organizer's status column | 165 Accepted, 10 In progress, 1 Dispute, 1 withdrew, 35 blank |
| Table share | 55 answers: 38 one address, 5 two addresses, 12 none |
| Repeated column | "Email Address" twice |

## The path: P2, started from the Google Form

Market "UBC Makers Market November 2026 Rehearsal".

| Step | Result |
| --- | --- |
| Proposal | Three dates, the year 2026 (confirmed), Gold and Silver, no day limit; every essential question but section and table-type preference, which became "not asked"; the status column and the repeated email column left out. "Keep all" on the three questions with rare answers, so no applicant lost an answer |
| Plan | Sections A (Lower atrium, Gold, 53), B (Level 1 - North, Silver, 37), C (Level 1 - Centre, 6) and D (Level 1 - South, 5): 101 tables a day. C and D are Bronze at the real market and were planned as Silver, because the form offers no Bronze |
| Import | 212 of 212; the proposal's mapping restored for all 33 columns |
| Re-import of the same file | 0 new, 0 updated, 212 unchanged; every application byte for byte the same |
| Rules | Current students before alumni and staff; any listed club before none; then first come, first served |
| Review | 212 cards by keyboard in seconds |
| Assign | As in the summary |
| Publish | The confirmation says what publishing puts on the air and that it cannot be undone |
| Check in | A vendor placed on all three days checked in for each; two vendors per date for theirs |
| Attendance | 7 vendors, 9 check-ins, each at its date |

### The verdicts

The 165 rows the organizer's sheet marks Accepted were approved and the withdrawn one rejected.
The other 46 were decided by the agent as **stand-ins**, by the form's own stated rules (UBC-affiliated, proof given, every certification ticked), on the user's instruction; all 46 passed.
Four are worth the organizer's own look before the real market: the one the sheet marks "Dispute", and three whose proof of affiliation is not a UBC address.

### The pass criteria (ticket 07)

| Criterion | Result |
| --- | --- |
| All rows import, and re-importing changes nothing | Holds |
| Nobody on a day they answered None, at a tier they declined that day, or beyond their own limit | Holds: none |
| Every approved vendor placed or told why | Holds: the 4 unplaced each wanted one day at Gold only, and each date they lack says why ("taken": all Gold tables that day were filled) |
| Pairs sit together | Holds: 36 requests stand; 63 of 63 dates together |
| The order is respected | Holds: every case where a lower-ranked vendor was placed on a date and a higher-ranked one was not is explained by the solver's "fewest dates so far first" (confirmed by the user as the market's behaviour), by a full-table vendor who could not take a half seat, or by a seat that came with a pair |

The 9 table-days left empty are C and D on Wednesday 18: Silver demand that day was below its 48 tables.

## Findings

### Fixed during the run

1. **Two addresses in one table-share answer.**
   The write read "the one address" and paired nobody when there were two.
   Decided with the user: the first address that belongs to an applicant is the partner, and the notice names an applicant who was named and not used.
   Reproduced in pytest at the write, the solver and the applications list first.
2. **A blank half-table share blocked Assign.**
   The plan screen said "Leave blank for 30%" (added by E27, which made the solver read the setting for the first time) while the Assignment page kept Assign disabled with "Set the half table proportion above".
   The gate predated the solver reading the setting at all.
   Reproduced in `assignment-options.spec.ts`; the placeholder now reads "30% (default)".
3. **Pairs split by the half-table share.**
   On 18 November Gold had used its share, so the either chooser of a pair was given a whole table and the partner was seated beside a stranger.
   A first fix moved such a pair to a section still under the share; a second case showed the outcome depending on which of the pair the solver reached first.
   Decided with the user: **the share never blocks a pair**.
   Reproduced in `test_assignment_behaviour.py` first.
4. **The check-in card's table** read "A 1 (Half Table (Left))".
   It now reads "A 1, left half", from the same wording the placement dialog uses, pinned in `checkin.spec.ts`.

### Standing, for the organizer before the real market

- **Attendance cannot say who is missing** (known gap 3).
  On a day with about 130 vendors, the door needs who is expected and who has not arrived; today the page lists only those who have checked in, by email.
- **The 46 stand-in verdicts** are the agent's, not the organizer's, and four are flagged above.
- **Table-share answers that pair nobody**: 11 hold no address, 2 name an address nobody applied with, 2 name a partner who wants a whole table, and 1 names someone whose own request comes first.
  Each is shown on its review card and in the vendor's detail, for the organizer to follow up on Discord.
- **Whether a vendor who accepted Silver should move down to make room** for a lower-ranked Gold-only vendor when Silver would otherwise sit empty.
  The form promises "the highest tier available among the selections made", which the solver keeps by rank; this would place the last 2 vendors of the second run.
- **Two people naming the same partner** gives the partner to the earlier applicant, with no notice for the other.
  Provisional, and none of this file's pairs needs it.

### Observations, not defects

- **Result counts table-days as "tables"** ("294 of 303 tables used" for 101 tables over three days), known gap 7.
- **The review card puts the applicant's name after the organizer's own questions**, known gap 4.
- **In review, a disabled "Import from CSV" and its explanation sit above the queue.**
  The explanation is right; it takes the most prominent place on the page while it is the one thing that cannot be done.
- **A lone half-table vendor with nobody left to pair with is given a whole table**, which uses a table where half would do; unchanged by this run.
- **The Markets page phase filter offers "Offers"**, a phase no market reaches.
- **Opening the site signed out logs two 401 errors** in the console before the redirect to sign-in, and the password field has no `autocomplete="current-password"`.

## Left on the stack

| Market | Id | State |
| --- | --- | --- |
| UBC Makers Market November 2026 Rehearsal | `0747d298-05d6-49ea-bce9-bd80d3100851` | Market Days, published, 9 check-ins; deliberately not archived |
| UBC Makers Market November 2026 Rehearsal 2 | `77f4e0ed-3679-45e6-bb7a-89e795d84d12` | Assignment, assigned with the second run's rules; not published |
