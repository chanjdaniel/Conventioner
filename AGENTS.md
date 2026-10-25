# Project agent memory

Conventioner runs a vendor market from applications to the door, in production at `conventioner.io`: an organizer plans the market, takes applications on its own page or imports a Google Form's responses, reviews them, assigns every approved vendor a table by the market's rules, publishes the result, and checks vendors in on the day.
This file holds what nearly every session needs; everything else is in the knowledge graph, reached through the index below.

## Tech Stack

- Front-end: Vue 3 + Vite + TypeScript (in `front-end/`), PrimeVue UI components, Pinia state management; Node 24.19.0 and its npm, pinned in `.nvmrc` (`nvm install`).
- Back-end: Python 3.12 / Flask + MongoDB (in `back-end/`); `back-end/.python-version`, the Dockerfile and CI agree.
- Testing: Vitest (unit) + Playwright (e2e) for front-end; pytest for back-end.
- CI: `.github/workflows/test.yml` runs on `dev` and `main` for both PRs and pushes.
- The whole stack, its versions and its folders: [`docs/TECH_STACK.md`](docs/TECH_STACK.md).

## Branch Model

- `dev` is the default/integration branch: all feature PRs target `dev`.
- `main` is the deploy-only branch: reached ONLY by promoting a green `dev` commit (`git push origin <sha>:main`), and a green CI run on it deploys.
  Both branches require the five CI checks; after a Release PR (merged with `--admin`, it gets no CI), merge `main` back into `dev`.
- Never commit directly to `main`.
  Never open PRs targeting `main` (except the release-please Release PR, which is automated).
- **Promotion is a fast-forward, and a green CI run on `main` deploys it**: `.github/workflows/deploy.yml` ships the back end, checks `/healthz`, then the front end (`conventioner.io`, `api.conventioner.io`); Vercel's own deploys of `main` are off.
  After an Instant Rollback, promote a build again or no deploy reaches the domain.
  A hotfix goes through `dev` when nothing unreleased waits there, else through a `hotfix/` branch from `main`.
  See [`docs/RELEASING.md#hotfixes`](docs/RELEASING.md#hotfixes).

## Commits and releases

- All commits MUST follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, etc.): release-please derives every version from them (`feat:` → minor, `fix:` → patch, breaking → major).
- Never edit `CHANGELOG.md` by hand: release-please writes it.
- Never reintroduce `release-as` in `release-please-config.json`: it overrides the version calculation on *every* run until cleared, and the one-time `0.1.0` bootstrap that used it is gone.
- Full release docs: [`docs/RELEASING.md`](docs/RELEASING.md).

## Irreversible-safety rules

- **Never put the production `MONGODB_URI` in `back-end/.env`**: the local stack mounts that directory and would run against production.
  Pass it inline to one-off scripts.
  `reset_database.py` refuses whenever `MONGODB_URI` is set.
