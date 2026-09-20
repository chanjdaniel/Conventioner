---
id: E16/F02
title: The scale, written down
type: feature
status: done
blocked_by: []
pr: [77]
---

## Outcome

Type, spacing, radius and elevation exist as tokens in `base.css`, and stylelint refuses a raw value outside it.

## Why now

Pure addition: the tokens land, the checks land, and nothing migrates yet.
That makes this safe to ship before the sizing decision and lets `claims-and-room` ticket 01 consume the tokens when it rewrites Market Setup, rather than being rewritten again afterwards.

Values are in `docs/design-system.md` and are not open here.
