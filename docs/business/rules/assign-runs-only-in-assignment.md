---
layer: business
kind: rule
describes:
  - back-end/api/placements.py#assign_phase_refusal
  - back-end/api/placements.py#assign_refusal
  - front-end/src/utils/assignPhase.ts
verified: 2026-10-22
sources:
  - wayfinding/readable-journey/01
  - E10/F03/S02
  - E36/F04/S02
---

# Assign runs only in assignment

The assignment runs in the `assignment` phase and nowhere else; anywhere else the run is refused with a 409 whose words name what the organizer can do from where they are.
Inside `assignment` it may be run again as often as needed, until results are published.

## Why

Before `assignment` the review is not finished, so a run would place vendors who may yet be rejected.
After it the answer is settled and vendors have been told, so a run could move someone who already knows their seat; a single placement is changed by hand on the Result page instead.
Inside `assignment` an organizer who changes the plan or approves a late application needs a fresh answer, and there is nothing yet to protect.

**It says only where Assign may run.**
It deliberately does not repeat the rules around it: "review everyone first" is the entry invariant on `assignment` (`_ALL_REVIEWED` in `back-end/guards.py`), and "run it before publishing" is the one on `market_days` (`_ASSIGNMENT_COMPUTED`).
Repeating either would give the product two places to change when one of them moves.

**It is the server's rule, not the button's**, because the endpoint is reachable directly and a hidden button is not a rule.

## Who may

An EDITOR, the bar every placement write sets; an archived market refuses anyone.

## Where it is kept

- `assign_phase_refusal` in [`back-end/api/placements.py`](../../../back-end/api/placements.py) says the phase rule, and `assign_refusal` adds published results (E36/F04/S02); the market read serves it as `assignRefusalReason`, so the Assign button says no first.
- [`front-end/src/utils/assignPhase.ts`](../../../front-end/src/utils/assignPhase.ts) mirrors the phase rule for the screens that word it before a read (the empty result, the pin hint, the out-of-date line); the server is the enforcement.
- The run itself is [placements](../../implementation/modules/placements.md).
- **A seed or a spec that wants an assignment walks the market to `assignment` first**: assigning from `draft` is a 409 (`front-end/e2e/helpers/seedAssignedMarket.ts`, [the E2E seeds](../../implementation/testing/e2e-seeds.md#reaching-a-stored-assignment)).
