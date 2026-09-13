# E02 progress and acceptance audit

Running record of E02 implementation.
One section per story, in dependency order.
A story is only marked done once every acceptance criterion in its file is audited here with evidence, not merely asserted.

## Order of work

Frontier first; a story starts only when every id in its `blocked_by` is done.

| # | Story | Blocked by | Status | PR |
| --- | --- | --- | --- | --- |
| 1 | F01/S01 Build approved applications into typed solver vendors | - | done (unpushed) | |
| 2 | F01/S02 Assign a market from its Applications | F01/S01 | done (unpushed) | |
| 3 | F01/S03 Honour the organizer's max assignments per vendor | F01/S02 | done (unpushed) | |
| 3b | F01/S04 Refuse a zero assignment cap (found in S03) | F01/S03 | done (unpushed) | |
| 4 | F02/S01 Build a priority rule from a form question | F01/S02 | done (unpushed) | |
| 5 | F02/S02 Prioritise by when the application arrived | F02/S01 | done (unpushed) | |
| 6 | F03/S01 Place vendors in their highest-ranked available section | F01/S02 | done (unpushed) | |
| 7 | F04/S01 Stop the product reading source data | F02/S02, F03/S01 | done (unpushed) | |
| 8 | F04/S02 Remove the source-data endpoints and collection | F04/S01 | done (unpushed) | |
| 9 | F04/S03 Remove the CSV-derived fields from the setup model | F04/S02 | done (unpushed) | |
| 10 | F04/S04 Remove col_name from market dates and public check-in | F04/S03 | done (unpushed) | |

Stories 3, 4 and 6 are all unblocked by F01/S02 and may run in any order relative to each other.

## Audits

<!-- one section per completed story: every acceptance criterion, with the evidence that satisfies it -->

### F01/S01 Build approved applications into typed solver vendors

Branch `feat/e02-solver-vendor-input`, commit `13d010bf`.
Full back-end suite green at 676 passed, up from 661; 39 of those are this story's, plus 5 pinning the shared rule it moved.

| Acceptance criterion | Verdict | Evidence |
| --- | --- | --- |
| A typed vendor model carries all seven essential fields, with the number of dates wanted as an integer and available dates as dates, not strings re-parsed at each use | met, with one deviation recorded below | `SolverVendor` is a frozen dataclass carrying all seven required fields plus the optional partner. `max_dates` is `Optional[int]`, asserted in `test_the_number_of_dates_wanted_is_an_integer`. |
| The optional table-share partner is representable as absent, and absent is the normal case | met | `table_share_email: Optional[str]`, `None` for blank, whitespace or missing. `TestTheOptionalPartner` covers all three, plus that naming nobody is never a missing answer. |
| A translation function turns an application into that model, and is unit-tested with no database and no market assignment | met | `solver_vendors_from_applications` takes models and an offering. Every test outside `TestOnlyApprovedApplicationsFeedTheSolver` constructs no collection and no `MarketAssignment`. |
| `ApplicationsApi` exposes a status-filtered list of applications for a market | met | `list_applications_with_status`. Covered by four tests: approved only, market scoping, empty market, waitlist exclusion. |
| An application missing a required answer is reported rather than silently yielding a blank-answered vendor | met | `IncompleteApplication` carries the applicant and every missing question at once. `TestReportingAnIncompleteApplication` covers each required question, a blank address, multiple missing answers, and that good applications in the same batch still build. |
| The existing CSV assignment path is untouched and every existing solver test still passes | met | The diff adds files and one function; it edits no solver code. 661 passed. |

#### Deviation: available dates are the plan's date strings, not parsed dates

The criterion says "as dates".
The implementation uses `frozenset[str]` holding the market plan's own spelling of each date, and the module docstring explains why.

A market date's identity in this codebase *is* the string on `MarketDateObject.date`, and the solver keys its per-date state by that same string.
Parsing here would create a second representation of one identity, which is the two-spellings problem `CLAUDE.md` already documents between camelCase and snake_case market keys, and it would buy nothing: every use is a membership test against dates that came from the same plan.

The criterion's intent, from ticket 02, was "instead of strings re-parsed at each use" - that is, not the CSV era's comma-separated blob split at every read.
A frozenset of canonical identifiers meets that intent.
Flagged rather than silently taken.

#### Decisions taken that the story left open

- **Requiredness is defined by the market's offering**, mirroring `validated_essential_answers` question for question, rather than by a fixed list of seven.
  Forced, not optional: table type is stubbed to one type in MVP, so a fixed list would reject every application in the product.
  Recorded in the module docstring as a contract the two must keep in step.
