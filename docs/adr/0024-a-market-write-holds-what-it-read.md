---
layer: implementation
kind: adr
describes:
  - back-end/market_write.py
  - back-end/tests/test_every_market_write_holds_what_it_read.py
verified: 2026-11-11
sources:
  - T244
  - T274
status: accepted
---

# A market write holds what it read

## Context

A request that changes a market reads it, judges a rule on it, and writes.
Most writes then wrote by id alone, so whatever another request changed in between was overwritten, or a rule judged on the market as read held for a market that no longer stood there.
A rename judged on a draft could land after the market opened applications, moving the public address it had just handed out; an automatic rejections save judged on an open review could land after the review closed; a highlights save could land on a market archived a moment before.
Each was reproduced against a real MongoDB with a second request landed between the read and the write.
Only four writes held what they read (the phase move, the assignment's revision, the verdicts and Publish results), each because a past bug made someone add it, so the safe write was a matter of care, not construction.
[ADR 0008](0008-each-write-names-what-it-changes.md) made every write name the part it changes; it said nothing of the market that part was judged on.

## Decision

**Every judged write to a market goes through one helper, `write_market` in [`back-end/market_write.py`](../../back-end/market_write.py), which holds what the request read in the same update that writes.**

- It always holds the market's `id` and its stored `phase` as read, so no write a phase rule judged lands after a move, an archive or a return to draft.
- It holds the stored keys the caller names at their values as read, and a revision a caller names at the revision it stood on, counting it up.
- It is one `find_one_and_update`, so nothing lands between the check and the write.
- When the market moved, it stores nothing, records no history entry, and raises `MarketChanged`: one 409 whose body is `{"error": <the sentence>, "code": "market_changed"}`, the sentence being "This market changed while you were working on it, so your change was not saved. Reload to see the latest, then make your change again."
- The front end tells that 409 apart by its `code` and re-reads the open market on it, so every screen reading the market store shows the market as it now stands, and the screen that wrote shows the server's sentence.
- A test, [`back-end/tests/test_every_market_write_holds_what_it_read.py`](../../back-end/tests/test_every_market_write_holds_what_it_read.py), walks the back end and fails on any write to the markets collection outside the helper that is not in its list of exceptions with a reason.

How it holds each kind of key, what it answers and the list: [the market write](../implementation/modules/market-write.md).

## Consequences

- A write over a market that changed is refused, not merged: the organizer reloads and makes the change again, on the market as it now stands.
  Showing another person's change as it happens is not part of this.
- A `Market` carries the stored document it was parsed from, so a writer holds exactly what its loader read; a `Market` built in code cannot be written from.
- Some writes stay outside it, each with its reason in the guard's list: the market's creation and deletion, the dealing lease's own protocol ([ADR 0020](0020-an-application-is-dealt-to-one-reviewer.md)), the essential offering's first-writer freeze, the migrations and the operator scripts.
- The writes not yet moved onto it are listed in the guard by the ticket of the task that moves them, so the list says what is left to do.
- A race between two collections, such as an application arriving as the review closes, is not one a single document's condition can hold, and stays outside it.

## Considered and rejected

- **A condition at each write site, as the four held writes had**: the safe write stays a matter of care, and the next write added forgets it, which is how all but four came to write by id.
- **Transactions**: a single-document condition holds every case here in one round trip; whether a race across collections needs one is its own decision.
- **Merging a change into the market as it now stands**: the server cannot know which of two people's choices was meant, and a rule judged on one market would be applied to another.
