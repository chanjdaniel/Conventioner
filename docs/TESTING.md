# Testing Conventioner

## Quick Start: Seed Fixture

The fastest way to get a working test environment:

```bash
./scripts/seed_fixture.sh
```

This brings up the Docker stack, creates the test users, creates an organization
(`Seed Test Org`, reused if the user already has one), creates a market in it, and
uploads a sample CSV.
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
pip install -r requirements-dev.txt
python -m pytest tests/ -v
```

276 tests covering the assignment algorithm, statistics, Discord webhook, attendance,
column mapping, schema generation, role validation, CAPTCHA verification/bypass, the
Conventioner data model (market phases, `is_draft` computed strictly from `phase`, application
form/status models, and backward compatibility with existing market documents), the `phase`
backfill migration, the `applications` collection migration, the server-owned market fields
preserved across updates, and the application form endpoints (`test_application_form.py`:
permission checks, field/key/option validation, `order` renormalization, server-owned
`published_at`, and the D9 lock refusing edits on every write path once an application
exists or the market leaves `draft`).

`test_attendance_api.py` additionally pins the public slug lookup, which is what decides
whether a market's public check-in URL is live: it serves a market past `draft` and refuses a
draft, on both a document that stores a `phase` and one written before the field existed (where
the phase is derived from `isDraft`), and it asserts the Mongo prefilter only *prunes* the
unambiguous drafts rather than making the draft decision itself.

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
  camelCase key, so an org-scoped market list and the public check-in lookup find the
  markets they should.
- `test_market_phase_consistency.py` - a market reports the same phase whichever endpoint
  served it (the list endpoint used to hand back raw documents while the detail endpoint
  derived the phase, so the two could disagree about pre-migration markets).
- `test_migrate_market_keys.py` - the key migration leaves every market under exactly one
  spelling of each field, camelCase wins where a document carries both, and it is
  idempotent.
- `test_migrate_is_draft_consistency.py` - the `isDraft`/`phase` reconciliation migration:
  a market the old build published (`phase: "draft"` + `isDraft: false`) has its *phase*
  advanced to `archived` rather than being confirmed as a draft, a stale `isDraft` on an
  already-advanced market is recomputed from the phase instead, a document with no `phase`
  is left untouched (it is `migrate_phase.py`'s to backfill, and flipping `isDraft` would
  silently archive every legacy draft), the writes are condition-checked so a concurrent
  transition cannot have a stale value written over it, and it is idempotent.

Requirements: `pytest` (listed in `requirements-dev.txt`), no database connection needed
(tests use in-memory fakes). Shared module stubs live in `back-end/tests/conftest.py`.

## Front-End Unit Tests

```bash
cd front-end
npm run test:unit
```

Tests cover the API client interceptor (automatic `X-Owner-Email` header injection) and
`parseMarketFromApi()` (`market.test.ts`), which round-trips the market `phase`,
application form, review config, and Discord guild id, and leaves them undefined when the
API omits them. The same suite covers `pathAfterLoadingMarket()`, which routes on `phase`
(draft → the setup wizard, anything past it → the market's public slug) and falls back to
`isDraft` only for a market cached by a build that predates the field - without that fallback,
a published market left in `localStorage` would be routed back into the setup wizard.
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
logic, which is the point of the registry (see `docs/OBJECT_RELATIONSHIPS.md`).
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
The smoke test covers login, dashboard, and markets navigation, and the market
pipeline test (`market-pipeline.spec.ts`) exercises the full product flow:
creating a market with a CSV upload, walking the 3-page setup wizard, triggering
assignment generation, verifying the assignment results view, then **publishing with
Done** - which posts the `draft` → `archived` transition - and confirming the market
lands on its public slug, reports `phase: archived` with `isDraft: false`, reopens from
the markets list to its public page rather than back into the wizard, and is reachable by
a vendor at its public check-in URL.
A second test in that spec covers the **upgrade path for markets the old build published**:
it rewinds a seeded market to the shape that build stored (`phase: "draft"` +
`isDraft: false`, via `helpers/legacyMarketDoc.ts`), asserts the public check-in URL is a
`404` in that state, runs the real `migrate_is_draft_consistency.py` inside the back-end
container against the live database, and asserts the market's phase advanced, its check-in
URL is live again, and a second run changes nothing. There is no product path back to that
document shape - the whole point of the change is that the app can no longer produce one -
so writing it directly is the only way to exercise the repair. Coverage also
includes tier-1 market operations journeys: public vendor check-in
(`checkin.spec.ts`), vendor browsing with search (`vendors.spec.ts`), and table
browsing with filtering (`tables.spec.ts`). The tier-2 suite (`tier2.spec.ts`)
covers organization CRUD (create, add admin/member, remove member, rename,
delete), market role management (add user with role, change role, remove user),
assignment CSV export (download and verify columns), and publishing a market
(verify the check-in URL is reachable). Tier-3 authentication and robustness
journeys (`auth.spec.ts`) cover new-user registration, the full password reset
flow (including reading the real reset token from MongoDB), posting an assignment
to Discord, and login/OTP error states. The organization-required suite
(`new-market-org.spec.ts`) covers the rule that every market must be created in an
organization: it asserts the new-market overlay's org dropdown lists exactly the
organizations from `GET /organizations`, that submission stays disabled until one is
picked, that the created market is stamped with the chosen `organizationId`, and that
a user belonging to no organization gets a disabled dropdown plus a link to
`/organizations`. The application-form suite (`application-form.spec.ts`) drives the
market-setup Application Form tab: an organizer builds a form (keys auto-slugged from the
labels), watches the live preview, saves it, and reloads to confirm it persisted; a second
test seeds an application straight into Mongo and asserts the D9 lock then renders the
builder read-only with its lock banner, that `PUT /markets/{id}/application-form` refuses
with 409, and that a market PUT carrying a rewritten form cannot smuggle one past it
either. The floorplan suite
(`floorplan.spec.ts`) drives the create-from-floorplan setup path end to end:
it walks the Floorplan AI 5-step wizard (upload, scale calibration, table
placement, section grouping, save) and verifies the resulting sections land
back in the setup wizard.

Configuration: `front-end/playwright.config.ts` (auto-detects the worktree
frontend port via `detectFrontendPort()`).

**Prerequisite**: Docker stack running with seeded test users.
Email: `e2e@example.com` (default, change via `TEST_EMAIL` env var when seeding),
plus the organization-less user `e2e-noorg@example.com` (change via `NO_ORG_EMAIL`).

### E2E Foundation

The suite is built on a Page Object Model plus a fixture layer under `front-end/e2e/`:

- **data-testid convention**: selectors follow `viewname-element`
  (e.g. `login-email-input`, `markets-create-button`). Views are instrumented
  with `data-testid` attributes so tests never depend on CSS classes or text.
- **Page objects** (`front-end/e2e/pages/`): `LoginPage`, `NewMarketPage`,
  `MarketSetupPage`, `AssignmentResultsPage`, `CheckinPage`, `VendorsPage`,
  `TablesPage`, `AttendanceStatusPage`, `OrganizationsPage`, `ManageMarketPage`,
  `PasswordResetPage`, `ApplicationFormPage`, and `FloorplanWorkflowPage` each wrap
  `getByTestId()` selectors and expose action methods. New page objects should follow
  these patterns.
- **Fixtures** (`front-end/e2e/fixtures.ts`): provides `TEST_USER`, the
  `BACKEND_URL` constant (defaults to `https://localhost:5000`, override via the
  `BACKEND_URL` env var), the `authenticatedPage` fixture (logs in before the
  test), and re-exports page objects for convenience.
