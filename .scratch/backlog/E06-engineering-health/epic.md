---
id: E06
title: Engineering health
type: epic
status: ready
blocked_by: []
pr: []
---

## Outcome

CI is trustworthy: a red build means something is broken, and a green build means nothing is.

## Why now

The suite is large (473 pytest, ~50 vitest, 47 Playwright) and CI is deliberately strict - PR #33 made retry-rescued passes fail the build rather than hide them.
That strictness only pays off if flakes are fixed when they appear.
A tolerated flake trains everyone to re-run the job, and then a real failure gets re-run too.

This epic is never "done"; it collects flakes, lint debt, and CI reliability work as they are found.
