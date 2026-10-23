---
layer: implementation
kind: testing
describes:
  - .github/workflows/test.yml
  - .no-mistakes.yaml
  - scripts/nm-test.sh
  - scripts/e2e-lock.sh
  - scripts/image-tags.sh
  - scripts/th-compose.sh
  - front-end/e2e/helpers/stack.ts
  - front-end/e2e/helpers/containerNames.ts
verified: 2026-10-24
---

# CI and the gate

Two things run the suites before code reaches `dev`: GitHub Actions on every push and pull request, and the no-mistakes gate on a branch pushed through it.
What each suite covers is [TESTING.md](../../TESTING.md); how a commit reaches production is [RELEASING.md](../../RELEASING.md).

## CI

[`.github/workflows/test.yml`](../../../.github/workflows/test.yml) runs on pushes and pull requests to `dev` and `main`.

| Job | Runs |
| --- | --- |
| `backend` | Python 3.12, `requirements.txt`, `requirements-floorplan-solver.txt` and `requirements-dev.txt`, then pytest |
| `frontend-unit` | Node 20, `npm ci`, Vitest |
| `frontend-lint-and-types` | Prettier's `format:check`, ESLint, Stylelint (`lint:css`, the [design language](../../design-system.md) gate) and the type-check |
| `knowledge-graph` | the checker's tests and `knowledge_graph.py check` |
| `knowledge-graph-drift` | on a pull request only, `knowledge_graph.py drift` against the base branch; it clones the full history for that |
| `docker-build` | `docker compose build` |
| `e2e-shard` | four runners, each building and starting its own stack, seeding it with `seed_fixture.sh` and running a quarter of the Playwright suite by spec file, with `DISABLE_CAPTCHA` and `DISABLE_EMAIL` set; it pulls `mongo:7` and `mongo-express:latest` from Docker Hub before the start and retries only that pull a handful of times, because a transient registry 500 once failed a shard outright, so a stack that genuinely fails to start fails the shard at once; on failure it uploads the report and posts a flaky-test summary |
| `e2e` | passes only when every shard did |

**Branch protection requires five checks** on both `dev` and `main`: `backend`, `frontend-unit`, `frontend-lint-and-types`, `docker-build` and `e2e`.
`e2e` is a job of its own so protection names one check whatever the shard count becomes.
`knowledge-graph` is a required check on `dev` as well.
`knowledge-graph-drift` is its own job and not required, for the next 10 PRs from 2026-10-22, then re-judged with the close-out's replay.

**A flaky test fails the build.**
Under `CI`, Playwright retries twice and sets `failOnFlakyTests` ([`front-end/playwright.config.ts`](../../../front-end/playwright.config.ts)), so a test that passes only on a retry still fails its shard.
Within a shard the tests share one database (`workers: 1`); never across shards.

## The no-mistakes gate

[`.no-mistakes.yaml`](../../../.no-mistakes.yaml) sets `allow_repo_commands: true` and one command, `test: ./scripts/nm-test.sh`.
Without it the gate has no way to run the suite, so it is the only workable setting, and it is safe because **the gate trusts it only from the repository's default branch, `dev`**: it loads the repo's commands from there, not from the pushed branch, so a pushed branch cannot enable a command of its own.

