# shellcheck shell=bash
#
# The machine's end-to-end lock, sourced by nm-test.sh: one gate run at a time holds it, from just
# before its stack starts until its teardown is done, because a stack starting or stopping changes
# the host's networks under another run's browser, which fails with net::ERR_NETWORK_CHANGED.
#
# It is an exclusive kernel lock (flock(2)) on one of the run's file descriptors, so the kernel
# releases it once the last process holding that descriptor is gone: the run, and the teardown
# guard it hands the descriptor to. Commands that may leave a process behind (Playwright's browser)
# run with the descriptor closed (`without_e2e_lock`), so nothing else keeps it after the run.
#
#     take_e2e_lock <seconds to wait> <who is taking it>
#     without_e2e_lock <command> [args...]   (an executable: a function or builtin would keep a copy)
#
# Uses flock(1) where it exists, else Python's fcntl ($PYTHON, else python3).

E2E_LOCK="${XDG_STATE_HOME:-$HOME/.local/state}/conventioner/e2e.lock"

# Locks the descriptor $1, waiting up to $2 seconds (0: not at all).
e2e_flock() {
  if command -v flock >/dev/null; then
    if (( $2 == 0 )); then flock -n "$1"; else flock -w "$2" "$1"; fi
  else
    "${PYTHON:-python3}" -c '
import fcntl, sys, time
fd, deadline = int(sys.argv[1]), time.monotonic() + float(sys.argv[2])
while True:
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        break
    except BlockingIOError:
        if time.monotonic() >= deadline:
            sys.exit(1)
        time.sleep(1)
' "$1" "$2"
  fi
}

# "45 minutes" for 2700, "20 seconds" for 20.
e2e_lock_span() {
  if (( $1 % 60 )); then echo "$1 seconds"; else echo "$(( $1 / 60 )) minutes"; fi
}

take_e2e_lock() {
  local wait=$1 who=$2 holder
  mkdir -p "${E2E_LOCK%/*}"
  # Read-write, so opening it never truncates the holder's line a waiting run reads.
  exec {E2E_LOCK_FD}<>"$E2E_LOCK"
  if ! e2e_flock "$E2E_LOCK_FD" 0; then
    holder="$(<"$E2E_LOCK")"
    printf 'nm-test: waiting for the end-to-end lock since %(%F %T %z)T, held by %s\n' -1 \
      "${holder:-another run}"
    if ! e2e_flock "$E2E_LOCK_FD" "$wait"; then
      echo "nm-test: ERROR: no end-to-end slot within $(e2e_lock_span "$wait")" >&2
      return 1
    fi
  fi
  printf '%s since %(%F %T %z)T\n' "$who" -1 >"$E2E_LOCK"
  printf 'nm-test: has the end-to-end lock at %(%F %T %z)T\n' -1
}

without_e2e_lock() {
  "$@" {E2E_LOCK_FD}>&-
}
