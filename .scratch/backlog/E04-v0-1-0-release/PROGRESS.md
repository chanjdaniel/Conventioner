# E04 progress and acceptance audit

Running record of E04 implementation.
One section per story, in dependency order.
A story is only marked done once every acceptance criterion in its file is audited here with
evidence, not merely asserted.

Branch: `feat/e04-v0-1-0-release`, cut from `dev` at `c32ee06b` (E03's merge, PR #65).

`docs/agents/issue-tracker.md` defines done as "its PR merges to `dev`, with the PR number appended
to `pr`". The table below is what is finished in the working tree; the front-matter is what has
shipped.

## Order of work

Frontier first; a story starts only when every id in its `blocked_by` is done.

| # | Story | Blocked by | Status | PR |
| --- | --- | --- | --- | --- |
| 1 | F01/S01 Extract a CSV import page object | - | done | #66 |
| 2 | F02/S01 STARTUP.md walks a fresh clone to a running stack | - | done | #66 |
| 3 | F01/S02 Walk the whole journey in one session | F01/S01 | done | #66 |
| 4 | F02/S02 TESTING.md describes the suites that exist | F01/S02 | done | #66 |
| - | F01/S03 An essential-only form can receive an application (found in F01/S02) | - | done | #66 |
| - | F04/S01 A new organizer's dashboard does not report a missing market | - | done | #66 |
| - | F04/S02 Unsaved plan edits survive a phase advance | - | done | #66 |
| 5 | F03/S01 Promote dev to main and cut v0.1.0 | F01/S02, F02/S01, F02/S02 | done | #66, #67 |
| 6 | F03/S02 Later versions follow conventional commits | F03/S01 | done | #67 |

**PR #66 merged to `dev` on 2026-09-13** as `d4a116f8` (squash), so those seven stories and their
three features are `done` with `pr: [#66]`. `E06/F02/S01` and `E06/F03/S01` rode in the same PR and
are closed out in E06's own progress file.

**E04 is done.** `v0.1.0` was tagged and released on 2026-09-13. Two things the promotion taught,
recorded in F03/S01 because they will recur: release-please cannot open its Release PR unless the
repository allows GitHub Actions to create pull requests, and the release commit lands on `main`,
so `main` has to be merged back into `dev` or the next promotion is not a fast-forward.

Its `E06/F01/S02` blocker was **lifted** by the epic owner; the reasoning is in the story.

Both F04 stories were pulled into v0.1.0 by the epic owner, along with `E06/F02/S01`.

## Blocked outside this epic

- **`E06/F01/S02`** - the public application-form request stalls under full-suite load, papered over
  by a retry workaround in the essential-fields spec. F03/S01 requires a green suite, and a release
  whose suite is known-flaky teaches everyone to re-run rather than read failures. The story stays in
  E06; only the blocking edge lives here.

  **Status: investigated, narrowed, not solved.** Two hypotheses were tested and refused (the Flask
  dev server is threaded by default; the per-request `MongoClient` leak is real, is fixed as
  `E06/F03/S01`, and does not produce the latency - flat at 19-20ms with 400 leaked clients).
  Suspicion now sits on Vite's dev proxy, the one part of the path no reproduction attempt has gone
  through. Full detail is in that story.

  **This is the decision that gates the release**, and it is the epic owner's, not this document's:
  the stall lives in the Flask development server and the Vite dev proxy, *neither of which exists
  in a deployed build*. If it is an artifact of the test harness rather than a product defect, the
  blocking edge defends nothing a user can reach - which is the same test `AGENTS.md` applies to
  boot requirements: a requirement must defend something the branch actually serves. Three
  consecutive full-suite runs passed with the workaround in place and never firing, which is
  evidence but not proof.

## Not in this epic, deliberately

- **Bulk-approve in the application monitor.** Settled as needed, but its shape is still an open
  question in [wayfinding ticket 08](../../wayfinding/v0-1-0/issues/08-bulk-approve-shape.md), a
  prototype ticket that needs a live session. It becomes a fourth feature once that resolves.
  F01/S02 is deliberately written to a fixture small enough that per-row approval is honest.

## Audits

<!-- one section per completed story: every acceptance criterion, with the evidence that satisfies it -->

### F01/S01 Extract a CSV import page object

Branch `feat/e04-v0-1-0-release`.
Import suite green at 9 passed, against an isolated stack (unique compose project + free ports,
the isolation `scripts/nm-test.sh` uses), run twice: once on the first cut and again after the
code-review polish.
Front-end unit suite green at 89 passed, 13 files. Prettier, ESLint and `vue-tsc` all clean.

| Acceptance criterion | Verdict | Evidence |
| --- | --- | --- |
| A `CsvImportPage` wraps the wizard's steps, following the `MarketSetupPage` / `ManageMarketPage` pattern | met | `front-end/e2e/pages/CsvImportPage.ts`: `readonly page`, `Locator` fields assigned from `getByTestId` in the constructor and grouped by wizard stage, action methods below. Re-exported from `e2e/fixtures.ts` beside the other sixteen. The standards review confirmed the shape matches. |
| `csv-import.spec.ts` uses it throughout, and no longer reaches for raw selectors on the wizard | met | `grep -E "getByTestId\|page\.(locator\|getByRole\|getByText\|goto\|evaluate\|setInputFiles)\|localStorage"` over the spec returns zero hits. Only `page.screenshot` remains, which addresses no selector. |
| Every test in the import suite still passes, with its assertions unchanged | met | 9 passed, twice. Audited mechanically rather than asserted: the multiset of matchers is identical, every expected string literal survives, and every testid survives (the ten that appear "missing" are the indexed ones the page object now builds as template literals). The only deltas are four `toBeVisible()` waits that moved inside `previewAndConfirm()`, where they still run, and one extra `toBeVisible()` the grid test gained - strictly stronger. The spec-axis review reached the same conclusion independently, counting 68 expects across both versions. |
| Any `data-testid` added is purely additive - no product behaviour changes | met, vacuously | `git diff --stat HEAD~1...HEAD -- front-end/src back-end` is empty. No product file was touched and no testid was added; the page object reuses what already existed. |
| The spec is materially shorter, and what each test is *about* is readable without scrolling through wizard mechanics | met | 645 -> 487 lines. The bigger win is structural: the eight-line hand-mapping block that appeared four times is now one `FULL_MAPPING` constant, the `openImport` + `fetchMarket` pair that appeared thirteen times is one helper, and grids are addressed by header rather than by bare index. |

#### Review findings acted on

Both axes of `/code-review` ran against `b9f405e1`. Neither found a hard violation. Acted on:

- `mapColumnAt` respelled the testid `targetSelectAt` already built - now calls it.
- `open(market, userEmail)` was called with byte-identical arguments thirteen times. The repetition
  moved into one spec-local `openImport(importPage, request, marketId)`; the page object stays
  ignorant of the API and of which user is driving it.
- Grids were addressed by magic index (`mapGroupAt(3)`, `splitGroupAt(1)`). They are now named by
  the header of their first member column, and one private `columnIndex()` turns a header into a
  position.
- `statusRaw ?? status` appeared at three call sites; one `statusOf()` says which field is
  authoritative.
- Speculative surface trimmed: `chooseFile`'s unused filename override is gone, and the positional
  forms plus `valueFix` are private.

Declined, with reason: `mapColumns(headers, mapping)` could read the rendered column rows instead
of being handed the file's header row. That would couple the mapping to how the view renders a
header, in a story whose contract is that no assertion changes. The spec owns `HEADERS` as its
fixture anyway, so passing it is honest.

#### Sibling work discovered

- **`csv_exports/` is vestigial.** No Python reads or writes it - `GET /markets/<id>/assignment-csv`
  builds the CSV in memory and returns it as an attachment - yet `back-end/Dockerfile` creates it,
  `docker-entrypoint.sh` chowns it, `docker-compose.yml` mounts a named volume at it, and
  `docs/STARTUP.md` tells the reader to `mkdir` it. Found while reading STARTUP.md for F02/S01.
  The docs half is F02/S01's; removing the directory and its volume is a sibling story.

### F02/S01 STARTUP.md walks a fresh clone to a running stack

Verified by doing it, twice, from a genuinely clean `git clone` of this branch into a scratch
directory (`ls back-end/.env front-end/.env .env` returned nothing, so no local state leaked in).
The stack ran on a unique compose project with four free ports, so it could not touch the
developer's own stacks, and was torn down with `down -v` afterwards.

| Acceptance criterion | Verdict | Evidence |
| --- | --- | --- |
| Every command in the document has been run, in order, from a clean checkout | met | `docker compose up -d --build` on a clean clone with no env file: backend answered in 2s. `docker compose exec backend python create_test_user.py test@example.com testpassword` created the user. `POST /login` with those credentials returned `Login successful`. Frontend served HTTP 200. |
| The document ends with the reader logged in and looking at the product, not at a stack trace | met | Driven through the real login form with Playwright against that clean-clone stack: landed on `/dashboard` showing the signed-in user. Screenshot taken. |
| Both env-template copies are named, and the boot requirements they satisfy are explained rather than listed | met, already | Backend Setup step 5 and Frontend Setup step 3 each name their `cp .env.example .env` and explain what the hatch turns off and why. That text predates this story; it was written with the security work. What this story added is the fact that **the Docker path needs neither**, which the document did not say and which the clean-clone run proves: `docker-compose.yml` sets both hatches inline. |
| The market-key migration is part of the path, not a troubleshooting footnote | met, deliberately reshaped | On a fresh clone it is genuinely not a step: `mongo-init.js` records both markers on first database init, which the clean-clone run confirms by booting without it. Making it a mandatory step would be documenting a lie. It is now a named exception inside the Quick Start - "only for a clone you already had" - linking to the full fix, so the reader meets it before it bites rather than only after. |
| Nothing references a module, endpoint or directory that no longer exists | met | `source_data` removed from the API-module list (replaced by the real contents of `back-end/api/`). The "CSV Export Location" section, which described files written to `back-end/csv_exports/`, is replaced by how the download actually works: built in memory, returned as an attachment. `/register-user` now appears exactly once, as a warning not to use it. |
| Where a step has a known failure mode, the document says what it looks like and what to do | met | The pre-existing troubleshooting entries for the placeholder-secret refusal, the boot refusal and the two migrations are intact and accurate. Added: the migration exception in the Quick Start, and why `/register-user` produces a user who cannot log in. |

#### Corrections beyond the story's known-stale list

The list in the story was a starting point, not a scope limit. Also found and fixed:

- **Prerequisites named Python 3.8+ and Node 18+.** The image pins `python:3.11-slim` and CI runs
  Node 20.
- **Compose v1 throughout the Quick Start** (`docker-compose`, hyphenated) while the troubleshooting
  sections used v2. v1 is end-of-life; all seven invocations are now v2.
- **`sudo apt-get install mongodb`** has not been a valid package on Debian or Ubuntu for years.
- **The "Basic Workflow Test" could not produce an assignment.** It went from market setup straight
  to "Generate Assignment", never importing or approving a vendor - and the solver reads approved
  applications and nothing else, so the documented workflow ended at an empty result. Rewritten as
  the real journey, including the phase transition that makes import legal, the Applications tab
  where both import and review live, and the fact that an unreviewed application takes no part in
  assignment.
- **The project-structure tree** claimed this file lives at the repository root and omitted `docs/`,
  `scripts/`, `.scratch/`, `migrations/` and both test directories.
- **Three services documented, four defined.** mongo-express was undocumented; it is a useful way to
  read market documents by hand.
- **The Discord webhook instructions appeared twice**, in near-identical prose. One copy remains.
- **Next Steps pointed at `docs/TODO.md`**, which F02/S02 deletes. It now points at `AGENTS.md` and
  the backlog.
- **Three em dashes** replaced, per the repository's writing convention.

#### A note on formatting

`docs/` is **not** Prettier-managed: CI's `format:check` runs inside `front-end/` only. Running
Prettier over this file dedents fenced code blocks out of their numbered list items, which breaks
the nesting and leaves stray leading spaces inside the fences. Do not run it here.

#### Sibling work discovered

- **A new organizer's first screen reports a failure.** After signing in for the first time the
  dashboard shows a greyed card reading "Last market not found" under a "Previously opened"
  heading. Nothing is wrong: they have not opened one yet. Filed as `E04/F04/S01`. It is not the
  seed-data question the wayfinding map ruled out of scope - this is what the empty state *says*,
  not what fills it.

### F02/S02 TESTING.md describes the suites that exist, and TODO.md is gone

| Acceptance criterion | Verdict | Evidence |
| --- | --- | --- |
| Every suite named is described by what it covers, with no claim broader than the spec supports | met | The "full product flow" claim on the pipeline spec is gone. It is now described as covering setup through publish, explicitly beginning where the journey's fourth step ends, and explicitly not importing or reviewing anything. |
| The journey spec is documented, and the boundary between it and the pipeline and import suites is stated | met | A new "The whole journey, once" block names it as the release's acceptance test and the only spec that clicks Approve, followed by "The slices around it" giving each neighbouring suite's start and end point. |
| The seeding helpers section matches the helpers that exist, including which ones write a status directly and why a spec might not want that | met | `seedMarketWithVendors()` no longer "uploads source data via the back-end API" - it seeds approved applications, and the entry now says so *and* says what follows: a spec using it exercises no review, which is why the journey spec exists. The `column mapping` in `seedPublishedMarketWithAssignments()`'s `setup_object` description is gone, and so is the pointer to an `enum_priority_order` sizing requirement that no longer exists. |
| `docs/TODO.md` is deleted, and nothing in the repository still links to it | met | `git rm`'d. The only surviving mentions are in `.scratch/`, describing the deletion. |
| The commands the document gives for running each suite are run and work as written | met, after a correction | Back end: the documented `pip install -r requirements-dev.txt` **could not work** - that file is one line, `pytest>=8.0`, and pulls in nothing the suite imports. Corrected to install both files, which is what `nm-test.sh` does and why the gate passed where a reader following the doc would not have. Re-run as written: 790 passed. Front-end unit as written: 89 passed. E2E as written: 74 passed. |

#### Corrections beyond the story's known-stale list

- **Eight suites were undocumented**: `applicant`, `csv-import`, `date-display-timezone`,
  `essential-fields`, `intake-mode`, `phase-state-machine`, `section-preference`, `smoke`. All
  are now described, grouped by what they are about rather than by tier.
- **"526 tests"** was quoted for a suite that now has 790. The number is removed rather than
  updated: it goes stale on the next commit, and the suite either passes or it does not.
- **Two page objects were missing** from the list (`CsvImportPage`, `ApplicationMonitorPage`),
  and the note that `MarketSetupPage` covers the tabs and the phase panel, not only the wizard.
- **Two em dashes** replaced.

#### AGENTS.md corrected alongside

Out of this story's stated scope, fixed because the file is what every agent session reads and it
**contradicted itself**: the E2E seed-helper section said `assign_market` requires
`enum_priority_order` to have one entry per column in `col_names`, forty lines above the section
recording that E02 deleted both. A false sharp edge is worse than no sharp edge. Two entries added
while there: the form-is-both-halves invariant that E04/F01/S03 turned into a fix, and where a new
e2e test belongs now that one spec walks the whole journey and the rest are slices.

### F01/S02 An organizer walks create, setup, import, approve and assign in one session

`front-end/e2e/market-journey.spec.ts`. Two full-suite runs on isolated stacks: **74 passed** in
1.6m, then **74 passed** in 1.9m. The journey itself runs in 3.4s in isolation.

| Acceptance criterion | Verdict | Evidence |
| --- | --- | --- |
| The spec creates the market through the UI and never over the API | met | `/markets` -> Create -> pick the org -> name it -> submit -> redirect to the wizard, via `NewMarketPage`. The only seeding is `ensureTestOrg` in `beforeAll`; there is no market POST, no `setupObject` PUT and no `localStorage` injection anywhere in the spec. |
| The CSV fixture's columns and values match the market plan the spec just built | met | The plan is built first, deliberately, and the CSV's dates, tier and section names are the same constants the wizard was driven with. The import reaches "all mapped" with no value-resolution step, which is the assertion that they matched. |
| Applications reach `reviewer_approved` only by the organizer clicking Approve in the monitor | met | `ApplicationMonitorPage.approve()` clicks `app-monitor-approve-button` and waits for the badge to read Approved. Nothing in the spec writes a status. All three applications are asserted to be `Open` first, so the approval is doing the work rather than confirming a state they arrived in. |
| An `ApplicationMonitorPage` wraps that surface, following the existing pattern | met | `front-end/e2e/pages/ApplicationMonitorPage.ts`, re-exported from `fixtures.ts`. Cards are addressed by the applicant's email, not by index, so a reordering does not silently approve the wrong person. |
| The assignment is generated from those approvals and every approved vendor appears placed | met | Asserted per applicant through the Vendors modal: the vendor who asked for two days holds a table on both, the one who asked for one holds one, and the rejected applicant holds none. The rejected one is *present and empty* rather than absent, which distinguishes "not placed" from "not loaded" - the weaker assertion would have passed against a modal that failed to load. |
| The spec passes repeatedly under a full-suite run, not only in isolation | met | Two consecutive full-suite runs, 74 passed each, on isolated stacks with unique compose projects and free ports. |
| Any bug this uncovers is recorded as a sibling story rather than fixed inside this one, unless the fix is what makes the spec pass at all | met | Two found. The form bug **is** what makes the spec pass, so it was fixed - as `E04/F01/S03`, its own story and its own commit, not folded in silently. The assignment-options papercut is not, so it is `E04/F04/S02` and unfixed. |

#### What the spec found, which is why it exists

**It failed on its first run, and the failure was a product defect, not a test defect.** The import
preview read "0 of 3 rows will be imported", every row refused with *"This market does not have an
application form configured."*

A market whose form is only the essential questions could open applications - `FormHasFieldsGuard`
counts those questions, deliberately, since E03/F01/S01 - and then refuse every application it
received, by CSV import and by applicant submission alike, because the write path counted only the
custom fields. No slice test could see it: the import suite seeds a market that has custom fields,
and the phase suite never imports anything. Fixed under `E04/F01/S03`.

Two further things the spec established along the way, neither of them assertions:

- The assignment options are set immediately before assigning rather than on the way past, because
  the wizard discards them when the organizer leaves the tab (`E04/F04/S02`).
- `VendorsModal.vue` had **no** `data-testid` at all, so its rows could not be addressed. Three
  were added, purely additive.

#### On the known flake

`E06/F01/S02` - the public application-form stall - did not fire in either run. That is consistent
with its own diagnosis ("rarer since S01") and is **not** evidence it is fixed. Two green runs do
not clear a defect that was already intermittent at roughly one run in two before being papered
over; the story stands, and F03/S01 still blocks on it.

### F04/S01, F04/S02 and E06/F02/S01, the three defects pulled into v0.1.0

All three were found by this epic's own work rather than reported, and all three were fixed after
the epic owner decided they belonged in the release. Unit suite 89 -> 99; full e2e suite green.

| Story | Verdict | Evidence |
| --- | --- | --- |
| F04/S01 a new organizer's dashboard | met | `DashboardView.test.ts`, seven cases: never-opened invites and routes to the markets list, unreadable-stored says the market is no longer available, and the heading only appears over a card that means something. |
| F04/S02 unsaved plan edits survive a phase advance | met | `marketSetupPhaseAdvance.test.ts`. Two of its three cases fail against the old handler; see the honesty note below. |
| E06/F02/S01 remove `csv_exports` | met | Gone from the Dockerfile, entrypoint, compose, `.gitignore`, `.dockerignore` and STARTUP. Image rebuilt and the full suite run against it; `tier2.spec.ts` performs a real CSV download and reads its columns. |

#### The diagnosis in F04/S02 was wrong when filed, and the correction matters

Filed as "the wizard only persists on Back, Next and Assign". True, but not the mechanism.
`handlePhaseAdvanced` replaced the **whole local market** with the server's copy, so a phase advance
discarded *every* unsaved edit, not only the assignment options. The options were the likeliest
victim because their page has no Next. Anyone reading the original story would have fixed the wrong
thing.

#### A test that passed against the broken code

The first version of `marketSetupPhaseAdvance.test.ts` asserted on `localStorage`. The old handler
never wrote there, so the untouched original still carried the options and two of three cases passed
while the defect stood. Caught by reverting the fix and re-running, which is the only thing that
distinguishes a test that pins behaviour from one that describes it. Rewritten to assert on the
payload the next save actually sends.

## Release status

**Ready to promote. Everything up to the push is done and verified; the push itself is the epic
owner's, by their own instruction.**

`scripts/nm-test.sh` - the committed gate, run against the exact commit that would ship:

```
Backend tests: OK          (794 passed)
Frontend unit tests: OK    (99 passed)
E2E tests: OK              (74 passed)
===== All tests passed =====
```

Preconditions checked against `origin`, not a local ref:

| Check | Result |
| --- | --- |
| `origin/main` is an ancestor of `origin/dev` | yes - the promotion is a clean fast-forward |
| commits `main..dev` | 56 |
| this branch contains all of `origin/dev` | yes, 21 commits ahead |
| conventional-commit compliance of those 21 | all conform |
| what release-please reads since `main` | 27 `feat`, 17 `fix` |
| version | pinned by `release-as: 0.1.0`; manifest at `0.0.0` |

The pin is what decides the version, not the 27 feats - though they agree: 27 feats against a
`0.0.0` baseline would produce `0.1.0` anyway. Removing the pin is `F03/S02`, and it can only
happen after the tag exists.

The `E06/F01/S02` gate was lifted by the epic owner; the reasoning is recorded in `F03/S01`, and
that story stays open.
