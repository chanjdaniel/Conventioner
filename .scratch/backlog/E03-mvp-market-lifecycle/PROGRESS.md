# E03 progress and acceptance audit

Running record of E03 implementation.
One section per story, in dependency order.
A story is only marked done once every acceptance criterion in its file is audited here with evidence, not merely asserted.

Branch: `feat/e03-mvp-market-lifecycle`, cut from `dev` at `61826853` (E02's merge).
One commit per story, one PR at the end, following E02's shape.

## Order of work

Frontier first; a story starts only when every id in its `blocked_by` is done.

| # | Story | Blocked by | Status | PR |
| --- | --- | --- | --- | --- |
| 1 | F01/S01 FormHasFieldsGuard counts essential questions | - | done (unpushed) | |
| 2 | F02/S01 A market declares how vendors reach it | - | not started | |
| 3 | F02/S02 A CSV market's applicant endpoints answer as if it did not exist | F02/S01 | not started | |
| 4 | F02/S03 A stranger visiting a CSV market's public pages is told nothing | F02/S02 | not started | |

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
