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
  A spec needing users beyond those two calls `ensureVerifiedUser()`
  (`front-end/e2e/helpers/verifiedUser.ts`) in `beforeAll`, which runs that same script inside
  the back-end container; do not hand-roll the user document, and do not switch to
  `/register-user`.
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
- Publishing is `POST /markets/{id}/transition` with `{ toPhase: 'archived' }`, never a PUT of
  `isDraft: false` - `isDraft` is derived from `phase` and a PUT body cannot set it.
- After publishing, with a configured `setup_object`, you must fetch the
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
  `front-end/e2e/access-control.spec.ts` pins the visibility that depends on this: a
  snake_case filter in the org-scoped market query is exactly the bug that once hid every
  org member's markets, and the suite's positive assertions catch it.
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
- **`phase` is the single source of truth for the market lifecycle; `is_draft` is derived from
  it.** `Market.is_draft` is a Pydantic `@computed_field` (true iff `phase == draft`) and is
  never independently writable: no request body can set it, and it is recomputed from the stored
  phase on every write. Nothing reads the stored value for a market whose `phase` this build
  understands. It is still *persisted*, and every writer keeps it in agreement with `phase` (create stamps both,
  `update_market()` re-derives it from the stored phase, the transition endpoint sets both in one
  atomic update), purely because it is the fallback `phase_from_market_document()` drops to when
  `phase` is missing or unrecognized - a fallback that contradicted the phase would answer
  confidently and wrongly. The two endpoints that serve a raw document rather than a parsed
  `Market` re-stamp `isDraft` from the effective phase before responding.
- **Publishing a CSV market is the `draft` → `archived` transition** (no guards), fired by the
  Done button in `GenerateAssignmentView.vue`. It used to be a `PUT` of `isDraft: false`; that
  route is gone, and this transition is now the only way a CSV market leaves `draft`.
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

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
