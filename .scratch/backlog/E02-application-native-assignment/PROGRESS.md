# E02 progress and acceptance audit

Running record of E02 implementation.
One section per story, in dependency order.
A story is only marked done once every acceptance criterion in its file is audited here with evidence, not merely asserted.

## Order of work

Frontier first; a story starts only when every id in its `blocked_by` is done.

| # | Story | Blocked by | Status | PR |
| --- | --- | --- | --- | --- |
| 1 | F01/S01 Build approved applications into typed solver vendors | - | done (unpushed) | |
| 2 | F01/S02 Assign a market from its Applications | F01/S01 | not started | |
| 3 | F01/S03 Honour the organizer's max assignments per vendor | F01/S02 | not started | |
| 4 | F02/S01 Build a priority rule from a form question | F01/S02 | not started | |
| 5 | F02/S02 Prioritise by when the application arrived | F02/S01 | not started | |
| 6 | F03/S01 Place vendors in their highest-ranked available section | F01/S02 | not started | |
| 7 | F04/S01 Stop the product reading source data | F02/S02, F03/S01 | not started | |
| 8 | F04/S02 Remove the source-data endpoints and collection | F04/S01 | not started | |
| 9 | F04/S03 Remove the CSV-derived fields from the setup model | F04/S02 | not started | |
| 10 | F04/S04 Remove col_name from market dates and public check-in | F04/S03 | not started | |

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
