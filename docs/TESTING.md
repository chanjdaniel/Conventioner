---
layer: implementation
kind: testing
describes:
  - front-end/playwright.config.ts
  - scripts/seed_fixture.sh
  - scripts/nm-test.sh
verified: 2026-10-22
sources:
  - E34/F03/S02
  - E35/F02/S01
---

# Testing Conventioner

How to run each suite, and what each covers.
The testing nodes of the [knowledge graph](implementation/testing/README.md) hold the sharp edges of each; the [Google Form corpus](../back-end/tests/test_data/README.md) is the suite's realistic data.
The sharp edges are in the testing nodes: [E2E patterns](implementation/testing/e2e-patterns.md), [E2E seeds](implementation/testing/e2e-seeds.md), [the market journey spec](implementation/testing/the-market-journey-spec.md), [floorplan E2E](implementation/testing/floorplan-e2e.md), [CI and the gate](implementation/testing/ci-and-the-gate.md) and [the assignment behaviour suite](implementation/testing/assignment-behaviour-suite.md).
The stack is seeded by [`scripts/seed_fixture.sh`](../scripts/seed_fixture.sh), Playwright is configured in [`front-end/playwright.config.ts`](../front-end/playwright.config.ts), and the no-mistakes gate runs everything through [`scripts/nm-test.sh`](../scripts/nm-test.sh).

## Quick Start: Seed Fixture

The fastest way to get a working test environment:

```bash
./scripts/seed_fixture.sh
```

This brings up the Docker stack, creates the test users, creates an organization
(`Seed Test Org`, reused if the user already has one), and creates a market in it.
The output prints the credentials and market ID.

Two verified users are created: the main test user, and a second user that
deliberately belongs to no organization (`e2e-noorg@example.com`) so the e2e suite can
exercise the zero-organization state of the market-creation org picker.

Override credentials:

```bash
TEST_EMAIL=myuser@example.com TEST_PASSWORD=mypass \
  NO_ORG_EMAIL=mynoorguser@example.com NO_ORG_PASSWORD=mynoorgpass \
  ./scripts/seed_fixture.sh
```

## Back-End Tests

```bash
cd back-end
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest tests/ -v
```

Install **both** files. `requirements-dev.txt` is only `pytest`; it does not pull in the runtime
dependencies, and the suite imports the application. `scripts/nm-test.sh` installs both, which is
why the gate passes where a hand-run `pip install -r requirements-dev.txt` does not.

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
`test_anonymise_form_export.py` covers the script that turns a real Google Form export into a
committable fixture, on a synthetic export: a value survives only when 3 distinct applicants gave
it, and the leak check refuses output that holds a rarer one.
`test_csv_proposal.py` holds the rules that read a Google Form's responses into a proposal to the
answer key they were measured against on those five exports, `test_csv_proposal_plan.py` does the
same for what the file says about the plan, and `test_csv_proposal_api.py` pins that asking for one
writes nothing.
`test_google_forms_corpus.py` pins the five exports that script made (`tests/test_data/google_forms/`):
each one's row count, header row and table-size answer counts.

A test count is deliberately not quoted here: it goes stale on the next commit, and the suite
either passes or it does not.

`test_attendance_api.py` additionally pins the public slug lookup (queried via the
stored `slug` field for an indexed, O(1) lookup rather than a collection scan), which
decides whether a market's public check-in URL is live: it serves a market past `draft`
and refuses a draft, on both a document that stores a `phase` and one written before the
field existed (where the phase is derived from `isDraft`).

The market phase lifecycle adds six suites:

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
  writable from a request body), every write persists it, and `published_market_by_slug`
  is one indexed query with a projection the caller controls.
- `test_market_phase_consistency.py` - a market reports the same phase whichever endpoint
  served it (the list endpoint used to hand back raw documents while the detail endpoint
  derived the phase, so the two could disagree about pre-migration markets).
- `test_migrate_market_keys.py` - the migration leaves every market in canonical form
  (camelCase keys, no legacy snake_case spelling, and a stored slug); camelCase wins
  where a document carries both, the slug is backfilled from the name and repaired
  when it disagrees, the index is built, and it is idempotent.
- `test_migrate_is_draft_consistency.py` - the `isDraft`/`phase` reconciliation migration:
  a market the old build published (`phase: "draft"` + `isDraft: false`) has its *phase*
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

Requirements: `pytest` (listed in `requirements-dev.txt`), no database connection needed
(tests use in-memory fakes). The fakes read a filter (`mongo_matches`) and a projection
(`mongo_project`) as Mongo does, a sub-document compared whole, so a read that fetches too
little fails here rather than in production. Shared module stubs live in `back-end/tests/conftest.py`, which
also points the `.env` loader at a path that does not exist - the suite reads no `.env`, so a
stale one on your machine cannot change its result.

## Front-End Unit Tests

```bash
cd front-end
npm run test:unit
```

Tests cover the API client (it sends credentials and attaches no request interceptor, so no
identity can be smuggled onto a request) and
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
every blocker the server returned, links to the guard's `resolutionLink` when there is one,
and renders nothing when there are no blockers - all without a line of guard-specific
logic, which is the point of the guard registry ([`back-end/guards.py`](../back-end/guards.py)).
Add more component tests in `front-end/src/__tests__/`.

Configuration: `front-end/vitest.config.ts` with `happy-dom` environment.

## End-to-End (E2E) Tests

