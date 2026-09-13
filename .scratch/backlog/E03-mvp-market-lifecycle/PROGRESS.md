# E03 progress and acceptance audit

Running record of E03 implementation.
One section per story, in dependency order.
A story is only marked done once every acceptance criterion in its file is audited here with evidence, not merely asserted.

Branch: `feat/e03-mvp-market-lifecycle`, cut from `dev` at `61826853` (E02's merge).
One commit per story, one PR at the end, following E02's shape.

## Order of work

Frontier first; a story starts only when every id in its `blocked_by` is done.

| # | Story | Blocked by | Status | PR |
| --- | --- | --- | --- | --- |
| 1 | F01/S01 FormHasFieldsGuard counts essential questions | - | not started | |
| 2 | F02/S01 A market declares how vendors reach it | - | not started | |
| 3 | F02/S02 A CSV market's applicant endpoints answer as if it did not exist | F02/S01 | not started | |
| 4 | F02/S03 A stranger visiting a CSV market's public pages is told nothing | F02/S02 | not started | |

F01/S01 and F02/S01 are both unblocked and may run in either order.
F01 has no dependency on F02: the guard correction is a pre-existing bug that MVP merely exposes.

## Audits

<!-- one section per completed story: every acceptance criterion, with the evidence that satisfies it -->
