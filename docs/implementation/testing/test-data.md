---
layer: implementation
kind: testing
describes:
  - back-end/tests/test_data/google_forms/
  - back-end/tests/test_data/example_columns.csv
  - back-end/tests/fixtures/synthetic_form_exports.py
  - back-end/create_test_user.py
  - back-end/seed_test_markets.py
  - scripts/seed_fixture.sh
  - front-end/e2e/fixtures.ts#TEST_USER
  - front-end/e2e/fixtures.ts#NO_ORG_USER
  - front-end/e2e/helpers/googleFormExport.ts#RESPONSES
  - front-end/e2e/helpers/seedApplication.ts#nameFromEmail
  - scripts/real_data_check.py
  - scripts/real_data_terms.txt
verified: 2026-10-31
sources:
  - T109
  - T131
---

# Test data

Every piece of Conventioner's test data is invented: no person, vendor, market, organization or venue in a fixture, seed or test is a real one, and none is derived from a real export.
The repository is public, so whatever a test holds can reach a screenshot, a log or a recording of a run, and from there a pull request.
This node says where each kind of test data lives, how it is made, the fictional vocabulary it uses, the rule for adding more, and what the real-data check enforces.

## Where test data lives

| Kind | Where | How it is made |
| --- | --- | --- |
| The Google Form corpus | [`back-end/tests/test_data/google_forms/`](../../../back-end/tests/test_data/google_forms/) | Five synthetic Google Form exports, written byte for byte by the generator [`synthetic_form_exports.py`](../../../back-end/tests/fixtures/synthetic_form_exports.py); [the corpus README](../../../back-end/tests/test_data/README.md) says the shape each keeps and how to regenerate them |
| A started market's columns | [`back-end/tests/test_data/example_columns.csv`](../../../back-end/tests/test_data/example_columns.csv) | Forty invented applications, with no export behind them |
| The back-end tests' own data | `back-end/tests/`, inline, and the fixtures of `conftest.py` | Written in each test |
| The stack's accounts | [`scripts/seed_fixture.sh`](../../../scripts/seed_fixture.sh), through [`back-end/create_test_user.py`](../../../back-end/create_test_user.py) | The E2E users at `example.com` ([E2E seeds](e2e-seeds.md)) |
| The test organization's markets | [`back-end/seed_test_markets.py`](../../../back-end/seed_test_markets.py) | Two markets of a test organization, on the database the environment names |
| The E2E accounts, markets and applications | [`front-end/e2e/fixtures.ts`](../../../front-end/e2e/fixtures.ts) and the seed helpers in `front-end/e2e/helpers/` | Written by each spec through the helpers ([E2E seeds](e2e-seeds.md)); a seeded vendor's name is made from its address ([`seedApplication.ts`](../../../front-end/e2e/helpers/seedApplication.ts)) |
| A short export for the specs that import through the UI | [`front-end/e2e/helpers/googleFormExport.ts`](../../../front-end/e2e/helpers/googleFormExport.ts) | Invented applicants at `.test` domains |
| The front-end unit tests' data | `front-end/src/__tests__/`, inline | Written in each test |

## The fictional vocabulary

A name that stands for a real kind of thing (the organization a market belongs to, a venue, a club) is built on the reserved word "Example", as the fixture domains are, so it reads as fictional on sight and cannot be a real one by accident.

| Stands for | Write |
| --- | --- |
| An organization or an affiliation | "Example College" (its students, alumni and staff), written out in full |
| A market | "Example Makers Fair" |
| A club or society | "Example College <Craft> Society" (Printmaking, Anime, Ceramics, Visual Arts), and an invented abbreviation of one where a form needs it (`ECVAS`) |
| A venue and its sections | the building "Example Hall"; the sections "North Wing" and "South Wing", and further compass-named wings |
| A person | a given and a family name from the generator's pools of common names, or an existing fixture's; never a name taken from an export |
| A business | an invented compound of a craft word and a shop word |
| An address | `example.com`, `example.org` or a `.test` domain |
| A phone number | 555-0100 to 555-0199, the range reserved for fiction |
| A handle or a link | a handle beginning `example`; a link at `example.com`, except an upload, which keeps the Google Drive host with an invented file id because the CSV proposal detects an upload by that host |

The seeds' older synthetic names stay as they are: "Main Hall", "Hall A", "Test Hall", the metal tiers ("Gold", "Silver") and the test organizations.

## Adding test data

- Use the vocabulary above, or the fixture pools that already exist; never a value read from a real export, a real market or a real person, however it is changed first.
- A real export never becomes test data in any form.
  The corpus changes only through the generator: describe the form in `synthetic_form_exports.py`, regenerate, and commit what it writes.
  `test_synthetic_form_exports.py` regenerates every file and compares the bytes, and `test_google_forms_corpus.py` holds the folder to exactly the generator's files, so a hand-edited or pasted file fails.
- After a regeneration, run `python3 scripts/real_data_check.py staged` on the machine that holds the real exports: a random draw can pair a given and a family name into a real applicant's, and only that machine can tell.
- A test that needs a real-looking value to prove a refusal composes it (`"user@" + "gmail.com"`) instead of writing it out.
- When a real name is found in the tree later, list it: run `python3 scripts/real_data_check.py add-term` and type the name at it, never on a command line or in a file, then replace it wherever `tree` finds it.

## What the check enforces

[`scripts/real_data_check.py`](../../../scripts/real_data_check.py) runs in the git hooks, the gate's `nm-test.sh` and CI's `real-data` job; [real data never leaves the PC](../conventions/security-invariants.md#real-data-never-leaves-the-pc) says each rule in full, and where each runs.

- Everywhere: an email address outside the fixture domains, a phone number written with separators outside 555-0100 to 555-0199, and a MongoDB Atlas host that is not a placeholder.
- Everywhere: a name listed in [`scripts/real_data_terms.txt`](../../../scripts/real_data_terms.txt), the real organization's, market's, venue's and groups' names, held as hashes; only the root `README.md`, `CHANGELOG.md`, `docs/records/` and the list itself may hold one.
- Where `.scratch/examples/` holds the real exports, which is the hooks' and a local run's work, never the gate's or CI's: an exact email, phone number or applicant's name from them, and, outside the same exempt files, a run of eight words, a link or a handle copied from their questions.
- A spreadsheet is read for its text, and one the check cannot read is refused outside the fixture folders.
- On a commit, a push or a range, only the added lines count; `tree` judges every file, so a name listed after its file was committed is found wherever it stands.

A refusal prints the file and line and the kind of value it found, with at most a masked hint and never the value, then the advice: the fixture domains, the fictional phone range, this vocabulary, and the generator.
