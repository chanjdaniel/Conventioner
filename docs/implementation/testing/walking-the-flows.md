---
layer: implementation
kind: testing
describes:
  - scripts/seed_fixture.sh
verified: 2026-10-22
sources:
  - E26
---

# Walking the flows

The flows ([`USER_FLOWS.md`](../../USER_FLOWS.md) indexes them) are written to be walked, two ways:

- **E2E testing:** each numbered step is a candidate assertion, and each flow's "Covered by" names the Playwright specs that already walk it; the [coverage map](#coverage-map) below lists the gaps.
- **User testing:** paths and flows open with a **Task** you can hand a participant without telling them where to click.

This node says what a walk needs: the stack, the accounts, the outside services, the fixtures, which specs walk which flows, and how to seed past the steps a test is not about.
How to run the suites is [`TESTING.md`](../../TESTING.md); the seed helpers are [E2E seeds](e2e-seeds.md).

## Environment, accounts and external dependencies

### Local stack

1. Bring the stack up with `DISABLE_EMAIL=true scripts/th-compose.sh up -d` from a treehouse worktree, or `DISABLE_EMAIL=true docker compose up -d` from the primary checkout.
2. Run [`./scripts/seed_fixture.sh`](../../../scripts/seed_fixture.sh).
   It creates two verified organizers, `e2e@example.com` / `e2epassword123` (owns `Seed Test Org`) and `e2e-noorg@example.com` / `e2enoorg123` (in no organization), plus one draft market.
3. Open the front end printed by the script (5173 on the primary stack, `5173 + slot*10` in a worktree) and sign in.

On a freshly built front-end container, the first visit to each lazily loaded page can render blank for a few seconds while Vite optimizes dependencies and reloads.
This is a dev-server effect, not a product bug; wait and retry before filing it.

### Accounts

