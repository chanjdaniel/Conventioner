# MVP bugs found walking the user flows

Found on 2026-09-30, on `dev` at `59677cf8`, while walking every flow in [USER_FLOWS.md](USER_FLOWS.md) on a fresh local stack.
Bugs 22 to 44 were found the same day by the usage test run with five real Google Form exports, written up in [MVP_TEST_RUN_2026-09-30.md](MVP_TEST_RUN_2026-09-30.md); that run also retested bugs 1 to 21, and each entry below says what it saw.
Every one was fixed by epic E26 ("The user flows hold") on `fix/mvp-e2e-testing`, except bug 39, which is known behaviour; the summary names the commit for each.
Bugs 45 to 47 were found while fixing the others, and bugs 48 to 53 on the live re-walk after the fixes ([MVP_TEST_RUN_2026-10-03.md](MVP_TEST_RUN_2026-10-03.md)).
Each fix began from the reproduction below, made into a Playwright spec that failed first.
Each entry gives a reproduction from the user's side first, then what was observed, then the cause as far as it was traced, then what a spec pinning it should assert.

Severity is judged by what a real organizer or vendor would suffer:

- **Critical:** market day or the main MVP path goes wrong for real people.
- **High:** a flow the product offers cannot be completed, or silently writes wrong data.
- **Medium:** the product says something untrue, or a documented option does not work.
- **Low:** interface polish, stale copy, code hygiene.

## Environment used

- Local Docker stack from a treehouse worktree (`DISABLE_EMAIL=true scripts/th-compose.sh up -d`), seeded with `scripts/seed_fixture.sh`, signed in as `e2e@example.com`.
- Browser viewport 1440 x 900.
- Two markets walked end to end:
  - "Harbour Night Market": created from scratch, 2 dates, 2 tiers, 2 sections, "Vendors apply on this market's page", one custom Select field, opened for applications.
  - "Fall Makers Fair": created with "I already have a Google Form" from `back-end/tests/test_data/google_forms/fall-2025.csv` (237 responses, 30 columns), 3 sections added by hand, imported, reviewed, assigned, one swap, published, one check-in, archived.
