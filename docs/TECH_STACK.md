---
layer: implementation
kind: module
describes:
  - back-end/requirements.txt
  - back-end/requirements.in
  - scripts/lock-backend-requirements.sh
  - front-end/package.json
  - .nvmrc
  - docker-compose.yml
  - front-end/vite.config.ts
verified: 2026-11-14
sources:
  - T254
  - T251
  - T263
  - T273
  - T317
  - T345
---

# Technology Stack

The technology Conventioner is built on, as its manifests pin it: [`back-end/requirements.in`](../back-end/requirements.in) and its lock [`requirements.txt`](../back-end/requirements.txt), [`front-end/package.json`](../front-end/package.json) and [`docker-compose.yml`](../docker-compose.yml).
How each part of the code works is in the implementation layer of the [knowledge graph](README.md): [modules](implementation/modules/README.md), [data](implementation/data/README.md), [conventions](implementation/conventions/README.md) and [testing](implementation/testing/README.md).

## Backend

### Python dependencies are locked

- Each back-end requirements file that Vercel, Docker, CI or the gate installs is a lock: every package, direct or not, at one exact version with its hashes, so a redeploy of unchanged code installs exactly what was tested
  - The redeploy of 2026-10-23 re-resolved six packages left unpinned, openai 3.35.1 to 3.37.0 among them; the first locks hold what that deploy installed
