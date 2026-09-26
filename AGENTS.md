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
- `v0.1.0` shipped on 2026-09-13; `.release-please-manifest.json` tracks the current version. Versions are derived from conventional commits (`feat:` → minor, `fix:` → patch, breaking → major). The one-time `release-as: 0.1.0` bootstrap that forced the first version has been removed - do not reintroduce it, since `release-as` overrides the calculation on *every* run until cleared.
- Full release docs: `docs/RELEASING.md`.

## Tech Stack

- Front-end: Vue 3 + Vite + TypeScript (in `front-end/`), PrimeVue UI components, Pinia state management.
- Back-end: Python 3.11 / Flask + MongoDB (in `back-end/`).
- Testing: Vitest (unit) + Playwright (e2e) for front-end; pytest for back-end.
- CI: `.github/workflows/test.yml` runs on `dev` and `main` for both PRs and pushes.
- Front-end formatting is Prettier-enforced: config in `front-end/.prettierrc.json`
  (semi:true, singleQuote:true, printWidth:100, trailingComma:all), `npm run format`
  to fix and `npm run format:check` to verify. CI runs `format:check` in the
  `frontend-lint-and-types` job, so unformatted front-end code fails the build; run
  `npm run format` before committing. The one-time reformat commit is listed in
  `.git-blame-ignore-revs`.

## E2E Testing Patterns

- **data-testid convention**: `viewname-element` (e.g. `login-email-input`, `markets-create-button`).
  No product behavior changes - purely additive test infrastructure.
- **Page Object Model**: Located under `front-end/e2e/pages/`.
  Each page object wraps Playwright `getByTestId()` selectors and exposes action methods.
  New pages should follow the existing `LoginPage`, `NewMarketPage`, `MarketSetupPage`,
  `AssignmentResultsPage`, `OrganizationsPage`, `ManageMarketPage` patterns.
- **Fixtures**: `front-end/e2e/fixtures.ts` provides `TEST_USER`, `authenticatedPage`,
  re-exports page objects for convenience, and exposes `BACKEND_URL`
  (derived from `stack().backendURL`) for direct API calls.
- **API-level seeding**: `front-end/e2e/helpers/seeds.ts` exports `seedMarketWithVendors()`
  which creates markets through the application-based path (organization -> market ->
  application form finalization -> source data upload) via the back-end API.
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
  A spec needing users beyond those two calls `ensureVerifiedUser()`
  (`front-end/e2e/helpers/verifiedUser.ts`) in `beforeAll`, which runs that same script inside
  the back-end container; do not hand-roll the user document, and do not switch to
  `/register-user`.
- **One spec walks the whole journey; the rest are slices.** `market-journey.spec.ts` is the only
  one that goes create -> plan -> open -> import -> **approve** -> assign in a single organizer
  session through the UI, and the only one that clicks Approve at all. Every other spec seeds past
  some part of it: the pipeline spec seeds applications already approved, the import spec seeds the
  market over the API and stops at "awaiting review". Before adding a test, decide which of those
  you are extending - and if the answer is "the seam between two of them", it belongs in the
  journey spec.
- **Open a market by URL**, the way a bookmark would: `e2e/helpers/marketScreens.ts`
  (`marketSetupPath`, `marketScreenPath`). Specs no longer plant a market in `localStorage`.
- **Run E2E**: `./scripts/seed_fixture.sh` then `cd front-end && npm run test:e2e`.
  Playwright config auto-detects worktree port via `stack().frontendPort`.
  Bring the stack up with `DISABLE_EMAIL=true scripts/th-compose.sh up -d` (compose passes it
  through from the host shell; CI and `nm-test.sh` set it) - without it the password-reset
  E2E 500s on the missing `RESEND_API_KEY`.
- **Market dates are calendar days, not instants**: a stored `YYYY-MM-DD` market date must
  render as the same day for every viewer regardless of timezone. `getFormattedDate`
  (`front-end/src/utils/utils.ts`) formats with pure UTC math; never parse a market date
  through `new Date()` with an offset. `front-end/e2e/date-display-timezone.spec.ts` pins
  this across Honolulu/LA/Tokyo via Playwright `timezoneId`.

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
- Publishing is `POST /markets/{id}/transition` - `isDraft` is derived from `phase`, and no
  request body can set either.
- **An assignment is stored by `POST /markets/{id}/assignment`, and by nothing else.**
  That one call runs the solver and persists what it produced.
  It used to be `GET /markets/{id}/assignment` (which only computes) followed by a whole-market PUT carrying the result. `assignmentObject` is what `record_attendance` reads at check-in time, so a stale client copy overwriting it moved vendors on market day (E11/F01/S01); the whole-market PUT is gone now (E21/F03/S06).
  `back-end/api/placements.py` is the single writer - a solver run, or `PUT /markets/{id}/placements` for one vendor in one seat on one date, both gated on `MarketRole.EDITOR`.
  Run the assignment *before* publishing: `market_days` has an entry invariant that one exists.

## One Market, From the Server (Conventioner sharp edge)

