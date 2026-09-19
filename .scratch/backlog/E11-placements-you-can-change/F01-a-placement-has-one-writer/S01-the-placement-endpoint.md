---
id: E11/F01/S01
title: The placement endpoint, and assignment_object becomes server-owned
type: story
status: ready
blocked_by: []
pr: []
---

## What to build

A dedicated endpoint that writes one placement on one market, gated on `MarketRole.EDITOR` - the
same bar as every other market write, and deliberately not stricter: an EDITOR can already rewrite
the tiers, sections and table counts the whole assignment is computed from.

`assignment_object` joins the server-owned fields in `update_market()`, beside `application_form`
and `import_mapping`, for the same documented reason.

**This breaks `seedPublishedMarketWithAssignments()`**, which works by
`GET /markets/{id}/assignment` then PUTting the whole market back - a pattern `AGENTS.md` documents.
It moves to the new endpoint, and the `AGENTS.md` note is updated with it.
That cost was weighed and accepted: closing a live overwrite hazard beats the convenience of a seed
helper.

## Acceptance criteria

- [ ] One endpoint writes one placement; a VIEWER is refused and an EDITOR is not.
- [ ] A market PUT carrying a stale `assignmentObject` no longer changes the stored assignment, and
      a test pins that.
- [ ] `seedPublishedMarketWithAssignments()` and `seedAssignedMarket()` use the new path, and the
      e2e suite passes unchanged otherwise.
- [ ] The `AGENTS.md` seeding note matches what the helpers now do.
