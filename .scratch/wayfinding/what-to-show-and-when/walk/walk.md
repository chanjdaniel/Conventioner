# The organizer UI, phase by phase (walk of 2026-10-18)

A read-only capture of what an organizer sees on each market page in each phase, for both intake paths.
Built from `dev` at `3ddf393b` in an isolated stack (treehouse slot 1), logged in as `e2e@example.com`, viewport 1440x900, full-page PNGs.
Screenshots sit beside this file as `<path>-<phase>-<page>.png`; `-landing` is wherever `/markets/:id` redirected, `-rail-menu` is the rail's More… menu opened, `-forward` is what clicking the rail's forward step produced.

## How the markets were made

- `fresh-draft`: the market `seed_fixture.sh` creates (name and organization only), the state the create dialog leaves.
- `form` ("Walk Form Market"): created over the API with `intakeMode: "form"`, a plan of 2 dates (Sat 21 and Sun 22 November 2026), tiers Gold and Silver, sections Upper Atrium (Gold, 6) and Lower Atrium (Silver, 6), and two custom fields.
  16 applications were written into Mongo once applications were open, the way `seedApplication.ts` does; 15 approved and 1 rejected through `PUT .../review`.
- `csv` ("Walk CSV Market"): created with no intake mode (so `csv`), then started from `back-end/tests/test_data/google_forms/fall-2025.csv` through the real Start-from-CSV screen, then imported through the real Import screen.
  The organizer's part of the plan (location, and sections Upper Atrium Gold 31, Lower Atrium Silver 28, as the November 2026 real plan has) was written with `PUT .../plan`.
  221 imported applications were decided over the API, every ninth rejected (197 approved, 24 rejected).
- Every phase move except the two archives was made by clicking the rail's forward button in the browser; both archives were made from the rail's menu, both from `market_days`, so "archived" here is always "archived after it ran".
  Archiving a draft was not walked.
- Assignments were run with `POST .../assignment`; check-ins with `POST .../attendance` (3 on the form market, 2 on the CSV market).
- Pages skipped as identical to the previous phase: Application Form after `applications_open` (same locked builder, only the phase name in the reason changes), Vendors and Attendance in phases where they show nothing new.

## Before either path: the fresh draft

| Page | State |
|---|---|
| Lands on | `/setup`. Tabs: Market Setup (dot), Application Form, Applications, Assignment. No Attendance tab. |
| Rail | Forward step "Open Applications", enabled and primary. Menu: "Archive Market". Clicking forward: "Cannot proceed: The application form asks nothing. Add market dates, tiers or sections so the form can ask the essential questions, or add a custom field, before opening applications." No resolution link. |
| Market Setup | Editable. "No market days yet / Pick them on the calendar." "How vendors apply" has "I collect applications elsewhere" already selected. Application form card: "Add dates, tiers, two or more sections above, and this form will have something to ask about." |
| Application Form | Editable. "Save Form" disabled with "This form already asks the essential questions. Add a field to save one of your own." |
| Applications | "Import from CSV" disabled: "This market is still a draft, so it is not taking applications yet. Open applications first, then import." Then "No applications received yet." |
| Assignment | Rules and options editable; "Assign" disabled: "This market is still a draft. Plan it, open applications and review them - the assignment runs once the market reaches the assignment phase." |
| Result / Vendors | Broken: red "Internal server error" on both (500 from `GET /tables` and `GET /assignment-statistics`: "Market must have setup data to perform assignment"). Result also reads "...assignment phase.Set the rules" with no space. |
| Attendance (by URL) | "This market has no dates yet." |

What a newcomer cannot tell:
- The primary green "Open Applications" is offered as the next step on an empty market and only fails after the click.
- The Form page says the form "already asks the essential questions" in the same minute the rail says "The application form asks nothing".
- That intake mode was decided for them: the create dialog never asks, and the card preselects "I collect applications elsewhere".

## Path 1: vendors apply on the market's page (`intakeMode: "form"`)