- **The back end is the only source of truth about a market, and the browser holds it in ONE
  place:** `front-end/src/stores/market.ts`. Every market screen, the rail and every tab read it;
  screens get it through `useOpenMarket` (`front-end/src/utils/openMarket.ts`). Settled in
  `.scratch/wayfinding/the-market-frame/issues/03-one-market-every-surface-reads.md`.
- **Every market screen is addressed by id**: `/markets/:marketId/{setup,vendors,import,floorplan,
  tables,attendance}`, built with `marketPath()`. The id-less paths redirect to `/markets`.
- **A write is followed by a re-read, never a patch.** After anything that changes the market
  (a transition - the rail does it - a form save, an assignment run, a placement, an import, a
  highlight) call the store's `refresh()`. Do not assign into the held market: no caller should
  need to know which fields its write touched.
- **Each write names what it changes; there is no whole-market PUT** (E21/F03/S06). The plan is
  `PUT /markets/:id/plan`, the name `PUT /markets/:id/name` (draft only - the name is the public
  address), the form, placements, highlights and transitions have their own. A market's
  organization is fixed at creation, and no two markets share a slug (unique `market_slug` index).
- **Unsaved work is the editor's working copy**, never layered on the store (the plan's
  `setupObject`/`planIntakeMode`, the form builder's form). A re-read never overwrites a working
  copy that holds unsaved edits.
- **Nothing about a market is stored in the browser.** `localStorage` `market` is gone and
  `noMarketInTheBrowser.test.ts` fails if it returns; the dashboard keeps only a `lastMarketId`
  pointer (`utils/lastMarket.ts`), set by the store when a market arrives.
- **`parseMarketFromApi` must carry every field the server sends.** It once rebuilt `setupObject`
  from a fixed key list and dropped `floorplans`; once screens read the parsed market, the plan's
  autosave erased the floorplan. Spread what you do not name.
- **Facts derived from the market are served on it**, not fetched per tab: the form lock is
  `applicationFormLockReason` on `GET /markets/:id`. A tab that fetches a fact for itself and
  publishes it to siblings is how the form builder and the priority rules went stale.

## The Phase Rail (Conventioner sharp edge)

- **`PhaseRail.vue` is the market lifecycle, on every market screen**, as a band below that
  screen's header. It replaced `PhaseControlPanel`, which floated above the card.
- **The spine is derived, never listed.** `phaseSpine()` (`front-end/src/utils/phase.ts`) walks
  `VALID_TRANSITIONS` forward from `draft`; a second list beside the table is the drift
  `_validate_registry()` refuses on the server. `offers` is off it (nothing sets
  `assignment_sent`) *except* for a market actually in that phase, which gets its stage back so
  the rail can still say where it stands.
- **Forward / back / destructive is read off the spine** (`transitionDirection`), not
  special-cased per phase. Only the one forward step is on the rail; everything else is behind
  `phase-rail-menu-button`. A spec that clicks `phase-transition-<phase>` for a back or
  destructive edge must open that menu first.
- **A terminal state is stated in words.** Strikethrough alone reads as *stopped*, not as
  *archived* - the prototype proved it. There is no record of which phases a market passed
  through, so an archived market's frozen stage is read off evidence it holds (a stored
  assignment, a published application form), never off history it does not.
- Screens routed by market id get their `Market` from `useOpenMarket`
  (`front-end/src/utils/openMarket.ts`), a reader of the one market store
  (`front-end/src/stores/market.ts`); a transition from the rail is followed by the store
  re-reading the market, and the rail never fails a screen that cannot load one.

## Placements, Pins and the Trail (Conventioner sharp edge)

- **Assign runs in the `assignment` phase and nowhere else** (`assign_phase_refusal` in
  `api/placements.py`, mirrored by `front-end/src/utils/assignPhase.ts`). A seed or a spec that
  wants an assignment must walk the market to `assignment` first - assigning from `draft` is a
  409. It deliberately does not repeat `_ALL_REVIEWED` or `_ASSIGNMENT_COMPUTED`, which
  `guards.py` already says once each.
- **`back-end/api/placements.py` is the only writer of `assignmentObject`.**
  `POST /markets/{id}/assignment` runs the solver and stores the result; `PUT`/`DELETE
  /markets/{id}/placements` writes or frees one seat; `POST /markets/{id}/placements/swap`
  trades two atomically.
  All four are gated on `MarketRole.EDITOR` - the same bar as every other market write, and
  deliberately not stricter, since an EDITOR already owns the tiers, sections and counts the
  whole assignment is computed from.
  There is no other door: the whole-market PUT that once let a stale client copy move vendors on
  market day is deleted (E21/F03/S06).
- **A pin IS a placement row, flagged `hand_placed`.** There is no separate constraint object;
  two records could disagree, and a vendor pinned to one table and placed at another is the exact
  bug pins exist to prevent.
  `assign_market` reads the market's own stored rows for flagged ones and seats them before
  anyone else, so the ordinary loop sees those tables occupied.
  A pin the plan can no longer hold is **orphaned, never deleted**, and `NoOrphanedPinGuard`
  blocks `-> assignment` until it is re-placed or freed.