- **Only main applications feed the solver.**
  The identity index is `(market_id, applicant_email, application_type)`, so an applicant's waitlist document is a second document for the same address; counting both would place one person twice.
  Nothing creates a waitlist application today, so this is a guard, not a product decision about waitlists.
- **`SolverVendor` is frozen and holds no placement state.**
  How many dates a vendor has been given belongs to a solver run, not to the description of what the vendor asked for.
  S02 decides how the solver holds that.

#### Review round

Both axes of `/code-review` ran against the first commit. Findings and what was done:

| Axis | Finding | Action |
| --- | --- | --- |
| Standards | Requiredness rules re-derived outside `essential_fields.py`, which `CLAUDE.md` names their single owner | Fixed. `asks_ranking`, `asked_essential_keys`, `offering_for_key`, `normalized_names`, `REQUIRED_ESSENTIAL_KEYS` and `EMAIL_LABEL` now live in the owner, and `_validate_ranking` reads the shared rule rather than restating it. |
| Standards | `list_applications_with_status` duplicated `list_applications_for_market`'s body | Fixed. Both call one `_newest_first(query)`. |
| Standards | Bare `"status"` literal beside the module's named field constants | Fixed. `STATUS_FIELD`, applied to all three queries. |
| Standards | `_names`/`_text` restated `_unique_names` | Fixed. Reuses the owner's helper through `normalized_names`. |
| Standards | Untyped `frozenset` beside `Tuple[str, ...]` in the same dataclass | Fixed. `FrozenSet[str]`. |
| Standards | `application_type` parameter has one caller | Kept. A query helper accepting the collection's own identity fields is its vocabulary, not speculative abstraction. |
| Standards | Module has no production caller yet | Expected. The story is explicitly the expand half; S02 consumes it. |
| Spec | **Availability was not checked against the offering**, so a date the market does not offer matched no market date and left the vendor silently unplaceable - the same defect moved from the attribute's name to its value | Fixed, and the strongest finding of the round. Any list answer naming something the market never offered is now reported as `unrecognised`, kept separate from `missing` because the two read differently to whoever has to fix them. Six tests. |
| Spec | `table_choice` compared case-sensitively while the form stores it lower-cased; fragile for imported rows | Fixed. Lower-cased, with three tests. |
| Spec | Waitlist exclusion was an unrecorded product decision buried in a docstring | Recorded as open on the v0.1.0 map's **Not yet specified**. The conservative behaviour stays, since reading both documents would place one person twice, but it is now a question rather than a silent ruling. |
| Spec | AC "every existing solver test still passes" is vacuous | Confirmed and material - see below. |

#### Material finding for later stories: the solver has no safety net

`assign_market` is monkeypatched away in the assignment-statistics tests.
The only tests that actually run the solver are the eleven in the column-mapping module, and those exist to test column mapping, which F04 deletes.
Placement, half-table pairing, priority ordering and the max-days cap have no coverage at all.

Consequence recorded on the tickets rather than left to be rediscovered:
F01/S02 gains an acceptance criterion to build characterisation tests against the CSV path *before* the swap, and F03/S01's criterion changed from updating existing solver tests to updating the ones S02 builds.

### F01/S02 Assign a market from its Applications

Branch `feat/e02-solver-vendor-input`, commits `4b46f2e0` (safety net) and `d078117d` (the swap).
Full back-end suite green at 683 passed. Net -496 lines.

| Acceptance criterion | Verdict | Evidence |
| --- | --- | --- |
| Characterisation tests pin placement BEFORE the swap and still pass after | met | `tests/test_assignment_behaviour.py`, committed green against the CSV path in `4b46f2e0`, then passing unchanged against the application path in `d078117d`. Only the harness's adapter changed; every assertion is identical. Mutation-checked: breaking the tier filter fails two of them. |
| `assign_market()` takes a market and its approved applications, and no caller fetches source data first | met | `assign_market(market)` resolves vendors via `solver_vendors_for`. No `source_data` reference remains in `api/markets.py` or `api/attendance.py` outside the unrelated delete path. |
| All call sites are moved over, including the one behind public check-in | met | Six, not the seven previously claimed: five in `api/markets.py`, one in `api/attendance.py`. Count corrected in the epic. |
| The solver and its validator read only typed vendor attributes | met | No `col_name`, `col_name_idx`, `toAttrString` or `getattr` vendor read remains in `assignment/`. The validator was deleted outright - see below. |
| The dead column-values helper is deleted rather than ported | met | Gone with the rest of the accessor layer. |
| A vendor is placed only at a tier they accepted, and a substring no longer matches | met | `Vendor.accepts_tier` is set membership. Pinned by `test_a_vendor_is_never_placed_at_a_tier_they_did_not_accept`. |
| Flexibility counts available dates | met | `date_flexibility = len(want.available_dates)`. |
| An application missing a required answer blocks assignment with a message naming the applicants, and no partial assignment is produced | met | `IncompleteApplicationsError`, raised before any placement, surfaced as 400 at all five market endpoints. Three tests, including one asserting no partial assignment. |
| A vendor with no application is not silently skipped | met | The refusal is all-or-nothing by construction. |
| Backend tests cover assignment from applications, the tier filter, and the missing-answer precondition | met | 22 tests in `test_assignment_behaviour.py`. |
| An e2e story imports a CSV, approves, assigns, with no fabricated source data | **not met** | Deferred. The e2e seeds still fabricate source data; F04/S01 is the story that removes that fabrication, and doing it here would duplicate its work. Flagged rather than quietly dropped. |

