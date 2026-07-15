# Treehouse worktrees for agents

This project uses [treehouse](https://github.com/kunchenguid/treehouse) to give
each coding agent its own isolated, pre-warmed git worktree from a reusable pool —
no re-cloning, no reinstalling deps, no port collisions.

## Prerequisites

- `treehouse` on your PATH (`curl -fsSL https://kunchenguid.github.io/treehouse/install.sh | sh`)
- Node (for the front-end) and Docker (for the back-end)
- Your own `.env`, `front-end/.env`, `back-end/.env` in the primary checkout
  (git-ignored; the pre-warm copies them into each worktree)

## Workflow

```sh
# 1. Acquire an isolated, pre-warmed worktree (leases it, copies .env files,
#    installs node_modules for root + front-end). Prints the worktree path.
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

## Port map (per worktree slot)

Slot = the pool index `N` in `~/.treehouse/<pool>/<N>/Conventioner`; offset = `N * 10`.

| Service       | main (primary checkout) | slot 1 | slot 2 |
|---------------|-------------------------|--------|--------|
| mongodb       | 27017                   | 27027  | 27037  |
| backend       | 5000                    | 5010   | 5020   |
| frontend      | 5173                    | 5183   | 5193   |
| mongo-express | 8081                    | 8091   | 8101   |

The **primary checkout** uses plain `docker compose` (default ports, container
names `conventioner-*-1`, auto-named by Compose). `th-compose.sh` also supports
an explicit stack identity via `COMPOSE_PROJECT_NAME` + `TH_*` port variables
(used by `scripts/nm-test.sh` for the no-mistakes gate).

## Housekeeping

- `treehouse status` — show the pool
- `treehouse prune` — remove stale idle worktrees (dry-run; `--yes` to apply)
- `treehouse destroy <path> --yes` — remove a specific worktree
- `max_trees` is set in `treehouse.toml` (default 4; each tree is hundreds of MB)

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

- **Returning a slot wipes its DB/volumes.** `th-return.sh` runs `docker compose
  down -v`, which removes the worktree's isolated mongodb, backend sessions, and
  CSV export volumes. A re-leased worktree always starts with a fresh DB — this
  is intentional for per-slot isolation.
- **Use `th-lease.sh`, not raw `treehouse get`.** treehouse v2.0.0 parses but does
  not invoke the `post_create` hook, so a raw worktree would be missing `.env` and
  `node_modules`. All pre-warming is driven by the wrapper.
- **Back-end has no local Python venv** — it runs via Docker (`python:3.11-slim`).
  The pinned deps don't build on the Python versions installed here.
- Reused worktrees don't auto-update node deps when a lockfile changes — run
  `npm install` yourself, or `treehouse destroy` the tree to force a fresh warm.
- If you `treehouse destroy` or `treehouse prune` a worktree without returning it
  first, its docker stack lingers (only `th-return.sh` tears stacks down) — run
  `scripts/th-compose.sh down -v` in the worktree beforehand, or see
  [Kill lingering worktree stacks](#kill-lingering-worktree-stacks) above.
