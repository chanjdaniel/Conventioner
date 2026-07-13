# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.

## Branch Model

- `dev` is the default/integration branch: all feature PRs target `dev`.
- `main` is the deploy-only branch: it auto-deploys, and is reached ONLY by promoting `dev` → `main` as a deliberate, versioned release.
- Never commit directly to `main`. Never open PRs targeting `main` (except the release-please Release PR, which is automated).

## Release Process

- Release management uses [release-please](https://github.com/googleapis/release-please) (GitHub Action `googleapis/release-please-action@v5`).
- Release type is `simple` (conventional-commits-driven; no per-language package file parsing).
- Workflow triggers on push to `main` (`.github/workflows/release-please.yml`).
- When `dev` is promoted to `main`, release-please opens a Release PR with version bump + CHANGELOG.
- Merging the Release PR creates a git tag (e.g., `v0.1.0`) and a GitHub Release.
- All commits MUST follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, etc.).
- Baseline seed: `0.0.0` in `.release-please-manifest.json`; the first release is pinned to `v0.1.0` via `release-as: 0.1.0` in `release-please-config.json`. Remove that `release-as` field after `v0.1.0` ships, after which versions follow conventional commits (`feat:` → minor, `fix:` → patch, breaking → major).
- Full release docs: `docs/RELEASING.md`.

## Tech Stack

- Front-end: Vue 3 + Vite + TypeScript (in `front-end/`), PrimeVue UI components, Pinia state management.
- Back-end: Python 3.11 / Flask + MongoDB (in `back-end/`).
- Testing: Vitest (unit) + Playwright (e2e) for front-end; pytest for back-end.
- CI: `.github/workflows/test.yml` runs on `dev` and `main` for both PRs and pushes.

## E2E Testing Patterns

- **data-testid convention**: `viewname-element` (e.g. `login-email-input`, `markets-create-button`).
  No product behavior changes - purely additive test infrastructure.
- **Page Object Model**: Located under `front-end/e2e/pages/`.
  Each page object wraps Playwright `getByTestId()` selectors and exposes action methods.
  New pages should follow the existing `LoginPage`, `NewMarketPage`, `MarketSetupPage`,
  `AssignmentResultsPage`, `OrganizationsPage`, `ManageMarketPage` patterns.
- **Fixtures**: `front-end/e2e/fixtures.ts` provides `TEST_USER`, `authenticatedPage`,
  re-exports page objects for convenience, and exposes `BACKEND_URL`
  (via `detectBackendPort()`) for direct API calls.
- **API-level seeding**: `front-end/e2e/helpers/seeds.ts` exports `seedMarketWithVendors()`
  which creates markets and uploads vendor CSV via the back-end API.
  `front-end/e2e/helpers/seedAssignedMarket.ts` exports `seedAssignedMarket()`, which
  also configures the market `setupObject` and triggers assignment via the API.
  Requires a verified test user (created by `scripts/seed_fixture.sh`).
- **Markets require an organization**: `POST /markets` rejects a payload with no
  `organizationId`, an unknown organization, or an organization the caller is not a
  member of (400 each).
  Anything that creates a market must therefore attach one: `seeds.ts` exports
  `ensureTestOrgAuthenticated()` (already-logged-in request context) and
  `ensureTestOrg()` (logs in first), both of which reuse the user's first organization
  or create `E2E Test Org`, and the seed helpers return it as `orgId`.
  Specs that create a market through the UI must call `ensureTestOrg()` in `beforeAll`,
  otherwise the overlay's org dropdown is empty and submit stays disabled.
- **Test user creation**: The back-end `/register-user` endpoint does NOT set `email_verified`,
  so users created through it cannot log in.
  Test users must be created via `back-end/create_test_user.py` which sets `email_verified=True`.
  `scripts/seed_fixture.sh` creates two verified users: `TEST_EMAIL` (owns `Seed Test Org`)
  and `NO_ORG_EMAIL` (`e2e-noorg@example.com`), which is deliberately left in no organization
  so `new-market-org.spec.ts` can exercise the zero-org fallback.