- People edit the `.in` file beside each lock (`requirements.in`, `requirements-floorplan-solver.in`, `requirements-dev.in`), never the `.txt`
- [`scripts/lock-backend-requirements.sh`](../scripts/lock-backend-requirements.sh) (needs any [uv](https://docs.astral.sh/uv/); it runs the uv pinned in `requirements-dev.in`, so every machine writes the same locks) is the one way to change a lock: with no options it keeps every pin and adds or drops only what an `.in` changed; `--upgrade-package <name>` moves one package on purpose, `--upgrade` everything
- Two checks hold the locks to that command:
  - `tests/test_requirements_are_locked.py` fails on a lock line that is not a hashed pin, a lock whose direct requirements are not exactly its `.in`'s or whose pins no longer satisfy it, and a package pinned differently in two locks
  - CI's `backend` job and `scripts/nm-test.sh` re-run the lock command and fail on any difference, which is what catches a pin edited by hand: the command writes that version's own hashes, and the files differ

### Core Framework

- **Flask 3.1** - Python web framework
  - Lightweight and flexible microframework
  - RESTful API endpoints
  - Session management with Flask-Session

### Authentication & Security

- **Flask-Login 0.6.3** - User session management
  - Handles user authentication state
  - Session-based authentication (not JWT)
  - A login id identifies the account, not its address ([users and email](implementation/data/users-and-email.md#a-sign-in-is-kept-on-the-server))
- **Flask-Bcrypt 1.0.1** - Password hashing
  - Secure password storage using bcrypt
  - Password verification for login
- **Flask-CORS 6.0** - Cross-Origin Resource Sharing
  - Enables frontend-backend communication
  - Configured with credentials support

### Database

- **MongoDB 8.0 in production, 7 locally and in CI** - NoSQL document database
  - Primary data storage
  - The local stack and CI run `mongo:7` while production runs 8.0, for the reason in [the MongoDB version](implementation/testing/real-mongo-suite.md#the-mongodb-version)
  - Collections: `APP_COLLECTIONS` in [`back-end/reset_database.py`](../back-end/reset_database.py) lists every collection the application writes and `GRIDFS_BUCKETS` its GridFS buckets, `schema_migrations` kept out of them on purpose; [the data nodes](implementation/data/README.md) describe the stored documents, [lookup indexes](implementation/data/lookup-indexes.md) names the indexes the back end builds as it boots, and [market deletion](implementation/modules/market-deletion.md#sharp-edges) every collection a market's records are deleted from
  - Connection via PyMongo 4.18, to `MONGODB_URI` when it is set (production's Atlas cluster), otherwise to `MONGODB_HOST` and its siblings
  - Database name: `conventioner`

### Data Validation

- **Pydantic 2.10** - Data validation and settings management
  - Type-safe data models
  - Automatic validation
  - Used for API request/response validation

### Email Service

- **Resend** - Transactional email service
  - Email verification links
  - Password reset emails
  - OTP (One-Time Password) delivery for passwordless login
  - HTML and plain text email templates
  - API key configured via `RESEND_API_KEY` environment variable

### CAPTCHA Service

- **Google reCAPTCHA v3** - Bot protection
  - Invisible CAPTCHA verification
  - Score-based verification (minimum 0.5)
  - Used on registration endpoint
  - Secret key configured via `RECAPTCHA_SECRET_KEY` environment variable, which the app refuses to boot without
  - Test-only bypass via `DISABLE_CAPTCHA`, honored only under `ALLOW_INSECURE_LOCAL_DEV` (see Environment Variables)

### Utilities

- **Python's `secrets`** - Email verification and password reset links, and sign-in codes, each stored only as its hash (`back-end/account_secrets.py`)
- **PyJWT 2.15** - The applicant's sign-in token, signed with `SECRET_KEY`
- **Cryptography 50** - Lets the local stack's `flask run --cert=adhoc` make its certificate; no module imports it
- **Requests 2.34** - HTTP library
  - Used for reCAPTCHA verification API calls
- **python-dotenv 1.2** - Reads `back-end/.env` on the first line `app.py` runs
  - The real environment wins over the file, so nothing exported by hand is shadowed by it

### A location's layout

- **Shapely 2** and **NumPy** - The geometry of Fill an area's placement
- **pyckingsolver** - The packing solver of a whole room's placement, in `back-end/requirements-floorplan-solver.txt` (Docker, CI and local development) because it has no wheel for production's glibc; production places on a grid instead, and an area is never handed to it
- **Pillow** - An uploaded image's size, and a PDF page drawn as a PNG; a layout calls no model
- **pypdfium2** - Draws a PDF floorplan's pages; its `manylinux_2_17` wheel carries PDFium, so it needs no system package, as production's Vercel function requires ([a location's layout](implementation/modules/floorplan-placement.md))

### Session Management

- **Flask-Session 0.8.0** - Server-side session storage
  - Session store selected by `SESSION_TYPE`, which has no default: `filesystem` (local disk) on a container or VM, `null` (signed cookie only, no server-side store) on a serverless host
  - A sign-in lasts 12 hours, or 30 days with "Remember me", counted from signing in and enforced by the server ([the cookies](implementation/conventions/security-invariants.md#the-cookies)); the session cookie ends with the browser
  - The session and remember-me cookies are `SameSite=Lax`, `Secure` and `HttpOnly` - not configurable, since the front end and the API are on one site ([the cookies](implementation/conventions/security-invariants.md#the-cookies))

### Testing

- **pytest 9.1** - Python test framework
  - Runs the back-end test suite (`python -m pytest tests/`), from `back-end/requirements-dev.txt`
  - Configured via `back-end/pytest.ini`
  - `tests/conftest.py` points PyMongo at a port nothing listens on and the tests use in-memory fakes, so no database connection is required
  - The exception is [the real-MongoDB suite](implementation/testing/real-mongo-suite.md), `tests/real_mongo/`, which runs on a MongoDB server in CI's `backend` job and skips where `REAL_MONGODB_URI` is unset

## Frontend

### Node and npm are pinned

- [`.nvmrc`](../.nvmrc) pins one Node, 24.22.1 (an LTS line), and with it the npm it bundles, 11.19.1; that npm writes the committed `front-end/package-lock.json`, and npm 10 rewrites it (it drops the `libc` fields)
- Every place that runs the front end's npm runs that pin: each machine through nvm (`nvm install` in the repository reads `.nvmrc`), every `actions/setup-node` step in CI and the Deploy workflow (`node-version-file: .nvmrc`), and `front-end/Dockerfile` (`node:24.22.1-alpine`)
- `front-end/package.json`'s `engines` says `node` `24.x` and `npm` `11.19.1`: npm warns (`EBADENGINE`) on an install under another version, and Vercel, which builds the production front end, reads the major from it (Vercel takes a major only, and an exact version there fails its build)
- Three checks hold the pin, each where the version is used:
  - CI's `frontend-lint-and-types` job checks its Node is `.nvmrc`'s, installs with `npm ci --engine-strict` (which refuses an npm other than `engines.npm`), and checks an `npm install --package-lock-only` changes nothing in the lockfile
  - `front-end/Dockerfile` installs with `npm ci --engine-strict`, which refuses a Node outside `24.x` or an npm other than `11.19.1`, so a base image that drifts from the pin and so bundles another npm fails the build
  - The treehouse pre-warm installs with `npm ci`, which never writes the lockfile, and warns when the machine's Node is not the pin ([the treehouse runbook](../scripts/README-treehouse.md))
- `@types/node` follows the same Node major (`^24`), so a type check never accepts an API the running Node lacks; Dependabot holds its later majors ([Dependabot](implementation/testing/ci-and-the-gate.md#dependabot))
- `front-end/tsconfig.node.json` and `front-end/tsconfig.e2e.json` extend `@tsconfig/node24`, the base for the same Node major
- To move the pin, change `.nvmrc`, the Dockerfile's `FROM` and `engines` together, with `@types/node`'s and `@tsconfig/node24`'s majors when the Node major moves, and regenerate the lockfile with the new npm as its own commit

### Core Framework

- **Vue 3.5.44** - Progressive JavaScript framework
  - Composition API (`<script setup>`)
  - Reactive data binding
  - Component-based architecture

### Build Tool

- **Vite 8.3.5** - Next-generation frontend build tool, bundling with Rolldown
  - CI holds the entry JavaScript of a build to a gzipped limit, the [bundle budget](implementation/testing/ci-and-the-gate.md#the-bundle-budget), and fails a build that calls `eval` or `Function`, which the [Content-Security-Policy](implementation/conventions/security-invariants.md#security-headers) refuses ([the eval check](implementation/testing/ci-and-the-gate.md#no-string-evaluated-as-script)), and the build itself fails when it holds any module of the development-only [component library](implementation/modules/component-library.md) ([no development page in the build](implementation/testing/ci-and-the-gate.md#no-development-page-in-the-build))
  - `vite preview` serves `front-end/vercel.json`'s security headers, so a production build runs locally under the policy production sends
  - Minifying keeps legal comments (`/*!` and `@license`, in [`vite.config.ts`](../front-end/vite.config.ts)), so the licence notices of copied icons and bundled libraries reach the shipped bundle ([ADR 0015](adr/0015-the-app-owns-its-components.md))
  - Vue, its router, Pinia and the helper the Vue plugin adds to every single-file component build into one chunk named `vue` (`codeSplitting` in [`vite.config.ts`](../front-end/vite.config.ts)), so the bundle budget's list names the runtime it loads
  - Fast development server with HMR
  - Production build optimization
  - Proxy configuration for API requests

### Language

- **TypeScript 6.0.3** - Typed JavaScript
  - Held below 7 (see [Dependabot](implementation/testing/ci-and-the-gate.md#dependabot)): 7.0 has no JavaScript API for `vue-tsc` and typescript-eslint
  - Type safety
  - Better IDE support
  - Compile-time error checking

### UI Framework & Components

- **The app's own components, on no component library** ([ADR 0015](adr/0015-the-app-owns-its-components.md))
  - A dialog is [`AppDialog`](../front-end/src/components/AppDialog.vue) ([dialogs](implementation/conventions/dialogs.md)); controls are the primitives of [the design language](design-system.md#the-primitive-layer), `.btn`, `.field` and `.chip`, over native inputs
  - A widget that is hard to get right, a date picker or a menu, would start from a headless library such as Reka UI; the first combobox, the placement dialog's searchable vendor pickers, is the app's own ([`SearchPicker.vue`](../front-end/src/components/SearchPicker.vue), [ADR 0015](adr/0015-the-app-owns-its-components.md)); `theAppOwnsItsComponents.test.ts` keeps PrimeTek's packages out
- **QR codes are encoded by `qrcode`** and drawn by the app as one SVG path ([attendance and the door](implementation/modules/attendance-and-door.md#sharp-edges)): a library, not a component, so [ADR 0015](adr/0015-the-app-owns-its-components.md) is not touched; `jsqr`, a dev dependency, decodes the drawing in a unit test
- **Icons are local SVG components** in [`src/components/icons/`](../front-end/src/components/icons/), no icon library or font
  - Each draws in `currentColor`; the one Lucide icon, `IconCheck`, is copied from `lucide-static` 1.61.0 at `1em`, so the `font-size` around it sizes it, with Lucide's ISC notice beside it in `LICENSE-lucide.txt` and in a `/*! @license` banner, which reaches the bundle (`theLucideNoticeReachesTheBundle.test.ts`); the four floorplan icons copied with it went with the floorplan beta (T257)
  - They replaced an icon font whose next major is proprietary (T45, [ADR 0015](adr/0015-the-app-owns-its-components.md)); `theAppOwnsItsComponents.test.ts` keeps the font out
- **The logo and the mark are brand files** in [`src/assets/brand/`](../front-end/src/assets/brand/), not icons ([brand files and icons](design-system.md#brand-files-and-icons))

### State Management

- **Pinia 4.1.0** - Vue state management
  - Stores in `src/stores/`: the open market (`market.ts`) and the applicant's application (`application.ts`)
  - The signed-in user is held by `App.vue` and handed down with provide/inject

### Routing

- **Vue Router 5.4.0** - Official router for Vue.js
  - Client-side routing
  - Route guards for authentication
  - Public and protected routes

### HTTP Client

- **Axios 1.21.0** - Promise-based HTTP client
  - API communication through one instance, `src/utils/api.ts`
  - Cookie-based authentication support

### Utilities

- **VueUse 15.0.0** - Collection of Vue composition utilities
  - Reusable composition functions
- **VueDraggable 4.1.0** - Drag and drop component, resolved to the ES source it publishes (`vite.config.ts`), since its UMD builds evaluate a string and carry a second Vue
  - Drag-and-drop functionality for UI elements
- **A layout is drawn in SVG by the app's own component** ([`LayoutMap.vue`](../front-end/src/components/layout/LayoutMap.vue)), with no canvas library: Konva and vue-konva went with the floorplan beta (T257)

### Development Tools

- **ESLint 10.13.0** - JavaScript/TypeScript linter
  - Code quality enforcement
  - `npm run lint` fixes what it can; `npm run lint:check` verifies without fixing and refuses a warning as it does an error, and CI's `frontend-lint-and-types` and `scripts/nm-test.sh` run it
  - Vue-specific linting rules from `eslint-plugin-vue` 10 (its `flat/essential` set, plus `vue/no-v-html` as an error, so no template renders raw HTML)
- **minimatch 11, held by `overrides` in `front-end/package.json`** - the glob matcher under ESLint, typescript-eslint and `@vue/test-utils`'s js-beautify, all development-only
  - Each of them still asks for minimatch 10, so the override holds every copy at `^11.0.8`, the line that has upstream's hardening
  - Drop the entry once ESLint, `@eslint/config-array`, `@typescript-eslint/typescript-estree` and js-beautify's `editorconfig` and `glob` all ask for 11
- **Prettier 3.9.10** - Code formatter, configured in `front-end/.prettierrc.json` (semicolons, single quotes, a 100-character line, trailing commas everywhere)
  - `npm run format` fixes and `npm run format:check` verifies; both cover `front-end/` and `docs/` with that config, leaving out the generated `docs/schema.d.ts`, which its test compares byte for byte (`front-end/.prettierignore`); CI runs the check in `frontend-lint-and-types`, so unformatted front-end code or docs fail the build: run `npm run format` before committing
  - The one-time reformat commits, of the front end and of `docs/`, are listed in `.git-blame-ignore-revs`, which `git blame` skips once `git config blame.ignoreRevsFile .git-blame-ignore-revs` is set
- **Stylelint 17** - The design language's gate (`npm run lint:css`, which refuses a warning as it does an error), configured in `stylelint.config.js`
- **Vue TSC 3.3.14** - TypeScript type checker for Vue
  - Type checking for Vue components

### Testing Tools

- **Vitest 5** - Unit test runner
  - Runs component and utility unit tests (`npm run test:unit`)
  - Uses the `happy-dom` environment (configured in `vitest.config.ts`)
- **@vue/test-utils 2** - Vue component testing utilities
- **PostCSS 8** - Parses the design language's CSS in `src/__tests__/primitives.test.ts`, and the styles of the components `src/__tests__/everySelectWearsThePrimitive.test.ts` reads, which read every rule they check through it and no other way
- **Playwright 1.64** - End-to-end browser testing
  - Drives Chromium against the running Docker stack (`npm run test:e2e`)
  - Configured in `playwright.config.ts`
  - Page Object Model + fixtures under `front-end/e2e/`; selectors use
    `data-testid` attributes (see `docs/TESTING.md`)
- **@axe-core/playwright 4.14** (axe-core, MPL-2.0) - Accessibility checks inside the Playwright suite
  - The `expectAccessible` fixture in `front-end/e2e/fixtures.ts`, walked by `e2e/accessibility-sweep.spec.ts` ([the design language](design-system.md#what-keeps-this-true))

## Infrastructure & DevOps

### Containerization

- **Docker** - Container platform
  - Multi-container application setup
  - Service orchestration via Docker Compose
  - The local stack, E2E and CI; production runs on Vercel (see [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md))

### Services (Docker Compose)

Every port is published on `127.0.0.1` only. A worktree's stack (`scripts/th-compose.sh`) offsets
the ports, caps each service's memory, CPU and processes, and starts mongo-express only with
`--profile tools` ([the treehouse runbook](../scripts/README-treehouse.md)).

1. **MongoDB** - Database service
   - `mongo:7`, port 27017
   - Persistent data volumes
   - Health checks configured

2. **Backend** - Flask API service
   - Port: 5001 (HTTPS with adhoc certificate; not 5000, [why](TESTING.md#testing-gotchas))
   - Restarts when a Python file in `back-end/` changes (`flask run --reload`)
   - `back-end/` is bind-mounted into the container, so a `back-end/.env` is read by the running stack

3. **Frontend** - Vue development server
   - Port: 5173
   - Hot-reload enabled
   - Vite dev server with proxy

4. **Mongo Express** - MongoDB admin UI
   - Port: 8081
   - Database management interface

### Continuous Integration

- **GitHub Actions** - CI pipeline (`.github/workflows/test.yml`)
  - Runs on pushes and pull requests to `main` or `dev`
  - Its jobs, what each runs and which checks branch protection requires: [CI and the gate](implementation/testing/ci-and-the-gate.md)
- **GitHub Actions** - Release automation (`.github/workflows/release-please.yml`)
  - Runs [release-please](https://github.com/googleapis/release-please) on pushes to `main`
  - Opens/updates a Release PR (version bump + CHANGELOG) that, when merged, tags a release
  - See [RELEASING.md](./RELEASING.md) for the branch model and release cycle

## Authentication Flow

### User Registration

1. User submits registration form with CAPTCHA verification
2. Backend validates CAPTCHA token
3. Password is hashed with bcrypt; one longer than 72 bytes, which bcrypt does not read, is refused (400) and makes no account
4. User account created with `email_verified: false`, holding its verification link's SHA-256, never the link; the link expires in 1 hour, and asking again replaces it at once
5. Verification email sent via Resend
6. User clicks verification link in email
7. Email verified, account activated; the link verifies once

### Login Methods

1. **Password Login**
   - Email and password authentication
   - Requires email verification
   - Session-based authentication
   - Rate limited: ten tries per address and fifty per caller in 15 minutes, a try that signs in taken back (429 with the wait)
   - A password longer than 72 bytes, which bcrypt does not read, does not match

2. **Passwordless Login (OTP)**
   - User requests OTP via email
   - 6-digit code sent via Resend
   - Code expires in 5 minutes
   - Its tries are counted in the update that reads it; the fifth wrong code discards it and keeps its wait
   - Rate limited: ten tries per address and sixty per caller in 15 minutes, a try that signs in taken back (429 with the wait); another code is refused (429 with the wait) until an hour after the last one expired, unless it was used
   - Asking for a code is rate limited too: five requests per address and thirty per caller in 15 minutes (429 with the wait)

### Password Reset

1. User requests password reset
2. Reset link generated, and only its SHA-256 stored
3. Reset link sent via Resend email
4. Token expires in 1 hour; another reset is refused (429) until an hour after it expired, and past five requests per address or thirty per caller in 15 minutes every request is refused (429 with the wait)
5. User sets new password; the link is used once, the address is marked verified, and a sign-in code asked for before ends
6. Password hashed and stored; one longer than 72 bytes is refused (400) as at registration

## Security Features

- **Password Hashing**: Bcrypt with secure salt generation
- **Email Verification**: Required before account activation
- **CAPTCHA Protection**: reCAPTCHA v3 on registration
- **Rate Limiting**: every sign-in, code, reset-link, verification-link and sign-up request, counted per address and per caller in the database (`back-end/sign_in_limits.py`), before the account is looked up; a try that signs in is taken back; OTP and password reset requests also wait on the last
- **Token Expiration**: Time-limited tokens for verification and reset
- **Secure Sessions**: HTTP-only, `Secure`, `SameSite=Lax` cookies, signed with a `SECRET_KEY` that has no fallback
- **CORS Protection**: An explicit origin allowlist (`CORS_ALLOWED_ORIGINS`); `*` is refused, because the session cookie is credentialed
- **Boot-Time Defenses**: The app refuses to start unless every variable its public surface rests on is configured (see [RELEASING.md](./RELEASING.md#pre-deploy-required-production-environment))
- **Input Validation**: Pydantic models for type safety

## Environment Variables

### Backend

- `RESEND_API_KEY` - Resend email service API key. **Required**: the app refuses to boot without it (see [RELEASING.md](./RELEASING.md#pre-deploy-required-production-environment))
- `FRONTEND_URL` - The address organizers sign in at: email links, and Discord's OAuth2 redirect (this plus `/discord/connected`) (e.g., `http://127.0.0.1:5173`). Has no say in CORS. **Required**: outside the hatch the app refuses to boot unless it is an `https://` origin with no path
- `FROM_EMAIL` - Email address to send from. **Required**: outside the hatch the app refuses to boot without it or with Resend's shared `onboarding@resend.dev`, the default under the hatch
- `RECAPTCHA_SECRET_KEY` - Google reCAPTCHA v3 secret key. **Required**: the app refuses to boot without it
- `CORS_ALLOWED_ORIGINS` - Comma-separated browser origins allowed to make credentialed requests (e.g., `https://app.example.com`). **Required**: the app refuses to boot without it, and `*` is refused
- `SECRET_KEY` - Signs the Flask session cookie. **Required**: there is no fallback, and the app refuses to boot without it. Must be at least 32 characters, and every value this repository has published (the old `TEMP_KEY_CHANGE_IN_PRODUCTION` fallback, the env-template and deploy-guide placeholders) is refused by name - it is readable by anyone who can read the repo. Rotating it ends every session signed with the old key
- `TRUSTED_PROXY_HOPS` - How many proxies of this deployment's own a request passes through before it reaches Flask (Vercel: `1`; Flask exposed directly: `0`). **Required**: there is no default, because unset is not zero but unknown. It decides whose address organizer signup reports to reCAPTCHA, which scores on it - behind an unnamed ingress that is the ingress's address, for every caller in the world
- `ALLOW_INSECURE_LOCAL_DEV` - Local-development escape hatch for the eight required variables (default OFF; set `true`/`1`). Never set it on a deployment: a back end that sees a platform variable (`VERCEL`, `VERCEL_ENV`, `VERCEL_REGION`, `AWS_LAMBDA_FUNCTION_NAME`) refuses to boot with it, or with any of the three test flags below, on
- `DISABLE_CAPTCHA` - Test-only flag to skip reCAPTCHA verification (default OFF; set `true`/`1`). Honored only when `ALLOW_INSECURE_LOCAL_DEV` is also set
- `DISABLE_EMAIL` - Test-only flag to skip sending verification, password reset, and OTP emails via Resend, treating them as sent (default OFF; set `true`/`1`). Honored only when `ALLOW_INSECURE_LOCAL_DEV` is also set
- `DISCORD_FAKE` - Test-only flag to answer the Discord bot's requests from the fake servers in the database instead of Discord (`back-end/discord_fake.py`; default OFF; set `true`/`1`). Honored only when `ALLOW_INSECURE_LOCAL_DEV` is also set
- `MONGODB_URI` - A full MongoDB connection string (production's Atlas cluster); when set, the five below are not read
- `MONGODB_HOST` - MongoDB hostname (default: `127.0.0.1`; the compose file sets `mongodb`)
- `MONGODB_PORT` - MongoDB port (default: `27017`)
- `MONGODB_USER` - MongoDB username (default: `admin`)
- `MONGODB_PASSWORD` - MongoDB password (default: `secret`)
- `MONGODB_AUTH_DB` - The database the user authenticates against (default: `admin`)
- `SESSION_TYPE` - Where the organizer's session is kept: `filesystem` (on local disk: a container or VM) or `null` (in the signed cookie only: a serverless deployment, which has no disk that outlives a request). **Required**: there is deliberately no default, because neither value is right for both hosts, and the app refuses to boot without it
- `BUILD_COMMIT` - The commit the deployment was built from, which `/healthz` reports as `commit` (`null` when unset or blank). Set by the Deploy workflow on each deployment (`vercel deploy --env`), never by hand ([how a deploy proves itself](RELEASING.md#how-a-deploy-proves-itself))

### Frontend

- `VITE_FLASK_HOST` - API base path (`/api` in the template and the compose file, `https://api.conventioner.io` in production; no default). **Required to build**: with none, every API request goes to the front end's own origin, so `vite build` refuses without it
- `VITE_BACKEND_URL` - Backend URL for Vite proxy (default: `https://127.0.0.1:5001`; the compose file sets `https://backend:5001`)
- `VITE_RECAPTCHA_SITE_KEY` - Google reCAPTCHA v3 site key, from the same reCAPTCHA property as the back end's `RECAPTCHA_SECRET_KEY`. **Required to build**: it is baked into the bundle, and without it the front end sends a placeholder token that the back end hands to Google, who never issued it - so every organizer signup is rejected. `vite build` refuses without it
- `VITE_ALLOW_INSECURE_LOCAL_DEV` - the only thing that lets a bundle be built with no site key or no `VITE_FLASK_HOST` above (local development and E2E, where the back end runs with `DISABLE_CAPTCHA`, and the bundle budget's build in CI and `nm-test.sh`, which is measured and never deployed). Opt-in, warns on every build it allows, and must never be set on a deployed build: a build with Vercel's `VERCEL` set refuses it outright
- `BUILD_COMMIT` - The commit the build was made from, which the build writes to `/version.json` (`null` when unset or blank). Read from the build's process environment, not through `loadEnv` and not a `VITE_` variable, so no `.env` file sets it and the bundle never holds it. Set by the Deploy workflow (`vercel deploy --build-env`), never by hand

## Project Structure

```
Conventioner/
├── back-end/
│   ├── api/              # API endpoint modules
│   │   ├── users.py      # User authentication endpoints
│   │   ├── markets.py     # Market management + application form endpoints
│   │   ├── organizations.py  # Organization endpoints
│   │   ├── applications.py  # Sole owner of the `applications` collection
│   │   ├── applicants.py, applicant_auth.py  # The public applicant surface
│   │   ├── placements.py # The only writer of a market's assignment
│   │   ├── attendance.py, door.py  # Check-in, by the vendor and at the door
│   │   ├── floorplans*.py   # The floorplan routes: a location's layout, its image and placement
│   │   └── layouts.py    # The market's table types, their own write
│   ├── utils/            # Utility modules
│   │   ├── tokens.py     # Token/OTP generation
│   │   ├── email.py      # Email service integration
│   │   ├── captcha.py    # CAPTCHA verification
│   │   └── configured_secret.py  # Whether a variable holds a secret
│   ├── migrations/       # Database migration scripts
│   ├── assignment/       # Assignment algorithm logic
│   ├── services/         # Floorplan placement and GridFS storage
│   ├── app.py            # Flask application entry point
│   ├── datatypes.py      # Pydantic data models
│   ├── guards.py         # Every phase-transition precondition (the D16 registry)
│   ├── market_documents.py  # Canonical market document form + migration markers
│   ├── csv_import.py, csv_proposal.py, csv_start.py  # Importing a Google Form's responses
│   ├── db_config.py      # MongoDB connection configuration
│   ├── requirements.in   # Python dependencies, edited by hand
│   └── requirements.txt  # Their lock, from scripts/lock-backend-requirements.sh
├── front-end/
│   ├── src/
│   │   ├── views/        # Page components
│   │   ├── components/   # Reusable components
│   │   ├── stores/       # Pinia stores
│   │   ├── utils/        # Utility functions
│   │   ├── router/       # Vue Router configuration
│   │   └── App.vue       # Root component
│   ├── e2e/              # Playwright specs, page objects and seeds
│   ├── package.json      # Node.js dependencies
│   └── vite.config.ts   # Vite configuration
├── docs/                 # Documentation
├── docker-compose.yml    # Docker Compose configuration
└── README.md             # Project README
```

## Development Workflow

1. **Backend Development**
   - Flask development server with auto-reload
   - MongoDB connection via PyMongo
   - API endpoints tested via HTTP requests

2. **Frontend Development**
   - Vite dev server with HMR
   - TypeScript compilation
   - Proxy to backend API

3. **Database Migrations**
   - Python scripts in `back-end/migrations/`
   - Run migrations to update schema
   - Example: `python back-end/migrations/add_email_verification.py`
   - `migrate_phase.py` backfills `phase` on existing market documents (`isDraft: true` → `draft`, `isDraft: false` → `archived`). It is idempotent, and `--dry-run` previews the changes without applying them.
   - `migrate_is_draft_consistency.py` brings `isDraft` into agreement with `phase` on documents that store a phase. `isDraft` is now derived strictly from `phase`, but the old publish flow wrote `isDraft: false` without moving the phase - those markets are advanced to `archived` (their `isDraft` was the only publish signal they had, and the public check-in lookup now decides on phase, so confirming them as drafts would take a live market's URL off the air). Documents with no `phase` are left to `migrate_phase.py`. It is idempotent, and `--dry-run` previews the changes without applying them.
   - `create_applications_collection.py` creates the `applications` collection and its indexes on an already-deployed database (`mongo-init.js` only runs on a fresh data volume). Two indexes are built: `market_id` (the lookup the D9 lock counts on) and a unique compound index on `(market_id, applicant_email, application_type)` that enforces the one-applicant-per-market guarantee. The migration refuses loudly with an actionable message if the collection already holds duplicates. It is idempotent, and `--dry-run` previews the changes without applying them.
   - `migrate_market_keys.py` rewrites market documents into canonical form: camelCase keys (`organization_id` → `organizationId`) plus a stored slug derived from the name. It drops the legacy snake_case spelling so no document carries both, stamps the slug on documents written before `Market.slug` existed, and builds the `market_slug` index the public lookup queries. It is idempotent, and `--dry-run` previews the changes without applying them.
   - The back end **refuses to boot** until `migrate_market_keys.py` has recorded every one of its markers (`market_document_keys`, `market_slugs` and `market_slugs_unique`) in the `schema_migrations` collection. Reads name the canonical key only, so an unmigrated market is invisible rather than broken, and the public slug lookup names the stored slug, so a market without one is unreachable at every public URL - a silent refusal to serve is worse than a loud refusal to start. A Mongo volume created before the migration existed has no marker, so an existing dev stack hits this - recover with `docker compose run --rm backend python migrations/migrate_market_keys.py` (`run`, not `exec`: the back-end container is crash-looping). See the Troubleshooting section of `docs/STARTUP.md`.

## External Services

### Resend (Email Service)

- **Purpose**: Transactional email delivery
- **Use Cases**:
  - Email verification
  - Password reset links
  - OTP codes for passwordless login
- **Configuration**: API key required
- **Documentation**: https://resend.com/docs

### Google reCAPTCHA v3

- **Purpose**: Bot protection and spam prevention
- **Use Cases**: Registration form protection
- **Configuration**: Site key (frontend) and secret key (backend)
- **Documentation**: https://developers.google.com/recaptcha/docs/v3

### Discord

- **Purpose**: Conventioner's one bot, added to an organizer's server, gives a market's vendors its role
- **Use Cases**: the Discord card, on a market's Tools tab, connects a market to a server; the Vendors page's Check Discord reads who is in it, and Give roles gives the market's role to the assigned vendors ([the Discord connection](implementation/modules/discord.md))
- **Configuration**: optional; client id, client secret and bot token, all three or Discord is off; called over REST only, with `requests`
- **Documentation**: https://docs.discord.com/developers

## Version Information

- **Python**: 3.12 (`back-end/.python-version`; Docker, CI and Vercel all run it)
- **Node.js**: 24.22.1, with npm 11.19.1 (`.nvmrc`; machines, CI and the front-end Dockerfile all run it, and Vercel the latest 24.x: [Node and npm are pinned](#node-and-npm-are-pinned))
- **MongoDB**: 8.0 in production; 7 locally and in CI ([the MongoDB version](implementation/testing/real-mongo-suite.md#the-mongodb-version))
- **Docker**: Latest stable version

## Additional Resources

- [Flask Documentation](https://flask.palletsprojects.com/)
- [Vue 3 Documentation](https://vuejs.org/)
- [MongoDB Documentation](https://docs.mongodb.com/)
- [Vite Documentation](https://vitejs.dev/)
- [Resend Documentation](https://resend.com/docs)
- [reCAPTCHA v3 Documentation](https://developers.google.com/recaptcha/docs/v3)
