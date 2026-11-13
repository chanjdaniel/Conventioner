---
layer: implementation
kind: module
describes:
  - back-end/assignment/lifecycle.py
  - back-end/migrations/migrate_assignment_state.py
  - back-end/datatypes.py#AssignmentState
  - back-end/api/markets.py#get_market_for_user
  - back-end/tests/test_the_allocation_table.py
verified: 2026-11-14
sources:
  - T277
  - T316
---

# The assignment's lifecycle

[`back-end/assignment/lifecycle.py`](../../../back-end/assignment/lifecycle.py) is the one owner of where a market's assignment stands.
It stores the assignment's state, serves where the table allocation stands as `allocation`, and is the only writer of the assignment's rows, its state and `publishedRevision`.
Before it, the state was read off five fields (the rows, their hand-placed flags, `madeFrom`, `resultsPublished` and the phase), each reader with its own precedence, and Publish results took a market holding only tables assigned by hand: every other approved vendor then read that they had no table, though the solver never ran (T277).
[ADR 0026](../../adr/0026-the-assignment-stores-its-state-and-publish-needs-a-run.md) records the decision.

## The stored state

`assignmentObject.state` ([`AssignmentState`](../../../back-end/datatypes.py), [the market document](../data/market-document.md)) is one of three:

- `none`: no row and no run.
- `pinned`: only tables assigned by hand, and no run yet.
- `run`: a table allocation was run.

`madeFrom` ([what an assignment was made from](made-from.md)) is required on `run`.
An allocation stored before runs recorded it carries `LEGACY_MADE_FROM`, `{"legacy": "before-fingerprints"}`, which holds no group, so it is never read as out of date, as no `madeFrom` was not.
`assignmentObject.publishedRevision` is the assignment `revision` Publish results stood on; it sits beside the `revision` it copies, and a write of the rows sets keys inside the object, so it is never dropped.

**The read trusts the stored state only while it agrees with the stored rows and `madeFrom`.**
`state_of(assignment_object, market_id)` returns the stored state when it agrees (`none` with no row and no `madeFrom`, `pinned` with rows and no `madeFrom`, `run` with a `madeFrom`; `stored_state_agrees`).
Otherwise it returns the state `derived_state` gives: `run` where `madeFrom` exists; `pinned` where every row is hand-placed and there is no `madeFrom`; `run` with the legacy marker where some row is not hand-placed, which only a run before fingerprints could have stored; else `none`.
An absent state (a market neither written nor migrated since T316, a raw seed) is derived without a word.
A disagreeing one, which a write by a release rolled back to leaves, logs one warning naming the market by id and both states, never an address.
It never raises, since a market read must not fail on a stored contradiction; the migration repairs it.

## Where the allocation stands

`allocation(market)`, an `Allocation`, is served on the market read (`get_market_for_user` in [`back-end/api/markets.py`](../../../back-end/api/markets.py)) as `allocation`, beside `assignmentOutOfDate`, whose list it is handed so the approved applications are read once:

- With `resultsPublished`: `published` while the stored `revision` is `publishedRevision`, or none was recorded (a market published before T316 that the migration has not reached is not known to have changed); else `changed_since_published`.
- Otherwise by `state_of`: `none` and `pinned` as stored, and a run `stale` or `current`.

**Whether a run is stale is judged only where a run can act on it.**
In `assignment` by every group (`changed_since_run`); in `applications` by the review group alone (`review_reopened_since_run`), since Back to review is the one way a run reaches that phase, and the cheap read keeps the stage's reads off the approved applications; in every other phase never, since no run happens there, which keeps a running market's reads off the approved applications too.
`judge_stale=False` reads a run as `current` without judging it, reading neither the phase nor the applications: the guards read it so, since a guard's verdict must not depend on the phase it is asked in ([the guards](guards.md)).

`results_out(allocation)` is true for `published` and `changed_since_published`, and `results_published(market)` asks it of a market's allocation read so.

## Every transition, as built

