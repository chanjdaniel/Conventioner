---
id: E06/F02/S02
title: Remove the tracked Playwright artifact from the repository root
type: story
status: done
blocked_by: []
pr: []
---

## What to build

No Playwright output is tracked in git, and the repository root cannot accumulate any.

## What was wrong

`test-results/.last-run.json` was tracked at the **repository root**, added by PR #33 and never
removed. It shipped in `v0.1.0`.

It was not a live artifact. Playwright writes to `front-end/test-results/`, which
`front-end/.gitignore` already covers, so the root copy was orphaned: not churning, not rewritten by
any run, and frozen at `{"status": "failed"}` from whenever PR #33 last touched it. A dead file
recording a failed run, carried into the first release.

Found while promoting `dev` to `main` for E04/F03/S01: the fast-forward output named it as a file
being created on `main`, which is the only reason anybody looked.

## What was done

The file is deleted, and `/test-results` and `/playwright-report` are ignored **at the root**, so a
future config change that writes there cannot quietly track output again. `front-end/.gitignore`
already covers where Playwright actually writes; these two guard the place nobody is watching.

## Acceptance criteria

- [x] No Playwright output is tracked anywhere in the repository
- [x] The repository root ignores `test-results/` and `playwright-report/`
- [x] Where Playwright actually writes is still ignored, and unchanged