#### Calls taken beyond the ticket

- **`assignment/validator.py` deleted, not ported.** Its only call site was commented out, so it was
  unreachable, and its entire content was CSV coupling.
  Porting dead code to keep a constant alive for F01/S03 to delete would have been waste.
  Consequence: F01/S03's criterion about the duplicated four-day constant in the validator is
  already satisfied.
- **The assignment CSV export was rebuilt.** It composed the organizer's own spreadsheet columns
  plus a date column each, which is why it needed the upload still on hand at download time.
  It now describes what the solver decided: one row per placed vendor, one column per date.
  Not named in the ticket, but unavoidable - the export took `source_data` as an argument.
- **`test_column_mapping.py` deleted.** Its subject is the column mapping this story removes, so
  it had no subject left. F04 was scheduled to delete it; it could not survive this story.
- **Priority ordering is temporarily inert.** The old scheme addressed its target by index into
  `col_names`, which no longer exists, so it cannot be ported - F02 replaces it. Every vendor now
  scores alike and the remaining sort keys decide. Smaller than it sounds: the solver already
  ignored `data_type` and `sorting_order`, so any rule configured as anything but an enumerated
  ordering already scored every vendor identically. **This is the one behaviour regression in the
  epic's middle, and F02 immediately closes it.**

#### Defect found and pinned, not fixed

`assign` breaks out of the table loop the moment one table cannot be filled, but validity is
answered per *table*: a vendor who accepts only one tier is not valid for a table of another.
An unfillable table early in the list therefore ends that date, leaving every later table empty
however many vendors could have taken one - a market with two tiers strands everyone whose tier
sorts second.

Pre-existing, not introduced here.
Fixing it would have moved placement and destroyed the equivalence proof this story rests on, so
it is pinned by `TestKnownDefectTheTableLoopStopsEarly` and handed to F03/S01, which inverts that
loop anyway. That story gained an acceptance criterion to fix it and invert the test.

### F01/S03 Honour the organizer's max assignments per vendor

Branch `feat/e02-solver-vendor-input`. Full back-end suite green at 689 passed.

| Acceptance criterion | Verdict | Evidence |
| --- | --- | --- |
| The solver reads the market's max-assignments-per-vendor setting | met | `MarketAssignment.market_max_assignments`, consumed by `max_assignments_for`. |
| The hard-coded four-day constant is gone from the solver and the validator, with no duplicate | met | `MAX_VENDING_DAYS` survives only as a word in a docstring explaining what it used to do. The validator's copy went with the module itself in S02. |
| A vendor is capped by the lower of the market setting and their own stated number of dates | met | `max_assignments_for` takes the min of whichever are set. `test_the_lower_of_the_two_wins_whichever_it_is` covers both directions in one market. |
| A vendor who asked for more days than the market allows is capped at the market setting | met | `test_the_market_cap_bounds_a_vendor_who_asked_for_more`. |
| A market with the setting unset has a defined, documented behaviour | met | Unset means no ceiling, documented on `market_max_assignments` with the reasoning: a market whose organizer named no limit is bounded by what each vendor asked for and how many dates they can attend, both real answers, rather than by a number nobody chose. |
| A vendor wanting twelve dates is not capped at one | met | `test_a_vendor_wanting_twelve_dates_is_not_capped_at_one`, over a six-date market. |
| The setup UI's clamp still agrees with what the solver enforces | met | The screen clamps to the market's date count and stores null when cleared; the solver reads null as no ceiling. A cap above the date count is not reachable, so the two cannot disagree. |

