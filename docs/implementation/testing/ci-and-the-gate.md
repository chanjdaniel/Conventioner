---
layer: implementation
kind: testing
describes:
  - .github/workflows/test.yml
  - .no-mistakes.yaml
  - scripts/nm-test.sh
  - front-end/e2e/helpers/stack.ts
  - front-end/e2e/helpers/containerNames.ts
verified: 2026-10-22
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
| `knowledge-graph` | the checker's tests, `knowledge_graph.py check`, and on a pull request `drift` against the base branch; it clones the full history for that |
| `docker-build` | `docker compose build` |
| `e2e-shard` | four runners, each building and starting its own stack, seeding it with `seed_fixture.sh` and running a quarter of the Playwright suite by spec file, with `DISABLE_CAPTCHA` and `DISABLE_EMAIL` set; on failure it uploads the report and posts a flaky-test summary |
| `e2e` | passes only when every shard did |

**Branch protection requires five checks** on both `dev` and `main`: `backend`, `frontend-unit`, `frontend-lint-and-types`, `docker-build` and `e2e`.
`e2e` is a job of its own so protection names one check whatever the shard count becomes.
`knowledge-graph` is not required yet.

**A flaky test fails the build.**
Under `CI`, Playwright retries twice and sets `failOnFlakyTests` ([`front-end/playwright.config.ts`](../../../front-end/playwright.config.ts)), so a test that passes only on a retry still fails its shard.
Within a shard the tests share one database (`workers: 1`); never across shards.

## The no-mistakes gate

[`.no-mistakes.yaml`](../../../.no-mistakes.yaml) sets `allow_repo_commands: true` and one command, `test: ./scripts/nm-test.sh`.
Without it the gate has no way to run the suite, so it is the only workable setting, and it is safe because **the gate trusts it only from the repository's default branch, `dev`**: it loads the repo's commands from there, not from the pushed branch, so a pushed branch cannot enable a command of its own.

[`scripts/nm-test.sh`](../../../scripts/nm-test.sh) is the runner the gate invokes, and anyone may run it.
It runs, in order, the knowledge graph's checker tests and `check`, back-end pytest (installing `requirements.txt`, the floorplan solver's and the dev requirements), front-end Vitest, and Playwright against a Docker stack of its own, with `DISABLE_CAPTCHA` and `DISABLE_EMAIL` set.
Its Python is `PYTHON_CMD`, else `python3.11`, else `python3`, and it installs nothing into that Python: it makes a virtual environment of its own from it, installs there, and deletes it on exit, since a uv- or distro-managed Python refuses `pip install` outright (PEP 668).
Its stack is isolated: a unique `COMPOSE_PROJECT_NAME` (`nmtest-<pid>`) and four free ports, each found by binding to port 0; an `EXIT` trap saves the back end's and front end's logs to `.stack-logs/` and tears the stack and its volumes down, however the run ends.
It does not run Prettier, ESLint, Stylelint or the type-check: CI does.

## Stack identity

Several stacks run on one machine (the primary checkout, each treehouse worktree, a gate run), so every script and the E2E suite resolve which stack they mean in one order:

1. **Explicit variables**: `COMPOSE_PROJECT_NAME` with the `TH_*_PORT` variables, as `nm-test.sh` exports them.
2. **The treehouse slot** read from the path (`/.treehouse/<pool>/<N>/`): project `conventioner-N`, every port offset by `N * 10` ([the treehouse runbook](../../../scripts/README-treehouse.md)).
3. **Otherwise**: [`scripts/seed_fixture.sh`](../../../scripts/seed_fixture.sh) falls back to the primary stack's defaults, while [`scripts/th-compose.sh`](../../../scripts/th-compose.sh) fails loud and sends the primary checkout to plain `docker compose`.

The E2E suite's side is [`front-end/e2e/helpers/stack.ts`](../../../front-end/e2e/helpers/stack.ts), read by `playwright.config.ts`, `fixtures.ts` and [`helpers/containerNames.ts`](../../../front-end/e2e/helpers/containerNames.ts): the explicit variables, then the slot, then `CI` (one stack, named by `COMPOSE_PROJECT_NAME` or the directory), and otherwise it throws rather than guess, because a silent fall back to the primary stack once corrupted shared databases.
`BACKEND_URL`, `FRONTEND_PORT`, `E2E_MONGO_CONTAINER` and `E2E_BACKEND_CONTAINER` override it.
This order is what lets the gate run from a worktree that has no treehouse slot without falling through to the primary stack.