- **Run E2E**: `./scripts/seed_fixture.sh` then `cd front-end && npm run test:e2e`.
  Playwright config auto-detects worktree port via `detectFrontendPort()`.

### Floorplan Workflow E2E

- **Deterministic - no AI mocking needed.** Despite the "Floorplan AI" name,
  the front-end wizard makes no LLM/vision calls. Table auto-placement
  (`POST /floorplans/place-tables`, `back-end/services/placement_service.py`)
  is a pure geometry solver (Shapely + `pyckingsolver`). The
  Gemini/GPT vision endpoint (`POST /floorplans/analyze`,
  `back-end/api/floorplans_analysis.py`) exists but is not wired into the
  front-end workflow (walls are drawn by hand). Consequence: the flow can be
  exercised end-to-end for real in CI with no API keys and no stubbing.
- **Konva canvas interactions and coverage gap.** The wizard's three canvas
  steps have different testability:
  - Calibration line drawing IS drivable with real Playwright `page.mouse`
    drags on the Konva stage (see `FloorplanWorkflowPage.drawCalibrationLine()`).
  - Section-grouping (Konva "lasso" selection) and the `FloorplanEditor` step
    are NOT reliably drivable via simulated mouse events.
    `floorplan.spec.ts` drives Pinia store state directly via `page.evaluate`
    for those steps (`groupAllTablesIntoSection()`), and uses
    `snapshotPlacedTables()` to assert table state persists across wizard steps.
  - **Coverage gap**: section grouping and editor canvas interactions are
    validated at the state level, not as real user gestures. Anyone extending
    floorplan coverage should account for this.
