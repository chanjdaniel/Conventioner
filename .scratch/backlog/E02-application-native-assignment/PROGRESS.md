# E02 progress and acceptance audit

Running record of E02 implementation.
One section per story, in dependency order.
A story is only marked done once every acceptance criterion in its file is audited here with evidence, not merely asserted.

## Order of work

Frontier first; a story starts only when every id in its `blocked_by` is done.

| # | Story | Blocked by | Status | PR |
| --- | --- | --- | --- | --- |
| 1 | F01/S01 Build approved applications into typed solver vendors | - | not started | |
| 2 | F01/S02 Assign a market from its Applications | F01/S01 | not started | |
| 3 | F01/S03 Honour the organizer's max assignments per vendor | F01/S02 | not started | |
| 4 | F02/S01 Build a priority rule from a form question | F01/S02 | not started | |
| 5 | F02/S02 Prioritise by when the application arrived | F02/S01 | not started | |
| 6 | F03/S01 Place vendors in their highest-ranked available section | F01/S02 | not started | |
| 7 | F04/S01 Stop the product reading source data | F02/S02, F03/S01 | not started | |
| 8 | F04/S02 Remove the source-data endpoints and collection | F04/S01 | not started | |
| 9 | F04/S03 Remove the CSV-derived fields from the setup model | F04/S02 | not started | |
| 10 | F04/S04 Remove col_name from market dates and public check-in | F04/S03 | not started | |

Stories 3, 4 and 6 are all unblocked by F01/S02 and may run in any order relative to each other.

## Audits

<!-- one section per completed story: every acceptance criterion, with the evidence that satisfies it -->
