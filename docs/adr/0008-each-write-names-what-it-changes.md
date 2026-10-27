---
layer: implementation
kind: adr
describes:
  - back-end/tests/test_the_market_put_is_gone.py
verified: 2026-10-27
sources:
  - wayfinding/the-market-frame/03
  - wayfinding/the-market-frame/04
  - E11/F01/S01
  - E21/F03
  - E21/F03/S06
status: accepted
---

# Each write names what it changes

The glossary concepts: [Market](../business/concepts/market.md) and [Review highlight](../business/concepts/review-highlight.md).

## Context

`PUT /markets/:id` stored the client's entire copy of a market.
The server survived it only by re-applying every field it owns (phase, form, assignment, intake mode, highlights, results) after each save, one "a stale client copy overwrote X" bug at a time, and it missed the ones nobody had thought of yet.
Three that were reproduced: a stale copy of `assignmentObject` sent from a screen left open moved vendors on market day (E11/F01/S01); the PUT moved a market to no organization, or to any organization id, and answered 200; and a rename through it gave a market another market's name, so two markets shared one public address.
A client sending its whole copy of a market is a client claiming to be the truth.

## Decision

There is no whole-market write.
Every write names the part of the market it changes, through an endpoint that accepts nothing else and judges that part alone:

| Write | Endpoint |
| --- | --- |
| The plan and the intake mode | `PUT /markets/:id/plan` |
| The name, only while the market is a draft (it is the public address) | `PUT /markets/:id/name` |
| The application form | `PUT /markets/:id/application-form`, and the CSV start's confirm |
| An assignment run, a seat, a swap, a hand-added vendor | `POST /markets/:id/assignment`, `PUT`/`DELETE /markets/:id/placements`, `POST /markets/:id/placements/swap`, `POST /markets/:id/vendors` |
| A floorplan, only while the market is a draft | `POST /floorplans/save-to-market` |
| Review highlights ([the rule](../business/rules/review-highlights.md)), automatic rejections | `PUT /markets/:id/review-highlights`, `PUT /markets/:id/rejection-rules` |
| A phase move, publishing results | `POST /markets/:id/transition`, `POST /markets/:id/publish-results` |
| Roles | `POST`/`PUT`/`DELETE /markets/:id/roles` |

A market's organization is fixed at creation: it is the market's container and an access grant at once, and Manage Market names it in one read-only line rather than offering to change it.
No two markets share a slug, the public address: creating or renaming a market is refused when its slug is taken, not only its exact name, since "Café Market" and "Cafe Market" are one address, and the unique `market_slug` index holds it ([the market document](../implementation/data/market-document.md)).
[`back-end/tests/test_the_market_put_is_gone.py`](../../back-end/tests/test_the_market_put_is_gone.py) pins that the route answers nothing.

## Consequences

- No server-owned field needs protecting from a client's copy: each write's endpoint is the only place its field is changed, so the field's rules live with its writer (the plan's in `prepared_plan`, the form's in `prepared_application_form`, the assignment's in `back-end/api/placements.py`).
- A screen saves only what it owns; the plan's autosave sends the plan and the intake mode, never the market it was built from.
- After any write the browser re-reads the market rather than merging what it sent ([one market, from the server](../implementation/conventions/one-market-from-the-server.md)).
- A new kind of change to a market is a new endpoint, with its own role check and its own judgement, rather than a field added to a general save.
- Moving a market between organizations, or renaming one after draft, has no write; either would return as its own feature, a move needing owner rights on the market and membership of the destination, with the old organization's members losing access.

## Considered and rejected

- **Keeping the PUT and protecting server-owned fields** (`_preserve_server_owned_fields`): every new server-owned field had to be added to it, and each one missed was a silent overwrite found in production.
- **Freezing the slug at first publish so renames could continue**: it adds a second stored identity to every public lookup, for a need nobody had.
