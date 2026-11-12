---
layer: implementation
kind: testing
describes:
  - scripts/seed_fixture.sh
verified: 2026-11-10
sources:
  - E26
  - E41/F01/S01
  - E40/F02/S01
  - E38/F06/S01
  - T148
  - T169
  - E38/F14/S02
  - T176
  - T263
  - T201
---

# Walking the flows

The flows ([`USER_FLOWS.md`](../../USER_FLOWS.md) indexes them) are written to be walked, two ways:

- **E2E testing:** each numbered step is a candidate assertion, and each flow's "Covered by" names the tests that already walk it; the [coverage map](#coverage-map) below lists the gaps.
- **User testing:** paths and flows open with a **Task** you can hand a participant without telling them where to click.

This node says what a walk needs: the stack, the accounts, the outside services, the fixtures, the gaps the specs leave in each flow, and how to seed past the steps a test is not about.
How to run the suites is [`TESTING.md`](../../TESTING.md); the seed helpers are [E2E seeds](e2e-seeds.md).

## Environment, accounts and external dependencies

### Local stack

1. Bring the stack up with `scripts/th-compose.sh up -d` from a treehouse worktree (email is off there by default), or `DISABLE_EMAIL=true docker compose up -d` from the primary checkout.
2. Run [`./scripts/seed_fixture.sh`](../../../scripts/seed_fixture.sh) in the worktree, or `./scripts/seed_fixture.sh --primary` in the primary checkout: it empties the stack's database first, so it refuses to guess which stack ([TESTING.md](../../TESTING.md#quick-start-seed-fixture)).
   It creates two verified organizers, `e2e@example.com` / `e2epassword123` (owns `Seed Test Org`) and `e2e-noorg@example.com` / `e2enoorg123` (in no organization), plus one draft market.
