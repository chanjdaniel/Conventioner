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

## A decision this story must make first

`main`'s three commits are `checkpoint`, `checkponit` and `checkout` - a scratch history from before
the branch model existed, with `dev` dozens of commits ahead. Decide before promoting whether
`v0.1.0` is tagged on a history that includes those commits, and record the reasoning here. It is
hard to reverse once a tag and a release exist.

## Acceptance criteria

- [ ] The full suite is green on `dev` before anything is promoted, including the e2e suite under a
      full-suite run
- [ ] The disposition of `main`'s pre-existing history is decided and recorded, not defaulted into
- [ ] `main` carries the release workflow and it runs on the promotion
- [ ] Release-please opens a Release PR whose version is `0.1.0` and whose CHANGELOG reflects the
      conventional commits that produced this release
- [ ] Merging that PR creates the `v0.1.0` tag and a GitHub Release
- [ ] `.release-please-manifest.json` reads `0.1.0` afterwards
- [ ] Nothing was committed directly to `main`
