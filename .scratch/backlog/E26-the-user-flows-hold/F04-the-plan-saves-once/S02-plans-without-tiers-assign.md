---
id: E26/F04/S02
title: Plans without tiers assign
type: story
status: done
blocked_by: []
pr: []
---


## What to build

Tier is a filter only when the market asked it: a plan whose sections have no tier assigns, and a market that adds tiers after its applications froze treats every applicant as accepting any tier.

Closes bugs 23 in `docs/MVP_BUGS.md`; each one's reproduction there is the starting E2E.

## Acceptance criteria

- [x] A market with untiered sections assigns its approved vendors.
- [x] Adding a tier after the import places vendors instead of nobody.
- [x] The solver never raises on a plan the editor accepted.
