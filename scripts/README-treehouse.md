---
layer: implementation
kind: runbook
describes:
  - scripts/th-lease.sh
  - scripts/th-compose.sh
  - scripts/th-return.sh
  - docker-compose.worktree.yml
verified: 2026-10-25
---

# Treehouse worktrees for agents

This project uses [treehouse](https://github.com/kunchenguid/treehouse) to give
each coding agent its own isolated, pre-warmed git worktree from a reusable pool -
no re-cloning, no reinstalling deps, no port collisions.

The wrappers are [`th-lease.sh`](th-lease.sh), [`th-compose.sh`](th-compose.sh) and [`th-return.sh`](th-return.sh); each worktree's stack is the base compose file plus [`docker-compose.worktree.yml`](../docker-compose.worktree.yml).

## Prerequisites

- `treehouse` on your PATH, at the version the team's code pins in `~/agent-team/bin/lib/tools.lock`
  (not treehouse's `install.sh`, which installs the latest release, not the pin):
  `team-doctor` checks it, and its `tool treehouse` line's fix is the pinned install command.
- Node 24.22.1, the one `.nvmrc` pins (`nvm install` in the repository), for the front-end, and Docker for the back-end
- Your own `.env`, `front-end/.env`, `back-end/.env` in the primary checkout
  (git-ignored; the pre-warm copies them into each worktree)

## Workflow

```sh
# 1. Acquire an isolated, pre-warmed worktree (leases it, copies .env files,
#    installs front-end/node_modules from the committed lockfile with npm ci, and
#    sets core.hooksPath to the committed .githooks/). Prints the worktree path.
path=$(scripts/th-lease.sh my-agent-label)
cd "$path"

# 2. Work normally. Front-end runs locally (npm/vite).
#    For the back-end, use the isolated docker stack (offset ports per worktree,
#    so multiple worktrees + the main checkout run in parallel):
scripts/th-compose.sh up -d           # or: logs -f backend, exec backend sh, etc.

# 3. Release the worktree back to the pool when done. Tears down this
#    worktree's docker stack; keeps node_modules warm for the next lease.
scripts/th-return.sh "$path"
```

### When the teardown fails

`th-return.sh` never hands a slot back with its stack still on it without saying so.
When the slot's `down -v --remove-orphans` fails, it prints the teardown's own error output and
`th-return: teardown failed for <path>; the lease is kept (use --force to return it anyway)`,
and exits 1 without calling `treehouse return`, so the slot stays leased to you.
Fix the cause (often a Docker daemon that is not running), then run it again.
`scripts/th-return.sh "$path" --force` reports the failure too but returns the lease anyway,
and keeps its other meaning: `treehouse return --force`, no prompts.
The teardown always targets the slot's own stack (`conventioner-<slot>`), even when your shell
has another stack's `COMPOSE_PROJECT_NAME` or `TH_*` ports exported.
A successful teardown is silent, and a worktree with no `docker-compose.yml` is returned
without one.

The last step is `treehouse return`, and its exit status is the script's: treehouse v3 exits 3
when it leaves a dirty worktree leased (commit its changes first; `--force` discards them).

## Port map (per worktree slot)

Slot = the pool index `N` in `~/.treehouse/<pool>/<N>/Conventioner`; offset = `N * 10`.

| Service       | main (primary checkout) | slot 1 | slot 2 |
|---------------|-------------------------|--------|--------|
| mongodb       | 27017                   | 27027  | 27037  |
| backend       | 5001                    | 5011   | 5021   |
| frontend      | 5173                    | 5183   | 5193   |
| mongo-express | 8081                    | 8091   | 8101   |

The back end's base is 5001, not Flask's 5000 ([why](../docs/TESTING.md#testing-gotchas)).

Every port, the primary checkout's included, is published on `127.0.0.1` only, so another
machine on the network does not reach a stack.
Dial it at `127.0.0.1`, never `localhost`, which is tried as `::1` first: see
[`docs/TESTING.md`](../docs/TESTING.md#testing-gotchas).
mongo-express is in the overlay's `tools` profile, so a worktree's stack starts without it;
start it with `scripts/th-compose.sh --profile tools up -d mongo-express`.
In the explicit mode below, `TH_MONGO_EXPRESS_PORT` is optional: unset, Docker picks a free
host port (`docker compose port mongo-express 8081` prints it).

The **primary checkout** uses plain `docker compose` (default ports, container
names `conventioner-*-1`, auto-named by Compose). `th-compose.sh` also supports
an explicit stack identity via `COMPOSE_PROJECT_NAME`, `TH_MONGO_PORT`,
`TH_BACKEND_PORT` and `TH_FRONTEND_PORT`, and Docker-picked ports via
`COMPOSE_PROJECT_NAME` with `TH_PORTS=auto` (used by `scripts/nm-test.sh` for its
Playwright stack): every host port is left empty, an `up` prints the ports Docker
assigned on stderr, and `th-compose.sh ports` prints any running stack's project
and ports as `export` lines (`eval "$(scripts/th-compose.sh ports)"`).

## Housekeeping

- `treehouse status` - show the pool
- `treehouse prune` - remove stale idle worktrees (dry-run; `--yes` to apply)
- `treehouse destroy <path> --yes` - remove a specific worktree; a leased one also needs
  `--include-leased` (and a dirty or busy one `--include-unlanded` or `--include-in-use`)
- `max_trees` is set in `treehouse.toml` (9; each tree is hundreds of MB, and the agent team's
  machine-wide cap on worktrees (T98) bounds the total across projects)

> **⚠️ `treehouse prune` and `treehouse destroy` do NOT tear down per-slot docker
> stacks.** Docker teardown lives only in `th-return.sh`. If you `prune` (it
> auto-removes stale idle worktrees) or `destroy` a worktree whose stack is still
> up, its offset-port containers keep running and can collide when that slot is
> reused. Always `scripts/th-return.sh "$path"` first, or run the cleanup below.

### Kill lingering worktree stacks

Worktree containers are named `conventioner-<slot>-*` (dash, with explicit
`container_name` in `docker-compose.worktree.yml`); the primary checkout
containers are auto-named `conventioner-*-1`. Filter on the numeric slot prefix
to avoid touching the primary stack:

```sh
# Remove every lingering per-worktree container (leaves the primary checkout alone).
# Matches container names starting with conventioner-<digit> (slot-based worktrees)
# and conventioner-nm (no-mistakes worktrees), excluding -1 suffixed primary containers.
docker ps -a --filter name=conventioner- --format '{{.ID}}\t{{.Names}}' \
  | awk '!/\t.*-1$/' | cut -f1 | xargs -r docker rm -f
```

## Notes / gotchas

- **A worktree's stack never restarts by itself.** The overlay sets `restart: "no"`
  on every service, so after a reboot or a Docker restart the stack stays down until
  `scripts/th-compose.sh up -d` brings it back. Its bind mounts are in long syntax with
  `create_host_path: false`: a stack whose worktree was deleted fails to start rather
  than re-creating the worktree's folders as root, and `th-compose.sh` makes the
  mountpoints of the volumes nested in them (`back-end/flask_session`,
  `front-end/node_modules`) as you, since Docker would make them as root.
- **Every stack carries the team's labels.** The overlay labels each container, named
  volume and network with `io.github.chanjdaniel.team.owner`, `.task`, `.kind`,
  `.worktree` and `.expires`, taken from `TEAM_OWNER`, `TEAM_TASK`, `TEAM_KIND`,
  `TEAM_WORKTREE` and `TEAM_EXPIRES`, each empty when its variable is unset. A named
  volume keeps the labels it was created with, so a stack for another task needs a
  `down -v` first.
- **Every service runs within limits.** The overlay sets `mem_limit`, `cpus` and
  `pids_limit` per service (mongodb 1g / 2 / 512, backend 768m / 1 / 256, frontend
  1g / 2 / 256, mongo-express 256m / 0.5 / 64), and MongoDB runs with
  `--wiredTigerCacheSizeGB 0.25`, since by default it sizes its cache from the host's
  memory, not the container's. A full `nm-test.sh` run's peaks are in
  [`docs/TESTING.md`](../docs/TESTING.md#stack-limits); raise a limit there, with a
  measurement, if a stack is OOM-killed (`docker inspect -f '{{.State.OOMKilled}}'`).
- **Every worktree shares its images.** The overlay runs `conventioner/backend:<tag>`
  and `conventioner/frontend:<tag>`, tagged by `scripts/image-tags.sh` with a hash of
  the files each is built from, so every slot stack and `nm-test.sh` stack with the
  same dependencies uses one image, and the source comes from the bind mounts.
  `th-compose.sh` builds an image only when none has its tag yet (`th-compose.sh
  ensure-images` does just that, starting nothing); `th-compose.sh build` always
  builds. The overlay never pulls them (`pull_policy: never`): `conventioner/*` on
  Docker Hub is not ours. After the front end's dependencies change, a stack keeps
  its old `node_modules` volume: `th-compose.sh rm -s -f -v frontend` then
  `th-compose.sh up -d` refills it from the new image (`up --renew-anon-volumes`
  leaves the old volume behind).
- **Email is off in a worktree's stack.** The overlay sets the backend's `DISABLE_EMAIL`
  to `true` unless the shell sets it, since an agent's stack has no Resend key;
  `DISABLE_EMAIL=false scripts/th-compose.sh up -d` sends real mail.
- **Returning a slot wipes its DB/volumes.** `th-return.sh` runs `docker compose
  down -v`, which removes the worktree's isolated mongodb and backend sessions
  volumes. A re-leased worktree always starts with a fresh DB - this
  is intentional for per-slot isolation. If that teardown fails, the lease is kept
  (see [When the teardown fails](#when-the-teardown-fails)).
- **Use `th-lease.sh`, not raw `treehouse get`.** treehouse v3 runs hooks only from
  the user's `~/.config/treehouse/config.toml`, never from this repository's
  `treehouse.toml`, so a raw worktree would be missing `.env` and `node_modules`.
  All pre-warming is driven by the wrapper.
- **A slot is warmed and torn down by its own scripts.** `th-lease.sh` and `th-return.sh`
  run from the checkout that calls them, often the primary checkout, which may be behind
  the slot: treehouse cuts the slot from the latest base branch.
  So `th-lease.sh` runs the slot's own `scripts/treehouse-setup.sh`, and `th-return.sh`
  tears the stack down with the slot's own `scripts/th-compose.sh`, whose overlay is the
  one beside the slot's compose file; a fix to either reaches the next lease or return
  once it is on the base branch.
  A slot without its own copy is warmed or torn down with the caller's, and the script
  says so on stderr.
  Only `th-lease.sh` and `th-return.sh` themselves are the caller's own.
- **Back-end has no local Python venv** - it runs via Docker (`python:3.12-slim`).
  The pinned deps don't build on the Python versions installed here.
- Reused worktrees don't auto-update node deps when a lockfile changes - run
  `npm ci` in `front-end/` yourself, or `treehouse destroy` the tree to force a fresh warm.
- **The pre-warm never writes the lockfile.** It installs with `npm ci`, so a warmed
  slot is clean whichever npm the machine has; a `package-lock.json` out of step with
  `package.json` fails the pre-warm (`ERROR: npm ci failed`) instead of being rewritten.
  `th-lease.sh` still hands out the slot, with its hooks set and no `front-end/node_modules`.
  Fix the lockfile on its branch and commit it.
- If you `treehouse destroy` or `treehouse prune` a worktree without returning it
  first, its docker stack lingers (only `th-return.sh` tears stacks down) - run
  `scripts/th-compose.sh down -v` in the worktree beforehand, or see
  [Kill lingering worktree stacks](#kill-lingering-worktree-stacks) above.
