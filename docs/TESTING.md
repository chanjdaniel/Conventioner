---
layer: implementation
kind: testing
describes:
  - front-end/playwright.config.ts
  - scripts/seed_fixture.sh
  - scripts/nm-test.sh
verified: 2026-11-14
sources:
  - E34/F03/S02
  - E35/F02/S01
  - T47
  - T74
  - E41/F01/S01
  - T200
  - T205
  - T263
  - T284
  - T317
---

# Testing Conventioner

How to run each suite, and what each covers.
The testing nodes of the [knowledge graph](implementation/testing/README.md) hold the sharp edges of each; the [Google Form corpus](../back-end/tests/test_data/README.md) is the suite's realistic data.
The sharp edges are in the testing nodes: [E2E patterns](implementation/testing/e2e-patterns.md), [E2E seeds](implementation/testing/e2e-seeds.md), [the market journey spec](implementation/testing/the-market-journey-spec.md), [the layout's E2E](implementation/testing/floorplan-e2e.md), [CI and the gate](implementation/testing/ci-and-the-gate.md), [the assignment behaviour suite](implementation/testing/assignment-behaviour-suite.md) and [the real-MongoDB suite](implementation/testing/real-mongo-suite.md).
The stack is seeded by [`scripts/seed_fixture.sh`](../scripts/seed_fixture.sh), Playwright is configured in [`front-end/playwright.config.ts`](../front-end/playwright.config.ts), and [`scripts/nm-test.sh`](../scripts/nm-test.sh) runs every suite on a stack of its own; the no-mistakes gate runs only its real-data checks (`--real-data-only`).
Before a merge, the suites run only in CI's required jobs: Playwright on the laptop was most of every gate run and the heaviest load the machine saw, and CI ran every suite again anyway ([CI and the gate](implementation/testing/ci-and-the-gate.md#the-no-mistakes-gate)).

## Quick Start: Seed Fixture

The fastest way to get a working test environment:

```bash
./scripts/seed_fixture.sh            # in a treehouse worktree: the slot's stack
./scripts/seed_fixture.sh --primary  # the primary checkout's stack
```

The script empties the stack's database first (`back-end/reset_database.py`), so it seeds only a stack it is told, and otherwise refuses before it touches anything.
It takes, in order, `COMPOSE_PROJECT_NAME` with `TH_MONGO_PORT`, `TH_BACKEND_PORT` and `TH_FRONTEND_PORT` (as `eval "$(scripts/th-compose.sh ports)"` exports them), then the treehouse slot its checkout sits in, and the default stack (the primary checkout's, or CI's one stack) only with `--primary`.
It refuses when only some of those variables are set, and `--primary` with any of them set or from a treehouse slot, where plain `docker compose` names the project after the directory, the primary checkout's.
It used to fall back to the primary stack's defaults, so a run outside a slot that had not yet exported its own stack wiped the primary checkout's local database.

It seeds a stack that already runs and never starts one: start the stack first, as the [E2E section](#end-to-end-e2e-tests) shows.
With the stack's back end not running, or not answering within 60 seconds, it exits non-zero before it resets anything.
It used to bring a stopped stack up itself, so a seed after a refused or forgotten start left a stack outside whatever owned the slot's stacks.

On a running stack it empties the database, creates the test users, creates an organization
(`Seed Test Org`, reused if the user already has one), and creates a market in it.
The output prints the credentials and market ID.

Two verified users are created: the main test user, and a second user that
deliberately belongs to no organization (`e2e-noorg@example.com`) so the e2e suite can
exercise the zero-organization state of the market-creation org picker.

Override credentials:

```bash
TEST_EMAIL=myuser@example.com TEST_PASSWORD=mypass \
  NO_ORG_EMAIL=mynoorguser@example.com NO_ORG_PASSWORD=mynoorgpass \
  ./scripts/seed_fixture.sh --primary  # omit --primary in a treehouse worktree
```

## Back-End Tests

```bash
cd back-end
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest tests/ -v
```

Install **both** files. `requirements-dev.txt` is only `pytest`, uv (for the lock check) and what they need; it does not pull in the runtime
dependencies, and the suite imports the application. `scripts/nm-test.sh` installs both, which is
why it passes where a hand-run `pip install -r requirements-dev.txt` does not.
The suite also uploads a real PDF floorplan, with an empty `PATH`, so it proves the Python requirements alone draw a PDF, as they must on production's Vercel function, which installs no system package.

The suite covers the assignment algorithm, statistics, attendance,
CSV import column mapping, schema generation, role validation, CAPTCHA verification/bypass, the
Conventioner data model (market phases, `is_draft` computed strictly from `phase`, application
form/status models, and backward compatibility with existing market documents), the `phase`
backfill migration, the `applications` collection migration, the server-owned market fields
preserved across updates, the application form endpoints (`test_application_form.py`:
permission checks, field/key/option validation, `order` renormalization, server-owned
`published_at`/`essential_options`, and the D9 lock refusing edits on every write path once an
application exists or the market leaves `draft`), and the essential form fields
(`test_essential_fields.py`: offering derivation, answer validation, freeze-on-first-answer,
server-owned options stripped from client payloads, and the `essential_` prefix guard).
`test_application_write.py` covers the one write path both intake routes share - including that a
form of only the essential questions is still a form, so such a market can actually receive the
applications its phase lets it open.
`test_assignment_behaviour.py` is the solver's behavioural suite; change placement against it
rather than beside it.
`test_synthetic_form_exports.py` holds every file of the Google Form corpus to the bytes
`tests/fixtures/synthetic_form_exports.py` makes, so a pasted or hand-edited fixture fails.
`test_csv_proposal.py` holds the rules that read a Google Form's responses into a proposal to the
answer key they were measured against on those five exports, `test_csv_proposal_plan.py` does the
same for what the file says about the plan, and `test_csv_proposal_api.py` pins that asking for one
writes nothing.
`test_google_forms_corpus.py` pins the five synthetic exports in `tests/test_data/google_forms/`:
each one's row count, header row and table-size answer counts.

A test count is deliberately not quoted here: it goes stale on the next commit, and the suite
either passes or it does not.

`test_attendance_api.py` additionally pins the public slug lookup (queried via the
stored `slug` field for an indexed, O(1) lookup rather than a collection scan), which
decides whether the market's vendor page is live: it serves a market past `draft`
and refuses a draft, on both a document that stores a `phase` and one written before the
field existed (where the phase is derived from `isDraft`).

The market phase lifecycle adds seven suites:

- `test_guards.py` - the guard registry (`back-end/guards.py`) in isolation: which edges
  are valid, the `form_has_fields` guard passing and failing, and the import-time
  self-check that rejects a registry whose tables disagree (a guard on an unreachable
  edge, an entry invariant an inbound edge fails to carry).
- `test_transition_api.py` - `POST /markets/<id>/transition` through the Flask test
  client, so the wire contract is covered and not just the registry: the status codes,
  the ADMIN permission gate, the camelCase blocker payload the front-end binds to, and
  the `409` when the phase changes underneath a request in flight.
- `test_market_document_keys.py` - reads of raw market documents name the canonical
  camelCase key and the slug index and markers the app boots on are seeded or verified;
  the public slug lookup is one indexed query rather than a collection scan.
- `test_market_slug.py` - pins that `Market.slug` is derived from the name (never
  writable from a request body), every write persists it, and the public slug lookup (`market_by_slug`)
  is one indexed query with a projection the caller controls.
- `test_market_phase_consistency.py` - a market reports the same phase whichever endpoint
  served it (the list endpoint used to hand back raw documents while the detail endpoint
  derived the phase, so the two could disagree about pre-migration markets).
- `test_migrate_market_keys.py` - the migration leaves every market in canonical form
  (camelCase keys, no legacy snake_case spelling, and a stored slug); camelCase wins
  where a document carries both, the slug is backfilled from the name and repaired
  when it disagrees, the index is built, and it is idempotent.
- `test_migrate_is_draft_consistency.py` - the `isDraft`/`phase` reconciliation migration:
  a market the old build published (`phase: "draft"` + `isDraft: false`) has its _phase_
  advanced to `archived` rather than being confirmed as a draft, a stale `isDraft` on an
  already-advanced market is recomputed from the phase instead, a document with no `phase`
  is left untouched (it is `migrate_phase.py`'s to backfill, and flipping `isDraft` would
  silently archive every legacy draft), the writes are condition-checked so a concurrent
  transition cannot have a stale value written over it, and it is idempotent.

The boot-time defenses add seven suites: one per thing the app refuses to start without
(`test_secret_key.py`, `test_cors.py`, `test_captcha.py`, `test_email.py`,
`test_session_storage.py`, `test_proxy.py`), and `test_public_endpoint_defenses.py`, which
pins the refusal itself: what it names, that `ALLOW_INSECURE_LOCAL_DEV` is the only thing
that waives it, and that `back-end/.env.example` still boots as it stands. Two more cover the
machinery underneath: `test_configured_secret.py` (a blank or published placeholder is not a
configured secret) and `test_env_file.py` (the `.env` loader, and that the real environment
wins over the file).

Requirements: `pytest` (listed in `requirements-dev.txt`), and no database connection, since the tests use in-memory fakes, except for the real-MongoDB suite below.
Most shared fakes in `back-end/tests/conftest.py` read a filter with `mongo_matches` (the applications, markets and organizations fakes, the sign-in attempts fake's conditional `$inc` and the GridFS fake's `find`), and so do many fakes of a single test file; it answers as MongoDB does for every case in `back-end/tests/mongo_cases.py` and raises `UnmodelledQuery` on an operator it does not model, so a test of a filter it cannot read fails instead of passing.
`test_the_shared_matcher.py` checks it against that table on every run, and the real-MongoDB suite checks the table against the server.
`FakeApplicationsCollection`, which stands in for applications and every record beside a market, writes with `mongo_update`, sorts and limits, and projects with `mongo_project` as the server does, and answers the server's matched and modified counts; it refuses an update operator, sort or projection it does not model the same way, and `test_the_shared_applications_fake.py` checks it against the same module's update, read and projection tables.
`FakeMarketsCollection` and `FakeSlugMarketsCollection`, the markets fakes, apply an `update_one`'s or a `find_one_and_update`'s filter with `mongo_matches` and its update with `mongo_update`, `update_one` answering the server's matched and modified counts and `find_one_and_update` the market before or after the write as the driver does, or none when nothing matched, so a market write that holds what it read matches nothing over a market that no longer holds it; `test_the_shared_markets_fakes.py` checks them against the update table.
So a read that fetches too little, or a write the server would apply otherwise, fails here rather than in production.
Shared module stubs live in `back-end/tests/conftest.py`, which also points the `.env` loader at a path that does not exist.
The suite reads no `.env`, so a stale one on your machine cannot change its result.

### The real-MongoDB suite

`back-end/tests/real_mongo/` runs against a real MongoDB server, named by `REAL_MONGODB_URI`, each test on a database of its own that it drops.
Unset, every test there skips, so an `nm-test.sh` run stays hermetic; CI's `backend` job runs it on a `mongo:7` service, the local stack's version ([why not production's 8.0](implementation/testing/real-mongo-suite.md#the-mongodb-version)), and sets `REAL_MONGODB_REQUIRED=true` so it can never skip.
It refuses a `mongodb+srv://` URI, a host that is not loopback and the primary checkout's port 27017.
Run it with `scripts/real-mongo-test.sh`, which starts a MongoDB of its own for the run and removes it however the run ends:

```bash
scripts/real-mongo-test.sh                                                  # the whole package
scripts/real-mongo-test.sh tests/real_mongo/test_the_applicant_side_races.py -q  # pytest's arguments, from back-end/
```

Its server is made and removed as [the real-MongoDB suite](implementation/testing/real-mongo-suite.md) describes; its Python is `PYTHON_CMD` (default `python3`), with both requirements files installed.
Never start a MongoDB for the suite by hand with `docker run`: removing such a container leaves the image's two anonymous volumes, about 0.3 GB a run, with nothing saying whose they are.
Against a worktree stack's MongoDB instead, its port from `scripts/th-compose.sh ports`:

```bash
cd back-end
REAL_MONGODB_URI="mongodb://admin:secret@127.0.0.1:<port>/?authSource=admin" python -m pytest tests/real_mongo
```

[The real-MongoDB suite](implementation/testing/real-mongo-suite.md) says how each test's database is made and bound, and what its fixtures give.

## Front-End Unit Tests

```bash
cd front-end
npm run test:unit
```

Tests cover the API client (it sends credentials, attaches no request interceptor and adds no
request transformer but the size refusal, so no identity can be smuggled onto a request) and
`parseMarketFromApi()` (`market.test.ts`), which keeps everything the server sends about a
market - the phase, the application form, the intake mode, the form lock and every key of the
plan, `floorplans` included - since every screen reads the parsed market and the plan's autosave
writes a working copy built from it. The same suite covers `openMarket()` and `marketPath()`: every
phase opens the market's own screens, addressed by id. `marketStore.test.ts` covers the one holder of
the open market (keyed by id, re-read after writes, never shows another market's copy), and
`noMarketInTheBrowser.test.ts` fails if any source file stores the market in `localStorage` again.
The application form builder is covered by three suites:
`applicationForm.test.ts` (the shared validator: which forms Save blocks with a hint - a
field the organizer has not started filling in - versus a validation error such as a bad,
blank, or duplicate key or option), `formBuilder.test.ts` (the `FormBuilder` component:
auto-deriving a field key from the label until the organizer hand-edits the key,
renumbering `order` contiguously as fields are added and removed, and hiding every editing
affordance when read-only), and `marketSetupForm.test.ts` (the `MarketSetupView` wiring:
the builder stays read-only until the server reports the lock state, never offers to edit
a locked form even for a frame, and keeps auto-derived keys auto-derived across a save).
`BlockerPanel.test.ts` covers the panel that renders a blocked phase transition: it lists
every blocker the server returned, links to the guard's `resolutionLink` when there is one
and the person may take its `resolutionAction`, and renders nothing when there are no
blockers - all without a line of guard-specific logic, which is the point of the guard
registry ([`back-end/guards.py`](../back-end/guards.py)).
Add more component tests in `front-end/src/__tests__/`.

Configuration: `front-end/vitest.config.ts` with `happy-dom` environment.

## Bundle Budget

```bash
cd front-end
VITE_ALLOW_INSECURE_LOCAL_DEV=true npm run build-only
npm run bundle-budget
```

It prints the gzipped size of each chunk a first visit loads before any page paints, and fails when their total passes the limit in `front-end/scripts/bundle-budget.ts`.
CI and `scripts/nm-test.sh` run it; what it measures, and how to raise the limit on purpose, is [the bundle budget](implementation/testing/ci-and-the-gate.md#the-bundle-budget).
On the same build they run `npm run no-eval`: no built file calls `eval` or `Function`.
The build itself fails if any module of the development-only [component library](implementation/modules/component-library.md) is in it ([CI and the gate](implementation/testing/ci-and-the-gate.md#no-development-page-in-the-build)).

## End-to-End (E2E) Tests

```bash
# Start the Docker stack, then seed test data: the seed never starts a stack
cd ..
DISABLE_EMAIL=true DISCORD_FAKE=true docker compose up -d  # scripts/th-compose.sh up -d in a treehouse worktree
./scripts/seed_fixture.sh --primary  # omit --primary in a treehouse worktree

# Run E2E tests
cd front-end
npm run test:e2e
```

E2E tests use Playwright driving Chromium against the running Docker stack.

A second stack beside your worktree's, say for a run that must not touch the slot's database, gets
its own project name and lets Docker pick its ports (`TH_PORTS=auto`):

```bash
export COMPOSE_PROJECT_NAME=my-e2e TH_PORTS=auto
scripts/th-compose.sh up -d            # prints the ports Docker picked
eval "$(scripts/th-compose.sh ports)"  # exports them for seed_fixture.sh and Playwright
./scripts/seed_fixture.sh
(cd front-end && npm run test:e2e)
scripts/th-compose.sh down -v
```

`scripts/nm-test.sh` runs its stack this way; [CI and the gate](implementation/testing/ci-and-the-gate.md#stack-identity)
has the details.

**Which spec to extend**: `market-journey.spec.ts` is the only spec that walks the whole journey
in one organizer session, and every other spec is a slice of it; [the market journey
spec](implementation/testing/the-market-journey-spec.md) says what each slice covers and where a
new test belongs. `phase-state-machine.spec.ts` walks every phase edge and the guards that refuse
them, and `smoke.spec.ts` covers login, the landing on Markets, and markets navigation.
Which specs walk a user flow is the "Covered by" list under each of its steps, and the gaps worth
a spec are the coverage map in [walking the flows](implementation/testing/walking-the-flows.md#coverage-map).
Coverage also includes tier-1 market operations journeys: public vendor check-in
(`checkin.spec.ts`), vendor browsing with search (`vendors.spec.ts`), and table
browsing with filtering (`tables.spec.ts`). The tier-2 suite (`tier2.spec.ts`)
covers organization CRUD (create, add admin/member, remove member, rename,
delete), market role management (add user with role, change role, remove user),
assignment CSV export (download and verify columns), and publishing a market
(verify the market's vendor page, where its vendors check in, is reachable). Tier-3 authentication and robustness
journeys (`auth.spec.ts`) cover new-user registration, the full password reset
flow (including reading the real reset token from MongoDB), posting an assignment
and login/OTP error states. The organization-required suite
(`new-market-org.spec.ts`) covers the rule that every market must be created in an
organization: it asserts that `POST /markets` rejects a payload with no
`organizationId` (400) and succeeds with a valid one, that the persisted market
carries the submitted `organizationId`, that a user with no organizations cannot
create a market via API, and that the new-market overlay's submission stays
disabled until an organization is picked (with a link to `/organizations` when
none exist). The applicant-facing suites cover a market whose vendors apply on its own page:
`applicant.spec.ts` (the public applicant login's anti-oracle behaviour: identical answers for
known and unknown emails, an identical 401 whatever the failure, and single-use codes),
`essential-fields.spec.ts` (the essential questions as an applicant answers them), and
`intake-mode.spec.ts` (a CSV market's applicant endpoints answering exactly as a market that does
not exist - the gated and absent renders are asserted to be identical, rather than each alone).
`section-preference.spec.ts` covers a vendor being placed in the section they ranked first, and
`date-display-timezone.spec.ts` pins a market date rendering as the same calendar day in
Honolulu, Los Angeles and Tokyo.
The application-form suite (`application-form.spec.ts`) drives the
market-setup Application Form tab: an organizer builds a form (keys auto-slugged from the
labels) on a market created through the API path, watches the live preview, saves it, and
reloads to confirm it persisted; a second test seeds an application straight into Mongo
and asserts the D9 lock then renders the builder read-only with its lock banner, that
`PUT /markets/{id}/application-form` refuses with 409, and that no whole-market PUT exists to
smuggle one past it (405). A location's layout's specs, which replaced the floorplan beta's, are
[the layout's E2E](implementation/testing/floorplan-e2e.md)'s.
The access-control suite (`access-control.spec.ts`) covers who can see a market: an org
member with no explicit market role, a user granted an explicit role but no org membership,
membership changes taking effect (adding a user grants visibility, removing revokes it), and
org deletion revoking org-based access while explicit-role access survives. Each test pairs a
positive assertion with a negative one **against the same market**, so a broken query that
returns zero rows fails the positive assertion instead of vacuously satisfying an empty-list
negative - the trap the org-membership regression fell into. Each user is driven in its own
browser context (`withUser()`) so no two of them ever share a session cookie or the persisted
`user` in `localStorage`, and every navigation waits for the markets fetch to settle before
asserting, since `.markets-view` renders before the list does and a `not.toBeVisible()` would
otherwise pass against a still-loading page.

Configuration: `front-end/playwright.config.ts` (auto-detects the worktree
frontend port via `stack().frontendPort`).

**Prerequisite**: Docker stack running with seeded test users.
Email: `e2e@example.com` (default, change via `TEST_EMAIL` env var when seeding),
plus the organization-less user `e2e-noorg@example.com` (change via `NO_ORG_EMAIL`).

### When a test fails

Every attempt that fails keeps its Playwright trace, and so does every retry, passing or not (`trace: 'retain-on-failure-and-retries'`), so a local run with no retries keeps one too.
A failed attempt's trace is `front-end/test-results/<test>/trace.zip`, and a retry's is in the same name's directory with `-retry1` or `-retry2` after it; a page of a second user's context (`withUser()`) is in the same trace as the test's own page.
A failed attempt also keeps its video (`video.webm`) and its final screenshot (`test-failed-1.png`) beside its trace, and an attempt that passes keeps neither (`video: 'retain-on-failure'`, `screenshot: 'only-on-failure'`), so a flaky test's failed first attempt has both while its passing retry has only its trace.
Open one with `npx playwright show-trace <path>` from `front-end/`, or from the HTML report (`npx playwright show-report`), which lists every attempt with its own trace.
On CI a failed shard uploads `front-end/playwright-report/` and `front-end/test-results/` as the artifact `playwright-artifacts-shard-<n>`, kept 7 days; a flaky test fails its shard, so its failing attempt's trace is there too ([CI and the gate](implementation/testing/ci-and-the-gate.md#ci)).
A rerun empties `test-results/` before it starts, so read or copy a failure's output first, or give the rerun an output directory of its own with `--output=<a new directory>`.
Reproducing a flake under load is [chasing a flake](implementation/testing/e2e-patterns.md#chasing-a-flake).

### E2E Foundation

The suite is built on a Page Object Model plus a fixture layer under `front-end/e2e/`:
[E2E patterns](implementation/testing/e2e-patterns.md) is how a spec is written (testids, page
objects, fixtures, opening a market by URL, `mongoEval`, market dates and plans), and [E2E
seeds](implementation/testing/e2e-seeds.md) is every helper that puts users and markets in the state
a spec starts from.
The page objects in `front-end/e2e/pages/` are these, one a line, sorted by class name, so a new one is one line in its place ([two features never share a line](implementation/conventions/two-features-never-share-a-line.md)):

- `ApplicationFormPage`
- `ApplicationMonitorPage`
- `ApplicationsAllPage`
- `AttendanceStatusPage`
- `ChoiceField` (a control, a select or a field by how many choices it has)
- `CsvImportPage`
- `EmailVerificationPage` (the page a verification link opens)
- `FollowUpDialog` (marking a follow-up, from One by one's card or the All view's drawer)
- `LayoutPage` (a location's layout page: its upload, calibration, map and tools)
- `LoginPage`
- `ManageMarketPage`
- `MarketSetupPage`
- `MarketsPage`
- `NewMarketPage`
- `OpenApplicationsDialog` (the rail's Open applications dialog, choosing reviewers)
- `OrganizationsPage`
- `PasswordResetPage`
- `PaymentsPage`
- `PersonChooser` (a chooser of one person: "Who will follow up", "Followed up by", "Assigned to", the history's "Who")
- `ResultPage`
- `ReviewerChooser` (the several-choice chooser of reviewers, in the panel's dialog, Open applications and the first import)
- `ReviewersPanel` (the Applications tab's Reviewers panel: its line, its Change dialog and its read-only list)
- `StartFromCsvPage`
- `StatsPage`
- `TablesPage`
- `ToolsPage`
- `UpdateInfoDialog` (the vendor drawer's Update info dialog)
- `VendorExportDialog` (the export dialog, wherever it opens)
- `VendorPage` (a market's vendor page, `/<slug>`: its sign-in, what a signed-in vendor reads, and the application form opened on it)
- `VendorsPage`

### Bypassing CAPTCHA and email in tests

The registration flow is protected by reCAPTCHA v3. For local development and E2E
runs, set `DISABLE_CAPTCHA=true` (or `1`) so `verify_recaptcha` skips verification
and returns a passing result. The bypass defaults OFF and is honored only by a back
end that has also been told it is a local development one, with
`ALLOW_INSECURE_LOCAL_DEV=true` (which `docker-compose.yml` sets); on anything else
it does nothing, so a deployment that inherited it from a copied env file is not
silently unprotected. The CI e2e job sets
`DISABLE_CAPTCHA=true`, and `docker-compose.yml` forwards the variable to the
back-end so `./scripts/seed_fixture.sh` and Playwright can register users without a
real CAPTCHA token. On the front-end, `executeRecaptcha()` returns a placeholder
token when `VITE_RECAPTCHA_SITE_KEY` is unset (as in test/dev builds), so the flow
still reaches the back-end where the `DISABLE_CAPTCHA` bypass applies.

Similarly, set `DISABLE_EMAIL=true` (or `1`) so the Resend-backed
`send_verification_email`, `send_account_exists_email`, `send_password_reset_email`,
and `send_otp_email` helpers skip the actual send and report success. This is also
honored only under `ALLOW_INSECURE_LOCAL_DEV`, defaults OFF in the back end, and is forwarded by
`docker-compose.yml`; the CI e2e job and `scripts/nm-test.sh` set it, and a worktree's
stack (`scripts/th-compose.sh`) defaults it to `true` (pass `DISABLE_EMAIL=false` to send).
The primary checkout's plain `docker compose up` does not, so export it in the shell that
brings that stack up: without it the password-reset test in `auth.spec.ts` answers 500 from
the unconfigured mailer. The password-reset E2E test does
not read the reset link from an email - it reads the token directly from MongoDB
(through `mongoEval` in `front-end/e2e/helpers/mongo.ts`, which runs `mongosh` in the container
named by `E2E_MONGO_CONTAINER`, derived from `stack().mongoContainerName`).

### A fake Discord

The Discord specs (`who-is-in-the-discord-server.spec.ts`, `possible-discord-matches.spec.ts`, `giving-the-discord-role.spec.ts`, `exporting-discord-columns.spec.ts`) run the back end's own check and "Give roles" against a fake Discord server, never Discord.
`the-tools-tab.spec.ts` saves the card's choices against it too, so its refusals and roles are the back end's own.
With `DISCORD_FAKE=true`, the bot client's requests are answered by [`back-end/discord_fake.py`](../back-end/discord_fake.py) from the servers in the `fake_discord_servers` collection, which a spec writes through [`fakeDiscord.ts`](../front-end/e2e/helpers/fakeDiscord.ts), each with a server id of its own.
Like the two above, it is honoured only under `ALLOW_INSECURE_LOCAL_DEV` and forwarded by `docker-compose.yml`; the CI e2e job and `scripts/nm-test.sh` set it, and a worktree's stack defaults it to `true` (pass `DISCORD_FAKE=false` to use real Discord values).
The primary checkout's plain `docker compose up` does not, so export it there too, or those specs find no "Check Discord" or "Give roles" and say so.
Connecting through the card skips Discord's approval screen under it, and connects the first fake server.
"Give roles" gives a role there too: the grant lands on the member in that collection, refused as Discord refuses one (a member not in the server, a role it lacks, or one at or above the bot's own).

## CI Pipeline

Pushes and PRs to `main` or `dev` run `.github/workflows/test.yml`.
[CI and the gate](implementation/testing/ci-and-the-gate.md) says what each job runs, which checks
branch protection requires (nine on `dev`, `CodeQL` among them, and six on `main`, `real-data-and-workflows` on both), why a flaky test fails the build, and what the no-mistakes gate
runs through `scripts/nm-test.sh` (the real-data checks alone, since CI runs every suite before a merge).

## Stack limits

Every worktree and `nm-test.sh` stack runs within the limits that [`docker-compose.worktree.yml`](../docker-compose.worktree.yml) sets per service (`mem_limit`, `cpus`, `pids_limit`), and MongoDB sizes its cache for its limit (`--wiredTigerCacheSizeGB 0.25`).
Each limit sits well above that service's peak in a full `scripts/nm-test.sh` run, read from `docker stats` throughout the run; a limit the peak comes within 20% of is raised and the run repeated.

Measured on 2026-10-23 on a 12-core, 31 GiB Linux machine (Compose 5.6.1), one gate run at a time, `docker stats` read about twice a second per service over the stack's whole life (22.6 minutes, 375 E2E tests); CPU is in cores, as `docker stats` gives it (100% is one core):

| Service       | Limit: memory / CPUs / PIDs | Peak memory                        | Peak CPU   | Peak PIDs |
| ------------- | --------------------------- | ---------------------------------- | ---------- | --------- |
| mongodb       | 1g / 2 / 512                | 479 MiB (47%)                      | 119% (59%) | 62 (12%)  |
| backend       | 768m / 1 / 256              | 134 MiB (17%)                      | 59% (59%)  | 19 (7%)   |
| frontend      | 1g / 2 / 256                | 471 MiB (46%)                      | 151% (75%) | 38 (15%)  |
| mongo-express | 256m / 0.5 / 64             | not started by an `nm-test.sh` run |            |           |

The back end's row predates its reloader (`flask run --reload`): the server process watches the code and exits on a change, and a parent process, which loads the app too, starts it again, so the back end holds two copies of the app, and the boot's checks and index builds run in both at each stack start.
Measured again on 2026-11-13 over a whole Playwright run on a worktree stack (2383 tests, 2.1 hours, one worker, `docker stats` read about every 2 seconds), the back end peaked at 344 MiB (45%) and 38 PIDs (15%), with no reload during the run; that stack ran under a CPU limit other than 1, so its CPU peak, 126%, is not comparable to the table's.
MongoDB started at 768m and 1 CPU: the first run took it to 630 MiB (82%) and 101% of its one core, so it was raised and the run repeated.
Neither run had a container killed for memory (`docker events --filter event=oom` over each run).
A stack that is OOM-killed shows `OOMKilled: true` in `docker inspect`; raise its limit here with a new measurement, not by guessing.

## Testing Gotchas

- **Backend uses HTTPS with self-signed cert**: When calling the API directly,
  use `curl -k` to skip certificate validation. Playwright accepts the cert via
  `ignoreHTTPSErrors: true` in `playwright.config.ts`, so browser navigation and
  the `APIRequestContext`-based seed helpers work against the self-signed backend.
- **Identity comes from the session, never a header**: the session cookie says who the
  caller is, and the back end reads it through `authenticated_email()`
  (`back-end/utils/identity.py`) and nothing else.
  The client used to attach an `X-Owner-Email` header from localStorage and the back end
  authorized against it, so any signed-in user could act as any other by changing a value their
  own browser owned (E07/F01/S02).
  Do not reintroduce it, and do not add another header like it - `test_session_is_the_identity.py`
  fails the build if one appears in `app.py` or any blueprint under `api/`.
  The e2e helpers authenticate by logging in, and no spec or seed sends an identity header.
- **Email verification**: The seed fixture creates users with `email_verified=true`
  via `back-end/create_test_user.py` so they can log in immediately.
- **The Google Forms fixture**: `back-end/tests/test_data/google_forms/five-day-grid.csv` is a
  synthetic response export in a Google Form's shape, written by
  `back-end/tests/fixtures/synthetic_form_exports.py`.
  It exists because three MVP blockers came from the _shape_ of a real export and every CSV test
  before it wrote its own short single-line headers.
  `back-end/tests/test_data/README.md` lists the six properties it must preserve;
  `test_form_export_shapes.py` asserts them, but for the duplicate and organizer columns, which the
  answer key in `test_csv_proposal.py` holds.
- **A real export never becomes test data in any form**: the Google Form corpus changes only through `back-end/tests/fixtures/synthetic_form_exports.py`.
  Name an invented organization, market, venue or club on the "Example" pattern, as [test data](implementation/testing/test-data.md) says, with the rest of the rule for adding test data.
  A fixture's addresses are at `example.com`, `example.org` or a `.test` domain, and its phone numbers are from 555-0100 to 555-0199, the fictional range (the rest of the 555 exchange can be assigned).
  The git hooks refuse anything else before it is committed or pushed, and the gate and CI refuse it again, in the branch's commits and then in every file of the tree; install the hooks once per clone with `git config core.hooksPath .githooks` (a treehouse worktree gets them from `scripts/treehouse-setup.sh`).
  See [real data never leaves the PC](implementation/conventions/security-invariants.md#real-data-never-leaves-the-pc).
- **Playwright browsers**: If `npx playwright install chromium` fails inside the
  Alpine Docker container, install Playwright and browsers on the host instead.
- **`nm-test.sh` never runs `sudo`**: it installs Chromium with
  `npx playwright install chromium`, never `--with-deps` or `install-deps` - those run
  `sudo` with no terminal, and each failed attempt counts toward the account's
  `pam_faillock` lockout. The machine's own package manager provides the system libraries;
  CI's e2e action keeps `--with-deps`, and `install-deps` when the browser comes from its cache, which is right on GitHub's Ubuntu runners.
- **`nm-test.sh` runs take turns for their E2E phase**: two `scripts/nm-test.sh` runs (with neither switch) on one machine
  run their unit suites side by side, but the second waits, saying
  `nm-test: waiting for the end-to-end lock since ...` and naming the run it waits for, until the first's stack is down,
  because a stack starting or stopping breaks another run's browser with
  `net::ERR_NETWORK_CHANGED`. `lsof ~/.local/state/conventioner/e2e.lock` lists the holder and
  every waiting run; [CI and the gate](implementation/testing/ci-and-the-gate.md#the-no-mistakes-gate)
  has the lock's rules. A dev stack or a hand-run Playwright takes no turn and can still meet it.
  A stack's own start no longer reaches its first spec: Playwright's global setup waits until the
  host's newest container interface is 20 seconds old, then until the back end answers through
  the front end and the sign-in page draws, and says how long it waits; a test whose browser saw
  the network change is annotated "network changed"
  ([E2E patterns](implementation/testing/e2e-patterns.md#sharp-edges)).
- **An agent or `nm-test.sh` stack never restarts by itself**: every stack started through
  `scripts/th-compose.sh` has `restart: "no"`, so after a reboot, a Docker restart or a crash it
  stays down until you bring it up again; the primary stack (plain `docker compose`) still restarts.
  Its bind mounts never create a missing source either, so a stack whose worktree is gone fails to
  start instead of re-creating the worktree's folders as root.
- **Every stack listens on `127.0.0.1` only, so every client dials `127.0.0.1`, never `localhost`**:
  the primary stack (`docker-compose.yml`) and every worktree and `nm-test.sh` stack publish their
  ports on IPv4 loopback, so another machine on the network does not reach them.
  Node and Chromium try `localhost` as `::1` first, and macOS gives a port held on `127.0.0.1` to
  any program that listens on IPv6, so for as long as one does, `localhost:<port>` reaches it
  instead of the stack: a gate run failed twice that way, for a few seconds, with EPROTO
  "unexpected message" and `ERR_INVALID_HTTP_RESPONSE`.
  A native `npm run dev` listens there too: `vite.config.ts` binds it to `127.0.0.1` (the
  container's `--host 0.0.0.0` overrides that), since left to `localhost` it listens on `::1` alone.
  The guards run the clients themselves: `scripts/tests/test_local_addresses.py` runs `stack.ts`
  and `seed_fixture.sh` and renders the compose files, and
  `front-end/src/__tests__/theLocalStackIsDialledAt127001.test.ts` loads Playwright's config, the
  suite's fixtures and Vite's config and starts the dev server.
  mongo-express is not part of a worktree or `nm-test.sh` stack unless asked for:
  `scripts/th-compose.sh --profile tools up -d mongo-express` (the primary stack still starts it).
- **The back end is on 5001, not Flask's default 5000**: macOS's AirPlay Receiver (System
  Settings, General, AirDrop & Handoff) listens on 5000 on both address families, so a client
  dialling 5000 can reach AirPlay instead of the back end.
  A slot's back end is on `5001 + slot * 10`, so no stack lands on 5000, and
  `scripts/tests/test_local_addresses.py` fails on a published port that a macOS service holds.
- **Worktree and `nm-test.sh` stacks share their images**: every slot stack and `nm-test.sh` run with the same
  dependencies runs the same `conventioner/backend:<tag>` and `conventioner/frontend:<tag>`, each
  tag a hash of the files its image is built from (`scripts/image-tags.sh`: the back end's
  Dockerfile, entrypoint and two requirements files; the front end's Dockerfile, `package.json`
  and `package-lock.json`), and the source reaches the containers through the bind mounts.
  So a change to the source needs no build, `scripts/th-compose.sh up -d` builds an image only
  when none has its tag yet, and `scripts/th-compose.sh build` rebuilds one anyway (say for a
  newer base image). After the front end's dependencies change, a stack keeps its old
  `node_modules` volume however its front end is recreated:
  `scripts/th-compose.sh rm -s -f -v frontend` then `up -d` refills it from the new image (`up --renew-anon-volumes` would too, but
  leaves the old volume behind). The primary stack and CI build their own images from
  `docker-compose.yml`, as before.
- **Driving a layout**: every gesture is a person's own, a drag with `page.mouse`, a key on the
  focused map, and what it did is read from the tables' names on the map and the layout the server
  stored, never from the page's state; see [the layout's E2E](implementation/testing/floorplan-e2e.md).
