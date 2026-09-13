---
id: E04/F03/S02
title: Later versions follow conventional commits
type: story
status: ready
blocked_by: [E04/F03/S01]
pr: []
---

## What to build

The `release-as: 0.1.0` pin is removed from the release-please config, so the next release derives
its version from the commit types since `v0.1.0`: `feat:` bumps the minor, `fix:` the patch, a
breaking change the major.

The pin existed only to force the first release's number off a `0.0.0` baseline. Left in place it
would pin every subsequent release to `0.1.0` as well, which fails silently: release-please would
keep proposing a version that already exists.

## Acceptance criteria

- [ ] `release-as` is gone from `release-please-config.json`, and nothing else in that config changes
- [ ] The removal lands after `v0.1.0` is tagged, never before
- [ ] `AGENTS.md` and `docs/RELEASING.md` no longer describe the pin as present, and instead say the
      versioning is commit-driven from here
- [ ] The next Release PR release-please opens proposes a version derived from commits, demonstrated
      or reasoned from the config rather than assumed
