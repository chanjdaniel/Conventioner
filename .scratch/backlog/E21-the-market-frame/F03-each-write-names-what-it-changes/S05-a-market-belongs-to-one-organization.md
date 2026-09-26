---
id: E21/F03/S05
title: A market belongs to one organization, for good
type: story
status: ready
blocked_by: [E21/F03/S01]
pr: []
---

## What to build

Manage Market says which organization a market belongs to, and offers no way to change it.

Today it shows "Organizations with access" as a list with a Viewer badge and Add / Remove controls.
There is only ever one organization, "Add" replaces it (moving the market, its visibility and whose deletion deletes it), and it falls back to the typed text as an id when no organization of that name exists.
Decided in [the-market-frame ticket 04](../../../wayfinding/the-market-frame/issues/04-what-becomes-of-the-whole-market-put.md): a market's organization is fixed at creation.

The section becomes one read-only line naming the organization and saying its members can view the market.
The add and remove organization controls, their handlers and their e2e coverage go.
The server stops accepting an organization change on any write; `S01`'s refusal of invalid changes becomes a refusal of every change.

## Acceptance criteria

- [ ] Manage Market shows the market's organization as one read-only line, in the organizer's terms.
- [ ] No control in the product changes a market's organization, and no write accepts a change to it.
- [ ] The e2e specs for the removed controls are removed or rewritten against the read-only line.