- The usage test run added five real Google Form exports from `.scratch/examples/markets/` in the primary checkout (untracked, and holding real applicants' details, so nothing from them is quoted here), and six more markets; [MVP_TEST_RUN_2026-09-30.md](MVP_TEST_RUN_2026-09-30.md) lists them.

## Summary

Flow ids refer to [USER_FLOWS.md](USER_FLOWS.md); "Tracked" names an open Wayfinder ticket that already records the problem.

| # | Bug | Severity | Flows | Tracked | Fixed in |
| --- | --- | --- | --- | --- | --- |
| [1](#bug-1) | Check-in sends hand-placed vendors to the wrong table | Critical | J6, J7, J8, K2 | | `176f9c2c` |
| [2](#bug-2) | A market started from a Google Form imports 0 rows of that same file | Critical | P2, G5, H2a | | `0eb2d8df` |
| [3](#bug-3) | The proposal saves the main table-choice answers as "ignore" | Critical | P2, G5, H2a | | `0eb2d8df` |
| [22](#bug-22) | Password-reset and verification links send a signed-out person to sign-in | Critical | A1, A4 | | `d6558368` |
| [23](#bug-23) | A market planned without tiers can never be assigned | Critical | P1, E2, E4, J3 | | `3aeeae03` |
| [24](#bug-24) | The import requires "Number of dates you want", which most real forms never asked | Critical | P1, P2, G4, H2d | | `cf0a17b9` |
| [4](#bug-4) | Applicants who chose only rare options lose a required answer | High | P2, G4, H2a | | `9f1ee9ff` |
| [5](#bug-5) | Skipped import rows are written as empty applications | High | H2i, I1 | | `c086ec13` |
| [6](#bug-6) | A first-time vendor cannot apply online | High | P3, H3a | | `c1636c89` |
| [25](#bug-25) | The plan saves itself in a loop and overwrites other editors | High | E1 to E5, J1, J2 | | `1be4550b` |
| [26](#bug-26) | A tier grid's day headings cannot be matched to dates by hand | High | H2b, H2c, P1, P4 | | `d10ac175` |
| [27](#bug-27) | Answers are split at every comma, even inside an option | High | G4, H2a, H2b | | `b48afb65` |
| [28](#bug-28) | Value decisions cannot be seen or changed once made | High | H2a, H2b, P2 | | `6c07070e` |
| [29](#bug-29) | Editing a custom field turns a switched-off Section preference back on | High | F1, F2, H2d, P2 | | `b1729d47` |
| [30](#bug-30) | Archived markets can still be edited | High | L1, L2, J6 to J8 | | `00eb8b01` |
| [7](#bug-7) | "Leave blank for no ceiling" keeps Assign disabled | Medium | J2a | | `74b45c59` |
| [8](#bug-8) | A market archived after Market Days says it was never published | Medium | L1 | `claims-and-room` 06 | `525d153e` |
| [9](#bug-9) | Archived check-in pages go offline, contrary to the docs and the deletion preview | Medium | L1, B5b | | `6be7b1b9` |
| [20](#bug-20) | A vendor cannot see their application or verdict once applications close | Medium | H3c, I7 | | `101d2c16` |
| [21](#bug-21) | A returning vendor's apply page opens empty | Medium | H3b | | `a94e4d9e` |
| [31](#bug-31) | An orphaned pin is invisible once the market is in Assignment | Medium | J10, K1 | | `1819ff45` |
| [32](#bug-32) | A hand placement moves a vendor into a tier they refused without warning | Medium | J6, J7 | `claims-and-room` 05, in part | `328a3da2` |
| [33](#bug-33) | "Why not placed" ignores the vendor's date limit and the market ceiling | Medium | J12 | | `54f3d5dd` |
| [34](#bug-34) | An applicant listed more than once in a file loses their approval on every re-import | Medium | H2h | | `c086ec13` |
| [35](#bug-35) | The import accepts a value that is not an email address as the applicant's email | Medium | H2a | | `c086ec13` |
| [36](#bug-36) | A vendor's sign-in ends on any reload | Medium | H3a to H3c | | `a94e4d9e` |
| [37](#bug-37) | Viewers are shown controls they cannot use | Medium | B2, every market page | | `dd4835ec` |
| [38](#bug-38) | Floorplan beta: Auto-Place places one table, and the calibration result is mislabelled | Medium | E6 | | `7ad0bfae` |
| [10](#bug-10) | Vendors page counts rejected applications as vendors | Low | J11 | `claims-and-room` 04 | `54f3d5dd` |
| [11](#bug-11) | The phase rail wraps at 1440 px when it shows the public URL | Low | H1 | `claims-and-room` 07 | `3254eaa9` |
| [12](#bug-12) | The market frame shifts 32 px on Start from your Google Form | Low | G3 to G5 | | `3254eaa9` |
| [13](#bug-13) | Assignment Options inputs have no visible border | Low | J2 | | `74b45c59` |
| [14](#bug-14) | Markets list: long names wrap, and separate days read as a range | Low | C2 | | `edf3cfb1` |
| [15](#bug-15) | Manage market dialog buttons are undersized | Low | L3, L5 | | `871f9e4f` |
| [16](#bug-16) | Stale or wrong copy in four places | Low | E8, H2a, H3a | | `4db6088c` |
| [17](#bug-17) | The essential questions panel omits two questions every form asks | Low | F1 | | `4db6088c` |
| [18](#bug-18) | A swap gives no warning when it changes a vendor's table size | Question | J7 | `claims-and-room` 05 (placement warnings) | `328a3da2` |
| [19](#bug-19) | Code and documentation hygiene | Low | none | | `6be7b1b9`, `525d153e`, `d4401703` |
| [39](#bug-39) | The solver fills market dates in calendar order | Question | J3 | | Known behaviour |
| [40](#bug-40) | The import misreports its own counts and rows | Low | H2a, H2h, H2i | | `9b290e34` |
| [41](#bug-41) | The proposal cuts question labels mid-sentence | Low | G4, F2 | | `9f1ee9ff` |
| [42](#bug-42) | Stale or wrong copy, second batch | Low | C1, D4, H2j, K1, A3, E6 | | `4db6088c` |
| [43](#bug-43) | Interface polish found on the usage run | Low | many | | `9c7d7362`, `4b19fc95`, `edf3cfb1`, `73ae4682`, `3254eaa9`, `871f9e4f` |
| [44](#bug-44) | Accessibility gaps | Low | many | | `98e7a17c` |
| [45](#bug-45) | The applicant form asks a Section preference the market switched off | High | H3a, F2 | | `b1729d47` |
| [46](#bug-46) | A market can be created owned by someone else, or by nobody | High | C1 | | `69f4b121` |
| [47](#bug-47) | Deleting a market leaves its applications and check-ins behind | High | L5, B5c | | `f7b21c32` |
| [48](#bug-48) | The import calls an answer the organizer chose to ignore "required", and lists a reason per question for a blank row | Low | H2i | | `df4e3db6` |
| [49](#bug-49) | Web addresses in answers are not links | Low | I1, H3c | | `902cac94` |
| [50](#bug-50) | A priority rule's controls have no names, and removing one needs a mouse | Low | J1, E1 | | `edece8b7` |
| [51](#bug-51) | The check-in email field shrinks to 22 px on a phone | Medium | K2 | | `aaff3130` |
| [52](#bug-52) | Links sit off their line, native controls are the browser's blue, "Plan saved" touches the card's corner | Low | many | | `00ad1604` |
| [53](#bug-53) | The vendor's Full name asks for the preferred name | Low | H3a | | `00ad1604` |

<a id="bug-1"></a>
## 1. Check-in sends hand-placed vendors to the wrong table

**Severity:** Critical.
On market day, a vendor who was moved by hand is told to stand at another vendor's table, and can check in there.

**Reproduce:**

1. Take a market through to Assignment and run it.
2. On Result, click an occupied seat, choose "Swap them with" another vendor, "Swap seats".
   Here: Idikit (Back 1) swapped with Utal (Front 10) on Monday, November 17, 2025.
3. Confirm the Result page, the Vendors detail panel and the placement history all show Utal at Back 1 and Idikit at Front 10.
4. Publish the market.
5. Open `/<market-slug>/check-in`, enter Utal's email, "Look up".

**Expected:** Utal's Monday card says Back 1 (Half Table), Bronze.

**Observed:** Utal's Monday card says Front 10 (Full Table), Gold, which is Idikit's seat; Idikit's lookup says Back 1.
"Check in" succeeds against the wrong table.
The public endpoint `GET /public/markets/<slug>/vendors/<email>/assignments` returns the pre-swap seats while the market's stored `assignmentObject` holds the swapped rows, flagged `handPlaced`.

**Cause:** `get_vendor_assignment_summary` in `back-end/api/attendance.py` replaces the market's `assignment_object` with an empty one and calls `assign_market()` on every lookup.
Read-only views are meant to describe the stored assignment (`assignment_to_show()` in `back-end/api/markets.py`), so this one ignores every pin, swap and freed seat, and any plan change since the run.
It also runs the solver on an unauthenticated request.

**A spec should assert:** after a swap (and separately after "Free this seat" and after placing into an empty seat), the check-in lookup for each affected vendor shows the stored seat.
No spec does this today; `checkin.spec.ts` only checks in vendors the solver placed.

**Retested on the usage run:** reproduced three ways on "Spring Makers Market 2026" (the March 2026 export).
A vendor swapped into another table was shown their old seat, which now belongs to the vendor they swapped with, and checked in there.
A vendor placed by hand on a fifth date had no card for it.
A vendor whose Tuesday seat was freed was still shown that seat.
A vendor nobody touched was shown correctly.
The Publish Market dialog promises "The assignment they see is the one you have now.", which this bug makes untrue.

<a id="bug-2"></a>
## 2. A market started from a Google Form imports 0 rows of that same file

**Severity:** Critical.
This is the MVP's headline path: start from last year's Google Form, then import this year's responses.

**Reproduce:**

1. "New market", "I already have a Google Form", upload `fall-2025.csv`, answer the year (2025), "Create the form and plan".
2. Add a location and one section per tier, "Open Applications".
3. Applications, "Import from CSV", upload the same `fall-2025.csv`.
   The mapping opens "Restored from your last import." and "All required questions are mapped."
4. "Preview import".

**Expected:** most of the 237 rows import.

**Observed:** "0 of 237 rows will be imported".
Every row is refused with "'I certify that the work I will be selling is my own original work, and not AI generated, drop-shipped, or stolen.' is required."

**Cause:** the proposal makes the three columns starting "I certify…" and "I understand…" into required Checkbox questions (`CHECKBOX_LEAD` in `back-end/csv_proposal.py`).
Google Forms exports a ticked checkbox as the option's label text ("I certify that I will be selling original…").
The import turns a checkbox cell into `true` only for `true`, `yes`, `1` or `checked` (`_coerce` in `back-end/csv_import.py`), so every ticked box reads as unticked and the required check fails.

**A spec should assert:** start from `fall-2025.csv`, open applications, import the same file, preview, confirm, and count the imported applications.
The seam test in `start-from-csv.spec.ts` stops at the mapping screen, before Preview, which is why this was not caught.

**Retested on the usage run:** the March 2026 export (250 responses) gives "0 of 250 rows will be imported"; 216 rows name a certification checkbox as their first problem.
The 2024 and spring 2025 exports never reach the preview (bug 24).

<a id="bug-3"></a>
## 3. The proposal saves the main table-choice answers as "ignore"

**Severity:** Critical (same path as bug 2; found by working around bug 2).

**Reproduce:** as bug 2, but with a copy of `fall-2025.csv` whose three checkbox columns have every ticked cell rewritten to `Yes`.

**Observed:** "72 of 237 rows will be imported".
135 of the 165 refused rows say "'Table choice' is required."
The column "Do you want to have a half table or full table?" holds "Full table" (89 rows), "Either" (86) and "Half table" (62).
The import screen never asks the organizer to match those values.

**Cause:** the mapping that "Create the form and plan" stores (and the import restores unchanged) has, for the table-choice question, `{"Full table": null, "Half table": null}`, and `null` means "ignore this value".
So every Full table and Half table answer is dropped before validation, and the required question fails.
"Either" survives only because it happens to equal the internal code `either` (`table_choice_for_label` in `back-end/essential_fields.py`).
Where in the proposal the two values are resolved to `null` is not yet traced; start at the mapping writer in `back-end/csv_start.py` and the table-choice rules in `back-end/csv_proposal.py`.

**A spec should assert:** after starting from `fall-2025.csv`, the stored import mapping resolves "Full table" and "Half table" to the whole-table and half-table choices, and an import of the same file keeps those rows.

**Retested on the usage run:** the March 2026 export stores the same `{"Full table": null, "Half table": null}`.
After working round bugs 2, 4 and 29 inside the product (reopen for editing, loosen the form, "Stop asking it"), 84 of 250 rows import and 162 are refused on "'Table choice' is required.", exactly the Full table and Half table answers.
Nothing in the product lets the organizer undo the saved "ignore" (bug 28), so those applicants cannot be imported at all.

<a id="bug-4"></a>
## 4. Applicants who chose only rare options lose a required answer

**Severity:** High.

**Reproduce:** as bug 3.

**Observed:** 28 rows are refused with "'What will you be selling at the event?' is required."
Those applicants picked only options that fewer than 3 applicants chose.
The proposal keeps an option only when at least 3 applicants chose it, and saves the rest as "ignore" in the mapping (129 resolutions stored for this one question).
An applicant whose every answer was a rare option ends up with no answer, and the question is required, so the whole application is refused.
One more row fails the same way on "Which clubs are you a member of?".

**Why it matters:** the rule protects the form from one-off answers, but applied to a required multi-select it throws away real applicants.
It needs a product decision: map rare answers to an "Other" option, make the question optional when rare answers exist, or ask the organizer on the import screen.

**A spec should assert:** whichever rule is chosen, an applicant with only rare answers is still imported.

**Retested on the usage run:** the March 2026 export loses 31 applicants on its required multi-select and 3 on a required single select, where the rare answer was "No, I am not a UBC student…".
Those 3 are applicants an organizer would want to see and reject, not lose.
The rule is also not "fewer than 3": for a multi-select it is a share of all answers, so an option chosen by 4 applicants was unticked too.

<a id="bug-5"></a>
## 5. Skipped import rows are written as empty applications

**Severity:** High.
The import silently writes data it just told the organizer it would not.

**Reproduce:** any import whose preview reports skipped rows; here, bug 3's file.

1. Preview says "165 rows will be skipped. These will not be imported."
2. Choose "Import 72 rows".

**Expected:** 72 applications.

**Observed:** 237 applications, all Open; 165 of them have no answers.
The review queue opens on "1 of 237 to review" with a card reading "This application carries no answers."

**Cause:** `import_applications` in `back-end/csv_import.py` calls `find_or_create_application` for each row before `record_application_answers` validates it.
When validation fails the loop records the failure and `continue`s, leaving the created application behind.
On a re-import the same pattern would leave an existing application untouched, which is fine; the bug is the create.

**Knock-on effects:**

- Every empty application must be rejected by hand before "Begin Assignment" (the all-reviewed guard).
- Each counts as "an application exists", so the form lock and the Reopen for Editing guard engage even if nothing was actually imported.
- The Vendors page counts them (bug 10).

**A spec should assert:** after an import with skipped rows, the market holds exactly the imported rows.

**Retested on the usage run:** "Imported 84 new applications. 166 rows skipped" left 250 applications, 166 of them empty, one keyed by a timestamp in place of an email (bug 35).
An empty application approved by mistake then refused the assignment run by name (J3a works), and had to be found in a 250-row list of emails with no search (see the test run's usability notes).
Rows with no email at all are not written, so the bug needs an email to bite.

<a id="bug-6"></a>
## 6. A first-time vendor cannot apply online

**Severity:** High.
The "Vendors apply on this market's page" option, offered on every draft since E18/F04/S01, cannot take a single new application.

**Reproduce:**

1. A market set to "Vendors apply on this market's page", in Applications Open.
2. Open `/<market-slug>/apply` as a vendor; it redirects to the sign-in page.
3. Enter a new email, "Send Code".
4. To get past the missing email, plant a known code for that address in `applicant_login_challenges` (as `createApplicantLoginChallenge()` does), then enter it.

**Expected:** a code arrives, and after entering it the vendor sees the form.

**Observed:**

- At step 3 no code is sent: the back end logs no send attempt at all, not even the `DISABLE_EMAIL` skip line.
- At step 4 `verify-code` answers 200, but with no token, and the page returns to "Sign In" with no message.
- The sign-in copy itself assumes an application exists: "Enter the email address you used to apply."

**Cause:** in `back-end/api/applicant_auth.py`, `request_login_code` sends the email only when an application already exists for that address, and `verify_login_code` issues a token only when it finds one.
Nothing creates the first application for a vendor who has never applied, so only vendors already brought in some other way (for example a CSV import) can ever sign in.
The anti-enumeration rules around both endpoints are deliberate and must survive the fix.

**A spec should assert:** a brand-new address can request a code, sign in, submit the form, and see its application on the applicant dashboard.
`applicant.spec.ts` seeds the application document before signing in, so it never meets this.

**Retested on the usage run:** reproduced on "Harbour Night Market".
A challenge document is stored for the new address, but no send is attempted; for an address that has an application, the same request logs "DISABLE_EMAIL is enabled - skipping applicant login code email", which confirms the cause.
With a planted code, `verify-code` again answered 200 and the page went back to "Sign In" with no message.

<a id="bug-7"></a>
## 7. "Leave blank for no ceiling" keeps Assign disabled

**Severity:** Medium.

**Reproduce:** Assignment page; leave "Max assignments per vendor" blank, set "Max half table proportion per section (%)" to 50.

**Expected:** Assign is enabled; no vendor has a ceiling on dates.

**Observed:** Assign stays disabled with "Set both assignment options above to run the assignment."

**Cause:** `assignmentOptionsComplete` in `front-end/src/views/MarketSetupView.vue` requires a whole number of at least 1.
AGENTS.md says "Unset means the organizer named no ceiling; there is no hidden default", and the input's help text says the same, so the gate is the part that is wrong.
Check the back end accepts a null ceiling on the run before relaxing the front end.

**Retested on the usage run:** reproduced.
It also traps the P2 path: the proposal offers "Most days one vendor may get: No limit" and stores no ceiling, then Assign refuses to run until one is typed.

<a id="bug-8"></a>
## 8. A market archived after Market Days says it was never published

**Severity:** Medium.

**Reproduce:** publish a market, record a check-in, then More…, "Archive Market", "Archive".

**Observed:** the rail strikes through Market Days and says "This market is archived. It was assigned but never published, so no check-in page went on the air."
The Attendance tab on the same screen shows the check-in recorded on market day.

**Cause:** `frozenAtIndex` in `front-end/src/components/PhaseRail.vue` reads evidence, not history: a stored assignment means Assignment, a published form means Applications Open.
Nothing it reads says the market reached Market Days.
Attendance records exist and are evidence of exactly that; a published flag or timestamp on the transition would be another.

**Already tracked:** `.scratch/wayfinding/claims-and-room/issues/06-does-a-market-remember-where-it-has-been.md` (open) records the same finding and holds the decision.

**Retested on the usage run:** reproduced on "Spring Makers Market 2026", where the note sits directly above an attendance table holding two check-ins.
A market archived from Applications Open says "It was abandoned before it ran." although it had opened applications.

<a id="bug-9"></a>
## 9. Archived check-in pages go offline, contrary to the docs and the deletion preview

**Severity:** Medium (needs a decision, then either a code or a docs change).

**Observed:** after archiving, `GET /public/markets/<slug>/check-in` answers 404 "Market not found".
The check-in lookup serves only Market Days (`CHECK_IN_PHASES` in `back-end/market_documents.py`).

**Contradictions:**

- AGENTS.md, "Organization Deletion and the Import Chain": "An archived market is still publicly served, so deleting one takes a live check-in URL off the air… Reaffirmed 2026-09-22."
- The organization-deletion preview (`DeleteOrgDialog.vue`) warns, per archived market, that "/<slug>/check-in will stop working", which is already true.
- `published_market_by_slug`'s docstring still describes the rule as "phase != draft".

One of the two rules has to go: either archived markets are served (read only), or the docs, the deletion preview and the deletion trail's reasoning are updated to say they are not.

**Retested on the usage run:** reproduced.
The "Archive this market?" dialog does not mention that the check-in page goes offline, even when the market is in Market Days.
The dead page lets a vendor type their email before saying "Market not found", and its header reads "VENDOR CHECK-IN" over "Vendor Check-in".

<a id="bug-10"></a>
## 10. Vendors page counts rejected applications as vendors

**Severity:** Low.

**Observed:** with 72 approved and 165 rejected applications, Vendors says "72 of 237 vendors assigned" while Result says "72 of 72 vendors placed".
Rejected applicants are not vendors of this market; the two pages should agree.

**Already tracked:** `.scratch/wayfinding/claims-and-room/issues/04-who-is-in-the-vendors-list.md` (open), which also notes that a rejected applicant's date cards say "Not placed" with no reason.

**Retested on the usage run:** "84 of 250 vendors assigned" beside Result's "0 unassigned".
On a market whose run placed nobody (bug 23) it reads "0 of 0 vendors assigned" while 172 applications are approved.

<a id="bug-11"></a>
## 11. The phase rail wraps at 1440 px when it shows the public URL

**Severity:** Low (interface).

**Reproduce:** a "Vendors apply on this market's page" market in Applications Open, viewport 1440 px wide.

**Observed:** the "Application page" chip with its URL and "Copy" pushes "Close Applications" and "More…" onto a second row, doubling the rail's height (about 120 px) and leaving an empty band beside the phase steps.
The Market Days rail with its "Check-in page" chip fits, because it has no forward button.

**Already tracked:** `.scratch/wayfinding/claims-and-room/issues/07-the-rails-second-row.md` (open), measured for the check-in chip at several widths; the application-page chip in Applications Open is a second case of the same cause.

**Retested on the usage run:** reproduced on "Harbour Night Market" in Applications Open.

<a id="bug-12"></a>
## 12. The market frame shifts 32 px on Start from your Google Form

**Severity:** Low (interface).

**Observed:** at 1440 px the market bar sits at x 0, width 1440 on `/markets/<id>/start-from-csv`, and at x 16, width 1408 on every other market page.
Moving between them makes the frame jump, which AGENTS.md says must not happen ("a screen in the frame sets no width of its own").
The same page logs `[Vue warn]: Extraneous non-props attributes (class) were passed to component…` for `StartFromCsvView`, whose template has a fragment root; the two are likely related.

**Retested on the usage run:** reproduced; the floorplan wizard (`/markets/<id>/floorplan`) is full-bleed in the same way, and the import page sits at x 32.

<a id="bug-13"></a>
## 13. Assignment Options inputs have no visible border

**Severity:** Low (interface).

**Observed:** the two inputs under "Assignment Options" render as blank white areas with no border and no placeholder, so nothing marks them as fields.

**Retested on the usage run:** reproduced; they also have no accessible name (bug 44).

<a id="bug-14"></a>
## 14. Markets list: long names wrap, and separate days read as a range

**Severity:** Low (interface).

**Observed:**

- "Harbour Night Market" wraps onto two lines in the name column, making its card taller than its neighbours.
- A market on October 3 and October 10 shows "Oct 3-10, 2026", which reads as eight consecutive days; the five-day market beside it shows "(5 days)" but this one shows no count.

<a id="bug-15"></a>
## 15. Manage market dialog buttons are undersized

**Severity:** Low (interface).

**Observed:** "Add user" and "Delete market" in the Manage market dialog are visibly smaller (about 28 px tall, smaller type) than every other button in the product, which uses the shared `.btn` primitive.

<a id="bug-16"></a>
## 16. Stale or wrong copy in four places

**Severity:** Low.

1. Market Setup, "Application form" card: after the form is locked it still says "Your plan offers something to apply for, so the form can ask about it. Build the application form".
   The usage run saw the same sentence in Draft on a market whose form already had 21 questions.
2. Applications page of a CSV market: "This market is open for applications. New ones will keep arriving here." Nothing arrives by itself on a CSV market.
3. Import, last step: the button says "Back to market setup" but goes to Applications.
4. Vendor sign-in (bug 6): "Enter the email address you used to apply."

<a id="bug-17"></a>
## 17. The essential questions panel omits two questions every form asks

**Severity:** Low.

**Observed:** the panel says "Every application form asks these" and lists Email, Available dates, Number of dates you want, Tier preference, Table choice, Table-share partner, Section preference and Table type preference.
The preview beside it, and every review card, also ask Full name and Preferred name.

<a id="bug-18"></a>
## 18. A swap gives no warning when it changes a vendor's table size

**Severity:** Question for the product.

**Observed:** swapping Utal (Front 10, Full Table, Gold) with Idikit (Back 1, Half Table, Bronze) went through with no warning, although it gives a vendor who was placed on a full table half a table in a cheaper tier.
Placing a vendor into an empty seat does warn about the same things ("They asked for a whole table. This gives them half of one."), so the swap is the odd one out.
Tier is a filter in the solver because it sets the price, so a swap that crosses tiers or table sizes probably deserves the same warnings, for both vendors.

**Already tracked, in part:** `.scratch/wayfinding/claims-and-room/issues/05-before-you-override-an-answer.md` (open) decides what the placement dialog says before a change overrides an answer; it covers placing, and a third override it misses (a vendor's own ceiling on dates), but not swaps.

**See also:** bug 32, found on the usage run: a swap and a placement can both move a vendor into a tier they refused, with no warning.

<a id="bug-19"></a>
## 19. Code and documentation hygiene

**Severity:** Low.

1. `published_market_by_slug` in `back-end/market_documents.py` builds a `query` and a `projection` it never uses before delegating to `_market_by_slug`, and its docstring describes the old "phase != draft" rule.
2. AGENTS.md, "Phase Transitions", still says "Publishing a market is the `draft` → `archived` transition… fired by the Done button in `GenerateAssignmentView.vue`".
   Publishing is now Assignment to Market Days from the phase rail, and that view no longer exists.
3. `ApplicationMonitor.vue` says "Intake mode has no organizer control yet", which E18/F04/S01 retired.
4. `get_public_application_form` in `back-end/api/applicants.py` says it "is not phase-gated on purpose … a market that has closed still has to be able to hand it over", but it goes through the intake lookup, which serves Applications Open only (bug 20).

<a id="bug-20"></a>
## 20. A vendor cannot see their application or verdict once applications close

**Severity:** Medium.
Found reading code while writing the flows, then reproduced live on the usage run with a vendor brought in by CSV import.

**Reproduce:**

1. A form market with an online applicant (for example one imported by CSV, who can sign in; see P4 in USER_FLOWS.md).
2. Review the application, "Publish Results".
3. "Close Applications".
4. As the vendor, open `/<market-slug>/applicant/dashboard` or sign in again.

**Expected:** "Your Application" shows Approved or Not Accepted.

**Observed (from code):** every applicant endpoint (the sign-in, the public form, the vendor's own application) goes through `applicant_intake_market_by_slug`, which serves Applications Open only (`APPLICANT_INTAKE_PHASES` in `back-end/market_documents.py`).
Once the market moves on, they answer "Market not found".
So a published verdict can only be seen while applications are still open, which is before most organizers publish one.
The apply page's own "Applications are not currently open for this market" state can never be shown for the same reason.

**The tension:** closing the applicant surface after Applications Open was a deliberate tightening (a stranger must not apply to a closed market).
Viewing your own application is not applying, so the read paths probably need a wider set of phases than the write path.

**A spec should assert:** after Publish Results and Close Applications, a signed-in applicant still sees their verdict.

**Reproduced live on the usage run:** on "Harbour Night Market" the vendor saw "Approved" after Publish Results.
After "Close Applications" the sign-in page showed the raw slug in place of the market's name, "Send Code" answered 200 but stored no challenge, and the public form answered 404, so the verdict could no longer be reached.

<a id="bug-21"></a>
## 21. A returning vendor's apply page opens empty

**Severity:** Medium.
Found reading code, then reproduced live on the usage run with a vendor brought in by CSV import.

**Reproduce:** as a vendor who already has an application, sign in from the apply link; sign-in lands on the apply page ("Your Application" has no link to it).

**Expected:** the form shows the saved answers, ready to change.

**Observed (from code):** `ApplicationPage.vue` starts its form from an empty object and never loads the stored application (the store's `fetchApplication` is not called there).
The vendor must answer every required question again before they can save.

**A spec should assert:** a vendor with a saved application sees their answers on the apply page.

**Reproduced live on the usage run:** every field was empty and "Not available" was pre-ticked on both days, although the imported answers named tiers on both.
"Save Application" refused with five "is required" messages; after the answers were typed again from memory it saved, and the vendor's original tier answer was replaced by what they re-entered.

<a id="bug-22"></a>
## 22. Password-reset and verification links send a signed-out person to sign-in

**Severity:** Critical.
An organizer who has forgotten their password cannot set a new one, which locks them out for good.

**Reproduce:**

1. Signed out, at `/login` choose "Forgot password?", enter an account's email, "Send Reset Link".
2. Open the reset link (`/reset-password?token=<token>`) in a fresh tab, still signed out.
   Locally the token can be read from `users.password_reset_token` in Mongo, as `auth.spec.ts` does.

**Expected:** the "set a new password" form.

**Observed:** the page redirects to `/login` within half a second; the reset form never appears.
`/verify-email?token=<token>` does the same after firing its verification request, so a new organizer never sees the confirmation.
Loading `/reset-password-request` directly (a bookmark, a pasted link) also lands on sign-in; it is only reachable by clicking "Forgot password?".

**Cause:** two definitions of "public page" disagree.
The router guard (`front-end/src/router/index.ts`, `beforeEach`) lets these paths through from its own `publicPages` list.
`App.vue` decides from `route.meta.public` (line 32), which none of these routes set, so its `onMounted` calls `/check-session`, gets 401 and runs `router.push('/login')`.
The same flag gives the reset-request page a navigation menu while signed out.

**Why no test caught it:** the reset spec in `auth.spec.ts` stubs `/check-session` to answer 200 "so the reset page can render", which hides exactly this.

**A spec should assert:** signed out, with no stubbed session, a real reset link shows the form and a new password works; likewise a real verification link shows its confirmation.

<a id="bug-23"></a>
## 23. A market planned without tiers can never be assigned

**Severity:** Critical for any organizer who does not price tables by tier; the plan lets a section have no tier.

**Reproduce:**

1. Plan a market by hand with dates and two sections whose Tier is left empty; build a form; open applications.
2. Import applications, review them, move to Assignment, set both options, "Assign".

**Observed:**

- The run fails with a bare "Internal server error".
  The back end logs `AttributeError: 'NoneType' object has no attribute 'name'` at `assign_table` (`back-end/assignment/assignment.py`, `tier=table.tier.name`, lines 584, 601 and 615).
- The obvious fix, adding a tier and giving both sections it, makes the run succeed but place nobody.
  The essential questions froze at the first imported application with no tiers, so no applicant accepts any tier, and every vendor panel says "No table at a tier they accept".
- Result then says "No assignment yet. Set the rules and run it" although an empty assignment is stored, and Vendors says "0 of 0 vendors assigned" beside 172 approved applications.
- The market cannot go back to Draft because applications exist, so there is no way forward inside the product.

**Needs a decision:** either the plan requires a tier on every section (and says so while planning), or the solver treats "no tier" as its own single tier.
Whichever is chosen, the solver must never raise on a plan the plan editor accepted.

**A spec should assert:** a market whose sections have no tier either cannot open applications, or assigns its vendors.

<a id="bug-24"></a>
## 24. The import requires "Number of dates you want", which most real forms never asked

**Severity:** Critical.
It blocks the import of three of the five real exports tried (2023, 2024 and spring 2025), whether the market was started from the export (P2) or planned by hand (P1).

**Reproduce:**

1. "I already have a Google Form" with `2024.csv` or `spring-2025-screening.csv` from `.scratch/examples/markets/`.
2. The proposal lists "Number of dates you want" under "Essential questions no column answers" as "Not asked · No column in your file answers it".
3. "Create the form and plan", "Open Applications", import the same file.

**Observed:** "Still unmapped: Number of dates you want", and "Preview import" stays disabled.
Nothing on the page says what to do: the question cannot be switched off, given a default, or worked out from the dates each applicant ticked.
The organizer's only way through is to add a column to the spreadsheet by hand, which the usage run did (counting each applicant's ticked days) to get the 2023 export in.

**Cause:** `asked_essential_keys()` (`back-end/essential_fields.py`, line 308) asks this question whenever the market has dates.
The proposal's confirm (`back-end/csv_start.py`, line 123) can only switch off the rankings (`UNASKABLE_ESSENTIAL_KEYS`), so the proposal's "Not asked" is not what gets stored.

**Needs a decision:** a sensible default exists in every one of these files, "as many dates as they are available for", capped by the market ceiling the proposal already reads from the grid heading ("At most 3 days").

**A spec should assert:** a real export with no "how many days" column can be started from and imported.

<a id="bug-25"></a>
## 25. The plan saves itself in a loop and overwrites other editors

**Severity:** High.

**Reproduce:** open Market Setup or the Assignment page of any market, change one thing (a section count, an option), then watch the network.

**Observed:** `PUT /markets/<id>/plan` fires about every 625 ms, with identical bodies, until the organizer leaves the page.
Measured: 55 saves while on one Setup page, 52 on one Assignment page, 9 in the 6 seconds after a single edit.
With a second tab open on the same market, a location added in that tab was gone 1.5 seconds later: the looping tab re-sends its own copy every cycle.
Alone, the same edit saves and stays.
An archived market loops the same way (bug 30).

**Cause (traced, not proven):** after each save the page re-reads the market, and the watcher on `market` in `front-end/src/views/MarketSetupView.vue` (line 142) replaces the plan's working copy.
A plan card then echoes the new object back as `update:setupObject`, `handleUpdateSetupObject` (line 276) counts it as a fresh edit, and the debounce schedules the next save.

**A spec should assert:** one edit produces one save, and a second editor's change survives.

<a id="bug-26"></a>
## 26. A tier grid's day headings cannot be matched to dates by hand

**Severity:** High.
Tier-by-day grids are how real Google Forms ask tier preference, so this blocks importing them unless the market was started from that file.

**Reproduce:** a market with dates 3 and 10 October 2026 and tiers Premium and Standard; import a CSV with grid columns "Which tiers would you take? [Saturday, October 3]" and "… [Saturday, October 10]", mapped as one group to Tier preference.

**Observed:** "Saturday, October 3" and "Saturday, October 10" are listed as values that "did not match your market", and the only choices offered are Premium, Standard and "Ignore this value".
There is no way to say which market date a heading means; ignoring them gives "0 of 5 rows will be imported" ("'Available dates' is required").
The same happens with the year in the heading ("Saturday, October 3, 2026").
Only ISO headings ("[2026-10-03]") import, and no real form writes those.
The market's own applicant form offers "Not available" for a day, but the import only treats a literal "None" as unavailable, so "Not available" is one more unmatched tier.

**Cause:** for Tier preference, `offered_values()` in `back-end/csv_import.py` (line 284) returns the market's tiers, and the unmatched-values payload (line 877) attaches that list to every unmatched item, including the day headings that `_matched_tiers_by_date` reports.
A started-from-CSV market only gets past this because the proposal writes heading-to-date resolutions itself.

**A spec should assert:** a hand-mapped tier grid with Google-style day headings imports, with each heading matchable to a market date.

<a id="bug-27"></a>
## 27. Answers are split at every comma, even inside an option

**Severity:** High.
Google Forms joins a checkbox question's answers with ", ", and many real options contain commas.

**Seen twice:**

- **The proposal keeps an option the import cannot read.**
  From the March 2026 export the proposal kept "Woven (crochet, knitting, etc)" (44 applicants) as an option of a required multi-select.
  The import's mapping step then warns "One column cannot answer What will you be selling at the event? reliably: some of its options have commas in their own names…", and the saved mapping holds fragments such as "Woven (crochet" and "and frames!" as ignored values.
  The proposal made a form its own import cannot fill.
- **Day answers are split into halves.**
  The 2023 export's "Which days would you prefer to attend?" holds answers like "Monday, November 20th, Tuesday, November 21st".
  The import splits them into "Monday" and "November 20th", so ten values need matching for five days.
  Matching both halves of each day to the same date, the obvious move, refuses every row with "'Available dates' repeats a date."; matching one half and ignoring the other works, and nothing says so.

**Needs:** split against the known options first (longest match), and treat a date matched twice as one date.

**A spec should assert:** the March 2026 "Woven" answers and the 2023 day answers both import with no manual decisions beyond one match per day.

<a id="bug-28"></a>
## 28. Value decisions cannot be seen or changed once made

**Severity:** High, because it makes bugs 3, 4 and 27 impossible to recover from.

**Observed:**

- On a market started from a Google Form, the stored mapping carries the proposal's "ignore" decisions (bug 3's table-choice values, bug 4's rare options).
  The import applies them silently: the mapping step shows no "values did not match" section and no list of saved decisions, so the organizer cannot see them or change them.
- On any import, a value matched on the mapping step disappears from the page once the preview has run; pressing "Back" does not show it again.
  The only way to change a match is to go back to Upload, choose the file again and redo every column mapping, because the mapping is only saved when an import is confirmed.

**Cause:** `CsvImportView.vue` restores `restoredResolutions` into its state (`null` becomes "Ignore this value") and sends them with every check, and the page lists only values the server still reports as unmatched.

**A spec should assert:** saved and restored value decisions are listed on the mapping step and can be changed.

<a id="bug-29"></a>
## 29. Editing a custom field turns a switched-off Section preference back on

**Severity:** High.
It breaks the import of every market started from a Google Form after any form edit, and asks online applicants a question the organizer switched off.

**Reproduce:**

1. A draft whose Section preference is not asked (unticked "Ask this", or started from a CSV, which switches it off).
2. On Application Form, change anything about a custom field (a type, "Required"), then "Save Form".

**Observed:** `applicationForm.unaskedEssentials` goes from `["essential_section_ranking", …]` to `[]`.
Section preference is asked again, and the import's required list gains "Section preference", which no column answers.
On "Spring Makers Market 2026" this disabled "Preview import"; "Stop asking it" (H2f) put it right.
A "Save Form" with no field edit keeps the list, which is why it looks intermittent.

**Cause:** the `fields` setter in `front-end/src/components/application/FormBuilder.vue` (line 34) emits a new form object holding only `fields` and `publishedAt`, dropping `unaskedEssentials`, and the next save sends that object whole.

**A spec should assert:** after unticking "Ask this" and editing a custom field, Save Form keeps Section preference switched off.

<a id="bug-30"></a>
## 30. Archived markets can still be edited

**Severity:** High.
An archived market is the record of what happened; USER_FLOWS L1 and the rail both treat it as read only.

**Observed:**

- On an archived market, Market Setup still offers every control, and clicking a date saved it (`PUT /markets/<id>/plan` answered 200).
- On the archived "Spring Makers Market 2026", Result still showed 210 "Change" and 76 "Place someone" buttons, and "Free this seat" removed a vendor from a market that had already run (`DELETE /markets/<id>/placements` answered 200).
- An archived market that never ran shows an Attendance tab.

**Cause:** neither `save_plan` (`back-end/api/markets.py`) nor the placement writes (`back-end/api/placements.py`) check for the archived phase; only the solver run is phase-gated.

**A spec should assert:** every write to an archived market is refused, and its pages offer no editing controls.

<a id="bug-31"></a>
## 31. An orphaned pin is invisible once the market is in Assignment

**Severity:** Medium.

**Reproduce:** in Assignment, place a vendor by hand in the last table of a section, then reduce that section's count on Market Setup so the table no longer exists.

**Observed:**

- Result shows "The market plan changed since this assignment ran." (J5 works) and still shows the removed table with the vendor in it; the summary says "4 of 8 tables used" while the grid below says "9 of 9 tables · 5 assigned".
- Nothing marks the pin as orphaned on Result, on the vendor's panel or in the CSV.
- "Run again" succeeds, keeps the vendor at the table that does not exist, and clears the out-of-date banner.
- "Publish Market" stays available.

**Cause:** `NoOrphanedPinGuard` guards only the move into Assignment; a market already there never meets it, and nothing on the result pages reads it.

**A spec should assert:** an orphaned pin is flagged on Result and the vendor's panel, and blocks Publish Market until moved or freed.

<a id="bug-32"></a>
## 32. A hand placement moves a vendor into a tier they refused without warning

**Severity:** Medium.
The applicant form promises "You will never be placed in a tier you leave unticked, even if it means going unplaced", and tier sets the price.

**Observed:**

- A swap moved a vendor who accepted only Gold on Monday into a Silver table, with no warning in the swap dialog.
  Afterwards their panel says "Placed by hand against their answer: a tier they did not accept, which sets their price", so the product knows.
- The place-someone dialog warns about availability and table size only; `placementWarnings()` (`front-end/src/utils/placementChange.ts`) has no tier check, although `placement_reasons.py` computes a tier override.
- Placing a vendor who already has their three dates (their own limit and the market ceiling) gives no warning either; that part is ticket 05's.

**Already tracked, in part:** `claims-and-room` 05 covers the missing date-limit warning on placing, not tier and not swaps; bug 18 covers table size on swaps.

<a id="bug-33"></a>
## 33. "Why not placed" ignores the vendor's date limit and the market ceiling

**Severity:** Medium.

**Observed:** a vendor who asked for 3 dates and got 3 (also the market ceiling) shows, for their fourth available date, "A table is free - they could be placed" with "Place them".
The real reason the solver left that date empty is the limit, and the link invites the organizer to break it.
A vendor already placed by hand over their limit is offered another date the same way.

**Cause:** `_reason_for` in `back-end/placement_reasons.py` checks availability, tier and occupancy, but never the vendor's `max_dates` or `max_assignments_per_vendor`.

**A spec should assert:** a vendor at their limit is told so, with no "Place them".

<a id="bug-34"></a>
## 34. An applicant listed more than once in a file loses their approval on every re-import

**Severity:** Medium.
Real exports contain repeat submissions: the 2023 export has 9 addresses more than once.

**Reproduce:** import the 2023 export, approve everyone, then import a later export in which one repeat applicant's three rows are unchanged.

**Observed:** the preview lists that applicant among "approved applications will return to review because their answers have changed", and after confirming they are Open again.
Nothing about them changed.
The counts also disagree: the preview says "2 new, 272 updated" and the result "Imported 2 new applications, updated 282", because the result counts rows and the preview counts applicants.

**Cause:** not traced; the change check probably compares each row in turn with the stored application, which holds the last row's answers, so an earlier duplicate row reads as a change.

**A spec should assert:** re-importing a file with repeat rows leaves an unchanged applicant's decision alone.

<a id="bug-35"></a>
## 35. The import accepts a value that is not an email address as the applicant's email

**Severity:** Medium.
Every vendor-facing flow keys on the email: sign-in codes, check-in lookups, and E05's outcome mail.

**Observed:** a row whose email cell was `not-an-email` imported as an application for "not-an-email", and bug 5 wrote one keyed by a timestamp from a real export's shifted row.
The preview did not flag either.

**A spec should assert:** a row with an invalid email is skipped with a reason.

<a id="bug-36"></a>
## 36. A vendor's sign-in ends on any reload

**Severity:** Medium.

**Observed:** after signing in, reloading the apply page, opening `/<slug>/applicant/dashboard` directly or using a new tab all land on "Sign In".
Anything typed on the long apply form is lost, and a new code is needed, with a 60 second wait between requests and one attempt per code.

**Cause:** the applicant token lives only in memory (`token` ref in `front-end/src/stores/application.ts`, line 17).

**Needs a decision:** keeping the token in memory may be deliberate; if so, the form needs a draft that survives a reload, and the sign-in should say that a reload signs you out.

<a id="bug-37"></a>
## 37. Viewers are shown controls they cannot use

**Severity:** Medium.

**Reproduce:** add an account as a Member of the market's organization (Viewer on its markets), sign in as them, open a draft.

**Observed:** every editing control is live: the calendar, every "+", "Open Applications" and "More…".
An edit appears to work, then the save fails with 403, reported in the server's words ("User does not have permission to edit this market"; "User does not have permission to manage this market's phase" in small red text under the rail), and the edit stays on screen until a reload.

**A spec should assert:** a Viewer's market pages show no editing controls.

<a id="bug-38"></a>
## 38. Floorplan beta: Auto-Place places one table, and the calibration result is mislabelled

**Severity:** Medium (beta, and labelled as such).

**Observed:**

- "Auto-Place Tables" placed one table in an 800 by 600 px floor plan calibrated at about 55 m wide.
  It places one table per table type unless tables already exist (`AutoPlaceButton.vue`, lines 49 to 53), there is no control for how many, and the step shows no plan and no count, so nothing says it worked.
- The calibration result reads "1 px = 0.0145 mm" and "1 m = 68,990 px" for a 435 px line entered as 30 m.
  The stored value is right (0.0145 px per mm); the labels invert it (`ScaleCalibration.vue`, lines 556 to 561): it should read 1 px ≈ 69 mm and 1 m ≈ 14.5 px.
- A reference line only draws when the drag starts on the image; a drag started on the empty canvas beside it does nothing, with no hint.
- The choice dialog promises "Auto-detect walls & obstacles", which the wizard does not do (walls are drawn by hand), and "Familiar step-by-step setup flow" for manual setup, which is now one page.
- The new table type defaults to "Max Capacity 1", while everywhere else a table seats two.

<a id="bug-39"></a>
## 39. The solver fills market dates in calendar order

**Severity:** Question for the product.

**Observed:** on the March 2026 export (84 approved vendors, 5 dates, 50 tables, ceiling 3) every vendor was placed and satisfaction was 100%, but placements per date were Monday 50, Tuesday 59, Wednesday 55, Thursday 27 and Friday 19.
A vendor available all week who wants 2 dates always gets the first two.

**Cause:** `assign()` in `back-end/assignment/assignment.py` walks the dates in order and gives each vendor every date it can until they reach their limit.

**Why it matters:** no vendor is worse off, but a market with a nearly empty Friday is worse for the organizer and for the vendors who are there.
Spreading a vendor's dates would cost nothing when there is room.

**Decided (E26): known behaviour, left as it is.** No vendor is placed worse by it, and spreading dates is a choice about what a market wants that nobody has made yet.
Recorded here so the next test run reads it as known rather than as new, and explained, with what changing it would take, in [MVP_KNOWN_GAPS.md](MVP_KNOWN_GAPS.md#1-the-solver-fills-market-dates-in-calendar-order).

<a id="bug-40"></a>
## 40. The import misreports its own counts and rows

**Severity:** Low.

1. "The first 3 rows, as they will be imported" shows the file's first three rows, including one listed as skipped a few lines above.
2. A row whose tier grid gives availability shows "Available dates: no answer" in the same sample.
3. Each skipped row names only its first problem, so an organizer who fixes it in the spreadsheet meets the next one on the next attempt.
4. "N updated" counts every matching row, changed or not ("272 updated" when 4 had changed).
5. A file whose rows have fewer fields than its header (a heading with an unquoted comma) is accepted silently and every later column shifts.
6. A tier grid is labelled "5 columns · one per option" when its columns are one per day.
7. "Your form never asked Section preference" appears on an online-form market whose form does ask it, before its column has been mapped.
8. The proposal's "answered by 360 of 359" (2024 export) counts more answers than responses.

<a id="bug-41"></a>
## 41. The proposal cuts question labels mid-sentence

**Severity:** Low (applicants see it).

**Observed:** where a Google Form heading wraps onto a second line, the proposal splits it into label and help text at the line break, even mid-sentence.
From the March 2026 export: the label "Please provide a link to your portfolio … you will be selling at UBC Makers" with help text starting "Market! (e.g. Google Drive…", and a label ending "(e.g. Workday timetable for this term, alumni" with help text "card, grad certificate, etc.)".

**Needs:** split at a sentence end, or keep the whole heading as the label when the first line is not a sentence.

<a id="bug-42"></a>
## 42. Stale or wrong copy, second batch

**Severity:** Low.

1. Dashboard for a person with no organization: "the next screen will make one with you as its owner if you have none".
   The next screen says "No organizations available. Create an organization" and keeps Create market disabled; its link leaves the dialog for `/organizations`.
   Routing to organization creation is what `new-market-org.spec.ts` intends, so the dashboard is wrong.
2. Applications page in Review or Assignment, beside the disabled import: "Reopen applications first - move back to applications closed - then import."
   From Assignment there is no way back, and "Reopen Applications" is a different move (Closed to Open) from "Return to Applications Closed".
3. Publish Market dialog: "The assignment they see is the one you have now." (untrue while bug 1 stands).
4. Organizer sign-in code: "If an account exists, an OTP has been sent" and "Invalid OTP"; every other screen says "code".
5. "What a reviewer reads first" labels every essential question "asked by every market", including Section preference, which a market can stop asking.
6. The proposal lists "Available dates" as "Not asked" on a market where the tier grid asks it, while the builder's essential panel lists it with dates.
7. The run refused for an incomplete application says "1 approved application(s) cannot be assigned…", and names the applicant with no link to their application.
8. Floorplan choice dialog: see bug 38.

<a id="bug-43"></a>
## 43. Interface polish found on the usage run

**Severity:** Low (interface).
All at 1440 by 900.

1. Import, value matching: each "Choose…" dropdown starts where its label ends, so the dropdowns do not line up.
2. Import mapping: headings are shown in full (one runs to 20 lines), while the proposal truncates the same headings to two.
3. Import mapping: a grouped grid's dropdown shows blank until chosen.
4. Proposal: for a long option, "chosen by 2 - keep?" floats to the far right, detached from its label; the "Number of dates you want" dropdown is narrower than the others.
5. Result: occupant boxes vary in width with their text; an empty table is badged "FULL TABLE"; the date filter chip shows "2026-10-10" rather than the date.
6. Review card: highlighted essential labels are grey while highlighted custom labels are black; the "Skip" key hint "S" has no box, unlike "R" and "A".
7. Reviewed list: the status badge and the opposite action are both filled pills in the same colours.
8. "Manage" is solid black on Organizations and outlined on Markets.
9. Organizations card truncates "Pier Collective Soci…" with spare room beside it.
10. Navigation menu: the Sign out row's icon and divider sit a few pixels off the rows above.
11. Reset password page: Title Case headings, a left-aligned title over a centred subtitle, and an input whose right border is clipped.
12. Vendors and Attendance flash "Loading market…" under an empty black bar.
13. Floorplan wizard: full-bleed, no rail, and a large empty grey area below every step.
14. Manage market: after "Add user", a lone "Cancel" sits above the new row; "Cannot change owner's role" appears at the foot of the dialog, far from the dropdown that caused it.
15. Delete market asks "Are you sure?" inline with "Confirm" before "Cancel" and focus left on the page, unlike every other destructive dialog, and does not say what goes with the market.

<a id="bug-44"></a>
## 44. Accessibility gaps

**Severity:** Low.

1. Plan inputs (tier, location and section names) and both Assignment Options inputs have no accessible name.
2. The organizer sign-in code input has no label and no placeholder.
3. In the form preview, a custom checkbox question's checkbox has no accessible name.
4. "More…" opens plain buttons, not a menu with menu items.
5. The login page's tabs are buttons, not a tab list.
6. The floorplan choice overlay is not a dialog to assistive technology, and blurs the page instead of using the product's dialog shell.

<a id="bug-45"></a>
## 45. The applicant form asks a Section preference the market switched off

**Severity:** High. Found fixing bug 29.

**Observed:** with "Ask this" off for Section preference, the applicant form (and the builder's preview, which renders it) still showed the ranking whenever the plan had two sections, marked it required, seeded an answer and validated it.

**Fixed:** the form asks a ranking only when the market does.

<a id="bug-46"></a>
## 46. A market can be created owned by someone else, or by nobody

**Severity:** High. Found on the usage run's data.

**Observed:** `POST /markets` took the owner from the request body and checked only that there was one, so a market could be created owned by another user or by an id that is nobody; one sat in its organization with "undefined" as its only owner, which nobody could manage.

**Fixed:** the signed-in creator is stamped as the sole owner, whatever the body names.

<a id="bug-47"></a>
## 47. Deleting a market leaves its applications and check-ins behind

**Severity:** High. Found fixing bug 9.

**Observed:** deleting a market - alone or with its organization - removed the market document and left its applications (every vendor's name, email and answers), its check-ins and its applicant sign-in codes behind for ever; deleting an organization left the placement trail too.

**Fixed:** one function deletes everything a market keeps beside itself, then the market, by either door.

<a id="bug-48"></a>
## 48. The import calls an ignored answer "required", and a blank row gets a reason per question

**Severity:** Low. Found on the re-walk (P2, P1).

**Observed:** an applicant whose every answer to a required question was a value the organizer had chosen to ignore was skipped with "'What will you be selling at the event?' is required.", and the panel said to fix the spreadsheet - where that applicant's cell was filled in.
A blank line in the 2023 export was skipped with eight reasons, one per required question, none of which was the reason.

**Fixed:** such a row says "Every answer to '<question>' is one you chose to ignore, and it is required.", the panel names Back as where that is fixed, and a blank row says "Every column this import reads is empty."

<a id="bug-49"></a>
## 49. Web addresses in answers are not links

**Severity:** Low. Found on the re-walk (P2).

**Observed:** a reviewer judges a vendor by their portfolio, and on the review card every portfolio, shop and Drive link was plain text, to be copied into a new tab by hand for each of 225 applicants.

**Fixed:** an `http` or `https` address in an answer is a link that opens in a new tab, on the review card and on the vendor's own page; nothing else ever becomes one.

<a id="bug-50"></a>
## 50. A priority rule's controls have no names, and removing one needs a mouse

**Severity:** Low. Found on the re-walk (P2); bug 44's sweep walked the rules page with no rule on it.

**Observed:** a rule's question, order and "add an answer" selects had no accessible name, and the "×" that removes a rule or an answer was an icon with a click handler, which a keyboard cannot reach.
The calendar's days were named only by their number.

**Fixed:** each control is named for its rule ("Rule 1: what it orders by"), the removes are buttons ("Remove rule 1"), and each day is named by its date.

<a id="bug-51"></a>
## 51. The check-in email field shrinks to 22 px on a phone

**Severity:** Medium: the phone is what check-in is used on. Found on the re-walk (P2).

**Observed:** at phone width the field and "Look up" stack, and the field's `flex: 1` became a zero height basis in the column, so it rendered 22 px tall under a 44 px button.

**Fixed:** the field keeps its own height, the button's 44 px touch target.

<a id="bug-52"></a>
## 52. Links sit off their line, native controls are the browser's blue, "Plan saved" touches the card's corner

**Severity:** Low. Found on the re-walk.

**Observed:** a scaffold rule padded every link by 3 px, which seven kinds of link leaned on without saying so; native radios and checkboxes were the browser's blue inside green-edged cards, with five components each setting the green for their own inputs; and "Plan saved" sat in the card's bottom-right corner, touching both edges.

**Fixed:** links carry no padding of their own, the accent colour is set once for the page, and "Plan saved" stands in the plan's gutter under its cards.

<a id="bug-53"></a>
## 53. The vendor's Full name asks for the preferred name

**Severity:** Low. Found on the re-walk (P1).

**Observed:** the applicant form described Full name as "Your name as you would like it read out", which is the question Preferred name asks just below it; the builder describes it as the name the applicant goes by officially.

**Fixed:** "Your full name, as it appears officially."

## Not bugs, but worth knowing when testing

- The slot-1 stack used for the usage run has real reCAPTCHA keys (`DISABLE_CAPTCHA` empty), so automated registration is scored as a bot (0.1 to 0.3) and refused with "CAPTCHA verification failed".
  A real person with a low score gets the same dead end, with no fallback challenge; that part may deserve a product decision.

- On a freshly built front-end container, the first visit to each lazily loaded page can render blank for a few seconds while Vite optimizes dependencies and reloads.
- Organizer registration, organizer sign-in codes, password reset and vendor sign-in codes all depend on email; with `DISABLE_EMAIL=true` none arrives, so those flows need a database seed or a real Resend key.
