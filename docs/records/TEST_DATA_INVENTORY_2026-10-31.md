---
layer: implementation
kind: record
sources:
  - T109
  - T129
  - T131
---
# Inventory of the test data, 2026-10-31

Every source of test data the repository held from 2026-10-30 to 2026-10-31, its verdict, and what was changed so that no test data names or copies anything real.
The work was three pull requests to `dev`: the synthetic corpus ([#203](https://github.com/chanjdaniel/Conventioner/pull/203), `T109`), the rest of the test data ([#215](https://github.com/chanjdaniel/Conventioner/pull/215), `T129`), and the real-data check's new rules with this record (`T131`).
How test data is made and added since is in [test data](../implementation/testing/test-data.md).
Every finding is named by file and kind only: no real value is quoted here.
"Real" means named, described or copied from a real person, vendor, market or organization.

## How it was read

- Every tracked file was run through the real-data check's line rules (an email address outside the fixture domains, a real-shaped phone number, an Atlas host): nothing was found.
- Every email local part in the back-end tests, the E2E specs and the unit tests was listed: all were at fixture domains, with invented names in them.
- The corpus files were profiled column by column, and their header rows read for contact details by kind.
- The tree was searched for the real organization's name and abbreviation, the real market's name, its venue's building and section names, and its student clubs' names.
- `git log --all` was searched for every spreadsheet ever committed, deleted ones included.

## The sources

| Source | Verdict | What changed |
| --- | --- | --- |
| `back-end/tests/test_data/google_forms/`, five CSVs | Derived from real data: made by an anonymiser from five real application exports of one market; the people were invented, but each header row was the organizer's question text verbatim, naming the organization, its market and clubs, its social handle and document links, and every answer three or more applicants shared was kept | Deleted and replaced one for one by five synthetic files written by a committed generator, named by the shape each keeps (`five-day-grid.csv`, `team-status-column.csv`, `no-timestamp.csv`, `four-day-grid.csv`, `days-as-one-question.csv`), each keeping its predecessor's rows, columns, column kinds and import outcome (#203) |
| `back-end/tests/test_data/google_forms_export.csv` | Derived from a sixth real export of the same market: its header row verbatim | Deleted; its tests read `five-day-grid.csv` (#203) |
| `back-end/tests/fixtures/synthetic_form_exports.py`, `back-end/tests/test_synthetic_form_exports.py` | New | The generator, and a test that regenerates every file and compares the bytes (#203) |
| `back-end/tests/test_data/README.md` | Described real markets: the market, the organization and each export's dates | Rewritten for the generated corpus (#203) |
| `back-end/tests/fixtures/anonymise_form_export.py` and its test | A tool for turning a real export into a fixture | Deleted (#203) |
| `back-end/tests/test_csv_proposal.py` | Its answer key quoted the real forms' questions and options | Re-pinned to the synthetic wording (#203); its label examples reworded in the fictional vocabulary (#215) |
| `back-end/tests/test_csv_proposal_plan.py`, `test_csv_start.py`, `test_csv_proposal_typesafe.py`, `test_google_forms_corpus.py`, `test_submitted_at_is_a_moment.py`, and `test_real_export_shapes.py` | Pinned the real-derived corpus: its dates, header hashes and counts; `test_csv_start.py` hand-wrote a header with the organization's abbreviation and clubs | Re-pinned to the synthetic files; `test_real_export_shapes.py` renamed `test_form_export_shapes.py`; `test_google_forms_corpus.py` holds the folder to exactly the generator's files (#203) |
| `front-end/e2e/start-from-csv.spec.ts`, `where-a-form-starts.spec.ts`, `helpers/finishStartedPlan.ts` | Read the corpus by its real seasons | Re-pointed to the synthetic files (#203) |
| `back-end/tests/test_rejection_rules.py`, `test_the_rules_reject.py`, `test_assignment_statistics_api.py`, `test_exporting_vendors.py` | Copied the real form's affiliation question and answers, and the venue's building as a location | The fictional vocabulary (#215) |
| `back-end/tests/test_the_door.py`, `test_two_outcomes.py` | The real market's section names; `test_the_door.py` also its dates, section sizes and tiers | Fictional sections (#215); fictional dates, sizes and tiers (`T131`) |
| `back-end/tests/test_the_pricing_card.py`, `test_the_stats_tab.py`, `test_dates_and_tiers_shape.py`, `test_tier_per_date.py` | A real section's name, or a question copied into a docstring | The fictional vocabulary (#215) |
| `back-end/tests/test_price_groups.py`, `front-end/e2e/price-groups.spec.ts`, `front-end/src/__tests__/elementPricing.test.ts`, `docs/business/flows/planning.md` | A real form's clubs question, word for word, naming nobody | Reworded (`T131`) |
| `back-end/rejection_rules.py`, `csv_proposal.py`, `csv_import.py`, `migrations/migrate_tier_preference_per_date.py`, `assignment/assignment.py` | Product code whose comments or docstrings quoted the real form or named the real market; an unused constant held a real club option | Comments made fictional; the constant deleted (#215) |
| `front-end/e2e/automatic-rejections.spec.ts`, `the-rules-table-lines-up.spec.ts` | Copied the real form's affiliation question and options | The fictional vocabulary (#215) |
| `front-end/e2e/the-pricing-card.spec.ts`, `the-stats-tab.spec.ts`, `phase-rail.spec.ts`, `helpers/seedTheScreens.ts` | A real section's, market's or group's name, or a copied question | The fictional vocabulary (#215) |
| `front-end/src/__tests__/automaticRejections.test.ts`, `placementChange.test.ts` | The affiliation question, and a verdict reason naming the organization | The fictional vocabulary (#215) |
| `front-end/src/__tests__/applicantOutcome.test.ts`, `resultFilters.test.ts`, `exportingVendors.test.ts`, `vendorDateCard.test.ts`, `csvProposal.test.ts`, `answerCounts.test.ts`, `marketHistory.test.ts`, `pricing.test.ts` | The organization's or a real section's name, a club option, or a copied question | The fictional vocabulary (#215) |
| `front-end/src/utils/applicantOutcome.ts`, `utils/pricing.ts`, `components/elements/ElementSectionSetup.vue`, `ElementPricing.vue`, `components/application/EssentialApplicationFields.vue`, `ChoiceConditions.vue` | Product comments naming the organization, a real section or the venue's room, or quoting the form | Comments made fictional (#215) |
| `docs/business/` nodes quoting the form or naming a real section (`planning.md`, `reading-the-markets-history.md`, `vendor-drawer.md`, `a-price-follows-the-table.md`, `tier-filters-section-prefers.md`) | Examples quoting the form, or naming the organization or a real section | Paraphrased in the fictional vocabulary (#215) |
| `.lavish/aesthetics-2026-09-20.html` | Named the real organization once | Reworded, and its images of `.lavish/aes/` dropped (#215) |
| `.lavish/aes/`, 38 committed screenshots | Not test data; the one sampled showed seed data only | Deleted on Daniel's ruling (#215) |
| `docs/implementation/testing/walking-the-flows.md` | Listed the corpus by real seasons, and pointed flow walks at the real exports in `.scratch/examples/` | Lists the synthetic files; the real-export row dropped on Daniel's ruling (#203) |
| `back-end/seed_test_markets.py`, `scripts/seed_fixture.sh`, `back-end/create_test_user.py` | Synthetic: fixture organization and market names, `example.com` accounts | None |
| `front-end/e2e/helpers/seed*.ts`, `front-end/e2e/fixtures.ts`, `front-end/e2e/fixtures/test-floorplan.png` | Synthetic: invented markets, organizations, vendors and people at fixture domains | None |
| `back-end/tests/conftest.py` and the other back-end tests; the other front-end unit tests | Synthetic | None |
| `docs/market-schema-input.example.json`, the three `.env.example` files | Synthetic: invented market names, placeholders | None |
| `back-end/tests/test_data/example_columns.csv` (arrived with #196) | Synthetic: forty invented applications, no export behind it | None |
| `docs/records/` (the bug ledger and the four usage runs) | Not test data: accounts of real usage runs that name the real market, its dates, its room plan and the real exports' file names, and quote its forms; no person's details | Kept as records; exempt from the listed-names and copied-wording rules (`T131`) |
| `README.md`, `CHANGELOG.md` | Not test data; the README says which market the product first serves | Exempt from the listed-names rule (`T131`) |

## The check that keeps it so

`scripts/real_data_check.py` gained three rules (`T131`), described in [real data never leaves the PC](../implementation/conventions/security-invariants.md#real-data-never-leaves-the-pc):

- A list of real names, `scripts/real_data_terms.txt`, held as 21 hashes: the real organization's abbreviation, its market's name, its society and clubs, its venue's rooms and sections, its social handle and the distinctive parts of its document links.
  No line or commit message outside the exempt files may hold one.
  The organization's full name was not listed, since no source in reach held it to read from.
- A whole-tree mode, `tree`, which the gate and CI's `real-data` job run after the commits; it was clean on this record's branch.
- A copied-wording rule, where the real exports are on the machine: eight words in a row, a link or a handle from a real export's questions.

## Git history

- Every committed version of the five corpus files (from 2026-09-27) and of `google_forms_export.csv` (from 2026-09-14) stays in history, with the real forms' question text, the organization's handle and document links, and the answers three or more applicants shared.
- No applicant's email, phone number or name was found in any committed version checked (the first and last versions of `google_forms_export.csv`, and the last corpus): the anonymiser had invented them.
- Commits on `dev` before #215 hold listed names in lines that phase later reworded; the deleted `.lavish/aes/` screenshots are in history too.
- Two deleted CSVs (`front-end/e2e/fixtures/test-vendors.csv`, `scripts/fixtures/vendors.csv`, removed 2026-07-15) held five invented rows each at `example.com`.
- Daniel ruled that history is not rewritten.
