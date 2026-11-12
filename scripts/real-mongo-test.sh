#!/usr/bin/env bash
#
# Run the back end's real-MongoDB suite (back-end/tests/real_mongo) on a MongoDB server of its own,
# and remove that server however the run ends.
#
# Usage, from anywhere in the checkout:
#     scripts/real-mongo-test.sh                              # the whole package
#     scripts/real-mongo-test.sh tests/real_mongo/test_the_applicant_side_races.py -q
#     PYTHON_CMD=/path/to/python3.12 scripts/real-mongo-test.sh
#
# Arguments are pytest's, run from back-end/, in place of `tests/real_mongo`. The Python is
# PYTHON_CMD (default python3), with back-end/requirements.txt and requirements-dev.txt installed.
#
# The server is the compose file's `mongodb` image, as CI's backend job runs it: no credentials,
# 64000 open files, on a loopback port Docker picks, so two runs never race for one port and the
# primary stack's 27017 is never touched. It keeps no volume: the image's /data/db and
# /data/configdb are tmpfs, and the container is started with --rm, so nothing of it outlives it.
# A server started by hand without them left both of the image's anonymous volumes behind, about
# 0.3 GB a run, with nothing saying whose they were. The container carries the team's labels from
# TEAM_* when they are set, as docker-compose.worktree.yml puts them on a stack.
#
# Requires: Docker, and Python with the back end's requirements.
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
PYTHON="${PYTHON_CMD:-python3}"
NAME="conventioner-real-mongo-$$"

fail() {
  echo "real-mongo-test: ERROR: $*" >&2
  exit 1
}

command -v docker >/dev/null || fail "docker is not on PATH."
command -v "$PYTHON" >/dev/null || fail "$PYTHON is not on PATH; set PYTHON_CMD."

IMAGE="$(docker compose --env-file /dev/null -f "$REPO_ROOT/docker-compose.yml" config --images mongodb)"
[ -n "$IMAGE" ] || fail "docker-compose.yml names no image for its mongodb service."

if [ $# -eq 0 ]; then
  set -- tests/real_mongo
fi

# After this the team's reaper may remove the server, should every removal below have failed.
EXPIRES="${TEAM_EXPIRES:-$("$PYTHON" -c 'import datetime as d; print((d.datetime.now(d.timezone.utc) + d.timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ"))')}"

# ── Removal ──────────────────────────────────────────────────────────────────

# The EXIT trap removes the server after a normal exit, a failure, and SIGINT or SIGTERM; nothing
# runs in this script after a SIGKILL, which is how the gate ends a run it aborts, to this script's
# whole process group. So a guard in a process group of its own also waits on a pipe this script
# holds open, which closes however the script ends, and removes the server then. The suite and
# every other child run with the pipe closed, so a process left behind cannot keep the guard
# waiting.
GUARD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/real-mongo-test.XXXXXX")"
mkfifo "$GUARD_DIR/alive"
set -m
(
  trap - EXIT
  cd /
  read -r _ <"$GUARD_DIR/alive" || true
  docker rm -f "$NAME" >/dev/null 2>&1
  rm -rf "$GUARD_DIR"
) </dev/null >/dev/null 2>&1 &
GUARD=$!
set +m
exec 9>"$GUARD_DIR/alive"

# The script's status is the one it exited with: an EXIT trap that does not call exit keeps it.
remove_server() {
  docker rm -f "$NAME" >/dev/null 2>&1 9>&- || true
  kill "$GUARD" 2>/dev/null || true
  rm -rf "$GUARD_DIR"
}
trap remove_server EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ── The server ───────────────────────────────────────────────────────────────

echo "real-mongo-test: starting $IMAGE as $NAME" >&2
docker run --detach --rm --name "$NAME" \
  --label "io.github.chanjdaniel.team.owner=${TEAM_OWNER:-}" \
  --label "io.github.chanjdaniel.team.task=${TEAM_TASK:-}" \
  --label "io.github.chanjdaniel.team.kind=${TEAM_KIND:-}" \
  --label "io.github.chanjdaniel.team.worktree=${TEAM_WORKTREE:-}" \
  --label "io.github.chanjdaniel.team.expires=$EXPIRES" \
  --tmpfs /data/db --tmpfs /data/configdb \
  --ulimit nofile=64000:64000 \
  -p 127.0.0.1::27017 \
  "$IMAGE" --wiredTigerCacheSizeGB 0.25 >/dev/null 9>&-

PUBLISHED="$(docker port "$NAME" 27017/tcp 9>&-)"
PUBLISHED="${PUBLISHED%%$'\n'*}"
PORT="${PUBLISHED##*:}"
[[ "$PORT" =~ ^[0-9]+$ ]] || fail "Docker published no port for $NAME (it said: $PUBLISHED)."

READY=false
for _ in $(seq 1 60); do
  if docker exec "$NAME" mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok' >/dev/null 2>&1 9>&-; then
    READY=true
    break
  fi
  sleep 1
done
if [ "$READY" != true ]; then
  docker logs --tail 20 "$NAME" >&2 9>&- || true
  fail "$NAME did not answer a ping within 60 seconds; its last log lines are above."
fi
echo "real-mongo-test: $NAME answers on 127.0.0.1:$PORT" >&2

# ── The suite ────────────────────────────────────────────────────────────────

# The last command, so the script's status is pytest's, pass or fail.
cd "$REPO_ROOT/back-end"
REAL_MONGODB_URI="mongodb://127.0.0.1:$PORT/?serverSelectionTimeoutMS=5000" REAL_MONGODB_REQUIRED=true \
  "$PYTHON" -m pytest "$@" 9>&-
