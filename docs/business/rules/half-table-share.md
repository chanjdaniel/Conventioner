---
layer: business
kind: rule
describes:
  - back-end/assignment/assignment.py#MAX_HALF_TABLES_PER_SECTION
  - back-end/assignment/assignment.py#MarketAssignment._half_table_share
  - back-end/assignment/assignment.py#MarketAssignment.is_max_half_tables
  - back-end/assignment/assignment.py#MarketAssignment.get_valid_vendors
  - back-end/datatypes.py#AssignmentOptionObject
verified: 2026-10-21
sources:
  - wayfinding/november-2026-dry-run/08
  - E27
  - E27/F01/S02
---

# The half-table share

The organizer's "max half table proportion per section" bounds how much of a section goes to vendors on half tables, on each date; left blank on the Assignment tab, it runs at 30%.
It bounds only vendors who chose Either and have no partner: once their section has reached its share on that date, they are given a whole table.

**Serves:** [Every approved vendor gets a table by the market's rules](../intents/every-approved-vendor-gets-a-table-by-the-markets-rules.md).

## Whom it bounds

- **An Either chooser with no partner**, when their turn comes: below the share they take half a table, beside the next vendor who accepts a half; at or above it, a whole table.
  The share is checked only on their own turn: an Either chooser picked to fill the other half beside a Half chooser takes it whatever the share (measured with a share of 0%).
- **Never a Half chooser**: they are seated on a half whatever the share, and take a whole table only when nobody is left who could share it.
- **Never a table-share pair**: a pair is an exception to the share, and sits together even in a section that has used it ([table-share pairing](table-share-pairing.md)).
- A Full chooser always takes a whole table.

**How it is counted**: every vendor seated on a half counts one, pins included, against the section's number of tables on that date, and the check is made before each Either chooser is seated.
A shared table counts two, so a 30% share over ten tables stops at four vendors on halves, two shared tables.

## Why

A table split in two seats more vendors, and the organizer decides how much of each section that may take.
The solver ignored the setting until E27 and ran every market at a hard-coded 30%, whatever the Assignment tab said; 30% is still what blank means, so a market that left it blank assigns as it did before.

## Where it is kept

- `_half_table_share` and `is_max_half_tables` in [`back-end/assignment/assignment.py`](../../../back-end/assignment/assignment.py), with the 30% as `MAX_HALF_TABLES_PER_SECTION`; who fills the other half is `get_valid_vendors`; the module is [the assignment solver](../../implementation/modules/assignment-solver.md).
- The setting is `max_half_table_proportion_per_section` on `AssignmentOptionObject` in [`back-end/datatypes.py`](../../../back-end/datatypes.py), a whole percentage the plan write refuses outside 0 to 100, set on the Assignment tab ([`ElementAssignmentOptions.vue`](../../../front-end/src/components/elements/ElementAssignmentOptions.vue)), which caps what is typed at 100.
- A pin on half a table counts against the share, since it occupies a real seat ([placements](../../implementation/modules/placements.md#pins)).
- Once the market can no longer reach `assignment`, the setting locks with the other assignment rules ([the assignment rules close with the assignment](the-assignment-rules-close-with-the-assignment.md)).
- The cases are in [the assignment behaviour suite](../../implementation/testing/assignment-behaviour-suite.md); the 30% default is pinned by none of them.
