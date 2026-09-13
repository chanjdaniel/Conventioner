---
id: E04/F03/S01
title: Promote dev to main and cut v0.1.0
type: story
status: done
blocked_by: [E04/F01/S02, E04/F02/S01, E04/F02/S02]
pr: [#66, #67]
---

## What to build

`dev` is promoted to `main` as a deliberate, versioned release. Release-please opens its Release PR;
merging it tags `v0.1.0` and publishes the GitHub Release with a CHANGELOG derived from the
conventional commits since the beginning.

This is the only time `main` is written to outside this process, and the first time the release
workflow has ever run, so it is as much a test of the machinery as a release.

## The state of `main`, checked

An earlier note on this story said `main` was three scratch commits (`checkpoint`, `checkponit`,
`checkout`) and asked what to do about them before tagging. That was read off a **stale local
`main`**. The real state:

- `origin/main` is at `2ccc8dcb`, an ordinary conventional-commit merge (PR #10).
- `origin/main` is an **ancestor of `origin/dev`**, so promotion is a clean fast-forward with no
  merge and no conflict.
- The three scratch commits are ancestors of *both* branches. They are part of the repository's
  history whatever happens here, so there is nothing to decide and nothing promotion changes.
  Rewriting shared history to tidy them is not on the table.

They also will not reach the CHANGELOG: release-please reads conventional commits and ignores
anything that is not one.

`main` does **not** yet carry `.github/workflows/release-please.yml`; it arrives with this
promotion, and the same push triggers it.

## The E06/F01/S02 gate, lifted deliberately

This story blocked on the public-form stall, on the principle that a release whose suite is
known-flaky teaches everyone to re-run rather than read failures. The epic owner lifted that gate
on 2026-09-13, and the reasoning is recorded here rather than lost in a chat:

- The stall **does not reproduce**: fifteen consecutive green full-suite runs across three
  configurations, eleven of them with the retry workaround deleted so nothing could absorb one.
- The workaround is **gone**, so a recurrence now fails loudly instead of silently succeeding, and
  CI runs with two retries and `failOnFlakyTests`.
- Both mechanisms that could have made it a *product* defect were tested and refused. What remains
  under suspicion is the Flask development server and the Vite dev proxy, **neither of which exists
  in a deployed build** - so the gate was defending a surface no user can reach, which is the same
  test `AGENTS.md` applies to boot requirements.
- `scripts/nm-test.sh` now captures both containers' logs before teardown, so the next recurrence
  is diagnosable rather than discarded.

`E06/F01/S02` stays **open**. Not reproducing is not the same as fixed, and its first criterion is
that the cause be identified.

## Acceptance criteria

- [x] The full suite is green on `dev` before anything is promoted - `scripts/nm-test.sh`: backend
      794, frontend unit 99, e2e 74, "All tests passed"; and CI green on PR #66 including its own
      e2e job on a different machine
- [x] The promotion is a fast-forward, confirmed against `origin/main` - `2ccc8dcb..7db8b7ce`,
      60 commits, and `main` ended byte-identical to `dev`
- [x] `main` carries the release workflow and it ran on the promotion - it arrived with the
      promotion and the same push triggered it
- [x] Release-please opened PR #67, `chore(main): release 0.1.0`, labelled `autorelease: pending`
- [x] Merging it created the `v0.1.0` tag and the GitHub Release, 2026-09-13
- [x] `.release-please-manifest.json` reads `0.1.0`
- [x] Nothing was committed directly to `main`: it only ever moved by fast-forward from `dev` and
      by the Release PR merge

## What the promotion turned up

**Release-please failed on its first run**, and not because of anything in this repository:
`GitHub Actions is not permitted to create or approve pull requests`. That is a repository setting
(`can_approve_pull_request_reviews`), and unlike `contents: write` it cannot be granted from the
workflow file. Everything else had already succeeded - it parsed 133 commits and created the
release branch and commit - so only the final PR-creation step was blocked. The epic owner chose to
enable the setting; `default_workflow_permissions` was deliberately left at `read`. **Anyone
standing up this workflow on a fresh repository will hit the same thing.**

**The release commit lands on `main`, not `dev`.** After the Release PR merged, `main` was ahead of
`dev` by `chore(main): release 0.1.0`, which carries the CHANGELOG and the bumped manifest. Left
alone, the *next* promotion would not have been a fast-forward. `main` was merged back into `dev`
as part of F03/S02. This is inherent to the release-branch model and will recur every release.
