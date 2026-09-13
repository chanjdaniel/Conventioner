---
id: E04/F03/S01
title: Promote dev to main and cut v0.1.0
type: story
status: ready
blocked_by: [E04/F01/S02, E04/F02/S01, E04/F02/S02, E06/F01/S02]
pr: []
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

## Acceptance criteria

- [ ] The full suite is green on `dev` before anything is promoted, including the e2e suite under a
      full-suite run
- [ ] The promotion is a fast-forward, confirmed against `origin/main` rather than a local ref
- [ ] `main` carries the release workflow and it runs on the promotion
- [ ] Release-please opens a Release PR whose version is `0.1.0` and whose CHANGELOG reflects the
      conventional commits that produced this release
- [ ] Merging that PR creates the `v0.1.0` tag and a GitHub Release
- [ ] `.release-please-manifest.json` reads `0.1.0` afterwards
- [ ] Nothing was committed directly to `main`