- **API-level seeding** (`front-end/e2e/helpers/seeds.ts`): all helpers use
  Playwright's `APIRequestContext` (cookies flow automatically) and require a
  verified test user created by `scripts/seed_fixture.sh`.
  - `loginViaApi()` logs in so the request context carries a Flask session cookie
    and returns the user UUID.
  - `ensureTestOrgAuthenticated()` returns the test user's first organization,
    creating `E2E Test Org` if they have none. Use it when the request context has
    already logged in; `ensureTestOrg()` wraps it with a login for contexts that have
    not. Every market-creating helper and spec needs one of these, because
    `POST /markets` rejects a payload without a valid `organizationId`. Specs that
    create a market through the UI call it in `beforeAll` so the org dropdown is not
    empty.
  - `seedMarketWithVendors()` logs in, ensures an organization, creates a market in
    it, and uploads a vendor CSV via the back-end API. The organization id is
    returned as `orgId` on the seed result.
  - `seedPublishedMarketWithAssignments()` additionally configures the market's
    `setup_object` (column mapping, dates, sections, tiers, locations), publishes
    it via `POST /markets/{id}/transition` with `{ toPhase: 'archived' }` - the same
    endpoint the product's Done button calls, since `isDraft` is server-derived and a
    PUT can no longer publish anything - then fetches the computed assignment via
    `GET /markets/{id}/assignment` and stores it back via PUT so the check-in API
    and vendor/table views have persisted assignments. Returns a `marketSlug`
    for navigating to the public check-in URL. See `AGENTS.md` for the
    `enum_priority_order` sizing requirement and other sharp edges.
  - `seedAssignedMarket()` (`front-end/e2e/helpers/seedAssignedMarket.ts`)
    additionally configures the market's `setupObject` and triggers the
    assignment engine via the API, returning the seed plus the market's URL
    `slug`.
  - `seedApplication()` (`front-end/e2e/helpers/seedApplication.ts`) is one of two
    exceptions to API-level seeding: it inserts an application document straight into
    Mongo via `mongosh` (`E2E_MONGO_CONTAINER` overrides the container name, as in
    `auth.spec.ts`). There is no applicant-facing submit endpoint yet, so writing the
    document the way that endpoint eventually will - snake_case, keyed by `market_id` -
    is the only way to reach the D9-locked state.
  - `helpers/legacyMarketDoc.ts` is the other: `makeLegacyPublishedMarket()` rewrites a
    market into the shape the pre-`phase` build stored for a published one, and
    `runIsDraftConsistencyMigration()` runs the real migration script inside the back-end
    container (`E2E_BACKEND_CONTAINER` overrides that container name). Both reach past the
    API on purpose - no endpoint can produce or repair that document shape.