- **Read-only views describe the STORED assignment, never a fresh run.**
  `assignment_to_show()` (`api/markets.py`) picks: `describe_stored_assignment()` when the market
  has placements, `assign_market()` when it has none. The statistics, the tables grid, the CSV
  all go through it.
  Consequence: **shrinking the plan does not unassign anybody** - only assigning again does. A
  test that expects an edit to the plan to change who is placed must re-run the assignment.
  `GET /markets/{id}/assignment` is the exception and stays a preview: it computes without storing.
- **`MarketTableRow.assignment` is the occupants and nothing else** - its LENGTH is what
  `derive_unassigned_tables_from_rows` reads to count spare capacity. Which side of a table is
  free lives in `assignment_slots` (`[left, right]`, null for vacant). Do not conflate them.
- **`back-end/placement_history.py` owns the `placement_history` collection**: who changed a
  placement, to what, when. Placements only - phase transitions, plan edits and form edits are
  out. **A solver run is one entry**, not one per placement. Entries are stored structured and
  worded by `front-end/src/utils/placementHistory.ts`. Deleted with the market.

## The Solver Reads Applications (Conventioner sharp edge)

- **There is no spreadsheet behind a market.** E02 removed `source_data`, its endpoints and its
  collection, every `col_name`/`col_name_idx`/`col_names`/`col_values`/`col_include`, and
  `enum_priority_order`. What this file used to call "Phase 5" is done; nothing is waiting on it.
- **`assign_market(market)` reads the market's own approved applications.** No caller fetches
  anything first. `assignment/vendor_input.py` is the single seam where application shape meets
  solver shape, and it is the only place that knows both; it is unit-testable with no database.
- **An approved application missing a required answer refuses the whole run**, naming the
  applicants (`IncompleteApplicationsError`), rather than being skipped into an assignment that
  looks complete with someone silently missing.
- **Requiredness is defined by what the market asked**, not by a fixed list.
  `essential_fields.asked_essential_keys()` is the single statement of that rule, read by both
  the applicant validator and the solver's translation. Two copies would drift, and the drift
  would surface as the solver rejecting answers the form had just accepted. Table type is stubbed
  to one type in MVP, so a fixed list would reject every application in the product.
- **A placement is dated by the market date itself.** It used to be dated by the spreadsheet
  column heading, which is why check-in, the table rows and the statistics each built a map from
  headings back to dates. Those maps are gone; do not reintroduce one.
- **A priority rule names a target and carries its own ordering.** The target is a form field key
  or a built-in attribute in the `application.` namespace (`submitted_at`, `application_type`);
  field keys are held to `^[a-z0-9_]+$`, so the two can never collide. How to order follows from
  the target's type - there is no `data_type` to declare, and adding one back would restore the
  silent no-op it replaced. **A CSV-imported row must carry its own `submitted_at`**, or
  first-come-first-served decides nothing.
- **`max_assignments_per_vendor` is the only ceiling.** The hard-coded `MAX_VENDING_DAYS = 4` is
  gone. Unset means the organizer named no ceiling; there is no hidden default.
- **Placement is vendor-driven.** `assign()` walks vendors in priority order and gives each the
  best table still open to them (`best_table_for`). It was table-driven, which made a vendor's own
  section ranking unable to influence anything and stopped a date at the first unfillable table.
  Section ranking is a preference and never a filter; tier is a filter, because it sets the price.
- `back-end/tests/test_assignment_behaviour.py` is the solver's behavioural suite. Before E02 the
  solver had none - `assign_market` was monkeypatched away everywhere - so any change to placement
  should be made against it rather than beside it.
- Do NOT delete `is_draft` from the `Market` model, and do not make it writable again. It is a
  `@computed_field` derived strictly from `phase` (true iff `phase == draft`), kept on the
  document only because it is the fallback `phase_from_market_document()` uses for a market
  written before `phase` existed. See Phase Transitions below.

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
- **`Market.application_form` has one writer on an existing market:** `PUT
  /markets/<id>/application-form`, which is what makes the lock unbypassable. Do not add a second
  (the whole-market PUT that was one is deleted, E21/F03/S06). `POST /markets` may carry a form,
  and it runs through the same validator.
- E2E reaches the locked state with `seedApplication()`
  (`front-end/e2e/helpers/seedApplication.ts`), which writes the document straight into Mongo
  via `mongosh`, because no applicant-facing submit endpoint exists yet.

## Intake Mode (Conventioner sharp edge)

- **`Market.intake_mode` says how vendors reach a market: `csv` or `form`, exactly one.** The
  phase cannot express this. Application submission is already gated to `applications_open`, but a
  CSV market passes through that phase too - that is where the import happens - so during that
  window its public application form would be live and taking applications from strangers the
  organizer has no way to answer.
- **Absence means `csv`, so the public applicant surface fails closed.** Wrongly hiding an
  application surface is visible and gets complained about; wrongly exposing one is silent until a
  stranger applies. There is no migration and no backfill, and none is needed.
  Consequence for tests: **any fixture whose market serves applicants must say `intakeMode: "form"`**,
  in pytest and in the e2e seeds alike. A fixture that does not is a market whose applicant
  endpoints answer 404, which is the default doing its job.