3. Open the front end printed by the script (`http://127.0.0.1:5173` on the primary stack, port `5173 + slot*10` in a worktree; never `localhost`, see [Testing gotchas](../../TESTING.md#testing-gotchas)) and sign in.

On a freshly built front-end container, the first visit to each lazily loaded page can render blank for a few seconds while Vite optimizes dependencies and reloads.
This is a dev-server effect, not a product bug; wait and retry before filing it.

### Accounts

- An account made through the Register tab cannot sign in locally: registration sends a verification email, and with `DISABLE_EMAIL=true` nothing is sent.
  Make local organizers with `back-end/create_test_user.py` (which sets `email_verified`), or `ensureVerifiedUser()` in a spec ([E2E seeds](e2e-seeds.md#users)).
- Sign-in codes (the organizer's "Sign-in code" tab, a vendor's applicant sign-in) and password-reset links are also email-only.
  Locally they need either a real Resend key or a database seed (see [Test data recipes](#test-data-recipes)).

### External services

| Dependency                                                                  | Needed by                                                                         | Local default                                                                                                                                                                                                                                                                         | What breaks without it                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MongoDB                                                                     | Everything                                                                        | Docker `mongodb` service                                                                                                                                                                                                                                                              | Nothing works. The back end also refuses to boot until `migrations/migrate_market_keys.py` has run on an old volume ([when the back end refuses to boot](../../OPERATIONS.md#when-the-back-end-refuses-to-boot)).                                                          |
| Resend (`RESEND_API_KEY`, `FROM_EMAIL`, `FRONTEND_URL`)                     | A1, A3, A4, H3                                                                    | `DISABLE_EMAIL=true`: nothing is sent                                                                                                                                                                                                                                                 | No verification, reset or code ever arrives.                                                                                                                                                                                                                               |
| Google reCAPTCHA v3 (`RECAPTCHA_SECRET_KEY` + `VITE_RECAPTCHA_SITE_KEY`)    | A1                                                                                | `DISABLE_CAPTCHA=true` plus a blank site key                                                                                                                                                                                                                                          | Deployed signup fails if the two keys are not a pair.                                                                                                                                                                                                                      |
| TypeSafe (`TYPESAFE_API_KEY`)                                               | G, sorting a CSV's columns                                                        | Unset; rules alone decide                                                                                                                                                                                                                                                             | Nothing: optional. Only column headings and the shape of their answers are sent, never an answer ([ADR 0007](../../adr/0007-what-may-be-sent-to-hosted-typesafe.md)).                                                                                                      |
| Discord (`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`) | The Tools tab's Discord card, and the Vendors page's Check Discord and Give roles | Unset; the card says Discord is not set up, and neither Check Discord nor Give roles is offered, unless `DISCORD_FAKE=true` (a worktree stack's default), under which a fake answers for Discord from the servers in the database ([a fake Discord](../../TESTING.md#a-fake-discord)) | Nothing: optional. Connecting needs a real server, `FRONTEND_URL=http://127.0.0.1:5173` (the address you sign in at), the OAuth2 redirect `http://127.0.0.1:5173/discord/connected` and "Requires OAuth2 Code Grant" on ([the Discord connection](../modules/discord.md)). |
| Google Sheets / Google Forms                                                | G and H2: the organizer's CSV export                                              | Fixtures below                                                                                                                                                                                                                                                                        | Nothing in the product; it is where real organizers get their file.                                                                                                                                                                                                        |
| Floorplan image or PDF                                                      | E6                                                                                | `front-end/e2e/fixtures/test-floorplan.png`                                                                                                                                                                                                                                           | Only the beta floorplan path. The wizard makes no AI calls and needs no keys.                                                                                                                                                                                              |

### Fixtures

| File                                                                                                                                                     | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Used in |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `back-end/tests/test_data/google_forms/five-day-grid.csv`, `team-status-column.csv`, `no-timestamp.csv`, `four-day-grid.csv`, `days-as-one-question.csv` | Five synthetic Google Form exports: `five-day-grid.csv` (237 rows, 30 columns, per-day tier grid, checkbox certifications), `team-status-column.csv` (250 rows, 35 columns, a team status column, four upload questions, a `TEST` row), `no-timestamp.csv` (237 rows, 28 columns, no timestamp column, two team columns first, a ceiling of 2 days), `four-day-grid.csv` (361 rows, 30 columns, a four-day grid, separate social columns, a ceiling of 3 days, two trailing empty columns), `days-as-one-question.csv` (294 rows, 12 columns, no tier grid, the days as one checkbox question); the [corpus README](../../../back-end/tests/test_data/README.md) describes each | G, H2   |
| `back-end/tests/test_data/example_columns.csv`                                                                                                           | Forty invented applications shaped to pin what a market started from a file keeps of it; the [corpus README](../../../back-end/tests/test_data/README.md#example_columnscsv) describes it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | F       |
| `front-end/e2e/fixtures/test-floorplan.png`                                                                                                              | 800x600 floor plan image                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | E6      |

## Coverage map

Each flow's specs are the "Covered by" lists under its steps, one test a line, sorted by file name, and a new spec is one line in the list of the step it walks ([two features never share a line](../conventions/two-features-never-share-a-line.md#a-flows-covered-by)); a few more are named in a flow's **Status:** lines.
The map keeps each flow and the gap worth a spec it still has.

| Flows                                                                                                                                                         | Gap worth a spec                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| [The lifecycle](../../business/flows/lifecycle.md)                                                                                                            | none noted                                            |
| [A Accounts](../../business/flows/accounts.md)                                                                                                                | A3's emailed code, which every spec stubs             |
| [B Organizations](../../business/flows/organizations.md)                                                                                                      | none noted                                            |
| [C Finding markets](../../business/flows/finding-a-market.md)                                                                                                 | none noted                                            |
| [D Creating](../../business/flows/creating-a-market.md)                                                                                                       | none noted                                            |
| [E Planning](../../business/flows/planning.md)                                                                                                                | E6 grouping as a real gesture                         |
| [F Form](../../business/flows/form-tab.md)                                                                                                                    | none noted                                            |
| [G Start from a Google Form](../../business/flows/starting-from-a-google-form.md)                                                                             | none noted (G5 then H2a runs on a synthetic export)   |
| [H Taking applications](../../business/flows/taking-applications.md)                                                                                          | none noted                                            |
| [H2 Import](../../business/flows/import.md)                                                                                                                   | none noted                                            |
| [H3 Applying online](../../business/flows/applying-online.md)                                                                                                 | none noted                                            |
| [I Reviewing](../../business/flows/review.md)                                                                                                                 | I1 verdicts by keyboard (A and R; S and N are walked) |
| [I7 and J1 to J5, J14](../../business/flows/assignment-and-result.md)                                                                                         | none noted                                            |
| [J6 to J10, J13, J19 Placing by hand](../../business/flows/placing-by-hand.md)                                                                                | none noted                                            |
| [J11, J12, J15, J16, J18, J20 Vendors](../../business/flows/vendors.md)                                                                                       | J16 and J18 against a real Discord server             |
| [The vendor drawer](../../business/flows/vendor-drawer.md)                                                                                                    | none noted                                            |
| [J17 Payments](../../business/flows/payments.md)                                                                                                              | none noted                                            |
| [K Publishing and market days](../../business/flows/market-day-door.md)                                                                                       | none noted                                            |
| [L Ending and managing](../../business/flows/ending-and-managing-a-market.md)                                                                                 | none noted                                            |
| [L6 Reading the market's history](../../business/flows/reading-the-markets-history.md)                                                                        | none noted                                            |
| [N1 to N7 Statistics](../../business/flows/stats.md)                                                                                                          | none noted                                            |
| Paths: [P1 and P2](../../business/flows/the-google-form-path.md), [P3](../../business/flows/the-online-path.md), [P4](../../business/flows/the-mixed-path.md) | **P1 and P2 whole, from creation to archive**         |

## Test data recipes

Seed through the API rather than the UI when a spec is about a later step; the helpers live in `front-end/e2e/helpers/`, and [E2E seeds](e2e-seeds.md#the-seed-helpers) says what each leaves behind.

| Need                                           | Use                                                                                                                                                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A verified organizer                           | `scripts/seed_fixture.sh` users, or `ensureVerifiedUser()` (`verifiedUser.ts`)                                                                                                                                                     |
| An organization for a market                   | `ensureTestOrg()` / `ensureTestOrgAuthenticated()` (`seeds.ts`)                                                                                                                                                                    |
| A draft market                                 | `seedDraftMarket.ts`                                                                                                                                                                                                               |
| A market in a given phase                      | `seedPhaseMarket.ts`                                                                                                                                                                                                               |
| A market with approved vendors                 | `seedMarketWithVendors()` (`seeds.ts`)                                                                                                                                                                                             |
| An assigned market                             | `seedAssignedMarket()` (`seedAssignedMarket.ts`)                                                                                                                                                                                   |
| A published market ready for check-in          | `seedPublishedMarketWithAssignments()` (`seeds.ts`); with `intakeMode: 'form'` it publishes the results first                                                                                                                      |
| An application written straight to Mongo       | `seedApplication()` (`seedApplication.ts`)                                                                                                                                                                                         |
| A form-intake market and a vendor sign-in code | `seedApplicantMarket()` (a `form` market in `applications`, with no application) and `createApplicantLoginChallenge()` (`seedApplicantMarket.ts`); plant the challenge after the UI requests a code, because a request replaces it |
| A market opened by URL                         | `marketSetupPath()` / `marketScreenPath()` (`marketScreens.ts`)                                                                                                                                                                    |

Any fixture whose market serves applicants must set `intakeMode: "form"`; without it the applicant endpoints answer 404.
An assignment can only be stored in the Assignment phase, so walk the market there before seeding one.
