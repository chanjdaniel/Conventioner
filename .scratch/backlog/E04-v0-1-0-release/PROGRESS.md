# E04 progress and acceptance audit

Running record of E04 implementation.
One section per story, in dependency order.
A story is only marked done once every acceptance criterion in its file is audited here with
evidence, not merely asserted.

Branch: `feat/e04-v0-1-0-release`, cut from `dev` at `c32ee06b` (E03's merge, PR #65).

`docs/agents/issue-tracker.md` defines done as "its PR merges to `dev`, with the PR number appended
to `pr`". The table below is what is finished in the working tree; the front-matter is what has
shipped.

## Order of work

Frontier first; a story starts only when every id in its `blocked_by` is done.

| # | Story | Blocked by | Status | PR |
| --- | --- | --- | --- | --- |
| 1 | F01/S01 Extract a CSV import page object | - | not started | |
| 2 | F02/S01 STARTUP.md walks a fresh clone to a running stack | - | not started | |
| 3 | F01/S02 Walk the whole journey in one session | F01/S01 | not started | |
| 4 | F02/S02 TESTING.md describes the suites that exist | F01/S02 | not started | |
| 5 | F03/S01 Promote dev to main and cut v0.1.0 | F01/S02, F02/S01, F02/S02, E06/F01/S02 | not started | |
| 6 | F03/S02 Later versions follow conventional commits | F03/S01 | not started | |

F01/S01 and F02/S01 are both unblocked and may run in either order, or in parallel: one is e2e
infrastructure and the other is documentation, and they do not touch the same files.

## Blocked outside this epic

- **`E06/F01/S02`** - the public application-form request stalls under full-suite load, papered over
  by a retry workaround in the essential-fields spec. F03/S01 requires a green suite, and a release
  whose suite is known-flaky teaches everyone to re-run rather than read failures. The story stays in
  E06; only the blocking edge lives here.

## Not in this epic, deliberately

- **Bulk-approve in the application monitor.** Settled as needed, but its shape is still an open
  question in [wayfinding ticket 08](../../wayfinding/v0-1-0/issues/08-bulk-approve-shape.md), a
  prototype ticket that needs a live session. It becomes a fourth feature once that resolves.
  F01/S02 is deliberately written to a fixture small enough that per-row approval is honest.

## Audits

<!-- one section per completed story: every acceptance criterion, with the evidence that satisfies it -->