- **`applicant_intake_market_by_slug()` (`back-end/market_documents.py`) is the single expression of
  the gate**, layered on `published_market_by_slug` and read by exactly the five applicant-intake
  endpoints. It cannot move into `published_market_by_slug`, because check-in shares that lookup and
  must stay open to every published market: how a vendor entered has no bearing on whether they can
  scan in on the day. It is one lookup rather than a check in each endpoint, because five checks are
  five chances to forget the sixth.
- **A gated market answers exactly as a market that does not exist.** Never add a "not accepting
  applications online" message: it confirms to any stranger guessing slugs that the market is real.
  The two applicant-login endpoints keep their *uniform* response rather than gaining a 404 of their
  own, because a 404 there would be an oracle saying "this slug is a CSV market" where every other
  answer says nothing. `front-end/e2e/intake-mode.spec.ts` asserts the gated and absent renders are
  identical rather than asserting each alone.
- **Intake mode does not gate the form builder.** A CSV market still has an application form,
  because the essential questions define the offering the CSV maps onto. Intake mode decides who
  fills the form in, not whether one exists.
- **It is organizer-settable only while the market is a draft**, through the plan write (`PUT
  /markets/<id>/plan`, `save_plan`), which refuses a change after that - derived from the stored
  phase rather than from a list of late phases. The control is
  `ElementIntakeMode`, a plan card; the server is the authority, so a hidden or disabled control is
  never the rule. It was withheld through MVP on the grounds that a toggle would advertise a surface
  MVP withheld - retired by `E18/F04/S01`, because the applicant surface turned out to be built and
  switched off rather than absent, and the apply page already answers correctly in every phase.
- **`market_from_document()` withholds `phase` and `intake_mode` from the Pydantic parse** and takes
  both from their document readers. Pydantic validates an enum on construction, before any later
  assignment can degrade it, so a stored value this build does not recognize used to raise - taking
  down every list that included that one market. Do not "simplify" this by letting the model parse
  either field.

## Market Document Canonical Form (Conventioner sharp edge)

- **The back end refuses to boot** unless `migrations/migrate_market_keys.py` has recorded
  every marker in `MARKET_MIGRATION_IDS` (`market_document_keys`, `market_slugs`,
  `market_slugs_unique`) in the `schema_migrations` collection. The migration establishes a
  market document's canonical form: camelCase keys (no legacy snake_case), a stored slug derived
  from the name, and a UNIQUE slug index. A dev Mongo volume older than a marker lacks it, so an
  existing stack hits this on first pull. The fix is the migration itself: `docker compose run
  --rm backend python migrations/migrate_market_keys.py` (`run`, not `exec` - the back end is
  crash-looping). One command records every marker; the operator never discovers them one
  restart at a time. When stored markets already share a public address it stops and names
  them: rename all but one in each group and run it again. Do not "fix" either refusal by
  softening the check: it fails closed because an unmigrated market is invisible, not broken.
- **Market documents are stored camelCase, and that is the only spelling reads may name.**
  Every write camel-cases the whole document, so a hand-written filter on `organization_id`
  matches nothing. Anything touching a raw document or a Mongo filter goes through
  `back-end/market_documents.py` (`market_doc_field`/`market_doc_filter`/`market_doc_set`/
  `market_from_document`). Do not add a read-time fallback that accepts both spellings: writes
  only refresh the camelCase key, so a legacy key holds a value that is stale forever.
  `front-end/e2e/access-control.spec.ts` pins the visibility that depends on this: a
  snake_case filter in the org-scoped market query is exactly the bug that once hid every
  org member's markets, and the suite's positive assertions catch it.
- **`Market.slug` is a computed field** (`@computed_field` on the Pydantic model, derived from
  the name via `market_name_slug()` in `back-end/datatypes.py`). It is persisted and indexed
  (`market_slug`, **unique** over non-empty slugs) so the public slug lookup
  (`published_market_by_slug` in `market_documents.py`) is one indexed query rather than a
  decode of every market on every unauthenticated request. It is never independently writable:
  no request body can name it, and every write recomputes it from the name. The stored slug
  narrows the query but does not decide it - `published_market_by_slug` re-checks the name
  against `market_name_slug`. **One address, one market** (E21/F03/S03): creation and rename both
  ask `public_address_refusal()`, so "Cafe Market" is refused beside "Café Market"; uniqueness
  on the exact name alone let two markets share a public URL.
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
- `Market.phase` is server-owned: `create_market()` stamps `draft`, and the transition endpoint is
  the only writer on an existing market.
- **`phase` is the single source of truth for the market lifecycle; `is_draft` is derived from
  it.** `Market.is_draft` is a Pydantic `@computed_field` (true iff `phase == draft`) and is
  never independently writable: no request body can set it, and it is recomputed from the stored
  phase on every write. Nothing reads the stored value for a market whose `phase` this build
  understands. It is still *persisted*, and every writer keeps it in agreement with `phase` (create stamps both,
  the transition endpoint sets both in one atomic update, and no other write touches either), purely because it is the fallback `phase_from_market_document()` drops to when
  `phase` is missing or unrecognized - a fallback that contradicted the phase would answer
  confidently and wrongly. The two endpoints that serve a raw document rather than a parsed
  `Market` re-stamp `isDraft` from the effective phase before responding.