The proof that the setting was previously ignored is in the test run: five of the six tests
failed before the wiring, including one asserting six dates and getting four.

#### Found, not fixed here

The setup screen accepts a cap of **zero** and stores it, and the solver honours it literally,
so the market assigns nobody.
Filed as E02/F01/S04 rather than folded in, following the repo's rule that work discovered
mid-story becomes a sibling story.
Low severity: the failure is visible rather than silent, since every vendor reports as
unassigned.

### F02/S01 Build a priority rule from a form question

| Acceptance criterion | Verdict | Evidence |
| --- | --- | --- |
| A rule names a form field key and carries its own ordering | met | `PriorityObject(id, target, ordering)`. |
| The ordering's shape is derived from the target's type, not declared | met | The screen picks the control from the target's type; there is no type to choose. |
| Data type, sorting order and column index are gone from the rule | met | Gone from the model, the contract, the TypeScript type and the screen. `DataType` is deleted entirely. |
| The per-column array of enum orderings is gone from the setup model | met | `enum_priority_order` removed from `SetupObject` and its contract, and from every fixture and e2e seed. |
| The solver orders vendors by the configured rules, in rule order | met | `_calculate_priority_score` returns one score per rule; compared as a tuple, so an earlier rule always outranks a later one. Two tests cover "the first rule decides" and "a tie is broken by the second". |
| An unplaced answer falls at `<All others>`, or last when absent | met | Two tests. |
| The target picker lists the market's own questions; the data-type dropdown is gone | met | Component tests assert both, including that a free-text question is not offered because it has no arrangement to make. |
| Contains and Does not contain are no longer offered | met | Deleted with `DataType`; a component test asserts the text is absent. |
| A configured rule demonstrably changes the order, provably so under the old behaviour | met | `test_reversing_the_ordering_reverses_who_is_placed` changes only the ordering between two otherwise identical runs. Under the old scheme both runs scored every vendor identically. |
| Frontend and backend tests cover rule creation, reordering, and scoring | met | 8 solver tests, 12 component tests. |
| `docs/schema.d.ts` regenerated, not hand-edited | met | Regenerated via `generate_market_schema.py`; its pinning test passes. |

### F02/S02 Prioritise by when the application arrived

| Acceptance criterion | Verdict | Evidence |
| --- | --- | --- |
| Submission time is selectable and orders earliest-first | met | `application.submitted_at`; `test_the_earlier_application_takes_the_only_table`. |
| Application type is selectable as a target | met | `application.application_type`. |
| Built-ins appear as their own group, separate from the organizer's questions | met | `optgroup` per group; a component test asserts the two labels in order. |
| Number, date and yes/no orderings work, direction derived from the target's type | met | Six solver tests plus component tests asserting the direction is worded for the target ("Lowest first" for a number, "Earliest first" for a date). |
| A market can combine a form-question rule and a built-in rule, applied in rule order | met | `test_an_arranged_rule_and_a_magnitude_rule_combine_in_order`. |
| An imported application carries its real submission time, proven by a test | met | Two tests in `test_csv_import.py`: the row's own Timestamp reaches `submitted_at`, and two rows keep distinct, correctly ordered times. |
| Frontend and backend tests cover each ordering shape | met | 710 back-end, 69 front-end, all green. |

#### Calls taken

- **An absent answer sorts last, never first.** An application with no usable value for a
  magnitude rule scores as infinitely far back rather than as zero.
  An absent answer is not evidence of anything, and letting it win by default would be the same
  silent-advantage failure this epic keeps removing.
- **Numbers are parsed before the true/false words**, so a numeric answer of zero is zero rather
  than a word that looks false. `"1"` and `"0"` were removed from the boolean vocabulary for the
  same reason.
- **A multi-select answer sorts by the applicant's first choice**, which is the only ordering
  information such an answer carries.
- **Renamed `SUBMITTED_AT_TARGET` to `SUBMITTED_AT_RULE_TARGET`** in `datatypes`, because
  `csv_import` already had that exact name meaning the import-mapping target.

### F03/S01 Place vendors in their highest-ranked available section

