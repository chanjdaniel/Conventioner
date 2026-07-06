# Testing Conventioner

## Quick Start: Seed Fixture

The fastest way to get a working test environment:

```bash
./scripts/seed_fixture.sh
```

This brings up the Docker stack, creates a test user, creates a market, and uploads a sample CSV.
The output prints the credentials and market ID.

Override credentials:

```bash
TEST_EMAIL=myuser@example.com TEST_PASSWORD=mypass ./scripts/seed_fixture.sh
```

## Back-End Tests

```bash
cd back-end
pip install -r requirements-dev.txt
python -m pytest tests/ -v
```

63 tests covering the assignment algorithm, statistics, Discord webhook, attendance,
column mapping, schema generation, role validation, and CAPTCHA verification/bypass.

Requirements: `pytest` (listed in `requirements-dev.txt`), no database connection needed
(tests use in-memory fakes).

## Front-End Unit Tests

```bash
cd front-end
npm run test:unit
```

Tests cover the API client interceptor (automatic `X-Owner-Email` header injection).
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
assignment generation, and verifying the assignment results view. Coverage also
includes tier-1 market operations journeys: public vendor check-in
(`checkin.spec.ts`), vendor browsing with search (`vendors.spec.ts`), and table
browsing with filtering (`tables.spec.ts`). The tier-2 suite (`tier2.spec.ts`)
covers organization CRUD (create, add admin/member, remove member, rename,
delete), market role management (add user with role, change role, remove user),
assignment CSV export (download and verify columns), and publishing a market
(verify the check-in URL is reachable). Tier-3 authentication and robustness
journeys (`auth.spec.ts`) cover new-user registration, the full password reset
flow (including reading the real reset token from MongoDB), posting an assignment
to Discord, and login/OTP error states. The floorplan suite
(`floorplan.spec.ts`) drives the create-from-floorplan setup path end to end:
it walks the Floorplan AI 5-step wizard (upload, scale calibration, table
placement, section grouping, save) and verifies the resulting sections land
back in the setup wizard.

Configuration: `front-end/playwright.config.ts` (auto-detects the worktree
frontend port via `detectFrontendPort()`).

**Prerequisite**: Docker stack running with seeded test user.
Email: `e2e@example.com` (default, change via `TEST_EMAIL` env var when seeding).

### E2E Foundation

The suite is built on a Page Object Model plus a fixture layer under `front-end/e2e/`:

- **data-testid convention**: selectors follow `viewname-element`
  (e.g. `login-email-input`, `markets-create-button`). Views are instrumented
  with `data-testid` attributes so tests never depend on CSS classes or text.
- **Page objects** (`front-end/e2e/pages/`): `LoginPage`, `NewMarketPage`,
  `MarketSetupPage`, `AssignmentResultsPage`, `CheckinPage`, `VendorsPage`,
  `TablesPage`, `AttendanceStatusPage`, `OrganizationsPage`, `ManageMarketPage`,
  `PasswordResetPage`, and `FloorplanWorkflowPage` each wrap `getByTestId()`
  selectors and expose action methods. New page objects should follow these
  patterns.
- **Fixtures** (`front-end/e2e/fixtures.ts`): provides `TEST_USER`, the
  `BACKEND_URL` constant (defaults to `https://localhost:5000`, override via the
  `BACKEND_URL` env var), the `authenticatedPage` fixture (logs in before the
  test), and re-exports page objects for convenience.
- **API-level seeding** (`front-end/e2e/helpers/seeds.ts`): all helpers use
  Playwright's `APIRequestContext` (cookies flow automatically) and require a
  verified test user created by `scripts/seed_fixture.sh`.
  - `seedMarketWithVendors()` logs in, creates a market, and uploads a vendor
    CSV via the back-end API.
  - `seedPublishedMarketWithAssignments()` additionally configures the market's
    `setup_object` (column mapping, dates, sections, tiers, locations), publishes
    it (`isDraft: false`), then fetches the computed assignment via
    `GET /markets/{id}/assignment` and stores it back via PUT so the check-in API
    and vendor/table views have persisted assignments. Returns a `marketSlug`
    for navigating to the public check-in URL. See `AGENTS.md` for the
    `enum_priority_order` sizing requirement and other sharp edges.
  - `seedAssignedMarket()` (`front-end/e2e/helpers/seedAssignedMarket.ts`)
    additionally configures the market's `setupObject` and triggers the
    assignment engine via the API, returning the seed plus the market's URL
    `slug`.

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
