---
id: E06/F01
title: E2E flake elimination
type: feature
status: ready
blocked_by: []
pr: []
---

## Outcome

No Playwright spec passes only on retry.

## Why now

CI fails the build on retry-rescued passes, so each flake is an intermittent red build on `dev` that costs a re-run and erodes trust in the signal.