- **An operator makes or verifies an account with `back-end/create_account.py`**, never `create_test_user.py` (a fixture script that prints the password).
- **Real applicant data never leaves the PC**: `.scratch/examples/` holds the organizers' real Google Form exports, untracked; never commit, quote or paste from them.
  The committed hooks (`.githooks/`, installed with `git config core.hooksPath .githooks`) refuse a real email, phone or name before a commit or push; the gate and CI check again.
  Use fixture values, and never `--no-verify`; see [real data never leaves the PC](docs/implementation/conventions/security-invariants.md#real-data-never-leaves-the-pc).
- **There is no fallback signing secret anywhere in this repository** and there must never be one again - not even "for dev".
  A committed fallback is a published key; see [ADR 0010](docs/adr/0010-no-secret-has-a-fallback.md).
- Running production, its variables and its incidents: [`docs/OPERATIONS.md`](docs/OPERATIONS.md); rebuilding it from nothing: [`docs/VERCEL_DEPLOYMENT.md`](docs/VERCEL_DEPLOYMENT.md).

## Running the stack and the suites

- **Bring a worktree's stack up with `scripts/th-compose.sh up -d`**: email is off in it unless you pass `DISABLE_EMAIL=false`; mongo-express starts only with `--profile tools`.
  The primary checkout's plain `docker compose up -d` needs `DISABLE_EMAIL=true`, or the password-reset E2E 500s on the missing `RESEND_API_KEY`.
  Every stack listens on `127.0.0.1` only.
  A worktree's stack and ports come from its treehouse slot: [`scripts/README-treehouse.md`](scripts/README-treehouse.md).
- **Run E2E**: `./scripts/seed_fixture.sh` then `cd front-end && npm run test:e2e`.
  Playwright config auto-detects worktree port via `stack().frontendPort`.
- Back end: `cd back-end && python -m pytest tests/ -v`, with both `requirements.txt` and `requirements-dev.txt` installed.
  Front-end unit tests: `cd front-end && npm run test:unit`.
- **Run `npm run format` in `front-end/` before committing**: CI's `format:check` fails unformatted front-end code.
- `scripts/nm-test.sh --skip-e2e` runs everything the no-mistakes gate runs; without the flag it adds Playwright, on an isolated stack of its own.
  Before a merge, Playwright runs only in CI's required `e2e` shards ([CI and the gate](docs/implementation/testing/ci-and-the-gate.md#the-no-mistakes-gate)).
- Setting up a machine: [`docs/STARTUP.md`](docs/STARTUP.md); every suite and its gotchas: [`docs/TESTING.md`](docs/TESTING.md).

## Knowledge graph

- **Durable knowledge lives in the graph, entered at [`docs/README.md`](docs/README.md).**
  Nodes live in `docs/business/{concepts,flows,rules,intents}/`, `docs/implementation/{modules,data,conventions,testing}/`, `docs/adr/` and `docs/records/`, each folder listed by its `README.md`; the runbooks, `docs/TESTING.md`, `docs/TECH_STACK.md` and `docs/design-system.md` are nodes where they stand.
- **A node is a Markdown file with frontmatter**, exactly these keys in this order: `layer`, `kind`, `describes` (the code it is about: a file, a `dir/`, or `file#symbol`), `verified` (the day it was read against the code), `sources` (work-item ids, never links) and, on an ADR only, `status`.
  Links are relative Markdown links, and a link across the business/implementation line is answered by one back.
- **A PR that changes a described file touches the node or bumps `verified`.**
  Find a file's nodes before changing it with `git grep -l '<path>' docs`; CI's `knowledge-graph-drift` job fails on a PR that does neither; it is not required, for the next 10 PRs from 2026-10-22, then re-judged with the close-out's replay, while `knowledge-graph` (the checker's tests and `check`) is a required check.
- **`python3 scripts/knowledge_graph.py check`** checks the frontmatter, every link and anchor, reachability and back-links; run it after editing any Markdown.

## Before changing an area, read its node

The market on screen:

- Before changing how a screen gets, holds or writes a market, read [one market, from the server](docs/implementation/conventions/one-market-from-the-server.md) and [the market store](docs/implementation/modules/market-store.md).
- Before changing a market route or link, read [every market page has an address](docs/implementation/conventions/every-market-page-has-an-address.md).
- Before changing the market bar, its tabs or a market screen's layout, read [the market frame](docs/implementation/modules/market-frame.md).
- Before changing what a screen says in a phase or on an intake path, read [the market guide](docs/implementation/modules/market-guide.md).
- Before changing the phase rail, read [the phase rail](docs/implementation/modules/phase-rail.md).
- Before changing styles, tokens or a control's look, read [the design language](docs/design-system.md) and [every control is named](docs/implementation/conventions/every-control-is-named.md).
- Before writing or changing a dialog, read [dialogs](docs/implementation/conventions/dialogs.md).

The market's lifecycle:

- Before changing a phase move or a precondition, read [the guards and the phase move](docs/implementation/modules/guards.md) and [ADR 0005](docs/adr/0005-phase-is-the-only-lifecycle-state.md).
- Before changing the phase history or "did this market run", read [the phase record](docs/implementation/modules/phase-record.md).
- Before changing what Market Setup may change after draft, read [the setup settles on leaving draft](docs/business/rules/the-setup-settles-on-leaving-draft.md).
- Before changing who may do what on a market, read [what each role may do](docs/business/rules/what-each-role-may-do.md) and [an archived market is read-only](docs/business/rules/an-archived-market-is-read-only.md).
- Before changing the application form builder or its lock, read [the form locks at the first application](docs/business/rules/the-form-locks-at-the-first-application.md) and [essential fields](docs/implementation/modules/essential-fields.md).
- Before changing a verdict or when review closes, read [verdicts settle on entering assignment](docs/business/rules/verdicts-settle-on-entering-assignment.md).
- Before changing Publish Results or what an applicant sees of it, read [Publish Results waits for the allocation](docs/business/rules/publish-results-waits-for-the-allocation.md) and [an applicant never reads a verdict early](docs/business/rules/an-applicant-never-reads-a-verdict-early.md).

Vendors coming in:

