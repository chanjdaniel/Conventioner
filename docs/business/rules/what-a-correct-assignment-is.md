---
layer: business
kind: rule
verified: 2026-10-22
sources:
  - wayfinding/november-2026-dry-run/07
  - wayfinding/november-2026-dry-run/map
---

# What a correct assignment is

An assignment of a real market is correct when five things hold, each checked on the screens and against the stored assignment:

1. **Every row imports**, and a second import of the same file changes nothing.
2. **No vendor's answers are broken**: nobody is placed on a day they said they cannot come, at a tier they did not choose for that day, or on more days than their own limit.
3. **Every approved vendor is placed, or says why**, in words the organizer can read.
4. **Pairs sit together**, by [table-share pairing](table-share-pairing.md).
5. **The order is respected**: nobody left unplaced on a day outranks, by the organizer's priority rules and the tie-breaks after them, someone placed at the same tier that day, allowing for the built-in "fewest dates so far go first" ahead of the rules ([priority and tie-breaks](priority-and-tie-breaks.md)).

## Why

These are what an organizer can judge a result by: whether everyone who applied is in, whether anyone got what they refused, whether anyone is left without a reason, and whether the market's own order decided who got the tables.
They were fixed with Daniel as the pass criteria of the November 2026 rehearsal, the first run on a market that had not happened yet, so that its assignment could be judged right or wrong against what the organizer knows and then used.

## Where it is kept

Each criterion is pinned where its rule is:

- 1: a re-import updates in place and writes nothing for an unchanged applicant ([importing a Google Form's responses](../flows/import.md)); `back-end/tests/test_csv_import.py` ("an unchanged re-import changes nothing").
- 2: [tier filters, section prefers](tier-filters-section-prefers.md) and [the ceiling on dates per vendor](max-assignments-ceiling.md); `back-end/tests/test_tier_per_date.py` holds a tier to the day it was chosen for.
- 3: [why a vendor was not placed](why-a-vendor-was-not-placed.md); `back-end/tests/test_placement_reasons.py`.
- 4: [table-share pairing](table-share-pairing.md) and [the half-table share](half-table-share.md), which never splits a pair.
- 5: [priority and tie-breaks](priority-and-tie-breaks.md).

The solver's side of 2, 4 and 5 is [the assignment behaviour suite](../../implementation/testing/assignment-behaviour-suite.md), whose cases state each in a vendor's terms; a change to placement that would break one of the five changes a case there first.

## Evidence

The rehearsal of 2026-10-09 ran the real November 2026 export (212 responses, three market days) on the market's real plan and the organizer's own verdicts, from the start from a CSV to check-in on all three days, and passed all five; the run is recorded in `docs/records/MVP_TEST_RUN_2026-10-09.md`.
On the way it changed two rules with Daniel, both now in [table-share pairing](table-share-pairing.md): an answer naming several addresses pairs with the first that belongs to an applicant, and the half-table share never blocks a pair.
A second run with the organizer's changes (no first-come rule, and the vendor with fewer tiers placed first among equals) placed 209 of 211.
