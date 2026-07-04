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

57 tests covering the assignment algorithm, statistics, Discord webhook, attendance,
column mapping, schema generation, and role validation.

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
The smoke test covers login, dashboard, and markets navigation.

Configuration: `front-end/playwright.config.ts`.

**Prerequisite**: Docker stack running with seeded test user.
Email: `e2e@example.com` (default, change via `TEST_EMAIL` env var when seeding).

## CI Pipeline

Pushes and PRs to `main` or `dev` trigger `.github/workflows/test.yml`:
- Back-end: install dependencies + pytest
- Front-end: npm ci + type-check + lint + unit tests
- Docker build verification

## Testing Gotchas

- **Backend uses HTTPS with self-signed cert**: When calling the API directly,
  use `curl -k` to skip certificate validation.
- **X-Owner-Email header**: Set automatically by the axios interceptor in
  `front-end/src/utils/api.ts`. New API calls using the shared `api` instance
  do not need to set it manually.
- **Email verification**: The seed fixture creates users with `email_verified=true`
  via `back-end/create_test_user.py` so they can log in immediately.
- **Playwright browsers**: If `npx playwright install chromium` fails inside the
  Alpine Docker container, install Playwright and browsers on the host instead.