- Before changing intake mode or the applicant surface, read [intake mode decides how vendors arrive](docs/business/rules/intake-mode-decides-how-vendors-arrive.md), [a gated market answers as absent](docs/business/rules/a-gated-market-answers-as-absent.md) and [ADR 0006](docs/adr/0006-intake-mode-fails-closed.md).
- Before changing applicant sign-in, read [a vendor signs in before they have applied](docs/business/rules/a-vendor-signs-in-before-applying.md).
- Before changing the CSV import, read [the CSV import](docs/implementation/modules/csv-import.md) and [the form amendment](docs/implementation/modules/form-amendment.md).
- Before changing the start from a CSV or what reaches TypeSafe, read [the CSV proposal and start](docs/implementation/modules/csv-proposal-and-start.md) and [ADR 0007](docs/adr/0007-what-may-be-sent-to-hosted-typesafe.md).

The assignment:

- Before changing the solver or a placement rule, read [the assignment solver](docs/implementation/modules/assignment-solver.md) and [the assignment behaviour suite](docs/implementation/testing/assignment-behaviour-suite.md); the rules it keeps are listed in [business/rules/](docs/business/rules/README.md).
- Before changing a placement, a pin or a swap, read [placements](docs/implementation/modules/placements.md) and [ADR 0002](docs/adr/0002-a-pin-is-a-placement-row.md).
- Before changing what an assignment remembers of its inputs, read [what an assignment was made from](docs/implementation/modules/made-from.md).
- Before changing check-in or the attendance page, read [attendance and the door](docs/implementation/modules/attendance-and-door.md).
- Before changing the floorplan beta or Auto-Place, read [floorplan placement](docs/implementation/modules/floorplan-placement.md).

The data and the back end:

- Before writing a raw Mongo read, filter or write on a market, read [the market document](docs/implementation/data/market-document.md).
- Before changing how applications are stored, read [the application document](docs/implementation/data/application-document.md).
- Before changing organizations, membership or market roles, read [the organization document, and roles](docs/implementation/data/organization-document.md).
- Before changing accounts or how an address is compared, read [users, and the one spelling of an address](docs/implementation/data/users-and-email.md).
- Before adding a query on a new field, read [lookup indexes](docs/implementation/data/lookup-indexes.md).
- Before adding or moving a back-end Python dependency, read [Python dependencies are locked](docs/TECH_STACK.md#python-dependencies-are-locked).
- Before changing the Node or npm version, or writing `front-end/package-lock.json`, read [Node and npm are pinned](docs/TECH_STACK.md#node-and-npm-are-pinned).
- Before deleting a market or an organization, or adding a collection keyed by market, read [market deletion](docs/implementation/modules/market-deletion.md) and [when an organization may be deleted](docs/business/rules/when-an-organization-may-be-deleted.md).
- Before changing a secret, a boot check, an environment variable or the real-data hooks, read [security invariants](docs/implementation/conventions/security-invariants.md) and the environment table in [`docs/RELEASING.md`](docs/RELEASING.md).
- Before answering a back end that refuses to boot, read [`docs/OPERATIONS.md`](docs/OPERATIONS.md#when-the-back-end-refuses-to-boot).

Tests and CI:

- Before writing or changing an E2E spec, read [E2E patterns](docs/implementation/testing/e2e-patterns.md) and [E2E seeds](docs/implementation/testing/e2e-seeds.md).
- Before adding a test that spans the organizer's journey, read [the market journey spec](docs/implementation/testing/the-market-journey-spec.md).
- Before extending floorplan coverage, read [floorplan E2E](docs/implementation/testing/floorplan-e2e.md).
- Before changing CI, `.no-mistakes.yaml` or `nm-test.sh`, read [CI and the gate](docs/implementation/testing/ci-and-the-gate.md).

## Agent skills

### Issue tracker

- The durable Epic > Feature > Story backlog and the Wayfinder maps live in the team home, `~/agent-team/projects/conventioner/{backlog,wayfinding}/` (the private `chanjdaniel/agent-team` repo), not in this repo.
- `.scratch/` is the task's transient, ignored working folder: `/to-spec` writes `.scratch/spec.md` and `/to-tickets` writes `.scratch/tickets/`.
- A Story's status moves in the team home as its Conventioner PR merges; GitHub is used for pull requests only, and its issue tracker is deliberately empty.
- [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md) has the rest: the hierarchy, who moves status, and where every work-item id and `sources` string resolves.

## Maintaining this file

- This file holds only what nearly every session needs before it knows which area it is in: the stack, the branch model, the irreversible-safety rules, the commands, the graph's contract and the index.
- Durable knowledge about one area goes to a node in the graph, read against the code first ([adding a node](docs/README.md#adding-a-node)), not here.
- When a new area gains a node, the index gains one line: "Before changing X, read [node]".
- Point to the authoritative file or command rather than repeating what the codebase already shows, and prefer rewriting or pruning a line over appending one.