- **Publishing a market is the `draft` → `archived` transition** (no guards), fired by the
  Done button in `GenerateAssignmentView.vue`. A market can also leave `draft` via
  `draft` → `applications_open` (guarded by `FormHasFieldsGuard`).
  A legacy published market (`phase: "draft"` + `isDraft: false`) reads back as a *draft*, since
  `draft` is a phase this build recognizes and takes at face value - hence the migration below.
- **No Mongo condition can answer "is this market published?"** `{"phase": {"$ne": "draft"}}`
  also matches a document with no `phase` - which is exactly what a legacy *draft* looks like -
  so a filter like that would put an unpublished market on a public check-in URL. The public
  slug lookup prunes with `non_draft_market_prefilter()` (`back-end/market_documents.py`) and
  makes the draft decision in Python via `phase_from_market_document()`. The prefilter prunes;
  it does not judge. Keep it that way.
- **`migrations/migrate_is_draft_consistency.py`** repairs documents whose `isDraft` and `phase`
  disagree, in *opposite* directions depending on which build wrote them: a market the old build
  published (`phase: "draft"` + `isDraft: false`) has its **phase** advanced to `archived` - its
  `isDraft` was the only publish signal it ever had, and confirming it as a draft would take a
  live market's public check-in URL off the air - while a market with a non-draft `phase` and a
  stale `isDraft: true` has its `isDraft` recomputed. Documents with **no** `phase` are left
  alone; they are `migrate_phase.py`'s to backfill.

## Security Hardening (PR 5a)

- **Invariant: a security control must never key on a variable whose default is the insecure value.**
  This is the root cause of both vulnerabilities this PR closes: `SECRET_KEY` fell back to a
  committed literal, and the CORS policy gated on `FLASK_ENV`, whose default (`development`) ran
  the permissive branch on every deployment.
- **There is no fallback signing secret anywhere in this repository** and there must never be one
  again - not even "for dev". A committed fallback is a published key. Deleting one is only half the
  job, because it stays readable in the history: `back-end/utils/configured_secret.py` is the single
  answer to "does this variable hold a secret?", and all three secrets (`SECRET_KEY`,
  `RECAPTCHA_SECRET_KEY`, `RESEND_API_KEY`) ask it. An operator meeting the boot refusal has an
  incentive to paste the old literal back (a fresh key logs every organizer out; the old one does
  not), and that would clear the refusal while changing nothing.
