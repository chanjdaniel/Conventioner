---
layer: business
kind: rule
describes:
  - back-end/assignment/assignment.py#MarketAssignment.sort_vendors
  - back-end/assignment/assignment.py#MarketAssignment._rule_score
  - back-end/assignment/assignment.py#MarketAssignment._arranged_score
  - back-end/assignment/assignment.py#MarketAssignment._magnitude_score
  - back-end/csv_import.py#orders_by_submitted_at
  - front-end/src/components/elements/ElementAssignmentPriority.vue
verified: 2026-10-22
sources:
  - wayfinding/v0-1-0/02
  - wayfinding/v0-1-0/03
  - wayfinding/november-2026-dry-run/06
  - wayfinding/november-2026-dry-run/map
  - E02
  - brain-dump/2026-10-19#17
  - E34/F05/S01
---

# Priority and tie-breaks

On each date, vendors take their turn in one order: whoever has fewest dates so far, then the organizer's priority rules, then the most constrained, then whoever applied first.
The organizer's rules decide who is placed first when demand exceeds tables; the tie-breaks after them make the same market assign the same way every time.

## The order of turns

1. **Fewest dates placed so far**, so dates are shared out before anyone gets a second.
2. **The organizer's rules**, in rule order, compared as a whole: an earlier rule always outranks a later one, and a later rule only breaks a tie the earlier ones left.
3. **Most constrained first, among vendors the rules leave equal**: fewest available days, then fewest tiers across those days (Gold and Silver on three days is 6, Gold on one day is 1), so a vendor who will take less is placed before one who will take more.
4. **Earliest submission.**
5. **The address**, a last resort that is always distinct, so two vendors nothing else separates are still ordered by something the market can explain rather than by what the database returned.

A first-come rule the organizer adds settles every tie before step 3 is reached.

## What a rule says

A rule names a target and carries its own ordering ([a priority rule names a target](../../adr/0004-a-priority-rule-names-a-target.md)).
The target is a key of one of the organizer's own form fields, or a built-in attribute of the application in the `application.` namespace (`application.submitted_at`, "When the application arrived", and `application.application_type`); field keys are held to `^[a-z0-9_]+$`, so the two can never collide.
How to order follows from the target's type, and there is nothing to declare:

- **Arranged** (a select or multi-select): the organizer puts the answers in order; `<All others>` stands where every answer they left out sorts, and without it an unplaced answer sorts behind every placed one.
  A multi-select answer stands where its best-placed choice does.
  A blank answer stands behind every placed position, `<All others>` included; the rule editor's hint says how several answers and a blank sort.
- **By magnitude** (a number, a date, a checkbox, the submission time): the organizer picks an end, lowest or highest, earliest or latest, ticked or unticked first.
  An answer with no usable value sorts last whichever end is picked: an absent answer is not evidence of anything.

A rule with no target yet scores everyone alike rather than breaking the run, so an organizer part-way through building one can still assign.

**A CSV-imported row must carry its own `submitted_at`**, or first-come-first-served decides nothing: a row with no mapped timestamp is stamped with the moment of the import, the same for every row.
The import screen warns when the market has a rule over the submission time and no column is mapped to "Submitted at" (`orders_by_submitted_at`).

## Why

Priority is where markets differ from one another, so the organizer names their own questions rather than choosing from a fixed list; and "first come, first served" is the commonest tie-break there is, so it is offered though no form question can supply it.
Declaring a type beside the target let a rule declared as a number order a text field and do nothing, silently.
Most constrained first places the vendors with the fewest chances while they still have a chance, and loses nobody anything the organizer asked for.
**Fewest dates so far comes before the organizer's own rules** because spreading tables across vendors is how the real market behaves, which Daniel confirmed before the November 2026 rehearsal; most constrained first was added after its first run.

## Where it is kept

- The order of turns is `MarketAssignment.sort_vendors` in [`back-end/assignment/assignment.py`](../../../back-end/assignment/assignment.py), and a rule's score is `_rule_score`, `_arranged_score` and `_magnitude_score`; the module is [the assignment solver](../../implementation/modules/assignment-solver.md).
- The rule editor is [`ElementAssignmentPriority.vue`](../../../front-end/src/components/elements/ElementAssignmentPriority.vue): it offers the market's select, multi-select, number, date and checkbox fields, and the built-in attributes; a free-text question has nothing to arrange and is not offered.
- The import's warning is `orders_by_submitted_at` in [`back-end/csv_import.py`](../../../back-end/csv_import.py), which normalises each row's timestamp ([the CSV import](../../implementation/modules/csv-import.md)).
- Once the market can no longer reach `assignment`, the rules lock ([the assignment rules close with the assignment](the-assignment-rules-close-with-the-assignment.md)).
- The cases are pinned in [the assignment behaviour suite](../../implementation/testing/assignment-behaviour-suite.md).
