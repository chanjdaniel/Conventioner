---
layer: business
kind: rule
describes:
  - back-end/api/markets.py#assignment_rules_lock_reason
  - back-end/assignment/made_from.py#assignment_rules
verified: 2026-10-21
sources:
  - E22/F02
  - E22/F02/S01
  - E22/F02/S02
  - E36/F04/S02
---

# The assignment rules close with the assignment

The assignment rules (the priority, the maximum assignments per vendor and the half-table share) may change for exactly as long as the market can still reach `assignment`, and until results are published.
After that the plan write refuses a change to them, and restating them as stored is not a change.

**Serves:** [Every approved vendor gets a table by the market's rules](../intents/every-approved-vendor-gets-a-table-by-the-markets-rules.md) and [Results go out once, and settle the allocation](../intents/results-go-out-once-and-settle-the-allocation.md).

## Why

A rule only takes effect when the assignment runs, and it runs in `assignment` alone ([assign runs only in assignment](assign-runs-only-in-assignment.md)).
A rule changed after the market can no longer run it would read as in force while deciding nothing; a single placement is changed by hand on the Result page instead.
Publishing results settles the rules too, since the run is not made again once applicants have been told.

**Derived, never listed.**
Whether the market can still reach `assignment` is a walk of the transition table (`route_between` in `back-end/guards.py`), so a phase added or an edge moved decides it with no edit here.
Today that closes the rules in `offers`, `market_days` and `archived`; an archived market gives the archived reason instead.

**The plan saves as the organizer types, in every phase**, and always carries the rules it holds, which is why a restatement must pass: the comparison is of the rules alone (`assignment_rules`), not of the whole plan.

## Who may

An EDITOR, while the rules are open.

## Where it is kept

- `assignment_rules_lock_reason` in [`back-end/api/markets.py`](../../../back-end/api/markets.py), read by the plan write (`prepared_plan`) and served on the market as `assignmentRulesLockReason` for the rules page to mirror rather than decide the phases itself.
- The rules' comparable shape is `assignment_rules` in [`back-end/assignment/made_from.py`](../../../back-end/assignment/made_from.py), the same shape a run fingerprints ([what an assignment was made from](../../implementation/modules/made-from.md)).
- The rest of the plan settles earlier, on leaving draft, under its own lock (`setupLockReason`).
