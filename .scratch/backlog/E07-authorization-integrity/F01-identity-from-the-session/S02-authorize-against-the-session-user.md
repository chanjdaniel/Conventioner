---
id: E07/F01/S02
title: Authorize every route against the session user
type: story
status: done
blocked_by: [E07/F01/S01]
pr: [685cebc6]
---

## What to build

Every route that today reads `X-Owner-Email` to decide permissions instead uses the identity the
session already proves. The header stops being an authorization input.

33 routes in `back-end/app.py` are affected. Prefer one shared seam that supplies the verified
identity over 33 edits, so a route added later cannot reintroduce the hole by copying its neighbour;
the specific shape is the implementer's call.

Delete the comment at `back-end/app.py:385` claiming the header is set by `login_required`. It is
the misconception that produced every instance.

## Acceptance criteria

- [x] No route decides permissions from a request header.
- [x] A test covers the proven attack: account A, authenticated, with `X-Owner-Email` set to organizer B, is refused both the read and the write on B's market.
- [x] The honest-header 403 that already works still works, so the fix is not "trust the header less" but "do not read it".
- [x] A grep for `X-Owner-Email` in an authorization position returns nothing.