| Acceptance criterion | Verdict | Evidence |
| --- | --- | --- |
| A vendor with a clear preference and several valid options gets their highest-ranked section | met | `best_table_for`. Two tests differing only in the ranking place the vendor in opposite sections. |
| A vendor whose top section is full still gets their next-best | met | `test_a_vendor_whose_top_section_is_full_still_gets_their_next_best`. |
| No vendor is left unassigned as a result of preference | met | Four contending vendors, all placed. |
| No vendor loses a placement to satisfy another's preference | met | Covered by the capacity characterisation tests, which are unchanged. |
| Preference never overrides tier | met | `test_preference_never_overrides_tier`. |
| Preference never overrides priority order | met | `test_preference_never_overrides_priority_order`. |
| The early-break defect is fixed and its pinning test inverted | met | `TestNoVendorIsStrandedBehindATableTheyCouldNotTake`, inverted from the pin F01/S02 left. |
| Characterisation tests updated with their changes explained, not silently re-baselined | met | **None needed.** Every characterisation test written before the swap passes unchanged through the inverted loop, which is a stronger result than the criterion asked for. |
| Backend tests cover a satisfied preference, a contended one, and a full top choice | met | `TestSectionPreference`, seven tests. |
| An e2e story asserts a vendor lands in their preferred section | met | `front-end/e2e/section-preference.spec.ts`. Two sections at the same tier, so tier rules nothing out and only preference can decide. |

### F04 Remove the CSV substrate

| Story | Verdict | Notes |
| --- | --- | --- |
| S01 Stop the product reading source data | met | Column-selection step, the four column pickers and the per-date column dropdown deleted. Vendor list and modal read applications and the form that produced them. No front-end call to a source-data endpoint. E2E seeds seed approved applications via `seedApprovedVendor`. |
| S02 Remove the endpoints and collection | met | Six API functions, their routes, the module, DB init and reset, and the market-delete cleanup. **The owed verification was done** - see below. |
| S03 Remove the CSV fields from the setup model | met | `SetupObject` and `AssignmentOptionObject` cleaned; `schema.d.ts` regenerated; a test pins that a legacy document still loads. |
| S04 Remove `col_name` from market dates and public check-in | met | The field and all three date-alias maps. Verified through the real check-in path by `market-pipeline.spec.ts`, which publishes and then checks a vendor in over the public URL. `AGENTS.md` updated. |

#### The verification F04/S02 owed

Ticket 03 concluded there was nothing to migrate but asked that it be confirmed against a real
database rather than assumed, for priority configurations and source data together.

Checked across every running stack (six Mongo containers: the primary dev stack, two named
worktrees, three flakehunt worktrees). Findings:

- Every market carrying a priority rule is named `E2E Published <timestamp>`.
- Every priority rule is byte-for-byte the shape the e2e seed wrote
  (`{id: 0, colNameIdx: 4, dataType: 'String', sortingOrder: 'ascending'}`).
- Every `source_data` document is the seeds' own `vendors.csv` or `test-vendors.csv`.
- Filtering market names against the test-fixture prefixes leaves an empty set on every stack.

No organizer data exists anywhere. Ticket 03's conclusion holds, now on evidence.

## Outcome

E02 is complete. Full suite green: **721 back-end, 69 front-end unit, 59 Playwright e2e**
(`scripts/nm-test.sh`, exit 0).

`source_data`, `col_names`, `col_values`, `col_include`, `enum_priority_order`, every
`*_col_name_idx`, `MarketDateObject.col_name`, `MAX_VENDING_DAYS` and the `DataType` enum are
gone from the repository, along with the `/source-data` endpoints and the collection behind them.

### What E2E caught that unit tests did not

Worth recording, because it is the argument for the e2e criteria being on these tickets at all.

1. **A design mistake in the S01 offering check.** Refusing the whole run over an answer naming
   something the market no longer offers looked right in isolation and is wrong in practice: the
   ordinary cause is an organizer dropping a tier after applications arrive. Corrected to drop
   the value and let the vendor be unplaceable, which is what the existing unassigned-vendors
   reporting is for.
2. **Assignment failures were invisible.** `handleAssign` let the error escape unhandled, so a
   refused run left the page sitting there with no message. The precondition F01/S02 added had
   no way to reach the organizer it was written for.
3. **Assignment output depended on database return order.** Once priority and flexibility had
   nothing left to say, order fell through to whatever Mongo returned - newest-first, as it
   happens, because the query was written for a review list.
4. **Two specs were incidentally testing the tier pre-fill**, which scraped tier names out of the
   uploaded spreadsheet. Removing the spreadsheet removed the pre-fill and left them asserting on
   rows that no longer had a reason to exist.

### The one story found mid-epic

- **E02/F01/S04** - the setup screen accepted a max-assignments cap of zero and the solver
  honoured it literally, so the market assigned nobody. Filed as a sibling story when found in
  S03, then done, because a feature is only `done` when every child story is and parking it would
  have left E02 complete with an asterisk. Anything below one now leaves the setting unset, which
  the solver reads as "no ceiling". Five component tests.
