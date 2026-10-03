---
id: E26
title: The user flows hold
type: epic
status: done
blocked_by: []
pr: [88]
---

## Outcome

Every flow in `docs/USER_FLOWS.md` that the product has built works as the document intends, for a real organizer with a real Google Form export and for a real vendor: nothing is blocked by a bug, nothing writes wrong data, and nothing says something untrue.
The paths P1 to P4 and P6 run end to end with the five real exports that stopped them.

## Why now

The usage test run of 2026-09-30 (`docs/MVP_TEST_RUN_2026-09-30.md`) found that the MVP's headline path did not complete for any of the five real exports, that password reset was unreachable, and 44 defects in all, registered with reproductions in `docs/MVP_BUGS.md`.
Each story below names the bugs it closes by their number in that register.

Decisions taken on 2026-10-01, with the user:

- Bug 4: the proposal offers a one-click "keep all" on a question it trims and a way to see every answer and choose which to keep; it says how many applicants would lose their only answer.
- Bug 24: an import with no "how many days" column gives every applicant no personal limit; the market's ceiling still caps them.
- Bug 39 (dates fill in calendar order): kept as it is, and recorded as known behaviour.
- Scope: bugs only; planned flows (E05 offers) and screen-less flows (delete account, transfer organization, `/init`) are out.

Open Wayfinder tickets this epic settles: `claims-and-room` 04 (who is in the vendors list), 05 (what the dialog says before an override), 06 (does a market remember where it has been) and 07 (the rail's second row).

## Features

- `F01` - accounts reach their own pages.
- `F02` - real exports import.
- `F03` - the form keeps what it asks.
- `F04` - the plan saves once, and every plan can be assigned.
- `F05` - placements tell the truth.
- `F06` - an archive is a record.
- `F07` - vendors can apply online.
- `F08` - screens match the person's role.
- `F09` - the floorplan beta places tables.
- `F10` - polish, copy and accessibility.
- `F11` - the re-walk holds.
