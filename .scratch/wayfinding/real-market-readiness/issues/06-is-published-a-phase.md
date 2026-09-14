# 06: Is "published" a phase, or is `archived` doing double duty?

Type: grilling
Status: claimed
Blocked by:

## Question

Report polish table, and the observation that drove it onto this map rather than into the polish epic.

Publishing a market is the `draft -> archived` transition. The Done button on the assignment results
fires it, and a **red "Archive Market" button** sitting beside the phase badge fires the same thing.
Pressing it is what puts the public check-in URL on the air.

`CONTEXT.md` defines **Phase** as the single source of truth for a market's lifecycle and lists
`archived` among its values. It does not define *publish* at all, yet publishing is what the organizer
is doing and what the check-in page depends on.

So `archived` currently means two opposite things: this market is finished, and this market has just
gone live.

Decide which this is:

- **A label problem.** The phase set is right, `archived` is a poor name for "public", and the fix is
  to rename the button and add the term to `CONTEXT.md`. Cheapest, and possibly correct.
- **A missing concept.** The lifecycle genuinely lacks a live/published state, and a market that has
  just opened check-in is not archived in any ordinary sense. Adding a phase is not free: every
  precondition table in `back-end/guards.py` is validated at import, `phase_from_market_document`
  has to keep answering for documents written before it, and `migrations/migrate_is_draft_consistency.py`
  exists precisely because a previous build's idea of "published" disagreed with this one's.

Interacts with the check-in work: the phase a market is in **while people are checking in** is the
same question seen from the door, and the phase list already has a candidate. `market_days` exists,
and `("offers", "market_days")` is a valid transition - but the only path to it runs
`assignment -> offers`, which `.scratch/backlog/E05-post-mvp-offers/epic.md` records as **deadlocked**:
`NoApprovedApplicationsGuard` blocks that edge while any application is `reviewer_approved`, and
nothing in `back-end/` ever writes `assigned` or `unassigned` to clear it.

So a real market can never reach `market_days`, and `archived` is the only phase publishing can
actually land in. That is worth establishing before deciding: the question may be less "should a
published phase exist" than "one exists and is stranded behind a deadlock in work that is out of
scope". Whether the answer is to reach `market_days` some other way, to rename `archived`, or to add
something new, is what this ticket settles.

Expected to change `CONTEXT.md` either way, and to warrant an ADR if the answer is a new phase.
