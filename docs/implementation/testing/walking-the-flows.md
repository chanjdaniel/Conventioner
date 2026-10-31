---
layer: implementation
kind: testing
describes:
  - scripts/seed_fixture.sh
verified: 2026-11-01
sources:
  - E26
  - E41/F01/S01
  - E40/F02/S01
  - E38/F06/S01
  - T148
---

# Walking the flows

The flows ([`USER_FLOWS.md`](../../USER_FLOWS.md) indexes them) are written to be walked, two ways:

- **E2E testing:** each numbered step is a candidate assertion, and each flow's "Covered by" names the Playwright specs that already walk it; the [coverage map](#coverage-map) below lists the gaps.
- **User testing:** paths and flows open with a **Task** you can hand a participant without telling them where to click.

This node says what a walk needs: the stack, the accounts, the outside services, the fixtures, which specs walk which flows, and how to seed past the steps a test is not about.
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

| Dependency | Needed by | Local default | What breaks without it |
| --- | --- | --- | --- |
| MongoDB | Everything | Docker `mongodb` service | Nothing works. The back end also refuses to boot until `migrations/migrate_market_keys.py` has run on an old volume ([when the back end refuses to boot](../../OPERATIONS.md#when-the-back-end-refuses-to-boot)). |
| Resend (`RESEND_API_KEY`, `FROM_EMAIL`, `FRONTEND_URL`) | A1, A3, A4, H3 | `DISABLE_EMAIL=true`: nothing is sent | No verification, reset or code ever arrives. |
| Google reCAPTCHA v3 (`RECAPTCHA_SECRET_KEY` + `VITE_RECAPTCHA_SITE_KEY`) | A1 | `DISABLE_CAPTCHA=true` plus a blank site key | Deployed signup fails if the two keys are not a pair. |
| TypeSafe (`TYPESAFE_API_KEY`) | G, sorting a CSV's columns | Unset; rules alone decide | Nothing: optional. Only column headings and the shape of their answers are sent, never an answer ([ADR 0007](../../adr/0007-what-may-be-sent-to-hosted-typesafe.md)). |
| Discord (`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`) | The Tools tab's Discord card, and the Vendors page's Check Discord | Unset; the card says Discord is not set up, and Check Discord is not offered | Nothing: optional. Connecting needs a real server, `FRONTEND_URL=http://127.0.0.1:5173` (the address you sign in at), the OAuth2 redirect `http://127.0.0.1:5173/discord/connected` and "Requires OAuth2 Code Grant" on ([the Discord connection](../modules/discord.md)). |
| Google Sheets / Google Forms | G and H2: the organizer's CSV export | Fixtures below | Nothing in the product; it is where real organizers get their file. |
| Floorplan image or PDF | E6 | `front-end/e2e/fixtures/test-floorplan.png` | Only the beta floorplan path. The wizard makes no AI calls and needs no keys. |

### Fixtures

| File | What it is | Used in |
| --- | --- | --- |
| `back-end/tests/test_data/google_forms/five-day-grid.csv`, `team-status-column.csv`, `no-timestamp.csv`, `four-day-grid.csv`, `days-as-one-question.csv` | Five synthetic Google Form exports: `five-day-grid.csv` (237 rows, 30 columns, per-day tier grid, checkbox certifications), `team-status-column.csv` (250 rows, 35 columns, a team status column, four upload questions, a `TEST` row), `no-timestamp.csv` (237 rows, 28 columns, no timestamp column, two team columns first, a ceiling of 2 days), `four-day-grid.csv` (361 rows, 30 columns, a four-day grid, separate social columns, a ceiling of 3 days, two trailing empty columns), `days-as-one-question.csv` (294 rows, 12 columns, no tier grid, the days as one checkbox question); the [corpus README](../../../back-end/tests/test_data/README.md) describes each | G, H2 |
| `back-end/tests/test_data/example_columns.csv` | Forty invented applications shaped to pin what a market started from a file keeps of it; the [corpus README](../../../back-end/tests/test_data/README.md#example_columnscsv) describes it | F |
| `front-end/e2e/fixtures/test-floorplan.png` | 800x600 floor plan image | E6 |

## Coverage map

| Flows | Specs that walk them | Gap worth a spec |
| --- | --- | --- |
| [The lifecycle](../../business/flows/lifecycle.md) | `phase-rail.spec.ts`, `phase-state-machine.spec.ts`, `every-move-lands.spec.ts`, `a-blocked-step-offers-its-fix.spec.ts`, `what-to-show-and-when.spec.ts`, `market-remembers-phases.spec.ts`, `the-rail-addresses.spec.ts` | none noted |
| [A Accounts](../../business/flows/accounts.md) | `auth.spec.ts`, `smoke.spec.ts`, `account-links.spec.ts`, `a-signup-is-sent-once.spec.ts`, `the-way-in-lines-up.spec.ts`, `sign-in-fits-a-phone.spec.ts` | A3 organizer sign-in code, beyond a wrong code |
| [B Organizations](../../business/flows/organizations.md) | `tier2.spec.ts`, `dialog-idiom.spec.ts`, `access-control.spec.ts`, `org-deletion.spec.ts`, `the-organizations-history.spec.ts`, `the-organizations-default.spec.ts`, `organizations-fit-a-phone.spec.ts`, `everyone-with-access.spec.ts` | none noted |
| [C Finding markets](../../business/flows/finding-a-market.md) | `dashboard-market-count.spec.ts`, `finding-a-market.spec.ts`, `every-market-page-has-an-address.spec.ts`, `one-market-from-the-server.spec.ts`, `the-frame-stays-put.spec.ts`, `sign-in-fits-a-phone.spec.ts` | none noted |
| [D Creating](../../business/flows/creating-a-market.md) | `new-market-org.spec.ts`, `dialog-idiom.spec.ts`, `public-address.spec.ts`, `where-a-form-starts.spec.ts`, `market-owner.spec.ts` | none noted |
| [E Planning](../../business/flows/planning.md) | `market-dates-by-month.spec.ts`, `date-display-timezone.spec.ts`, `plan-cards-share-a-row.spec.ts`, `plan-saves-once.spec.ts`, `untiered-plans-assign.spec.ts`, `intake-mode.spec.ts`, `floorplan.spec.ts`, `the-floorplan-beta-places-tables.spec.ts`, `price-groups.spec.ts`, `what-to-show-and-when.spec.ts`, `the-words-say-what-is-true.spec.ts`, `alignment.spec.ts`, `the-pricing-card.spec.ts` | E6 grouping as a real gesture |
| [F Form](../../business/flows/form-tab.md) | `application-form.spec.ts`, `essential-fields.spec.ts`, `ask-this-stays-off.spec.ts`, `section-preference.spec.ts`, `review-highlights.spec.ts`, `automatic-rejections.spec.ts`, `the-questions-come-from-the-file.spec.ts`, `every-move-lands.spec.ts` | none noted |
| [G Start from a Google Form](../../business/flows/starting-from-a-google-form.md) | `start-from-csv.spec.ts`, `where-a-form-starts.spec.ts` | none noted (G5 then H2a runs on a synthetic export) |
| [H Taking applications](../../business/flows/taking-applications.md) | `phase-state-machine.spec.ts`, `phase-rail.spec.ts`, `every-move-lands.spec.ts`, `taking-applications-stops-and-resumes.spec.ts`, `vendors-see-their-application-after-close.spec.ts`, `market-journey.spec.ts` | none noted |
| [H2 Import](../../business/flows/import.md) | `csv-import.spec.ts`, `form-amendment.spec.ts`, `a-late-export.spec.ts`, `the-import-lines-up.spec.ts`, `market-journey.spec.ts` | none noted |
| [H3 Applying online](../../business/flows/applying-online.md) | `applicant.spec.ts`, `a-first-time-vendor-applies.spec.ts`, `returning-vendors-edit-their-answers.spec.ts`, `vendors-see-their-application-after-close.spec.ts`, `intake-mode.spec.ts`, `essential-fields.spec.ts` | none noted |
| [I Reviewing](../../business/flows/review.md) | `market-journey.spec.ts`, `review-highlights.spec.ts`, `needs-a-follow-up.spec.ts`, `a-verdict-says-who.spec.ts`, `reviewers-do-not-collide.spec.ts`, `a-reviewer-holds-what-they-look-at.spec.ts`, `the-all-view.spec.ts`, `exporting-from-the-applications-tab.spec.ts`, `automatic-rejections.spec.ts`, `phase-state-machine.spec.ts`, `result-and-review-read-cleanly.spec.ts`, `the-list-says-when-it-was-read.spec.ts`, `changing-a-verdict-is-its-own-row.spec.ts`, `choosing-reviewers-deals-the-open-applications.spec.ts`, `each-arrival-is-dealt.spec.ts`, `removing-a-reviewer.spec.ts` | I1 verdicts by keyboard (A and R; S and N are walked) |
| [I7 and J1 to J5, J14](../../business/flows/assignment-and-result.md) | `market-pipeline.spec.ts`, `the-assignment-tabs-pages.spec.ts`, `assignment-options.spec.ts`, `the-result-page.spec.ts`, `tables.spec.ts`, `a-search-on-the-results.spec.ts`, `a-refused-run-says-who-and-where.spec.ts`, `the-result-knows-what-it-was-made-from.spec.ts`, `the-assignment-rules-close.spec.ts`, `results-wait-for-the-allocation.spec.ts` | none noted |
| [J6 to J10, J13 Placing by hand](../../business/flows/placing-by-hand.md) | `placement-edit.spec.ts`, `override-warnings.spec.ts`, `placing-someone-not-approved.spec.ts`, `placement-pins.spec.ts`, `adding-a-vendor.spec.ts`, `a-searchable-vendor-picker.spec.ts`, `orphaned-pin-in-assignment.spec.ts`, `the-placement-history-dialog.spec.ts`, `the-vendors-history.spec.ts` | none noted |
| [J11, J12, J15, J16 Vendors](../../business/flows/vendors.md) | `vendors.spec.ts`, `vendors-and-limits.spec.ts`, `placing-someone-not-approved.spec.ts`, `adding-a-vendor.spec.ts`, `an-added-vendor-is-unassigned.spec.ts`, `exporting-vendors.spec.ts`, `exporting-placements-by-date.spec.ts`, `who-is-in-the-discord-server.spec.ts` | J16 against a real Discord server |
| [The vendor drawer](../../business/flows/vendor-drawer.md) | `the-vendor-drawer.spec.ts`, `the-vendors-history.spec.ts`, `the-payment-tab.spec.ts`, `changing-owed-and-paid.spec.ts`, `a-seat-and-an-entry-open-the-drawer.spec.ts`, `change-placement-shows-the-table.spec.ts`, `vendor-notes.spec.ts`, `updating-vendor-info.spec.ts`, `updating-answers-the-assignment-reads.spec.ts` | none noted |
| [K Publishing and market days](../../business/flows/market-day-door.md) | `phase-rail.spec.ts`, `checkin.spec.ts`, `the-door-on-market-day.spec.ts`, `the-door-keeps-its-own-day.spec.ts`, `alignment.spec.ts` | none noted |
| [L Ending and managing](../../business/flows/ending-and-managing-a-market.md) | `phase-state-machine.spec.ts`, `an-archive-is-read-only.spec.ts`, `an-archive-keeps-its-check-in-page.spec.ts`, `tier2.spec.ts`, `access-control.spec.ts`, `the-manage-market-dialog-holds-together.spec.ts`, `the-permissions-section.spec.ts`, `the-organizations-default.spec.ts`, `public-address.spec.ts`, `org-deletion.spec.ts`, `market-records-go-with-it.spec.ts`, `everyone-with-access.spec.ts` | none noted |
| [L6 Reading the market's history](../../business/flows/reading-the-markets-history.md) | `the-markets-history.spec.ts`, `the-vendors-history.spec.ts`, `a-verdict-names-whom-it-was-dealt-to.spec.ts` | none noted |
| Paths: [P1 and P2](../../business/flows/the-google-form-path.md), [P3](../../business/flows/the-online-path.md), [P4](../../business/flows/the-mixed-path.md) | `market-journey.spec.ts` walks P1 from creation to the result; `start-from-csv.spec.ts` walks P2's seam from the confirm to the first import; `what-to-show-and-when.spec.ts` holds P4 refused | **P1 and P2 whole, from creation to archive** |


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
| A form-intake market and a vendor sign-in code | `seedApplicantMarket()` (a `form` market in `applications`, with no application) and `createApplicantLoginChallenge()` (`seedApplicantMarket.ts`); plant the challenge after the UI requests a code, because a request replaces it |
| A market opened by URL | `marketSetupPath()` / `marketScreenPath()` (`marketScreens.ts`) |

Any fixture whose market serves applicants must set `intakeMode: "form"`; without it the applicant endpoints answer 404.
An assignment can only be stored in the Assignment phase, so walk the market there before seeding one.