### Bypassing CAPTCHA and email in tests

The registration flow is protected by reCAPTCHA v3. For local development and E2E
runs, set `DISABLE_CAPTCHA=true` (or `1`) so `verify_recaptcha` skips verification
and returns a passing result. The bypass is honored only when `FLASK_ENV` is not
`production`, defaults OFF, and never applies in production. The CI e2e job sets
`DISABLE_CAPTCHA=true`, and `docker-compose.yml` forwards the variable to the
back-end so `./scripts/seed_fixture.sh` and Playwright can register users without a
real CAPTCHA token. On the front-end, `executeRecaptcha()` returns a placeholder
token when `VITE_RECAPTCHA_SITE_KEY` is unset (as in test/dev builds), so the flow
still reaches the back-end where the `DISABLE_CAPTCHA` bypass applies.

Similarly, set `DISABLE_EMAIL=true` (or `1`) so the Resend-backed
`send_verification_email`, `send_password_reset_email`, and `send_otp_email`
helpers skip the actual send and report success. This is also honored only when
`FLASK_ENV` is not `production`, defaults OFF, and is forwarded by
`docker-compose.yml`; the CI e2e job sets it too. The password-reset E2E test does
not read the reset link from an email - it reads the token directly from MongoDB
(via `docker exec` into the container named by `E2E_MONGO_CONTAINER`, default
`conventioner_mongodb`).

## CI Pipeline

Pushes and PRs to `main` or `dev` trigger `.github/workflows/test.yml`:
- Back-end: install dependencies + pytest
- Front-end: npm ci + type-check + lint + unit tests
- Docker build verification
- E2E: build and start the Docker stack, seed fixtures, install Playwright
  (Chromium), run the Playwright suite with `DISABLE_CAPTCHA=true` and
  `DISABLE_EMAIL=true`, and upload the Playwright report + test results as
  artifacts on failure

## Testing Gotchas

- **Backend uses HTTPS with self-signed cert**: When calling the API directly,
  use `curl -k` to skip certificate validation. Playwright accepts the cert via
  `ignoreHTTPSErrors: true` in `playwright.config.ts`, so browser navigation and
  the `APIRequestContext`-based seed helpers work against the self-signed backend.
- **X-Owner-Email header**: Set automatically by the axios interceptor in
  `front-end/src/utils/api.ts`. New API calls using the shared `api` instance
  do not need to set it manually.
- **Email verification**: The seed fixture creates users with `email_verified=true`
  via `back-end/create_test_user.py` so they can log in immediately.
- **Playwright browsers**: If `npx playwright install chromium` fails inside the
  Alpine Docker container, install Playwright and browsers on the host instead.
- **Driving the Konva floorplan canvas**: `FloorplanWorkflowPage` calibrates the
  scale by issuing `page.mouse` drags over the Konva stage, but the lasso-based
  section grouping cannot be driven reliably through the canvas, so the page
  object manipulates the Pinia store directly via `page.evaluate`. The
  `FloorplanEditor` no longer resets the store on mount (it preserves the
  existing `placedTables`, `tableTypes`, `sections`, `walls`, and `obstacles`),
  so the spec uses `snapshotPlacedTables()` to assert tables survive the
  step-2-to-step-3 transition rather than snapshotting and restoring around it.
