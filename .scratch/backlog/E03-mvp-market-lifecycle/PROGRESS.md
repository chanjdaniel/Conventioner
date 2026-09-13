# E03 progress and acceptance audit

Running record of E03 implementation.
One section per story, in dependency order.
A story is only marked done once every acceptance criterion in its file is audited here with evidence, not merely asserted.

Branch: `feat/e03-mvp-market-lifecycle`, cut from `dev` at `61826853` (E02's merge).
One commit per story, one PR at the end, following E02's shape.

Shipped in #65, merged to `dev` on 2026-09-13. Every item is `status: done` with `pr: [#65]`.

## Order of work

Frontier first; a story starts only when every id in its `blocked_by` is done.

| # | Story | Blocked by | Status | PR |
| --- | --- | --- | --- | --- |
| 1 | F01/S01 FormHasFieldsGuard counts essential questions | - | done | #65 |
| 2 | F02/S01 A market declares how vendors reach it | - | done | #65 |
| 3 | F02/S02 A CSV market's applicant endpoints answer as if it did not exist | F02/S01 | done | #65 |
| 4 | F02/S03 A stranger visiting a CSV market's public pages is told nothing | F02/S02 | done | #65 |
| 5 | F02/S04 Publishing lands the organizer on a page their market serves (found in S03) | F02/S03 | done | #65 |

F01/S01 and F02/S01 are both unblocked and may run in either order.
F01 has no dependency on F02: the guard correction is a pre-existing bug that MVP merely exposes.

## Audits

<!-- one section per completed story: every acceptance criterion, with the evidence that satisfies it -->

### F01/S01 FormHasFieldsGuard counts essential questions

Branch `feat/e03-mvp-market-lifecycle`.
Back-end suite green at 732 passed, up from 724: eight new guard tests.
`phase-state-machine.spec.ts` green at 7 passed, two of them new.

| Acceptance criterion | Verdict | Evidence |
| --- | --- | --- |
| A market whose `applicationForm` has no custom fields but a non-empty essential offering advances `draft -> applications_open` | met | `test_passes_when_the_form_asks_only_essential_questions`, and the same market walked through the UI in `a market with no custom fields but a date on the plan opens applications`. Covered for a market with no form object at all, not just an empty one. |
| A market whose form asks genuinely nothing is still blocked, with a message that tells the organizer what to do | met | `test_fails_when_the_form_asks_nothing` and `test_fails_when_an_empty_form_meets_an_empty_plan`. The message names market dates, tiers and sections as the fix, and keeps the `/market-setup` resolution link. |
| The blocker message no longer implies that adding a *custom* field is the only remedy | met | `test_the_blocker_does_not_name_a_custom_field_as_the_only_remedy` asserts the message names dates; the e2e blocked case asserts the rendered panel does too. The custom field is still offered, second, as one of two remedies rather than the only one. |
| Existing behaviour for forms that do have custom fields is unchanged | met | `test_passes_when_form_has_a_custom_field` is the original test under its old assertions. The guard id stays `form_has_fields`, which `test_transition_api.py` and the registry tests pin. |
| Backend tests cover: essential-only form, custom-only form, both, and neither | met | All four, plus the three boundary cases below. |
| An e2e story walks an organizer from market creation to `applications_open` without adding a custom field | met | `seedFormlessPhaseMarket` creates a market with a date and no form at all; the organizer clicks through the real phase control panel. Its negative twin covers the empty plan. |

#### The story's open question, decided

The story left "what does a non-empty essential offering mean" to implementation.
It means `asked_essential_keys(effective_essential_options_for_market(market))` is non-empty, which is the existing single statement of which questions an offering actually asks.

The alternative was a fresh predicate over the market plan, and it would have drifted from the two readers that already apply this rule (the applicant answer validator and the solver's input translation).
`AGENTS.md` records that drift as the exact failure this contract is shaped to prevent: the solver rejecting answers the form had just accepted.

Three consequences worth naming, each pinned by a test:

- A single section is **not** a question (`asks_ranking` needs two), so a one-section market with no dates and no tiers is still blocked.
- A tier alone **is** a question, and so is a date alone.
- A frozen offering on the form wins over the live market plan, so a market whose applicants have already answered is judged on what they were asked.

#### Found and fixed along the way

`scripts/seed_fixture.sh` still POSTed to `/source-data/<market>`, which E02 deleted, so every local seed printed a 404 page mid-run and then claimed source data had been uploaded.
Removed the step and renumbered the progress lines.
Not caused by this story; fixed under the standing rule in `CLAUDE.md` about leaving lint and test rot alone.

### F02/S01 A market declares how vendors reach it

Back-end suite green at 760 passed, up from 732: 28 new tests.

| Acceptance criterion | Verdict | Evidence |
| --- | --- | --- |
| A market carries an intake mode of exactly `csv` or `form`, persisted camelCase like every other market key | met | `IntakeMode` has the two members and no third. Every write assertion in `test_market_intake_mode.py` reads `intakeMode`, the camelCase key, from what the collection was handed. |
| `POST /markets` may carry an intake mode, and a market created without one is CSV | met | `TestCreatingAMarket`, both cases, asserted against the inserted document. |
| A market PUT while the market is in `draft` may change the intake mode | met | `TestWritingItWhileTheMarketIsADraft`, in both directions. |
| A market PUT once the market has left `draft` cannot change it | met | `test_a_market_past_draft_cannot_change_its_intake_mode`, parametrized over every non-draft phase, so a new phase is covered the day it is added. Plus the legacy case: a document with no `phase` is judged by the phase it falls back to. |
| A stored document with no intake mode reads as CSV wherever the value is asked for | met | Three readers, three tests: the document reader, a parsed `Market`, and a served raw document (`TestIntakeModeOnAServedDocument`, list and detail agreeing). |
| An unrecognized stored value reads as CSV rather than raising, and is not silently rewritten | met | `test_an_unrecognized_value_reads_as_csv_rather_than_raising` and `test_reading_an_unrecognized_value_does_not_rewrite_the_document`, plus the parse and serve paths. |
| The market schema contract carries the field and `docs/schema.d.ts` is regenerated from it | met | `MarketSchemaContract.intake_mode`; `docs/schema.d.ts` regenerated by `generate_market_schema.py`, which `test_generate_market_schema.py` pins. |
| Back-end tests cover creation with and without the field, the draft-edit path, the frozen path from each non-draft phase, absence, and an unrecognized value | met | All of the above. |

No organizer UI control was added, as the story specifies.

#### Found and fixed along the way

`market_from_document` raised on a market whose stored `phase` was a value this build does not
recognize, though its own docstring promised that case went through `phase_from_market_document`.
Pydantic validates an enum field on construction, before the later `object.__setattr__` could
degrade it, so the reader never got the chance. One unreadable document would have taken down
every list that included it - the precise failure the reader exists to prevent.

The fix is what this story needed for its own field anyway: `phase` and `intake_mode` are both
withheld from the parse and supplied by their document readers. `test_an_unrecognized_phase_
degrades_instead_of_failing_the_parse` pins the phase half.

#### Decisions taken that the story left open

- **The freeze is derived from the stored phase**, not from a list of phases that count as late.
  A list would drift as the phase machine gains edges; the derivation cannot.
- **A draft payload that omits intake mode keeps what the draft stored.** `Market.intake_mode`
  defaults to `csv`, so an omitted field is otherwise indistinguishable from a deliberate `csv`,
  and the front end round-trips markets it fetched. Without this, any edit to a form market's name
  would have switched its intake off. Follows the `review_config` precedent of consulting
  `model_fields_set`.
- **The raw-document endpoints stamp the effective intake mode**, as they already stamp `isDraft`.
  Otherwise a client round-tripping a market with an unrecognized stored value would PUT back
  something the model refuses, and a draft market would answer 400 on an edit that touched
  something else entirely. `_stamp_effective_phase` is renamed `_stamp_effective_market_state`,
  since it now keeps two derived fields honest rather than one.

### F02/S02 A CSV market's applicant endpoints answer as if it did not exist

Back-end suite green at 784 passed, up from 760: 24 new tests.
Full Playwright suite green at 61 passed, including the applicant specs and the check-in URL test.

| Acceptance criterion | Verdict | Evidence |
| --- | --- | --- |
| Each of the five applicant-intake endpoints answers 404 for a published CSV market | met, with one deviation recorded below | `TestTheThreeApplicationEndpoints` asserts 404 from the public form, the application read and the application save. The two login endpoints are the deviation. |
| Each of them still serves a published form-intake market exactly as it does today | met | `test_the_public_form_is_served_for_a_form_market`, and the whole pre-existing applicant suite, which now declares `intakeMode: "form"` on its fixtures and is otherwise untouched. |
| A 404 from a gated market is indistinguishable from a 404 for an unknown slug: same status, same body | met | Four tests compare the two whole responses rather than their statuses: one per endpoint, gated against absent. |
| Both check-in endpoints serve a published CSV market unchanged | met | `TestCheckInIsNotGated`, parametrized over `csv`, `form` and absent, plus `test_published_market_by_slug_still_serves_a_csv_market`. End to end, `tier2.spec.ts` publishes a market (intake mode unset, so CSV) and verifies its check-in URL. |
| A draft market is still unreachable through the new lookup, in either intake mode | met | `test_a_draft_form_market_is_not`: both gates have to pass, and neither weakens the other. |
| The new lookup is the only place the intake requirement is expressed, and it keeps the caller-named field projection | met | `applicant_intake_market_by_slug` is the sole reader of intake mode on the public path; the five endpoints carry no check of their own. `test_the_caller_still_gets_only_the_fields_it_named` pins the projection, and `test_intake_mode_is_projected_even_when_the_caller_does_not_name_it` pins the one field it adds. |
| Back-end tests cover every gated endpoint in both modes, both check-in endpoints against a CSV market, and the draft case | met | `tests/test_applicant_intake_gate.py`, 24 tests. |

#### Deviation: the two login endpoints do not answer 404, and must not

`request-code` and `verify-code` have never answered 404 for an unknown market.
They return one uniform response whether the market, the applicant, or the code is unknown
(`200` "if an account exists..." and `401` "invalid or expired code"), precisely so nothing about
who has applied can be read off them.

Making a CSV market answer 404 there would have built the oracle those endpoints exist to avoid:
a 404 would say "this slug is a CSV market" where every other answer says nothing.
So a CSV market joins the indistinguishable set instead, which is the criterion's actual intent
and what the third criterion states outright.
`test_requesting_a_code_for_a_csv_market_answers_as_an_unknown_slug_does` and its verify twin
compare whole responses, and `test_requesting_a_code_for_a_csv_market_stores_no_challenge` proves
nothing downstream of the lookup runs.

#### Evidence the gate fails closed, from the test suite itself

Twelve existing tests failed the moment the five endpoints moved onto the new lookup: their
market fixtures named no intake mode, and absence means CSV.
Each was a market whose vendors apply through the public form, so each fixture now says so.
The same was true of `seedApplicantMarket` in the e2e helpers.
That is the fail-closed default doing its job on the only markets that existed to test it.

### F02/S03 A stranger visiting a CSV market's public pages is told nothing

Front-end unit suite green at 79 passed, up from 74: five new `MarketHomeView` tests.
`intake-mode.spec.ts` green at 12 passed, all new.

| Acceptance criterion | Verdict | Evidence |
| --- | --- | --- |
| Each of the four public applicant routes renders the not-found state for a published CSV market | met | `intake-mode.spec.ts` walks all four against a seeded CSV market. Three of them needed no code change: after F02/S02 the API answers a CSV market exactly as it answers an unknown slug, and those pages already render that answer. Only the market home had to change. |
| That state is the same one an unknown slug produces; the two are asserted to be identical rather than each asserted separately | met | Eight parametrized tests, two per route: the rendered body text, and the path the visitor ends up on after any redirect. Both are compared gated-against-absent, with the slug masked out - the one thing the two legitimately differ by, since every applicant page falls back to printing what the visitor typed when it has no market name, which it has in neither case. |
| The market home route no longer renders the slug stub for a market it cannot serve | met | `MarketHomeView` resolves its market through the public application-form endpoint, the same gated surface its siblings use, and renders "Page not found" when that does not answer. `test_never_prints_the_slug_back_before_it_knows_the_market_is_real` covers the loading state too: the old stub told every visitor their guess was real, and a page that printed the slug while loading would keep doing so. |
| The check-in route for the same market is unaffected | met | `its vendors still reach check-in` loads the check-in page for that same CSV market and finds the email input. |
| No page tells the visitor that the market exists but is not taking applications | met | `the market home never confirms that the market exists` asserts the not-found block is present and the market-name element absent. The unit suite pins the copy: it names no market, no application and no import. |
| An e2e story walks a stranger through a CSV market's applicant routes and then through its check-in route, against one seeded market | met | One `beforeAll` seed, shared by all ten CSV tests. A second describe block covers a form market, so the suite proves the gate discriminates rather than merely blocking. |

The not-found baseline was left as it stands, for both cases equally.
`ApplicationPage` still says "could not be loaded, check your connection" rather than "not found",
which is a wording question older than this story and equally wrong for an unknown slug.
Improving it for only the gated case is what the story rules out, and improving it for both is a
change to applicant-facing copy that MVP does not need.

#### Found along the way: publishing now lands the organizer on a dead end

The Done button in `GenerateAssignmentView` publishes the market and then navigates to `/<slug>`.
For an MVP market that is a CSV market, so it now renders "Page not found" - the organizer's
reward for publishing is a page telling them their own market does not exist.

This is a regression this story introduces, not a pre-existing wart, so it is not left standing.
Per the tracker convention it is a sibling story rather than growth of this one: F02/S04.

### F02/S04 Publishing lands the organizer on a page their market serves

Front-end unit suite green at 83 passed, up from 79.
Full Playwright suite green at 73 passed.

| Acceptance criterion | Verdict | Evidence |
| --- | --- | --- |
| Publishing a CSV market lands the organizer on a page that renders, not on not-found | met | `market-pipeline.spec.ts` and `tier2.spec.ts` both publish a market and wait for the check-in URL, then assert the attendance view is visible. `tier2` also asserts the not-found block is absent, so a future regression that routed back to the market home fails there. |
| Publishing a form market still lands on the market home | met | `publishedMarketDestination` returns the bare slug for `IntakeMode.Form`, unit-tested. Not covered end to end: MVP seeds no form market through the assignment wizard, and building one only to publish it would be a fixture with no product behind it. |
| The destination is decided from the market's intake mode, not guessed from the phase | met | The helper takes the intake mode as an argument and reads nothing else; `handleDone` passes `market.intakeMode` from the stored market document. |
| A market whose slug cannot be derived still falls back as it does today | met | `falls back to the organizer market page when the name yields no slug`, for a name of only punctuation and for an empty name. |
| An e2e story publishes a market and asserts the organizer can read the page they land on | met | Both publish specs above. |

#### Why check-in, and not the market home with a notice

The alternative was to let a CSV market's market home render something for its own organizer.
That would mean the page answers differently depending on who is asking, which is the property
E03/F02 exists to remove: the page cannot tell an organizer from a stranger without an
authenticated call, and an unauthenticated page that leaks "this market is real" to the right
visitor leaks it to every visitor.

Check-in needs no such distinction. It is already public, already serves CSV markets, and is the
link the organizer has to share on the day, so it is the page that was always going to be useful
at that moment.

`IntakeMode` now exists in the front-end type module as well, mirroring the back-end enum, and
`Market.intakeMode` is declared on the TypeScript interface.

## Review findings and what was done about them

`/code-review` against `dev` at the end of the epic, two axes in parallel.

### Standards

| Finding | Verdict | Action |
| --- | --- | --- |
| `intake_mode_from_market_document` read `intakeMode` with a snake_case fallback, which `AGENTS.md` forbids outright: "Do not add a read-time fallback that accepts both spellings". | Upheld. The precedent it was copied from (`phase_from_market_document`) is exempt only because documents predate the field; intake mode is new in this branch, so no document can carry the other spelling. | Fallback removed. The test that asserted the fallback now asserts its absence, with the reason. |
| Items marked `status: done` while `pr` is empty and nothing is merged. | Upheld. | Every E03 item set to `in-progress` until the PR merges. |
| `PROGRESS.md` is a fourth artifact kind in a tree the tracker defines as epic/feature/story. | Not actioned. It is what this epic was asked for, and E02 established it. The tracker's warning is about conflating *work items* with *decisions*; an audit trail is neither, and `status` cannot carry per-criterion evidence. |
| The two document readers are now the same shape (possible Duplicated Code). | Not actioned. Two instances, and their fallbacks genuinely differ: phase falls back to the `isDraft` mapping, intake mode to a constant. Extracting would need the fallback passed as a callback, which is more machinery than the duplication costs. Worth revisiting at a third reader. |
| `MarketHomeView` still renders `marketName || marketSlug`. | Not actioned. That branch is reached only when the market is found, and ticket 07 says a form market keeps the stub. Echoing the slug of a market the visitor has just been shown is not a leak. |

### Spec

| Finding | Verdict | Action |
| --- | --- | --- |
| "An unrecognized stored value is not silently rewritten" holds on read but not on write: the next PUT persists the degraded `csv`. | Upheld as an overclaim in the docstring, not as a defect. Normalizing on write is the repair - `csv` is already the only answer every reader gives that document - but the docstring promised the typo survived, which is false. | Docstring corrected to say reading degrades and writing normalizes. `test_the_next_write_normalizes_an_unrecognized_value` pins it, so the behaviour is now chosen rather than incidental. |
| **`MarketHomeView` called a market missing on any request failure**, including a timeout. `fetchPublicApplicationForm`'s own docstring warns against exactly that conflation. | Upheld, and a real defect. A form market on a flaky connection was told it did not exist. | `notFound` added beside `failed`, set only on a genuine 404. The view renders "page not found" only for that, and a retryable "could not be loaded" otherwise. Four new tests on the fetch util, two on the view. Indistinguishability is untouched: a gated market and an unknown slug both answer 404. |
| Ticket 07 says a form market's stub stays "exactly as it is"; S03 requires the page to resolve its market through the gated surface. The diff silently picks S03. | Upheld as an undisclosed spec conflict. | Recorded here. S03 is the later and more specific statement, and ticket 07's intent - that no public market landing page gets designed - is honoured: the stub's content is unchanged, only what it does before rendering it. |
| Drive-by fixes (seed script, `market_from_document` parse) are outside all five specs. | Acknowledged; both were already disclosed above. |
