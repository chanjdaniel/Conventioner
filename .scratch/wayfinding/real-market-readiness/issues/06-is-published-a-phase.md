# 06: Is "published" a phase, or is `archived` doing double duty?

Type: grilling
Status: resolved
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

## Settled so far

Given in grilling on 2026-09-14. **Not a resolution** - this ticket stays open until the whole
round is closed.

- **Publishing becomes `assignment -> market_days`.** One row in `VALID_TRANSITIONS`, not a new
  phase: no migration, no new guard table, and `_validate_registry()` catches a mistake at import.
  It un-strands a phase that already exists and already means exactly this.
- **`archived` goes back to meaning one thing: finished.** Every `* -> archived` edge means "this
  market is over", including from `draft`, where it means "finished without ever running".
  `draft -> archived` is therefore kept, as **abandonment, not publishing** - which makes the red
  destructive styling on the Archive Market button *correct*, and retires the polish-table item
  that started this ticket.
- **Check-in gates on `market_days`.** A market abandoned from draft must not serve a public
  check-in URL.
- **Each public surface names its own phases.** `published_market_by_slug` (check-in) and
  `applicant_intake_market_by_slug` (the five applicant endpoints) answer different questions, and
  "non-draft" stops being a useful rule for either. Applicant intake narrows to
  `applications_open` - stricter than today, and the safe direction: a stranger applying to a
  market that has already assigned is current behaviour and it is wrong.
- **The new edge needs a guard**: an assignment-computed **entry invariant** on `market_days`, not
  an edge guard, so a second route to the phase later cannot bypass it. The transition endpoint is
  reachable directly and a hidden button is not a rule. Caution from a live precedent: `offers` has
  an entry invariant and is deadlocked *because nothing satisfies it*, so whatever this guard
  checks must be something the solver actually writes.

## Answer

**`market_days` is the published phase. `archived` goes back to meaning one thing: finished.**

Publishing becomes `assignment -> market_days`, fired by the Done button. `archived` stops doing
double duty.

### Why not a new phase, and why not a rename

`market_days` already exists in the phase list and already means exactly this. It was unreachable in
practice: the only route to it runs `assignment -> offers`, which
`.scratch/backlog/E05-post-mvp-offers/epic.md` records as **deadlocked** - `NoApprovedApplicationsGuard`
blocks that edge while any application is `reviewer_approved`, and nothing in `back-end/` ever
writes `assigned` or `unassigned` to clear it. So the phase was stranded behind out-of-scope work
rather than missing.

Adding `assignment -> market_days` is one row in `VALID_TRANSITIONS`: no migration of the phase
vocabulary, no new guard table, and `_validate_registry()` catches a mistake at import. Adding a
*new* phase would be the expensive version of the same idea. Renaming the button would leave the
lifecycle lying about itself and force `CONTEXT.md` to define "publish" as a synonym for "archive",
which no reader would believe.

### `draft -> archived` is kept, and it means abandonment

Every `* -> archived` edge now means "this market is over", including from `draft`, where it means
"over without ever having run". That is what makes `archived` mean one thing everywhere - and it
makes the red destructive styling on the **Archive Market** button *correct* rather than a defect,
which retires the polish-table item that started this ticket.

### Each public surface names its own phases

- **Check-in** (`published_market_by_slug`) serves `market_days`. A market abandoned from draft must
  not serve a public check-in URL.
- **Applicant intake** (`applicant_intake_market_by_slug`) narrows to `applications_open`.

"Non-draft" stops being a useful rule for either. `AGENTS.md` already said the intake gate could not
move into `published_market_by_slug` because check-in must stay open to every published market; this
answer just makes "every published market" mean something specific, and the honest consequence is
that both lookups now name their own phases. Note the applicant gate becomes **stricter** than
today - a stranger applying to a market that has already assigned is current behaviour, and it is
wrong.

### The new edge carries a guard

An **assignment-computed entry invariant** on `market_days`, in `PHASE_ENTRY_INVARIANTS` rather than
on the edge, so a second route to the phase later cannot bypass it. The transition endpoint is
reachable directly and a hidden button is not a rule.

One caution, from a live precedent in this same file: `offers` has an entry invariant and is
deadlocked *because nothing satisfies it*. Whatever this guard checks must be something the solver
actually writes - `assignmentObject.vendorAssignments` - not a status nothing sets.

### Migration

A plain script moving already-published markets from `archived` to `market_days`, so they keep their
check-in URL. No boot marker: an `archived` market that should be `market_days` fails check-in
loudly, which is not the invisible hazard the marker pattern exists for.

Expected to add **publish** to `CONTEXT.md` as the `assignment -> market_days` transition, and
`market_days` as the phase a market is in while it is running.

Buildable work: `.scratch/backlog/E03-mvp-market-lifecycle/F03-publishing-lands-in-market-days/`.