| Phase | Lands on | Rail forward step, and what clicking it shows | Market Setup | Application Form | Applications | Assignment / Result / Vendors | Attendance |
|---|---|---|---|---|---|---|---|
| draft (planned) | Setup | "Open Applications"; succeeded with no confirmation and left me on Setup. Menu: "Archive Market". | Editable. "Start from my Google Form's responses" disabled: "This market's form already has questions of its own, so it can't be started from a Google Form's responses." | Editable, 2 custom fields, preview. | Import disabled (draft reason). | Rules editable, Assign disabled (draft reason). Result shows all 24 table-days "Unassigned" with 24 "Place someone" buttons. | Absent |
| applications_open | Applications | "Close Applications", no confirmation. Rail now carries "Application page localhost:5183/walk-form-mar…" + Copy. Menu: "Reopen for Editing" (refused: "16 applications have already been submitted, so this market cannot return to draft. The application form is frozen once anyone has answered it."), "Archive Market". | Plan still editable, no notice; intake card locked: "This is fixed once a market leaves draft, because changing it would strand whatever the previous choice produced." | Read-only: "Application form can only be edited while the market is in draft phase. Current phase: Applications Open." | "This market is open for applications. New ones will keep arriving here." Import enabled. Review deck live: "1 of 16 to review", Reject / Skip / Approve. "Publish Results" disabled: "Review an application first; there is nothing to publish yet." | Assign disabled: "Applications are still being collected. Close them and review them first - the assignment runs once the market reaches the assignment phase." Result: 24 empty tables, "Place someone" on each. Vendors: "0 of 0 vendors assigned". | Absent (by URL: "Nobody is placed on this date.") |
| applications_closed | Applications | "Begin Review", no confirmation. Menu: "Reopen Applications", "Archive Market". Application page link still shown. | As above. | As above. | "This market is no longer receiving applications. You can still import the ones you collected elsewhere." Same review deck, Approve still live. | Assign disabled with the open-phase text, "Applications are still being collected. Close them…", which is false now. | Absent |
| review | Applications | "Begin Assignment". With 16 undecided: "Cannot proceed: 16 applications are still awaiting review. Every application must be approved or rejected before assignment can begin." Menu: "Return to Applications Closed". | As above. | As above. | "16 applications still to decide. Every one must be decided before this market can assign." Import disabled: "...Use Return to Applications Closed, under More… on the phase rail, then import." When all decided: "Every application has been decided. This market is ready to assign." and "Publish Results" enabled with no explanation. | Assign disabled: "This market is still in review. Move it to the assignment phase to run the assignment." | Absent |
| assignment, before a run | Assignment | "Publish Market" (primary) though nothing has run. It opens "Publish Market? ... The assignment they see is the one you have now." Confirming: "Cannot proceed: No assignment has been computed for this market, so its check-in page could not tell anyone where to stand. Run the assignment first." Menu: "Send Offers", "Archive Market". | As above. | As above. | Import disabled: "...past review, so it takes no more applications and nothing more can be imported." "All 16 reviewed". | Rules editable, "Assign" enabled (dot on Assignment). Result: "No assignment yet. Set the rules and run it" directly above a full grid showing "16 assigned, 0 partial, 8 empty" with every vendor named at a table. Vendors: "15 of 15 vendors assigned". | Absent |
| assignment, after a run | Result | "Publish Market" succeeds through the same dialog. | As above. | As above. | As above. | Assignment: "Run again / Places everyone again." Result: "15 of 15 vendors placed · 16 of 24 table-days used · 0 unassigned · 100% satisfaction", Statistics, Download CSV, "Change" on each seat. | Absent |
| market_days | Attendance | No forward step. Rail: "Application page localhost:5…" and "Check-in page localhost:518…", both truncated past reading. Menu: "Archive Market" only; dialog: "Archiving is permanent… Its check-in page stays up as a record: vendors can still look up where they were placed, but nobody can check in." | Plan inputs still editable (dates removable, counts editable), no notice. | As above. | As above. | Assignment read-only: "The assignment for this market is settled. A rule only takes effect when the assignment runs, and this market can no longer run it. Change a single placement on the Result page instead." Result: "Change" and "Place someone" still offered. | "0 of 15 checked in", per-date chips "Nov 21, 2026 0/15", "Nov 22, 2026 0/9", "Check in" per row. |
| archived (after it ran) | Result | No forward step, no menu button. Line under the spine: "This market is archived. It was published and ran its market days." Rail keeps "Application page" and drops "Check-in page". | Read-only: "This market is archived. An archived market is the record of what happened, so nothing in it can be changed." (the archive line appears twice on the page). Application form card gone. | Read-only, reason still the draft-phase sentence: "...Current phase: Archived." | Import disabled with the archive sentence; "All 16 reviewed". | Assignment page still says "Change a single placement on the Result page instead". Result: no Change or Place controls. | "3 of 15 checked in"; the 12 who never came still read "Not yet". |

