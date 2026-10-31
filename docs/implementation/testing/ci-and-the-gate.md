---
layer: implementation
kind: testing
describes:
  - .github/workflows/test.yml
  - .github/dependabot.yml
  - .no-mistakes.yaml
  - scripts/nm-test.sh
  - scripts/e2e-lock.sh
  - scripts/image-tags.sh
  - scripts/th-compose.sh
  - front-end/e2e/helpers/stack.ts
  - front-end/e2e/helpers/containerNames.ts
  - front-end/scripts/bundle-budget.ts
  - front-end/scripts/no-eval.ts
verified: 2026-10-28
sources:
  - T47
  - T53
  - T74
  - T84
  - T109
---

# CI and the gate

Two things run the suites before code reaches `dev`: GitHub Actions on every push and pull request, and the no-mistakes gate on a branch pushed through it.
[Dependabot's pull requests](#dependabot) meet only the first.
What each suite covers is [TESTING.md](../../TESTING.md); how a commit reaches production is [RELEASING.md](../../RELEASING.md).

## CI

[`.github/workflows/test.yml`](../../../.github/workflows/test.yml) runs on pushes and pull requests to `dev` and `main`.
Its token is read-only (`permissions: contents: read`), every action is pinned by its full commit SHA with the version in a comment beside it, which [Dependabot](#dependabot) bumps together, and no checkout keeps its git credentials (`persist-credentials: false`), since no job pushes.
No `${{ }}` expression is written inside a `run:` script: a value reaches the shell through the step's `env:` and is read as a variable.

| Job | Runs |
| --- | --- |
| `backend` | Python 3.12, the locks `requirements.txt`, `requirements-floorplan-solver.txt` and `requirements-dev.txt`, a re-lock that fails on any difference ([the locks](../../TECH_STACK.md#python-dependencies-are-locked)), then pytest |
| `frontend-unit` | the Node `.nvmrc` pins, `npm ci`, Vitest |
| `frontend-lint-and-types` | a check that the Node is `.nvmrc`'s, `npm ci --engine-strict` (the npm is `engines.npm`), and a check that npm writes the committed lockfile unchanged ([Node and npm are pinned](../../TECH_STACK.md#node-and-npm-are-pinned)), then Prettier's `format:check`, ESLint, Stylelint (`lint:css`, the [design language](../../design-system.md) gate), the type-check, and a `vite build` measured against [the bundle budget](#the-bundle-budget) and checked for [no string evaluated as script](#no-string-evaluated-as-script) |
| `knowledge-graph` | pytest from `back-end/requirements-dev.txt`, the scripts' tests (on the Node `.nvmrc` pins, since the pre-warm's tests run its npm) and `knowledge_graph.py check` |
| `knowledge-graph-drift` | on a pull request only, `knowledge_graph.py drift` against the base branch; it clones the full history for that |
| `real-data` | on a pull request only, [`real_data_check.py`](../../../scripts/real_data_check.py) on the PR's commits since the base branch and then on every file of the merge it checks out (`tree`), then gitleaks 8.28.0 (checksum-verified, fully redacted) on the same commits; the backstop to the git hooks and the gate, which run the checker before anything is pushed ([real data never leaves the PC](../conventions/security-invariants.md#real-data-never-leaves-the-pc)) |
| `zizmor` | [zizmor](https://docs.zizmor.sh/) 1.31.1 (checksum-verified) with `--offline` over the repository, which audits the three workflows and `dependabot.yml` without a token; any finding fails the job, and its log names the audit, file and line; an accepted finding is ignored on its own line as `# zizmor: ignore[<audit>] <reason>`, and there is no zizmor config file, so nothing is ignored wholesale |
| `zizmor-online` | on a pull request only, the same zizmor without `--offline`, given the run's read-only token, so it adds the audits that look actions up on GitHub: an impostor commit, a known-vulnerable action or a confused ref behind a pin; information, not a required check, because it depends on GitHub's API |
| `docker-build` | `docker compose build` |
| `e2e-shard` | four runners, each building and starting its own stack, seeding it with `seed_fixture.sh --primary` and running a quarter of the Playwright suite by spec file, with `DISABLE_CAPTCHA` and `DISABLE_EMAIL` set; it pulls `mongo:7` and `mongo-express:latest` from Docker Hub before the start and retries only that pull a handful of times, because a transient registry 500 once failed a shard outright, so a stack that genuinely fails to start fails the shard at once; it posts a flaky-test summary on every run, and on failure uploads the report |
| `e2e` | passes only when every shard did |

**Branch protection requires ten checks on `dev` and six on `main`.**
Both require `backend`, `frontend-unit`, `frontend-lint-and-types`, `docker-build`, `e2e` and `zizmor`.
`dev` also requires `knowledge-graph`, `real-data`, [`CodeQL`](#codeql) and `agent-review`, a commit status the agent team's reviewer sets on a pull request's head rather than a CI job.
`dev`'s protection binds admins too (`enforce_admins`), so nothing merges into it, the merge of `main` back into `dev` included, without all ten, short of changing the protection itself; `main`'s does not, which is how the Release PR merges with `--admin` ([RELEASING.md](../../RELEASING.md#how-a-release-happens)).
`e2e` is a job of its own so protection names one check whatever the shard count becomes.
`knowledge-graph-drift` is its own job and not required, for the next 10 PRs from 2026-10-22, then re-judged with the close-out's replay.
`zizmor-online` is never required: a rate limit or outage of GitHub's API would otherwise block a merge, and `zizmor` already holds the workflows to the offline audits.
`real-data` is the only real-data check the gate's own commits get: the document, lint and CI-fix steps commit after `nm-test.sh` has run, and the gate pushes them from its repository, which has no hooks installed ([real data never leaves the PC](../conventions/security-invariants.md#real-data-never-leaves-the-pc)).

**A flaky test fails the build.**
Under `CI`, Playwright retries twice and sets `failOnFlakyTests` ([`front-end/playwright.config.ts`](../../../front-end/playwright.config.ts)), so a test that passes only on a retry still fails its shard.
Within a shard the tests share one database (`workers: 1`); never across shards.

## The bundle budget

**CI fails a pull request whose entry JavaScript grows past a set gzipped size.**
The entry JavaScript is what a first visit downloads before any page paints: the module script `dist/index.html` loads and every chunk it preloads, not a route's lazily loaded chunk.
[`front-end/scripts/bundle-budget.ts`](../../../front-end/scripts/bundle-budget.ts) (`npm run bundle-budget`, after `npm run build-only`) gzips each at level 9, prints every chunk's size and the total against the limit on every run, and exits non-zero above it.
It runs in the required `frontend-lint-and-types` job and in `nm-test.sh`, both on a build made with `VITE_ALLOW_INSECURE_LOCAL_DEV=true`, since the bundle is measured and never deployed.

The limit is `LIMIT_GZIP_BYTES` in that script, set a few KB above the total measured when it landed (102220 B against 105000 B, T76), and lowered when the total fell (85740 B against 89000 B, T84, when vuedraggable stopped bringing a second Vue).
It landed because nothing noticed `main.ts` installing vue-konva for the whole app, which put the floorplan canvas library on every page, `/login` included, for about 60 KB gzipped.
**Raise the limit only on purpose**: in the same pull request as the code that needs it, saying there what the extra bytes buy, and still a few KB above the new total so the next unplanned growth fails.
The first fix to try is a lazily loaded route or component, which keeps the code out of the entry.

## No string evaluated as script

**CI fails a build any of whose JavaScript calls `eval` or the `Function` constructor.**
The front end's [Content-Security-Policy](../conventions/security-invariants.md#security-headers) has no `'unsafe-eval'`, so such a call is refused once the policy enforces and reported while it is report-only, and with no reporting endpoint a report in production reaches nobody.
[`front-end/scripts/no-eval.ts`](../../../front-end/scripts/no-eval.ts) (`npm run no-eval`, after `npm run build-only`) reads every `.js` file under `dist/assets/`, prints each call with its file and a little context, and exits non-zero on any; it runs right after the bundle budget, on the same build, in `frontend-lint-and-types` and in `nm-test.sh`.
The first one it would have caught was vuedraggable's UMD build, whose bundled core-js finds the global object with `Function('return this')()` and whose `require("vue")` pulled in a second Vue with its template compiler; `vite.config.ts` resolves `vuedraggable` to the ES source the package publishes beside its builds, which has neither.

## CodeQL

GitHub's CodeQL default setup, a repository setting with no workflow file here, analyses `actions`, `javascript-typescript` and `python` with the default suite, on every pull request to `dev` and weekly on `dev`.
Each pull request gets an `Analyze (actions)`, an `Analyze (javascript-typescript)` and an `Analyze (python)` check, and a `CodeQL` check from `github-advanced-security` that reports the alerts new in the code it changed.
It is the automated backstop for [a request value is a string](../conventions/a-request-value-is-a-string.md) (`py/nosql-injection`) and [an exception never reaches a client](../conventions/an-exception-never-reaches-a-client.md) (`py/stack-trace-exposure`).
**`CodeQL` is a required check on `dev`** (since 2026-10-28): it fails a pull request that brings in a new security alert of medium severity or above, or a new standard alert of severity error.
Those are the repository's check-run failure thresholds (Settings, Code security, protection rules): "Medium or higher" for security alerts, lowered from the default "High or higher" because `py/stack-trace-exposure` is a medium, and "Only errors" for standard alerts, which have a rule severity rather than a security one.
The three `Analyze (<language>)` checks are not themselves required: they make the analyses the `CodeQL` check reads.
`main`'s six checks are unchanged: nearly every commit reaches `main` by promotion from `dev`, where it has already passed `CodeQL`, and the others are the Release PR, merged with `--admin`, and a [hotfix](../../RELEASING.md#hotfixes).

## Dependabot

[`.github/dependabot.yml`](../../../.github/dependabot.yml) has Dependabot open version-update pull requests weekly, for `npm` in `front-end/` and for the workflows' `github-actions`.
It has no `pip` entry: the back end's hashed locks are written by `uv` through `scripts/lock-backend-requirements.sh` ([the locks](../../TECH_STACK.md#python-dependencies-are-locked)), and that Dependabot writes them as the script does is unverified, so a back-end version bump is made by hand with the script.
Dependabot alerts, and the security-update toggle, are repository settings, not this file: they follow the dependency graph, so a `pip` security update can still arrive as a pull request; make it with the script rather than merging Dependabot's lock edits.

**Its pull requests target `dev`**, the default branch, and their titles are Conventional Commits that release-please reads:

| Updates | Title |
| --- | --- |
| an npm production dependency | `fix(deps): ...` |
| an npm development dependency | `chore(deps-dev): ...` |
| a GitHub Action | `ci(deps): ...` |

The release effect of each type is the one in [RELEASING.md](../../RELEASING.md#conventional-commits); the npm split by dependency type keeps a tooling bump from carrying a `fix` title.
A week's minor and patch bumps come as one pull request per group (npm production, npm development, Actions), so CI runs once for each; a major bump comes on its own.
**A new release waits a week** (`cooldown: default-days: 7` on both updaters) before Dependabot proposes it, so a bad release has time to be pulled before CI runs it.
Security updates are not delayed: GitHub applies no cooldown to them.
The Actions updater bumps the workflows' SHA pins and the version comments beside them.
A major the project cannot take yet is held with an `ignore` entry in the file, whose comment gives the reason, any upstream issues and when to try again, so next week's batch does not reopen it.
The holds today:

- `typescript` 7: 7.0 ships no JavaScript API, so `vue-tsc` and typescript-eslint cannot run on it.
- `@types/node` 25 and later: the types follow the Node major `.nvmrc` pins, 24, and move with that pin ([Node and npm are pinned](../../TECH_STACK.md#node-and-npm-are-pinned)), so a type check never accepts an API the running Node lacks.

The component kit's and icon font's next majors were held too, for their proprietary licence, until T45 removed both packages ([ADR 0015](../../adr/0015-the-app-owns-its-components.md)).

For these ecosystems, security updates take the same titles, and always target the default branch.

**Dependabot's pull requests bypass the no-mistakes gate**: CI's required checks are their gate, and a person reads each before merging it.
A bump to a described file turns the non-required `knowledge-graph-drift` job red: `front-end/package.json` for [TECH_STACK.md](../../TECH_STACK.md), a workflow for this node and [RELEASING.md](../../RELEASING.md).
That is expected; a reviewer re-reads each affected node and bumps its `verified`.

## The no-mistakes gate

[`.no-mistakes.yaml`](../../../.no-mistakes.yaml) sets `allow_repo_commands: true` and one command, `test: ./scripts/nm-test.sh --skip-e2e`.
**The gate reads `allow_repo_commands` only from the repository's default branch, `dev`**, so a pushed branch cannot turn it on for itself; with it on, as `dev` has it, the gate runs the pushed branch's own `commands`, not `dev`'s.
That is safe here only because every branch pushed through the gate is the team's own: the no-mistakes [repo config reference](https://kunchenguid.github.io/no-mistakes/reference/repo-config/) says to leave it `false` for a repository that accepts contributions.

**The gate leaves Playwright to CI.**
Its test step runs every suite but Playwright, and Playwright runs before a merge only in CI's four `e2e-shard` jobs, which branch protection requires as `e2e` and the gate's CI step waits for and can fix.
On the laptop, Playwright was about 90% of the gate's test step (22 minutes on a quiet machine, 46 to 65 under the team's load, and red on load alone in 3 of 8 runs), and CI then ran the same specs again in 6 to 7.5 minutes a shard (T47's report).
So a pull request opens before its Playwright has passed, and CI reports an E2E failure a few minutes later; nothing merges red, because `e2e` is required, and a red `e2e` is the gate's red to fix.
CI's run is also the stricter one: there `failOnFlakyTests` fails a test that passes only on a retry ([above](#ci)).
The first gate run with `--skip-e2e`, on the branch that added it, took 6.4 minutes for its test step, and its CI step waited for all four shards (6 to 6.5 minutes each) before it passed.

[`scripts/nm-test.sh`](../../../scripts/nm-test.sh) is the runner the gate invokes, and anyone may run it.
With `--skip-e2e`, as the gate runs it, it stops after Vitest, the [bundle budget](#the-bundle-budget) and [the eval check](#no-string-evaluated-as-script) with one line, `nm-test: --skip-e2e: Playwright is left to CI's e2e shards; no stack started.`, and starts no stack, sets no teardown trap and takes no end-to-end lock; without it, it runs everything below.
It runs, in order, the real-data check on the branch's commits since `origin/dev` and then on every file of the tree at `HEAD` (before anything else, and failing the run on a finding, since the gate pushes the branch), the scripts' tests and the knowledge graph's `check`, back-end pytest (installing `requirements.txt`, the floorplan solver's and the dev requirements, then re-locking them as CI does), front-end Vitest, a `vite build` held to the bundle budget and checked for no string evaluated as script, and Playwright against a Docker stack of its own, with `DISABLE_CAPTCHA` and `DISABLE_EMAIL` set.
Its Python is `PYTHON_CMD`, else `python3.12` (`back-end/.python-version`), else `python3`, and it installs nothing into that Python: it makes a virtual environment of its own from it, installs there, and a guard deletes it once the run is gone, since a uv- or distro-managed Python refuses `pip install` outright (PEP 668).
Its stack is isolated: a unique `COMPOSE_PROJECT_NAME` (`nmtest-<pid>`), and host ports Docker assigns as the stack starts (`TH_PORTS=auto`, [below](#stack-identity)), so two runs started together can never race for one port, as runs that each probed for a free port before starting could.
Once the stack is up, the run reads its ports back with `th-compose.sh ports` and exports them for `seed_fixture.sh` and Playwright.
mongo-express is not started (it is in the overlay's `tools` profile).
It builds no image of its own: its stack runs the images every worktree and `nm-test.sh` stack with the same dependencies shares, `conventioner/backend:<tag>` and `conventioner/frontend:<tag>`, each tag a hash of the files its image is built from ([`scripts/image-tags.sh`](../../../scripts/image-tags.sh)), and `th-compose.sh ensure-images` builds one only when no image has its tag yet, so a run whose dependencies did not change builds nothing.
The source reaches the containers through the bind mounts, so the images do not depend on it.
It labels its stack `TEAM_KIND=gate`, the value the team's reaper reads, kept although only a run without `--skip-e2e` starts a stack and the gate's own runs start none; it also sets `TEAM_WORKTREE` (its repository root), `TEAM_EXPIRES` (two hours after its start) and, only when `TEAM_TASK` is set, `TEAM_OWNER=agent-team`; the [worktree overlay](../../../scripts/README-treehouse.md) puts those labels on every container, volume and network, with `restart: "no"`, no bind mount that creates its missing source, every port on `127.0.0.1` and each service within its memory, CPU and process limits ([measured](../../TESTING.md#stack-limits)).

**A run's stack is gone within a minute, however the run ends.**

| The run | What tears its stack down |
| --- | --- |
| passes, fails, or is sent `SIGTERM` | the `EXIT` trap: it saves the back end's and front end's logs to `.stack-logs/`, then `down -v --remove-orphans`, printing any error |
| is aborted by the gate (`SIGTERM`, then `SIGKILL`, to its process group) | the teardown guard, since the `SIGKILL` kills the trap's own `docker` commands |
| is sent `SIGKILL` | the teardown guard, since nothing of the script runs after it |

The teardown guard is a subshell that `nm-test.sh` starts with job control just before `up`, so it has a process group of its own and the gate's group kill misses it.
It waits for the run's process to be gone, then runs `docker compose -p <project> down -v --remove-orphans` (no compose file, as the gate may already be deleting the worktree), up to three times, until no container, volume or network of the project is left; after a normal exit it finds nothing left.
It writes to `.stack-logs/<project>-guard.log`, not to the run's output, so it holds nothing of the gate's open once the run is over.
Should both fail, the stack's `expires` label tells the team's reaper it may remove it.
A second guard, started the moment the run makes its virtual environment (`$TMPDIR/nmtest-<pid>-venv.*`), removes it once the run is gone, so a run killed in any phase leaves nothing behind.

**Runs take turns for their E2E phase, one at a time on a machine.**
A stack starting or stopping creates or removes a Docker network, which changes the host's networks under every browser on the machine, and another run's Playwright then fails with `net::ERR_NETWORK_CHANGED`.
So from just after its images are built until its teardown is done, `nm-test.sh` holds an exclusive kernel lock on `${XDG_STATE_HOME:-$HOME/.local/state}/conventioner/e2e.lock` ([`scripts/e2e-lock.sh`](../../../scripts/e2e-lock.sh)), taken with `flock` on one of its file descriptors, or with Python's `fcntl` where `flock` is missing.
The kernel releases it when the last process holding that descriptor is gone: the run, and the teardown guard it starts just after taking it, so a killed run keeps the lock until its stack is down and a waiting run never starts beside a stack still being removed.
Every other command of the E2E phase (`up`, `seed_fixture.sh`, Playwright) runs with the descriptor closed, so a process one of them leaves behind, such as a browser, never keeps the lock.
The rest of the run (the knowledge graph, the back end's and the front end's unit tests, building a shared image whose dependencies changed) runs beside other runs.
A run that finds the lock held prints `nm-test: waiting for the end-to-end lock since <time>, held by <project> (pid <pid>, <worktree>) since <time>`, and `nm-test: has the end-to-end lock at <time>` once it has it; after 45 minutes without it the run fails with `no end-to-end slot within 45 minutes`.
To see who holds it and who waits: `cat ~/.local/state/conventioner/e2e.lock` names the last run to take it, and `lsof ~/.local/state/conventioner/e2e.lock` lists every process with it open, the holder and its guard, and each waiting run with its `flock`.
The lock is the one place T19's `team-capacity run --kind gate:conventioner` is to take over, keeping the lock as the fallback where `team-capacity` is absent; `nm-test.sh` does not call it yet, and the lock can go once the browser is isolated from the host's network changes.
`nm-test.sh` never calls `sudo`: it installs Chromium with `npx playwright install chromium`, never `--with-deps` or `install-deps`, because those run `sudo` with no terminal and each failed attempt counts toward the account's `pam_faillock` lockout; the machine's own package manager provides the system libraries.
CI's workflow keeps `--with-deps`, which is correct on GitHub's Ubuntu runners.
It does not run Prettier, ESLint, Stylelint or the type-check: CI does.

## Stack identity

Several stacks run on one machine (the primary checkout, each treehouse worktree, an `nm-test.sh` run), so every script and the E2E suite resolve which stack they mean in one order:

1. **Docker's ports** (`th-compose.sh` only): `COMPOSE_PROJECT_NAME` with `TH_PORTS=auto`, as `nm-test.sh` sets them.
   The wrapper leaves every host port empty (`127.0.0.1::<container port>`), so Docker picks each one as the container starts, and ignores any `TH_*_PORT` the caller set, so the stack's configuration is the same however it is called later.
   After an `up` it prints the assigned ports on stderr as `TH_MONGO_PORT=`, `TH_BACKEND_PORT=` and `TH_FRONTEND_PORT=` lines (and `TH_MONGO_EXPRESS_PORT=` when mongo-express runs).
   Without `COMPOSE_PROJECT_NAME` it refuses, even in a slot.
2. **Explicit variables**: `COMPOSE_PROJECT_NAME` with the `TH_*_PORT` variables, as `nm-test.sh` exports them once its stack is up.
3. **The treehouse slot** read from the path (`/.treehouse/<pool>/<N>/`): project `conventioner-N`, every port offset by `N * 10` ([the treehouse runbook](../../../scripts/README-treehouse.md)).
4. **Otherwise**: [`scripts/th-compose.sh`](../../../scripts/th-compose.sh) fails loud and sends the primary checkout to plain `docker compose`, and [`scripts/seed_fixture.sh`](../../../scripts/seed_fixture.sh) refuses before it touches anything, since it empties the stack's database: the default stack (the primary checkout's, or CI's one stack, which the `e2e` shards seed) takes `--primary`.
   It refuses as well when the environment names only part of a stack (some of `COMPOSE_PROJECT_NAME`, `TH_MONGO_PORT`, `TH_BACKEND_PORT` and `TH_FRONTEND_PORT`, not all), and `--primary` with any of them set or from a treehouse slot, where plain `docker compose` would name the project after the directory, the primary checkout's.
   It once fell back to the primary stack's defaults, and a gate run that seeded before exporting its own stack's ports wiped the primary checkout's local database.

The E2E suite's side is [`front-end/e2e/helpers/stack.ts`](../../../front-end/e2e/helpers/stack.ts), read by `playwright.config.ts`, `fixtures.ts` and [`helpers/containerNames.ts`](../../../front-end/e2e/helpers/containerNames.ts): the explicit variables, then the slot, then `CI` (one stack, named by `COMPOSE_PROJECT_NAME` or the directory), and otherwise it throws rather than guess, because a silent fall back to the primary stack once corrupted shared databases.
`BACKEND_URL`, `FRONTEND_PORT`, `E2E_MONGO_CONTAINER` and `E2E_BACKEND_CONTAINER` override it.
This order is what lets `nm-test.sh` run its stack from a worktree that has no treehouse slot without falling through to the primary stack.
`th-compose.sh ports` prints a running stack's project and ports as `export` lines, read from Docker with `docker compose port` in any of the wrapper's modes, so `eval "$(scripts/th-compose.sh ports)"` gives a shell, `seed_fixture.sh` and the suite the explicit variables of a stack whose ports Docker picked.
It fails when the stack's MongoDB, back end or front end is not running.
