---
id: E04/F03
title: v0.1.0 is cut
type: feature
status: ready
blocked_by: []
pr: []
---

## Outcome

`dev` reaches `main`, release-please tags `v0.1.0` and publishes a GitHub Release, and the version
pin that forced that number is removed so every later release derives its version from commit types.

## Why now

Nothing has ever shipped. The manifest is still `0.0.0`, there are no tags, and `main` is dozens of
commits behind `dev`. The machinery is already automated, so this feature is short - it exists to be
done deliberately and in the right order, not accidentally.
