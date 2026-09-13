# E06 progress and acceptance audit

Running record of E06 work. Unlike E02, E03 and E04, this epic has no branch of its own: its
stories are picked up wherever they are found, so this file records **which PR carried each one**.

## Status

| Story | Status | PR | Note |
| --- | --- | --- | --- |
| F01/S01 Essential-fields applicant form flake | done | #55 | |
| F01/S02 The public form request stalls under load | done | | Closed on an assumption, not a cause - see below |
| F02/S01 Remove the `csv_exports` directory | done | #66 | Pulled into v0.1.0 by the epic owner |
| F02/S02 Remove the tracked Playwright artifact | done | | Found while promoting dev to main |
| F03/S01 One MongoDB client per process | done | #66 | Found while investigating F01/S02 |

Both landed on `dev` with PR #66 (`d4a116f8`, squash) on 2026-09-13.

## F01/S02, closed without a cause

**Closed by the epic owner's decision on 2026-09-13, on the assumption that the stall is
environmental. The cause was never identified**, and the story's first acceptance criterion is
left unticked to say so. The full evidence lives in the story; the short version, so nobody
restarts from zero:

**Refuted, with measurements:**

- The Flask dev server serialising requests. `--with-threads` defaults to true in Flask 3.0.
- The per-request `MongoClient` leak. It fit the symptom shape exactly and is a real defect
  (fixed as F03/S01), but is **not** this stall: with ~400 leaked clients the endpoint answered in
  19-20ms flat across three heartbeat windows, and five full-suite runs with the leak deliberately
  restored all passed.
- Vite reloading the page when Playwright writes artifacts. A live browser kept its page state
  across artifact writes; only the final `.html` report triggers a reload, and that lands after
  the suite.

**Where it stands:** the stall does not reproduce at all. Fifteen consecutive green full-suite runs
across three configurations, eleven of them with the retry workaround deleted so nothing could
absorb one. That is not a fix. It was closed anyway, deliberately, because the cost of a recurrence
is now low and the cost of chasing an unreproducible defect is not - and because the layer still
under suspicion does not exist in a deployed build. **Reopen it if it recurs.**

**What is now in place for the next occurrence:** the retry workaround is gone, so a recurrence
fails loudly rather than succeeding quietly; CI runs with two retries and `failOnFlakyTests`; and
`scripts/nm-test.sh` writes both containers' logs to `.stack-logs/` before teardown, which is what
the story asked for and what no earlier attempt had.

**Still unexamined:** whether an earlier spec leaves a long-running request in flight that this one
queues behind, and whether the failure follows a particular neighbouring spec rather than the clock
(run with a shuffled order to find out).

## Audits

### F03/S01 One MongoDB client per process

Measured against a running stack, reading `db.serverStatus().connections.current` from MongoDB:

| | before | after |
| --- | --- | --- |
| baseline | 28 | 9 |
| +10 applicant requests | 48 | 9 |
| +30 applicant requests | 60 | 9 |
| +30 requests to `/markets` | no growth | no growth |

The `/markets` control is what localises the defect to the four per-request call sites in
`api/applicants.py` rather than to request handling in general. Four unit tests pin the memoization,
the fresh client the migration probe still gets, and that the probe never becomes the default.

### F02/S01 Remove the `csv_exports` directory

Gone from the Dockerfile, the entrypoint, `docker-compose.yml`, `.gitignore`, `.dockerignore` and
`docs/STARTUP.md`. The image was rebuilt and the full suite run against it; `tier2.spec.ts` performs
a real CSV download and reads its columns, which is what demonstrates the download still works.

Anyone with an existing stack has an orphaned `<project>_backend_csv` volume: removing the mount
does not remove a volume already created.