- **Artifacts** (PR #18 pattern to follow):
  - Page object: `front-end/e2e/pages/FloorplanWorkflowPage.ts`
  - Spec: `front-end/e2e/floorplan.spec.ts`
  - Fixture: `front-end/e2e/fixtures/test-floorplan.png` (800×600 PNG)
- **Save-path null-tolerance**: `POST /floorplans/save-to-market`
  (`back-end/api/floorplans_save.py`) handles a null `setupObject` on the
  market doc (the manual-setup path leaves it null). The fix uses
  `isinstance(existing_setup, dict)` to branch between updating the existing
  object and seeding a fresh one.
- **Editor-mount table preservation**: `FloorplanEditor.vue`'s
  `loadBackgroundImage()` only calls `store.initFloorplan()` when no floorplan
  exists yet, spreading the existing store data (`placedTables`, `tableTypes`,
  `sections`, `walls`, `obstacles`, scale) into the init so forward wizard
  progression keeps auto-placed tables; when a floorplan already exists it just
  refreshes the background image fields. This replaced an earlier
  snapshot/restore workaround in the e2e page object.

## E2E Seed Helpers for Published Markets

- `seedPublishedMarketWithAssignments()` in `front-end/e2e/helpers/seeds.ts` creates a fully
  published market with vendor assignments ready for check-in, vendor browsing, and table filtering tests.
- The back-end assignment algorithm (`assign_market`) requires `enum_priority_order` to have one
  entry (empty list) per column in `col_names`. Omitting this causes an `IndexError`.
- After publishing (`isDraft: false`) with a configured `setup_object`, you must fetch the
  computed assignment via `GET /markets/{id}/assignment` and store it back via PUT.
  The stored `assignmentObject.vendorAssignments` is what `record_attendance` reads at check-in time.

## CSV Field Runtime Coupling (Conventioner sharp edge)

- `col_name` and `col_name_idx` on `MarketDateObject` (in `back-end/datatypes.py`) are
  used at runtime in two places that CANNOT be removed until Phase 5 of Conventioner:
  - `back-end/api/attendance.py:67-75` - `record_attendance()` builds date aliases from
    `md.get("col_name")`. Without it, public check-in for existing markets breaks.
  - `back-end/assignment/assignment.py:53` - `_calculate_date_flexibility()` resolves
    dates via `market_date.col_name`. Without it, the solver fails for existing markets.
- These fields are kept Optional with `None` defaults on the Pydantic models during
  Phases 1-4. New application-based markets leave them `None`. Existing CSV-backed
  markets retain their values.
- The same backward-compat strategy applies to the other CSV-derived fields on
  `SetupObject`, `PriorityObject`, and `AssignmentOptionObject`: keep them Optional,
  remove them in Phase 5 when the solver adapter and attendance redesign land.
- Do NOT delete `is_draft` from the `Market` model. Existing code reads it. The new
  `phase` field is added alongside it; code migrates to `phase` checks gradually.

## Application Form Lock (Conventioner sharp edge)

- **Applications are stored snake_case**, unlike markets and organizations, which are
  camelCased on write. The market foreign key is `market_id`, NOT `marketId`.
  `back-end/api/applications.py` is the single owner of the collection and every reader and
  writer must go through it. A writer that stored the market reference under any other key
  would silently disable the D9 lock below - the count would just return 0.
- **The D9 lock has one source of truth**: `application_form_lock_reason()` in
  `back-end/api/markets.py`. A market's application form is editable only in `draft` phase
  and only while no application exists for it; once an applicant has submitted, the form is
  frozen for good.
- **`Market.application_form` is server-owned on update.** `PUT /markets/<id>/application-form`
  is its only writer on an existing market; `update_market()` re-applies the stored form over
  whatever a market PUT body carried. Do not "fix" that by letting a market PUT write the form
  - it is what makes the lock unbypassable. `POST /markets` may carry a form, and it runs
  through the same validator.
- E2E reaches the locked state with `seedApplication()`
  (`front-end/e2e/helpers/seedApplication.ts`), which writes the document straight into Mongo
  via `mongosh`, because no applicant-facing submit endpoint exists yet.

## Market Document Keys (Conventioner sharp edge)

- **The back end refuses to boot** unless `migrations/migrate_market_keys.py` has recorded its
  marker in the `schema_migrations` collection. A dev Mongo volume created before the migration
  existed has no marker, so an existing stack hits this on first pull. The fix is the migration
  itself: `docker compose run --rm backend python migrations/migrate_market_keys.py`
  (`run`, not `exec` - the back end is crash-looping). Do not "fix" it by softening the check:
  it fails closed because an unmigrated market is invisible, not broken.
- **Market documents are stored camelCase, and that is the only spelling reads may name.**
  Every write camel-cases the whole document, so a hand-written filter on `organization_id`
  matches nothing. Anything touching a raw document or a Mongo filter goes through
  `back-end/market_documents.py` (`market_doc_field`/`market_doc_filter`/`market_doc_set`/
  `market_from_document`). Do not add a read-time fallback that accepts both spellings: writes
  only refresh the camelCase key, so a legacy key holds a value that is stale forever.
- **Parse stored markets with `market_from_document()`**, never `Market(**snake_dict)`.
  `Market.phase` defaults to `draft`, so a raw parse silently mislabels every market written
  before the field existed. `phase_from_market_document()` (`back-end/datatypes.py`) is the one
  source of truth for that mapping, and `MarketsApi.load_market_context()` is the shared
  market + organization + permission load every endpoint should use.

## Phase Transitions (Conventioner sharp edge)

- **Every precondition for every phase transition lives in `back-end/guards.py`.** Adding or
  removing one is a one-file edit: the `POST /markets/<id>/transition` endpoint and the
  front-end `BlockerPanel.vue` are generic over the `PreconditionResult` wire shape and must
  stay that way. `_validate_registry()` runs at import and refuses to load tables that disagree,
  so a misspelled phase or a dropped entry invariant is a startup error, not a silent no-op.
- `Market.phase` is server-owned: `create_market()` stamps `draft`, `update_market()` re-applies
  the stored phase, and the transition endpoint is the only writer on an existing market.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
