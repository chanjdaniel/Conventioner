---
id: E30/F01/S04
title: The menu offers nothing that can never succeed
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

"Send Offers" is in the rail's menu during assignment on both paths and can never succeed: nothing moves an application past approved, and `offers` is off the spine already.
It leaves the menu while `offers` is unreachable in practice; a market actually in `offers` keeps what the rail already does for it.

## Acceptance criteria

- [ ] The assignment phase's menu has no "Send Offers", before or after a run, on either path.
- [ ] A market seeded into `offers` still shows its stage and its ways out.