## Path 2: the organizer imports a Google Form responses CSV (`intakeMode: "csv"`)

| Phase | Lands on | Rail forward step, and what clicking it shows | Market Setup | Application Form | Applications | Assignment / Result / Vendors | Attendance |
|---|---|---|---|---|---|---|---|
| draft, Start from CSV | `/start-from-csv` (from the Setup button) | n/a | Steps "1 Upload 2 Year 3 Review 4 Confirm". After upload a modal "Which year are these dates in?" opens over the proposal, prefilled 2025. Proposal: "6 to check", "6 answer essential questions, 15 become your questions, 3 left out", "Keep all 129", "Keep all 6". "Create the form and plan" lands on the Application Form page. | | | | |
| draft (after the CSV start) | Setup | "Open Applications"; no blocker even though tier Bronze has no tables. Menu: "Archive Market". | 5 dates (Mon 17 to Fri 21 November 2025), tiers Gold, Silver, Bronze each with an amber "No tables" chip and no explanation; Location and Section empty, "Total tables: 0". Start-from-CSV button now disabled with "This market's form already has questions of its own, so it can't be started from a Google Form's responses." | Editable, 15 custom fields, and a "PREVIEW Applicant view" with "You signed in with it; every update goes there." for a form no applicant will see. | Import disabled (draft reason). | As fresh draft, but Result/Vendors load (plan exists). | Absent |
| applications_open | Applications | "Close Applications". No Application page link (correct for CSV). Menu: "Reopen for Editing", "Archive Market". | Plan editable; intake locked with the same sentence as path 1. | Read-only, same reason as path 1. | Before import: "This market is open for applications. Import them from your form's responses as they come in." and "No applications received yet." After import: review deck "1 of 221 to review". No "Publish Results" (path 1 has it). | Same "still being collected" text as path 1. | Absent |
| (import flow) | `/import` | n/a | Map step opens with "Restored from your last import." although no import ever ran (the mapping came from the CSV start). Preview: "221 of 237 rows will be imported", "16 rows will be skipped", 15 of them "Every answer to 'What will you be selling at the event?' is one you chose to ignore, and it is required." Result: "Imported 221 new applications." then "Back to applications". | | | | |
| applications_closed | Applications | "Begin Review". Menu: "Reopen Applications". | As above. | As above. | "This market is no longer receiving applications. You can still import the ones you collected elsewhere." Import enabled, deck live. | Same false "still being collected" text. | Absent |
| review | Applications | "Begin Assignment". With all 221 decided it was refused: "Cannot proceed: 1 tier has no tables, and approved applicants are waiting on them: Bronze (" followed by 90 email addresses in one red paragraph ") Add a section at that tier, or reject those applications, before assigning." Directly beneath it the page says "Every application has been decided. This market is ready to assign." | Plan editable (adding a Bronze section cleared the blocker). | As above. | "221 applications still to decide…", then "All 221 reviewed · 197 approved · 24 rejected". | "This market is still in review…" | Absent |
| assignment, before a run | Assignment | "Publish Market", same dialog and refusal as path 1. Menu "Send Offers" refuses: "197 applications are still approved but not yet assigned or unassigned. Run the assignment solver before sending offers." | As above. | As above. | Import disabled, past review. | Same contradiction as path 1: "No assignment yet" over a full preview, Vendors "197 of 197 vendors assigned". | Absent |
| assignment, after a run | Result | "Publish Market". | As above. | As above. | As above. | "197 of 197 vendors placed · 345 of 345 table-days used · 0 unassigned · 87% satisfaction". Sections listed Courtyard (Bronze) first, alphabetical rather than by tier. | Absent |
| market_days | Attendance | No forward step. Rail: "Check-in page localhost:5183/walk-csv-market/check-in" readable in full (only one link). Publishing dates a year in the past raised no warning. | Plan still editable. | As above. | As above. | Rules locked, same text as path 1. | Per-date chips "Nov 17, 2025 0/92" and so on. |
| archived (after it ran) | Result | As path 1, and no check-in link at all. | As path 1. | As path 1. | As path 1. | As path 1. | Opens on the last date; everyone who did not come reads "Not yet". |