The events are `place` (an assignment by hand, a move, a swap), `free` and `run`.
Changing the rules, the plan or the approved applications, Back to review and Publish results write nothing to the rows: they change only what `allocation` reads.
`next_state(state, event, rows_after)`: a run makes every state `run`; a place makes `none` and `pinned` `pinned` and leaves `run`; a free leaves `none`, makes `pinned` `none` once no row is left, and leaves `run`, since a run freed down to no row is still an allocation that was made.

Each (allocation, event) pair, as the routes answer it and as [`back-end/tests/test_the_allocation_table.py`](../../../back-end/tests/test_the_allocation_table.py) walks it, one block per allocation ([two features never share a line](../conventions/two-features-never-share-a-line.md)):

**`none`**

- Place: `pinned`.
- Free: `none`, nothing written.
- Run: `current`.
- An input changes: `none`.
- Publish: refused, "Allocate tables first".
- Back to review: taken, `none`.

**`pinned`**

- Place or swap: `pinned`.
- Free: `pinned`, or `none` when the last pin goes.
- Run: `current`, the pins kept.
- An input changes: `pinned`.
- Publish: refused, the pins-only sentence.
- Back to review: taken, `pinned`.

**`current`**

- Place or swap: `current`.
- Free: `current`.
- Run: `current`.
- An input changes: `stale`.
- Publish: `published`.
- Back to review: taken, `stale`.

**`stale`**

- Place or swap: `stale`.
- Free: `stale`.
- Run: `current`.
- An input changes: `stale`.
- Publish: refused, out of date.
- Back to review: taken, `stale`.

**`published`**

- Place or swap: `changed_since_published`.
- Free: `changed_since_published`.
- Run: refused, results published.
- An input changes: `published`.
- Publish: refused, already published.
- Back to review: refused, results published.

**`changed_since_published`**

- Place or swap: `changed_since_published`.
- Free: `changed_since_published`.
- Run: refused.
- An input changes: `changed_since_published`.
- Publish: refused.
- Back to review: refused.

The table's "an input changes" is a change to the assignment rules: a vendor added by hand is left out of the run's vendors, so adding one never makes a run stale.
A rule change after results is refused (400, the rules lock), so "published" stays.

## Its interface

- `store(market, event, rows, *, assignment_date, made_from=None)`: the one write of the rows, from [placements](placements.md)' four doors.
  It sets the rows, `assignmentDate`, a null `assignmentStatistics` and `state` from `next_state` of `state_of`, so a write also repairs a state a rolled-back release left, and on a run `madeFrom`.
  It goes through [the market write](market-write.md), holding the assignment `revision` as read and counting it, and on a run `resultsPublished` too.
  A run with no `made_from`, or anything else with one, is a `RuntimeError` before anything is written, since only code calls it.
- `publish_refusal(market)`, why Publish results waits, in this order: results out ("Results are already published."); outside `assignment`; `none` ("Allocate tables first: results tell each applicant whether they have a table."); `pinned` ("Only tables assigned by hand are stored. Allocate tables first: allocating keeps them and assigns every other approved vendor, so each applicant is told whether they have a table."); `stale` (out of date); a `current` run with no row ("Nobody has a table in this allocation, ..."); else None.
  `publish_results_refusal` in [`back-end/api/applicants.py`](../../../back-end/api/applicants.py) returns it, and the market read serves it as `publishWaitsReason`; `may_publish` is it having nothing to say.
- `publish(document)`: Publish results' write, `resultsPublished` and `publishedRevision` set to the revision read (0 when none), holding the phase, the flag and the revision ([publish results waits for the allocation](../../business/rules/publish-results-waits-for-the-allocation.md)).
- `may_go_live(market)`: results out, on at least one stored row.
  The `market_days` entry invariants keep one guard per condition (`assignment_computed`, `assignment_after_review`, `results_published`), so the rail names the one that stands; together they pass exactly when this holds.
- `unallocated_refusal(market)`: the `assignment_computed` guard's sentence and remedy, `Remedy.RUN` (Allocate tables on Settings) or `Remedy.BY_HAND` (Assign tables on Assignments, where nobody is seated and a run is refused: results out, or a market left in Offers).
  It reads the phase so that the guard does not.

**A free that frees nothing writes nothing** and answers `{"removed": 0}` with 200: asking an empty seat to be empty is no transition and no error.

