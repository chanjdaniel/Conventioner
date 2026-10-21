# Records

Part of the [knowledge graph](../README.md), implementation layer.
Every file here but this one is a node of kind `record`, and keeps the name it was written under.

A record is a dated report, frozen when it was written: a bug ledger or a test run.
Its text never changes, except a link whose target moved; it carries no `describes` and no `verified`, because it describes a moment, not the code as it is.

## Nodes

One line per node, sorted by file name.

- [MVP bugs found walking the user flows](MVP_BUGS.md) - the bug ledger, bugs 1 to 53, each with its reproduction and cause; code comments cite it as "bug N"
- [MVP usage test run, 2026-09-30](MVP_TEST_RUN_2026-09-30.md) - every flow walked with five real Google Form exports; bugs 1 to 21 retested, 22 to 44 new
- [MVP re-walk after E26, 2026-10-03](MVP_TEST_RUN_2026-10-03.md) - the three intake paths walked again after E26; bugs 48 to 53
- [Rehearsal of the November 2026 market, 2026-10-09](MVP_TEST_RUN_2026-10-09.md) - the real market rehearsed on a stand-in plan
- [Final dry run of the November 2026 market, 2026-10-18](MVP_TEST_RUN_2026-10-18.md) - the real market walked on its real room the day it went to production