## What differs between the paths

- The CSV path has no "Application page" link on the rail and no "Publish Results" control; the form path has both from `applications_open` on (Publish Results disappears once archived; the application page link stays).
- Both paths show "Import from CSV" on Applications in every phase, including the form-intake market, where it is a primary green button while applications are open.
- Both paths call the same steps "Open Applications" and "Close Applications", which on a CSV market open and close nothing a vendor can see; on a CSV market "Close Applications" means "I have finished importing".
- The CSV start creates tiers but no sections or locations, so a CSV market reaches Open Applications with "Total tables: 0" and is first told about it two phases later, in review, as a 90-address blocker.
- The CSV start saves the import mapping, and the first import calls it "your last import"; values the start set aside as rare count as "one you chose to ignore", which skipped 15 of 237 rows the organizer never chose to drop.

## Visibly broken or wrong

- Fresh draft: Result and Vendors show "Internal server error" (500s from `/tables` and `/assignment-statistics` when `setupObject` is null).
- Result banner text: "...the assignment phase.Set the rules" (missing space), on every pre-assignment phase.
- Assignment `before a run`, both paths: Result says "No assignment yet. Set the rules and run it" above a fully populated preview grid with names at tables, and Vendors says "N of N vendors assigned"; nothing marks the grid as a preview.
- `applications_closed`, both paths: the Assignment page still says "Applications are still being collected. Close them…".
- "Publish Market" is the primary forward step before any assignment exists, and its dialog says "The assignment they see is the one you have now" before refusing.
- "Send Offers" is offered in the assignment menu on both paths and cannot succeed (nothing moves an application past approved); its refusal is hard to parse.
- "Reopen for Editing" is offered in the menu with 16 applications present and always refused.
- Rail links truncate to "localhost:5…" and "localhost:518…" once a market has both the application and check-in links (form path, market days).
- Archived: the rail keeps the application page link and drops the check-in page link, the reverse of what the archive dialog promises stays up.
- Archived Assignment page still tells the organizer to "Change a single placement on the Result page instead", where nothing can be changed; archived Form says it can be edited "only while the market is in draft phase".
- Archived Attendance labels vendors who never came "Not yet".
- Market Setup's inputs stay editable through `applications_open` to `market_days` with no word on what an edit now affects (the form's offering is frozen at the first applicant; placements are not re-run).
- Review approve and reject are live from `applications_open` onward, so "Begin Review" names a phase whose work could already be done.
- The review deck shows the newest application first ("1 of 16" was the last to arrive).
- The Vue devtools pill overlaps content at the bottom centre of every screenshot (dev build only).

## What a newcomer could not tell, by phase

- Draft: that sections with counts are required before an assignment can ever run; nothing in draft says so, and Open Applications does not check it.
- Draft, form path: the address the form will go live at; the card says "the market's own address" but shows none until applications open.
- Applications open: whether to start approving now or wait for Begin Review; the screen offers both.
- Applications open, form path: whether editing dates or sections now reaches the live form (it does not).
- Applications closed: what "Begin Review" adds, when review was already possible.
- Review: what "Publish Results" does, to whom, and whether it is needed before assignment; the button carries no explanation once enabled.
- Assignment before a run: that the grid on Result is a preview and nothing is stored, and that "Assign" must be pressed before "Publish Market".
- Assignment after a run: that publishing is irreversible and is the step that puts the check-in page up; only the dialog says so.
- Market days: what comes next, since the rail has no forward step and the only menu item is red "Archive Market"; and where the check-in page is, since its link is truncated.
- Archived: where the public record lives, since the check-in link is gone from the rail.