**It imports nothing in `api/`**, so the guards, the routes and the migration all import it.

## Who reads it, and who keeps the flag

Every refusal that asks "are results published" of the assignment asks `results_published`: `assign_refusal` ([assign runs only in assignment](../../business/rules/assign-runs-only-in-assignment.md)), `assignment_rules_lock_reason` ([the assignment rules close with the assignment](../../business/rules/the-assignment-rules-close-with-the-assignment.md)), `_why_the_review_is_closed`, `ResultsPublishedGuard` and `ResultsNotPublishedGuard`.
`AssignmentComputedGuard` reads `unallocated_refusal`, and `AssignmentNotBeforeReviewGuard` reads `review_reopened_since_run` through the owner.
A placement, a free and a swap record `after_results` in their history entry while `results_published` holds ([the market's history](../data/history.md)).

The applicant-facing reads keep reading `resultsPublished` itself: `_application_response` in `back-end/api/applicants.py`, `results_are_out` and `vendor_page_market_by_slug` in [`back-end/market_documents.py`](../../../back-end/market_documents.py), and the automatic rejections' `Rulebook`.
They ask whether applicants were told, which is the flag, not where the allocation stands, and the public slug path keeps its cheap projected read.

The front end reads the served `allocation` and never derives it from rows: an absent one reads as `none`.
The rail and the market's pages read it through [the market guide](market-guide.md) and [the market frame](market-frame.md) (`resultsAreOut` and `settledBy` in `marketPage.ts`); the out-of-date line speaks only on `stale` ([an assignment knows when it is out of date](../../business/rules/an-assignment-knows-when-it-is-out-of-date.md)); the seat dialog says what a vendor's page says once results are out ([placing by hand](../../business/flows/placing-by-hand.md)); Settings words its run "again" only on an allocation that was run ([the assignment and its result](../../business/flows/assignment-and-result.md)).
Whether a run may happen is never the allocation's to say: it is the served `assignRefusalReason`.

## The migration

[`back-end/migrations/migrate_assignment_state.py`](../../../back-end/migrations/migrate_assignment_state.py), `[--dry-run]`, gives every live market the state `derived_state` reads where its stored one is absent or disagrees, the legacy marker where the rule gives it and no `madeFrom` is stored, and a published market with none recorded its `publishedRevision`, the stored `revision` (0 when none).
Each write goes through `write_market`, holding the revision rather than counting it, since the rows are unchanged and a count would read a published market as changed; a market changed meanwhile is judged again, up to three tries, then listed as skipped.
It prints each market's id and what it sets, never a name or an address, and a count ("would set" on a dry run).
It is safe to run again, and has no boot marker, since an unmigrated market reads correctly through `state_of`.
When to run it: [`docs/OPERATIONS.md`](../../OPERATIONS.md#starting-a-database-and-migrations).

## Sharp edges

**The stored state is the owner's record; the read is robust to a release that does not write it.**
A rollback to a release before T316 writes rows without a state, or leaves a state its rows now contradict; `state_of` reads such a market correctly before the migration runs again, and the next write through `store` repairs it.

**`publishedRevision` is the whole record of what applicants were told.**
Which rows they were told is not kept: a change by hand after results reads `changed_since_published`, and each change is in the history.

**A test's run carries `madeFrom`.**
`stored_assignment` in [`back-end/tests/conftest.py`](../../../back-end/tests/conftest.py) refuses `run` without one, so no test whose verdict depends on the allocation stands on a run the product cannot make; `made_from_now(doc)` gives the fingerprint a run made now would record.

## Why

- [Publish results waits for the allocation](../../business/rules/publish-results-waits-for-the-allocation.md): never on tables assigned by hand alone.
- [An assignment knows when it is out of date](../../business/rules/an-assignment-knows-when-it-is-out-of-date.md): `stale` is its served word.
- [Placing by hand](../../business/flows/placing-by-hand.md): a change after results says so.
- [The market's lifecycle](../../business/flows/lifecycle.md): going live waits for `may_go_live`.
- [ADR 0026](../../adr/0026-the-assignment-stores-its-state-and-publish-needs-a-run.md).