- **A blank or published value is NOT a configured secret, and a truthy placeholder is worse than a
  blank.** Both are what a half-copied template looks like, and a check that keys on mere truthiness
  passes on `re_xxxxx` - so the boot check reported a configured deployment and the failure landed at
  request time instead (a captcha verified against a key Google never issued, a 500 per signup from
  Resend). `configured_secret()` therefore strips, and `is_published()` refuses every value this repo
  has printed where a secret goes plus anything shaped like one (a run of x's, a `your-` prefix), on
  a laptop as on a deployment. Add any future placeholder to that set; better, never let a doc or a
  template print a usable-looking key - **every env template in this repo ships blanks** (with
  `DISABLE_CAPTCHA`/`DISABLE_EMAIL` on) precisely so there is nothing to copy.
- **`ALLOW_INSECURE_LOCAL_DEV` is the ONLY escape hatch** for the six boot-time requirements
  (`SECRET_KEY`, `RECAPTCHA_SECRET_KEY`, `CORS_ALLOWED_ORIGINS`, `RESEND_API_KEY`, `SESSION_TYPE`,
  `TRUSTED_PROXY_HOPS`). It defaults to OFF - the secure state is the one you get by forgetting. It
  does *not* excuse a published `SECRET_KEY`: the hatch exists so a process with **no** key can boot
  with a random one.
- **A boot requirement must defend something this branch actually serves.** Each of the six is
  reachable today: the session cookie, `POST /register`'s captcha, the organizer API's origin list,
  the mail that carries every verification link, reset link and OTP, the store the session is kept
  in, and - the subtlest - the address that captcha is scored against. A requirement with nothing
  behind it teaches operators to work around the check, so `utils/rate_limit.py` is *not* here: it
  bounds the applicant endpoints, which are not on this branch. `TRUSTED_PROXY_HOPS` is, because
  `remote_addr` is what organizer signup hands Google as reCAPTCHA's `remoteip` - so the hop count
  serves the captcha, not a limiter that does not exist yet. Make the requirement follow the caller,
  not the module it was first written for: the same variable can be dead weight in one slice and
  load-bearing in the next, and this one became load-bearing the moment `RECAPTCHA_SECRET_KEY` did
  (before, a deployment with no secret took the dev bypass and no token ever reached Google).
- **`FLASK_ENV` does not exist in this repository - nothing reads it, and nothing sets it.** It is
  gone from the Dockerfile, `docker-compose.yml` and the env templates, so the invariant is
  structural rather than aspirational: a variable nobody sets is a variable nobody can key on. Do not
  reintroduce it. The image used to export `development`, so anything keyed on it read the same on a
  deployment as on a laptop - that is how the CORS hole survived, and how `SESSION_TYPE` came to
  default to `filesystem` on serverless hosts that have no disk. `SESSION_TYPE` is therefore
  configuration with no default (`back-end/utils/session_storage.py`), and `SESSION_COOKIE_SECURE` is
  not configurable at all, because a `SameSite=None` cookie is only accepted by a browser when Secure.
- **`SESSION_TYPE=null` installs no session store.** flask-session has no `null` backend and raises
  on one; Flask's own interface signs the session into the cookie, which is the only store a
  serverless function has. Do not "fix" a `null` deployment by handing it to `Session(app)`.
- **The check is a check.** `check_public_endpoint_defenses()` reads configuration and returns it;
  `configure_public_endpoint_defenses()` is the only thing that touches the app. Keep them apart:
  flask-cors installs an `after_request` handler per call, so a check with side effects stacked one
  onto the live app every time anything asked it a question.
- **The required production environment is documented in `docs/RELEASING.md`** - keep that table
  in step with the boot check in `back-end/app.py`. `back-end/.env.example` is the local-development
  template and must boot as it stands (it sets the hatch); a placeholder that is *truthy* is worse
  than a blank, because the app takes it for a configured secret. A deploy doc that is wrong is worse
  than one that is missing, because it will be trusted.
- **Every secret is read from the environment when it is asked for, never captured at import.**
  `signing_secret()`, `verifiable_secret()` and `sendable_key()` all call `os.getenv` per call, so the
  boot check is a pure function of the environment rather than of the import order that produced it.
  Two of them used to read their key into a module global on the way up, and that one difference cost
  three separate bugs: a `.env` loaded afterwards was a `.env` nobody saw (hence the ordering rule
  `app.py` used to hold in a comment), `monkeypatch.delenv` on those variables was a silent no-op, and
  every test had to know which module attribute to patch instead - so a test that "cleared the secret"
  cleared nothing and passed only because the shell running it happened to hold no key. Do not
  reintroduce a module-level `os.getenv` for a secret. `resend.api_key` is set on the way into each
  send (`ready_mailer()`), for the same reason.
- **`back-end/.env` is read by `back-end/utils/env_file.py`, called on `app.py`'s first line** (before
  the imports below it build their Mongo clients). Nothing loaded that file before this PR (no
  `load_dotenv`, no `python-dotenv`), which was harmless only while the app booted regardless; with
  the six requirements in place, the developer who followed `docs/STARTUP.md` met a refusal naming
  the variable they had just set. The real environment wins (`override=False`): the Docker stack
  bind-mounts `back-end/` into the container, so a stray `.env` must never be able to hand a process
  an escape hatch or a signing key it did not choose. **The test suite reads no `.env` at all** -
  `tests/conftest.py` points `utils.env_file.ENV_FILE` at a path that does not exist, because two test
  modules import `app`, and a suite whose result depends on an untracked file is green in CI and red
  on the laptop of anyone whose `.env` still carries what the old template printed.
  `test_the_local_development_template_boots_as_it_stands`
  (`tests/test_public_endpoint_defenses.py`) runs the shipped template through the real boot check, so
  an edit that pins an origin or reinstates a placeholder fails there rather than on a laptop.
- **`VITE_RECAPTCHA_SITE_KEY` is the other half of `RECAPTCHA_SECRET_KEY`, and it is a *build-time*
  requirement.** Making the back-end secret mandatory is what made it load-bearing: a bundle with no
  site key sends a placeholder token (`front-end/src/utils/captcha.ts`), which a back end with no
  secret used to wave through and a back end with a real one hands to Google, who never issued it - so
  every organizer signup 400s on a deployment that looks healthy. `vite build` therefore refuses a
  bundle without it (`front-end/vite.config.ts`), with the same opt-in escape hatch by the same name
  (`VITE_ALLOW_INSECURE_LOCAL_DEV`). A defense that exists on only one side of the wire is not one.
  Consequence for setup: **`cp .env.example .env` is a step in `front-end/` too**, not only in
  `back-end/`. Vite's `loadEnv` reads `front-end/.env` and never `.env.example`, so a fresh clone has
  no site key and no hatch, and `npm run build` throws. Both templates ship the shape that works as
  it stands; `docs/STARTUP.md` names both copies.

## Essential Form Fields (Conventioner sharp edge)