```bash
# Start the Docker stack and seed test data
cd .. && ./scripts/seed_fixture.sh

# Run E2E tests
cd front-end
npm run test:e2e
```

E2E tests use Playwright driving Chromium against the running Docker stack.

**Which spec to extend**: `market-journey.spec.ts` is the only spec that walks the whole journey
in one organizer session, and every other spec is a slice of it; [the market journey
spec](implementation/testing/the-market-journey-spec.md) says what each slice covers and where a
new test belongs. `phase-state-machine.spec.ts` walks every phase edge and the guards that refuse
them, and `smoke.spec.ts` covers login, dashboard, and markets navigation.
Which specs walk which user flow, and the gaps worth a spec, is the coverage map in [walking the
flows](implementation/testing/walking-the-flows.md#coverage-map).
Coverage also includes tier-1 market operations journeys: public vendor check-in
(`checkin.spec.ts`), vendor browsing with search (`vendors.spec.ts`), and table
browsing with filtering (`tables.spec.ts`). The tier-2 suite (`tier2.spec.ts`)
covers organization CRUD (create, add admin/member, remove member, rename,
delete), market role management (add user with role, change role, remove user),
assignment CSV export (download and verify columns), and publishing a market
(verify the check-in URL is reachable). Tier-3 authentication and robustness
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
smuggle one past it (405). The floorplan suite
(`floorplan.spec.ts`) drives the create-from-floorplan setup path end to end:
it walks the floorplan beta's five-step wizard (upload, scale calibration, table
placement, section grouping, save) and verifies the resulting sections land
back on Market Setup.
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

### E2E Foundation

The suite is built on a Page Object Model plus a fixture layer under `front-end/e2e/`:
[E2E patterns](implementation/testing/e2e-patterns.md) is how a spec is written (testids, page
objects, fixtures, opening a market by URL, `mongoEval`, market dates and plans), and [E2E
seeds](implementation/testing/e2e-seeds.md) is every helper that puts users and markets in the state
a spec starts from.
The page objects in `front-end/e2e/pages/` are `LoginPage`, `NewMarketPage`, `MarketSetupPage`,
`ResultPage`, `CheckinPage`, `VendorsPage`, `TablesPage`, `AttendanceStatusPage`,
`OrganizationsPage`, `ManageMarketPage`, `PasswordResetPage`, `ApplicationFormPage`,
`FloorplanWorkflowPage`, `ApplicantLoginPage`, `ApplicantDashboardPage`, `ApplyPage`,
`CsvImportPage`, `StartFromCsvPage`, `MarketsPage`, `ApplicationsAllPage` and
`ApplicationMonitorPage`.

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
`send_verification_email`, `send_password_reset_email`, and `send_otp_email`
helpers skip the actual send and report success. This is also honored only under
`ALLOW_INSECURE_LOCAL_DEV`, defaults OFF, and is forwarded by
`docker-compose.yml`; the CI e2e job and `scripts/nm-test.sh` set it too, but a bare
`scripts/th-compose.sh up` does not, so export it in the shell that brings the stack up:
without it the password-reset test in `auth.spec.ts` answers 500 from the unconfigured
mailer. The password-reset E2E test does
not read the reset link from an email - it reads the token directly from MongoDB
(through `mongoEval` in `front-end/e2e/helpers/mongo.ts`, which runs `mongosh` in the container
named by `E2E_MONGO_CONTAINER`, derived from `stack().mongoContainerName`).

## CI Pipeline

Pushes and PRs to `main` or `dev` run `.github/workflows/test.yml`: back-end pytest, front-end unit
tests, format, lint, style lint and type-check, the knowledge graph's checks, a Docker build, and
the E2E suite in four shards.
[CI and the gate](implementation/testing/ci-and-the-gate.md) says what each job runs, which five
checks branch protection requires, why a flaky test fails the build, and what the no-mistakes gate
runs through `scripts/nm-test.sh`.

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
  Several e2e specs still pass the header on their own request contexts; it is inert, and those
  helpers authenticate properly by logging in.
- **Email verification**: The seed fixture creates users with `email_verified=true`
  via `back-end/create_test_user.py` so they can log in immediately.
- **The Google Forms fixture**: `back-end/tests/test_data/google_forms_export.csv` is a real
  response export with the people replaced, built by an earlier version of
  `back-end/tests/fixtures/anonymise_form_export.py`.
  It exists because three MVP blockers came from the *shape* of a real export and every CSV test
  before it wrote its own short single-line headers.
  `back-end/tests/test_data/README.md` lists the six properties it must preserve, and
  `test_real_export_shapes.py` asserts those before it asserts anything else.
- **Playwright browsers**: If `npx playwright install chromium` fails inside the
  Alpine Docker container, install Playwright and browsers on the host instead.
- **`nm-test.sh` never runs `sudo`**: it installs Chromium with
  `npx playwright install chromium`, never `--with-deps` or `install-deps` - those run
  `sudo` with no terminal, and each failed attempt counts toward the account's
  `pam_faillock` lockout. The machine's own package manager provides the system libraries;
  CI's workflow keeps `--with-deps`, which is right on GitHub's Ubuntu runners.
- **Driving the Konva floorplan canvas**: calibration is a real mouse drag, but section grouping
  sets the store directly and the editor canvas is not exercised at all; see [floorplan
  E2E](implementation/testing/floorplan-e2e.md) for the coverage gap.