[`scripts/nm-test.sh`](../../../scripts/nm-test.sh) is the runner the gate invokes, and anyone may run it.
It runs, in order, the knowledge graph's checker tests and `check`, back-end pytest (installing `requirements.txt`, the floorplan solver's and the dev requirements), front-end Vitest, and Playwright against a Docker stack of its own, with `DISABLE_CAPTCHA` and `DISABLE_EMAIL` set.
Its Python is `PYTHON_CMD`, else `python3.12` (`back-end/.python-version`), else `python3`, and it installs nothing into that Python: it makes a virtual environment of its own from it, installs there, and a guard deletes it once the run is gone, since a uv- or distro-managed Python refuses `pip install` outright (PEP 668).
Its stack is isolated: a unique `COMPOSE_PROJECT_NAME` (`nmtest-<pid>`), and host ports Docker assigns as the stack starts (`TH_PORTS=auto`, [below](#stack-identity)), so two runs started together can never race for one port, as runs that each probed for a free port before starting could.
Once the stack is up, the run reads its ports back with `th-compose.sh ports` and exports them for `seed_fixture.sh` and Playwright.
mongo-express is not started (it is in the overlay's `tools` profile).
It builds no image of its own: its stack runs the images every worktree and gate stack with the same dependencies shares, `conventioner/backend:<tag>` and `conventioner/frontend:<tag>`, each tag a hash of the files its image is built from ([`scripts/image-tags.sh`](../../../scripts/image-tags.sh)), and `th-compose.sh ensure-images` builds one only when no image has its tag yet, so a run whose dependencies did not change builds nothing.
The source reaches the containers through the bind mounts, so the images do not depend on it.
It labels the stack as a gate run (`TEAM_KIND=gate`, `TEAM_WORKTREE` its repository root, `TEAM_EXPIRES` two hours after its start, and `TEAM_OWNER=agent-team` only when `TEAM_TASK` is set), and the [worktree overlay](../../../scripts/README-treehouse.md) puts those labels on every container, volume and network, with `restart: "no"`, no bind mount that creates its missing source, every port on `127.0.0.1` and each service within its memory, CPU and process limits ([measured](../../TESTING.md#stack-limits)).

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

**Gate runs take turns for their E2E phase, one at a time on a machine.**
A stack starting or stopping creates or removes a Docker network, which changes the host's networks under every browser on the machine, and another run's Playwright then fails with `net::ERR_NETWORK_CHANGED`.
So from just after its images are built until its teardown is done, `nm-test.sh` holds an exclusive kernel lock on `${XDG_STATE_HOME:-$HOME/.local/state}/conventioner/e2e.lock` ([`scripts/e2e-lock.sh`](../../../scripts/e2e-lock.sh)), taken with `flock` on one of its file descriptors, or with Python's `fcntl` where `flock` is missing.
The kernel releases it when the last process holding that descriptor is gone: the run, and the teardown guard it starts just after taking it, so a killed run keeps the lock until its stack is down and a waiting run never starts beside a stack still being removed.
Every other command of the E2E phase (`up`, `seed_fixture.sh`, Playwright) runs with the descriptor closed, so a process one of them leaves behind, such as a browser, never keeps the lock.
The rest of the run (the knowledge graph, the back end's and the front end's unit tests, building a shared image whose dependencies changed) runs beside other runs.
A run that finds the lock held prints `nm-test: waiting for the end-to-end lock since <time>, held by <project> (pid <pid>, <worktree>) since <time>`, and `nm-test: has the end-to-end lock at <time>` once it has it; after 45 minutes without it the run fails with `no end-to-end slot within 45 minutes`.
To see who holds it and who waits: `cat ~/.local/state/conventioner/e2e.lock` names the last run to take it, and `lsof ~/.local/state/conventioner/e2e.lock` lists every process with it open, the holder and its guard, and each waiting run with its `flock`.
The lock is the one place T19's `team-capacity run --kind gate:conventioner` takes over, with the lock kept as the fallback where `team-capacity` is absent; it can go once the browser is isolated from the host's network changes.
`nm-test.sh` never calls `sudo`: it installs Chromium with `npx playwright install chromium`, never `--with-deps` or `install-deps`, because those run `sudo` with no terminal and each failed attempt counts toward the account's `pam_faillock` lockout; the machine's own package manager provides the system libraries.
CI's workflow keeps `--with-deps`, which is correct on GitHub's Ubuntu runners.
It does not run Prettier, ESLint, Stylelint or the type-check: CI does.

## Stack identity

Several stacks run on one machine (the primary checkout, each treehouse worktree, a gate run), so every script and the E2E suite resolve which stack they mean in one order:

1. **Docker's ports** (`th-compose.sh` only): `COMPOSE_PROJECT_NAME` with `TH_PORTS=auto`, as `nm-test.sh` sets them.
   The wrapper leaves every host port empty (`127.0.0.1::<container port>`), so Docker picks each one as the container starts, and ignores any `TH_*_PORT` the caller set, so the stack's configuration is the same however it is called later.
   After an `up` it prints the assigned ports on stderr as `TH_MONGO_PORT=`, `TH_BACKEND_PORT=` and `TH_FRONTEND_PORT=` lines (and `TH_MONGO_EXPRESS_PORT=` when mongo-express runs).
   Without `COMPOSE_PROJECT_NAME` it refuses, even in a slot.
2. **Explicit variables**: `COMPOSE_PROJECT_NAME` with the `TH_*_PORT` variables, as `nm-test.sh` exports them once its stack is up.
3. **The treehouse slot** read from the path (`/.treehouse/<pool>/<N>/`): project `conventioner-N`, every port offset by `N * 10` ([the treehouse runbook](../../../scripts/README-treehouse.md)).
4. **Otherwise**: [`scripts/seed_fixture.sh`](../../../scripts/seed_fixture.sh) falls back to the primary stack's defaults, while [`scripts/th-compose.sh`](../../../scripts/th-compose.sh) fails loud and sends the primary checkout to plain `docker compose`.

The E2E suite's side is [`front-end/e2e/helpers/stack.ts`](../../../front-end/e2e/helpers/stack.ts), read by `playwright.config.ts`, `fixtures.ts` and [`helpers/containerNames.ts`](../../../front-end/e2e/helpers/containerNames.ts): the explicit variables, then the slot, then `CI` (one stack, named by `COMPOSE_PROJECT_NAME` or the directory), and otherwise it throws rather than guess, because a silent fall back to the primary stack once corrupted shared databases.
`BACKEND_URL`, `FRONTEND_PORT`, `E2E_MONGO_CONTAINER` and `E2E_BACKEND_CONTAINER` override it.
This order is what lets the gate run from a worktree that has no treehouse slot without falling through to the primary stack.
`th-compose.sh ports` prints a running stack's project and ports as `export` lines, read from Docker with `docker compose port` in any of the wrapper's modes, so `eval "$(scripts/th-compose.sh ports)"` gives a shell, `seed_fixture.sh` and the suite the explicit variables of a stack whose ports Docker picked.
It fails when the stack's MongoDB, back end or front end is not running.