- An account made through the Register tab cannot sign in locally: registration sends a verification email, and with `DISABLE_EMAIL=true` nothing is sent.
  Make local organizers with `back-end/create_test_user.py` (which sets `email_verified`), or `ensureVerifiedUser()` in a spec ([E2E seeds](e2e-seeds.md#users)).
- Sign-in codes (the organizer's "Sign-in code" tab, a vendor's applicant sign-in) and password-reset links are also email-only.
  Locally they need either a real Resend key or a database seed (see [Test data recipes](#test-data-recipes)).

### External services

| Dependency | Needed by | Local default | What breaks without it |
| --- | --- | --- | --- |
| MongoDB | Everything | Docker `mongodb` service | Nothing works. The back end also refuses to boot until `migrations/migrate_market_keys.py` has run on an old volume ([when the back end refuses to boot](../../OPERATIONS.md#when-the-back-end-refuses-to-boot)). |
| Resend (`RESEND_API_KEY`, `FROM_EMAIL`, `FRONTEND_URL`) | A1, A3, A4, H3 | `DISABLE_EMAIL=true`: nothing is sent | No verification, reset or code ever arrives. |
| Google reCAPTCHA v3 (`RECAPTCHA_SECRET_KEY` + `VITE_RECAPTCHA_SITE_KEY`) | A1 | `DISABLE_CAPTCHA=true` plus a blank site key | Deployed signup fails if the two keys are not a pair. |
| TypeSafe (`TYPESAFE_API_KEY`) | G, sorting a CSV's columns | Unset; rules alone decide | Nothing: optional. Only column headings and the shape of their answers are sent, never an answer ([ADR 0007](../../adr/0007-what-may-be-sent-to-hosted-typesafe.md)). |
| Google Sheets / Google Forms | G and H2: the organizer's CSV export | Fixtures below | Nothing in the product; it is where real organizers get their file. |
| Floorplan image or PDF | E6 | `front-end/e2e/fixtures/test-floorplan.png` | Only the beta floorplan path. The wizard makes no AI calls and needs no keys. |

### Fixtures

| File | What it is | Used in |
| --- | --- | --- |
| `back-end/tests/test_data/google_forms/fall-2023.csv`, `spring-2024.csv`, `spring-2025.csv`, `fall-2025.csv`, `spring-2026.csv` | Five anonymised real Google Form exports (237 rows in `fall-2025.csv`, 30 columns, per-day tier grid, checkbox certifications); the [corpus README](../../../back-end/tests/test_data/README.md) describes each | G, H2 |
| `back-end/tests/test_data/google_forms_export.csv` | An older Google Form export, 232 applications | H2 |
| `.scratch/examples/markets/*.csv` in the primary checkout | Five real exports (2023 to 2026), untracked, with real applicants' details; never commit or quote them | G, H2, user testing |
| `front-end/e2e/fixtures/test-floorplan.png` | 800x600 floor plan image | E6 |

## Coverage map

| Flows | Specs that walk them | Gap worth a spec |
| --- | --- | --- |
| [The lifecycle](../../business/flows/lifecycle.md) | `phase-rail.spec.ts`, `phase-state-machine.spec.ts`, `every-move-lands.spec.ts`, `a-blocked-step-offers-its-fix.spec.ts`, `what-to-show-and-when.spec.ts`, `market-remembers-phases.spec.ts`, `the-rail-addresses.spec.ts` | none noted |
| [A Accounts](../../business/flows/accounts.md) | `auth.spec.ts`, `smoke.spec.ts`, `account-links.spec.ts`, `a-signup-is-sent-once.spec.ts`, `the-way-in-lines-up.spec.ts` | A3 organizer sign-in code, beyond a wrong code |
| [B Organizations](../../business/flows/organizations.md) | `tier2.spec.ts`, `dialog-idiom.spec.ts`, `access-control.spec.ts`, `org-deletion.spec.ts` | none noted |
| [C Finding markets](../../business/flows/finding-a-market.md) | `dashboard-market-count.spec.ts`, `finding-a-market.spec.ts`, `every-market-page-has-an-address.spec.ts`, `one-market-from-the-server.spec.ts`, `the-frame-stays-put.spec.ts` | none noted |
| [D Creating](../../business/flows/creating-a-market.md) | `new-market-org.spec.ts`, `dialog-idiom.spec.ts`, `public-address.spec.ts`, `where-a-form-starts.spec.ts`, `market-owner.spec.ts` | none noted |
| [E Planning](../../business/flows/planning.md) | `market-dates-by-month.spec.ts`, `date-display-timezone.spec.ts`, `plan-cards-share-a-row.spec.ts`, `plan-saves-once.spec.ts`, `untiered-plans-assign.spec.ts`, `intake-mode.spec.ts`, `floorplan.spec.ts`, `the-floorplan-beta-places-tables.spec.ts`, `what-to-show-and-when.spec.ts`, `the-words-say-what-is-true.spec.ts` | E6 grouping as a real gesture |
| [F Form](../../business/flows/form-tab.md) | `application-form.spec.ts`, `essential-fields.spec.ts`, `ask-this-stays-off.spec.ts`, `section-preference.spec.ts`, `review-highlights.spec.ts`, `automatic-rejections.spec.ts`, `every-move-lands.spec.ts` | none noted |
| [G Start from a Google Form](../../business/flows/starting-from-a-google-form.md) | `start-from-csv.spec.ts`, `where-a-form-starts.spec.ts` | none noted (G5 then H2a runs on an anonymised export) |
| H2 Import | `csv-import.spec.ts`, `form-amendment.spec.ts`, `market-journey.spec.ts` | none noted |
| H3 Online applications | `applicant.spec.ts`, `intake-mode.spec.ts`, `essential-fields.spec.ts` | none noted |
| I Reviewing | `market-journey.spec.ts`, `review-highlights.spec.ts`, `phase-state-machine.spec.ts`, `result-and-review-read-cleanly.spec.ts` | I1 keyboard review |
| J Assigning | `market-pipeline.spec.ts`, `the-result-page.spec.ts`, `tables.spec.ts`, `placement-edit.spec.ts`, `placement-pins.spec.ts`, `vendors.spec.ts`, `the-assignment-rules-close.spec.ts` | none noted |
| K Publishing and market days | `phase-rail.spec.ts`, `checkin.spec.ts`, `alignment.spec.ts` | none noted |
| L Ending | `phase-state-machine.spec.ts`, `tier2.spec.ts`, `org-deletion.spec.ts`, `market-records-go-with-it.spec.ts` | none noted |
| Paths: [P1 and P2](../../business/flows/the-google-form-path.md), [P3](../../business/flows/the-online-path.md), [P4](../../business/flows/the-mixed-path.md) | `market-journey.spec.ts` walks P1 from creation to the result; `start-from-csv.spec.ts` walks P2's seam from the confirm to the first import; `what-to-show-and-when.spec.ts` holds P4 refused | **P1 and P2 whole, from creation to archive** |

The rows for H to L are the groups still in `USER_FLOWS.md`.

## Test data recipes

Seed through the API rather than the UI when a spec is about a later step; the helpers live in `front-end/e2e/helpers/`, and [E2E seeds](e2e-seeds.md#the-seed-helpers) says what each leaves behind.

| Need | Use |
| --- | --- |
| A verified organizer | `scripts/seed_fixture.sh` users, or `ensureVerifiedUser()` (`verifiedUser.ts`) |
| An organization for a market | `ensureTestOrg()` / `ensureTestOrgAuthenticated()` (`seeds.ts`) |
| A draft market | `seedDraftMarket.ts` |
| A market in a given phase | `seedPhaseMarket.ts` |
| A market with approved vendors | `seedMarketWithVendors()` (`seeds.ts`) |
| An assigned market | `seedAssignedMarket()` (`seedAssignedMarket.ts`) |
| A published market ready for check-in | `seedPublishedMarketWithAssignments()` (`seeds.ts`); with `intakeMode: 'form'` it publishes the results first |
| An application written straight to Mongo | `seedApplication()` (`seedApplication.ts`) |
| A form-intake market and a vendor sign-in code | `seedApplicantMarket()` (a `form` market in `applications_open`, with no application) and `createApplicantLoginChallenge()` (`seedApplicantMarket.ts`); plant the challenge after the UI requests a code, because a request replaces it |
| A market opened by URL | `marketSetupPath()` / `marketScreenPath()` (`marketScreens.ts`) |

Any fixture whose market serves applicants must set `intakeMode: "form"`; without it the applicant endpoints answer 404.
An assignment can only be stored in the Assignment phase, so walk the market there before seeding one.