- `back-end/essential_fields.py` is the single owner of the essential-questions contract:
  the reserved `essential_*` answer keys in `Application.form_data`, the offering derivation
  (dates from `setupObject.marketDates`, sections from `setupObject.sections`, table types from
  the LAST floorplan's `tableTypes`), applicant answer validation, and the freeze.
  `front-end/src/utils/essentialFields.ts` is its front-end mirror and must stay in step.
- The offering follows the market plan live until the first applicant save, which snapshots it
  onto `applicationForm.essentialOptions` (camelCase, server-owned like `publishedAt`; a client
  payload can never write it). After that, no market-plan edit reaches the form - do not add a
  refresh path. The form save writes `essentialOptions: null`, so the freeze filter matches
  null-or-missing, not `$exists`.
- **A form is its custom fields PLUS the essential questions the plan asks, and either half alone
  is a form.** Every layer that asks "does this market have a form?" must read
  `asked_essential_keys()` rather than count custom fields. `FormHasFieldsGuard` does, and so does
  `application_write._asks_nothing()` - it did not, and the disagreement meant a market could open
  applications and then refuse every application it received, by CSV import and by applicant alike.
  A market that asks genuinely nothing is still refused.
- Custom form-field keys may not use the `essential_` prefix (validated in
  `_normalized_application_form` and mirrored in `front-end/src/utils/applicationForm.ts`).
- `docs/schema.d.ts` is generated from `datatypes:MarketSchemaContract`; after changing a
  contract model, run `python generate_market_schema.py --output ../docs/schema.d.ts` from
  `back-end/` (pinned by `tests/test_generate_market_schema.py`).
- Local stack for E2E: export `DISABLE_EMAIL=true` when bringing the stack up (`nm-test.sh`
  does this; a bare `th-compose.sh up` does not), otherwise `auth.spec.ts`'s password-reset
  test hits a 500 from the unconfigured mailer.

## No-mistakes Gate

- `.no-mistakes.yaml` at the repo root configures the no-mistakes CI gate.
  `allow_repo_commands: true` is the only safe setting (without it the gate has
  no way to run the test suite), but it is **only trusted from the `dev` branch**:
  the gate reads the config from the base branch's commit, so a pushed branch
  cannot self-enable arbitrary commands.
- `scripts/nm-test.sh` is the committed test runner the gate invokes. It runs the
  full suite (backend pytest, frontend vitest, Playwright E2E) with an isolated
  Docker stack (unique `COMPOSE_PROJECT_NAME` + bind-to-port-0 free ports), and
  guarantees teardown via an `EXIT` trap.
- Both `scripts/th-compose.sh` and `scripts/seed_fixture.sh` resolve their stack
  identity in this priority order: 1) explicit env vars (`COMPOSE_PROJECT_NAME` +
  `TH_BACKEND_PORT` etc.), 2) treehouse slot from path, 3) primary defaults (or
  fail loud for `th-compose.sh`). This makes them work from a no-mistakes worktree
  (which has no treehouse slot) without falling through to the primary stack.

## The Design Language (Conventioner sharp edge)

- **`docs/design-system.md` is the single statement of what this product looks like**, decided
  2026-09-20 from the walk in `.lavish/aesthetics-2026-09-20.html`. A value not in that file does not
  belong in a component. `front-end/src/assets/base.css` is where it becomes tokens; `E16` is the work
  of making it true.
- **There is no shared component layer yet, and that is the root cause of everything aesthetic.**
  12,211 lines of CSS in 71 scoped `<style>` blocks, each re-deciding from scratch: 17 radius
  declarations, 24 font sizes, 32 spacing values, 351 hardcoded hex colours against 704 token uses.
  Do not add a 72nd set of local decisions - reach for the tokens, and once `E16/F03` lands, the
  primitives.
- **The card idiom was extracted; the type and spacing scales were authored.** That distinction
  matters when something looks off: 6px controls, 10px cards and the three-layer shadow are what the
  newer screens already did, so a disagreement with them is a bug. The type and spacing scales are
  new, so a disagreement is unmigrated code.
- **A `var(--x)` that resolves to nothing fails silently and catastrophically.** `--mm-text-red` was
  referenced in seven rules and defined nowhere, which rendered the market-archive confirmation button
  as white text on a white dialog with no border - invisible, on the only irreversible action in the
  product. `E16/F01/S05` adds the resolution check. Never write `var(--mm-x, #fallback)`: a fallback
  on a defined token is a second definition waiting to drift, and on an undefined one it hides the bug.
- **`contrast.test.ts` asserts tokens, not usages, and that gap has been occupied.** A token exempt
  from the contract because it "never carries text" (`--mm-border`) was used as a button fill with
  white text at 1.74:1. The Playwright sweep in `E16/F01/S05` covers usages - and **it is only worth
  the states it walks**, so dialogs, menus, disabled controls and empty states must be opened
  deliberately. A twenty-screen pass missed the invisible button because nobody opened that dialog.
- **A token is only AA on the ground it was measured against.** `--mm-green` is 4.59:1 on white and
  4.43:1 on the phase rail's `#FBFBFA`.
- **Form controls do not inherit `font-family`.** Setting `font: inherit` on them alone is wrong while
  `body` declares Inter - it makes every control Inter while the 274 Outfit rules around them stay
  Outfit. `body` becomes Outfit first (`E15/F01/S01`). And `font` is a SHORTHAND: it carries
  `line-height` too, and a control's height is its line box, so the reset pairs it with
  `line-height: normal`.
- **`front-end/src/assets/primitives.css` owns every control.** `.btn`, `.field` and `.chip` carry
  height, padding, radius, type, focus and the disabled state, because a token cannot stop a file
  writing `height: 45px` - and that was the damage: ten control heights on one screen, four disabled
  treatments, sixty button-ish class names. Reach for a primitive rather than deciding again;
  `src/__tests__/primitives.test.ts` is the contract.
- **`npm run lint:css` is the design-language gate**, and it is **warnings globally, errors per
  migrated file** (`.stylelintrc.json` `overrides`). A rule that fails the build on a pre-existing
  backlog gets switched off, so a slice adds its files to that list when it lands. Everything MVP
  serves is on the list; the 174 remaining warnings are the floorplan GUI and the applicant views,
  both switched off in MVP.
