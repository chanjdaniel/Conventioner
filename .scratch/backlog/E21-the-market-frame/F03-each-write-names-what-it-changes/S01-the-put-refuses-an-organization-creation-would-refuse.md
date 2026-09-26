---
id: E21/F03/S01
title: The market PUT refuses an organization that creation would refuse
type: story
status: done
blocked_by: []
pr: []
---

## What to build

A market can never be written into a state `POST /markets` refuses to create.

Reproduced on the primary stack, as an organizer with editor rights on a market:

- `PUT /markets/:id` with `organizationId: null` answered 200 and stored null.
- `PUT /markets/:id` with `organizationId: "not-a-real-org"` answered 200, stored it, and `$addToSet`-ed the market onto the organization of that id.

`POST /markets` refuses a missing organization, an unknown one and one the caller is not a member of (400 each).
`update_market()` checks none of them.
AGENTS.md records "a market belonging to nothing is a state `POST /markets` refuses to produce", which this PUT produces on request, and Manage Market's "remove organization" button (`manage-market-remove-org-button`) is a control that does exactly that.

The PUT applies the same three refusals as creation whenever the organization changes, through the same check rather than a copy of it.
The remove-organization control goes, since the only thing it can now do is be refused.
This is the quick close of a live hole; `S05` then removes organization changes altogether, and `S06` the PUT.
Whether a market may move between organizations at all, and who may move it, is [ticket 04](../../../wayfinding/the-market-frame/issues/04-what-becomes-of-the-whole-market-put.md); this story only makes the invalid moves impossible.

## Acceptance criteria

- [x] Reproduced first as a failing pytest: both PUTs above succeed today.
- [x] A PUT that changes `organizationId` to null, to an unknown id, or to an organization the caller is not a member of answers 400, stores nothing, and touches no organization's `markets` list.
- [x] Creation and update share one organization check; there is no second copy of the rule.
- [x] Manage Market no longer offers "remove organization", and its e2e coverage is updated.