- **A market screen stands in `MarketFrame`** (`front-end/src/components/MarketFrame.vue`), whose
  bar and whole phase rail stick at `top: var(--banner-h)` - the banner's height as a token - on the
  same principle as the banner itself. The card fills at least the window under the banner. Never
  give a frame screen an `overflow` scroller of its own: the sticky block silently stops sticking.
- **A screen is one of two widths and never caps its own height.** `--workspace-max` (1440) or
  `--list-max` (1100); the PAGE scrolls. **Every market screen is `--workspace-max`, set by
  `MarketFrame`** (E22/F04/S01): a screen in the frame sets no width of its own, or moving between
  a market's screens makes the frame jump. `.app-container` used to be `position: absolute;
  height: 100vh`, which is why no screen could scroll the page and every tall screen grew its own
  nested scrollers. Do not reintroduce a viewport-height shell.

## Dialogs (Conventioner sharp edge)

- **`front-end/src/components/AppDialog.vue` is what a dialog is in this product** (E20/F01): a
  native `<form>` in a modal doing one small job. It owns the scrim, window, close control, Escape
  and backdrop dismissal, the inert behaviour, and the `type="submit"` confirm. **That form IS the
  Enter contract** - Enter runs the same handler as the button, so it inherits that handler's
  guard, and a disabled submit makes Enter inert with no key handler anywhere. Do not add
  `@keydown.enter`: five views each invented their own answer and one of them (`ApplicantLogin`)
  bypassed its own resend cooldown by doing so.
- A dialog of several independent actions passes no `confirmLabel` and hosts its own `<form>`s
  (Manage organization has three). Testids come from the `testid` prefix - `<testid>-window`,
  `-submit-button`, `-cancel-button`, `-background`, `-close-button`.
- **Closing never means saved, and saving never closes.** Three closes are correct and are pinned:
  deleting the thing, the explicit close control, and Escape or backdrop. The parent learns about a
  save through its own event, never through close - `OrganizationsView` treating close as its
  refresh signal is why every membership change used to close the dialog.
- **A destructive dialog opens focused on Cancel**, deliberately: one stray Enter would otherwise be
  the whole irreversible action. Focus skips `:disabled` controls - `focus()` on a disabled element
  is a silent no-op, which left the create-market dialog opening with focus on `<body>`.
- **A dialog opened FROM a dialog is a sibling of it**, so `useInertBehind` marked it out of play:
  it rendered, read correctly, was visible and enabled, and could not be clicked. A dialog now
  un-inerts its own branch on open and restores the marks on close. Asserting this needs a control
  the PAGE holds - the view container is an ancestor of the dialogs and is never marked.
- `src/__tests__/modalsHoldThePageInert.test.ts` keeps a FLOOR of cover-painting files that **falls
  on purpose** as dialogs adopt the shell. `AppDialog` itself is pinned by name, because without
  that every dialog built on it leaves the rule's sight at once.

## Organization Deletion and the Import Chain (Conventioner sharp edge)

- **Deleting an organization deletes the drafts and archived markets it holds, and is refused while
  it holds anything mid-lifecycle** (`BLOCKING_PHASES` in `back-end/api/organizations.py`). The
  refusal names each market. The update that set `organizationId` to null is **gone outright** - a
  market belonging to nothing is a state `POST /markets` refuses to produce.
  The check lives with the organization API, NOT in `guards.py`, which is validated against the
  transition table and is for transitions.
- **An archived market is still publicly served**, so deleting one takes a live check-in URL off the
  air and destroys the record of a market that ran. Reaffirmed 2026-09-22. The confirmation
  therefore names what each deletion destroys per market, and `back-end/deletion_trail.py` records
  it - written BEFORE anything is destroyed, and allowed to fail the whole operation.
- **`back-end/api/form_amendment.py` fixes the application form from inside the import** (E20/F03).
  It **adds no transition edge**: the route is a breadth-first walk of `VALID_TRANSITIONS`, two hops
  from `applications_open` and four from `applications_closed`, and the market returns to the phase
  it started in.
- **Pre-flight, not rollback.** Every guard on every hop is judged against the PROPOSED form before
  the market moves. Judging the stored form would pass a market whose current form is fine, move it
  to draft, write a form that asks nothing and then refuse the return - stranding it mid-import.
  `Market.form_amendment` records the destination before the first step, so a chain that stalls says
  where it stopped and offers to finish.
- The form is still written by `save_application_form` in `draft`, so the D9 lock stays
  unbypassable. The chain is ADMIN, because it moves phases.

## Agent skills

### Issue tracker

Work is tracked as committed markdown under `.scratch/`: an Epic > Feature > Story backlog in
`.scratch/backlog/`, and Wayfinder decision maps in `.scratch/wayfinding/`. GitHub is used for pull
requests only; its issue tracker is deliberately empty. Work items are things to *build*; Wayfinder
maps are open *questions* to resolve, and a decision lives in exactly one of them. Story status must
be updated as PRs merge - see `docs/agents/issue-tracker.md` for the full convention.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
